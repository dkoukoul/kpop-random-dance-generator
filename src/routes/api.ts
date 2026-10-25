import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { mkdir, access, stat } from 'fs/promises';
import type { GenerateRequest, SongSegment, FailedSegment } from '../types';
import { getVideoInfo, downloadSegment, searchVideos, parseTimeToSeconds } from '../services/youtube';
import { generateReport, buildSetlist, songStartTimes } from '../services/report';
import { concatenateWithCountdown, generateCountdownAudio, cleanupTempFiles, audioDuration, trimToLast, fadeOutEnd } from '../services/audio';
import { logVisit, logGeneration, getStats, getPopularCut, getTopSongs } from '../services/analytics';
import { getYtdlpStatus, updateYtdlp } from '../services/ytdlp-updater';
import { toYoutubeWatchUrl } from '../services/youtube-url';

const api = new Hono();

type SongState = 'waiting' | 'working' | 'done' | 'skipped';

interface Job {
  status: 'processing' | 'complete' | 'error';
  filename?: string;
  setlistFilename?: string;
  error?: string;
  failedSegments?: FailedSegment[];
  // One state per requested song, in order.
  phase?: 'downloading' | 'combining';
  startedAt: number;
  songs: { state: SongState; reason?: string }[];
}

// Generation jobs, in memory: a restart forgets them.
const jobs = new Map<string, Job>();

function updateJob(jobId: string, patch: Partial<Job>): void {
  const job = jobs.get(jobId);
  if (job) jobs.set(jobId, { ...job, ...patch });
}

function setSongState(jobId: string, index: number, state: SongState, reason?: string): void {
  const job = jobs.get(jobId);
  if (!job || !job.songs[index]) return;
  const songs = job.songs.slice();
  songs[index] = reason ? { state, reason } : { state };
  jobs.set(jobId, { ...job, songs });
}

const JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// No mix takes this long; a job still "processing" after it is stuck.
const STUCK_JOB_MS = 6 * 60 * 60 * 1000;

/** Forget jobs older than a day (their files are long gone) and stuck ones. */
export function pruneJobs(now = Date.now()): void {
  for (const [id, job] of jobs) {
    const age = now - job.startedAt;
    if (age > JOB_MAX_AGE_MS || (job.status === 'processing' && age > STUCK_JOB_MS)) jobs.delete(id);
  }
}

// Pull out the actual yt-dlp/ffmpeg ERROR line so failure reasons shown to users
// aren't buried in version-warning noise.
function extractErrorReason(message: string): string {
  const match = message.match(/ERROR:\s*(.+)/);
  return match ? match[1]!.trim() : message;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Paths
const TEMP_DIR = join(process.cwd(), 'temp');
const ASSETS_DIR = join(process.cwd(), 'assets');
const COUNTDOWN_PATH = join(ASSETS_DIR, 'countdown.mp3');
// The last 3 seconds of countdown.mp3 ("3, 2, 1").
const COUNTDOWN_3S_PATH = join(ASSETS_DIR, 'countdown-3s.mp3');

/** The countdown the host chose: 3 or 5 seconds, 5 for anything else. */
export function countdownChoice(value: unknown): 3 | 5 {
  return value === 3 ? 3 : 5;
}

/** The fade-out at the end of each song: 1, 2 or 3 seconds, or 0 (none) for anything else. */
export function fadeOutChoice(value: unknown): 0 | 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}

// Ensure directories exist
async function ensureDirs() {
  try {
    await mkdir(TEMP_DIR, { recursive: true });
    await mkdir(ASSETS_DIR, { recursive: true });
  } catch (e) {
    // Ignore if exists
  }
}

// Ensure countdown audio exists
async function ensureCountdownAudio() {
  try {
    await access(COUNTDOWN_PATH);
  } catch {
    console.log('Countdown audio not found, generating...');
    await generateCountdownAudio(COUNTDOWN_PATH);
  }
}

// The 3-second file ships in assets/; if it's missing, it's cut once from the
// 5-second one. Never fails: without it, mixes use the 5-second countdown.
let shortCountdown: Promise<boolean> | null = null;
function ensureShortCountdown(): Promise<boolean> {
  shortCountdown ??= (async () => {
    try {
      await access(COUNTDOWN_3S_PATH);
      return true;
    } catch {
      console.log('3-second countdown not found, cutting it from the 5-second one...');
      try {
        await ensureCountdownAudio();
        await trimToLast(COUNTDOWN_PATH, 3, COUNTDOWN_3S_PATH);
        return true;
      } catch (error) {
        console.error('Could not make the 3-second countdown; using the 5-second one:', error);
        shortCountdown = null; // try again next time
        return false;
      }
    }
  })();
  return shortCountdown;
}

// Initialize
ensureDirs();
ensureCountdownAudio()
  .then(ensureShortCountdown)
  .catch((error) => console.error('Could not make the countdown audio:', error));

/**
 * POST /api/visit
 * Log a user visit
 */
api.post('/visit', async (c) => {
  const userAgent = c.req.header('user-agent') || 'unknown';
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  
  await logVisit(userAgent, ip);
  return c.json({ success: true });
});

/**
 * GET /api/stats
 * Get basic analytics stats (Protected)
 */
api.get('/stats', basicAuth({
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin'
}), async (c) => {
  const stats = getStats();
  return c.json(stats);
});

/**
 * GET /api/ytdlp-status
 * Report the yt-dlp version and last update check (Protected).
 * Downloads failing en masse is almost always a stale yt-dlp, so make it visible.
 */
api.get('/ytdlp-status', basicAuth({
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin'
}), async (c) => {
  return c.json({ ...getYtdlpStatus(), activeJobs: activeJobCount() });
});

/** Mixes still being made. Jobs live in memory, so a restart kills these. */
export function activeJobCount(): number {
  let count = 0;
  for (const job of jobs.values()) if (job.status === 'processing') count++;
  return count;
}

/**
 * POST /api/ytdlp-update
 * Force a yt-dlp self-update without restarting the server (Protected)
 */
api.post('/ytdlp-update', basicAuth({
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'admin'
}), async (c) => {
  const updated = await updateYtdlp();
  return c.json({ updated, ...getYtdlpStatus() });
});

/**
 * GET /api/top-songs
 * Top 10 most used videos in past mixes, one row per video (Public).
 * Shown on every page view, so it is cached (see createTopSongsLookup).
 */
api.get('/top-songs', (c) => {
  return c.json(getTopSongs());
});

/**
 * GET /api/popular-cut?url=...
 * The community's most common cut for a video, used to prefill new cards.
 * Returns { cut: null } when fewer than 3 people picked the same cut.
 */
api.get('/popular-cut', (c) => {
  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'URL is required' }, 400);
  }
  return c.json({ cut: getPopularCut(url) });
});

/**
 * GET /api/youtube/info?url=...
 * Fetch video metadata from YouTube
 */
api.get('/youtube/info', async (c) => {
  const url = c.req.query('url');
  
  if (!url) {
    return c.json({ error: 'URL is required' }, 400);
  }

  const watchUrl = toYoutubeWatchUrl(url);
  if (!watchUrl) {
    return c.json({ error: 'That is not a YouTube video link' }, 400);
  }

  try {
    const info = await getVideoInfo(watchUrl);
    return c.json(info);
  } catch (error) {
    console.error('Error fetching video info:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: `Failed to fetch video info: ${errorMessage}` }, 500);
  }
});

/**
 * GET /api/bands
 * Fetch the list of bands for variety tracking
 */
api.get('/bands', async (c) => {
  const filePath = join(ASSETS_DIR, 'band-list.txt');
  try {
    const file = Bun.file(filePath);
    const text = await file.text();
    return c.text(text);
  } catch (error) {
    console.error('Error reading band list:', error);
    return c.text('', 404);
  }
});

/**
 * GET /api/youtube/search?q=...
 * Search for videos on YouTube
 */
api.get('/youtube/search', async (c) => {
  const query = c.req.query('q');
  console.log(`📡 GET /api/youtube/search?q=${query}`);
  
  if (!query) {
    console.warn('⚠️ Missing query parameter');
    return c.json({ error: 'Query is required' }, 400);
  }
  
  try {
    console.log('🌐 Calling searchVideos...');
    const results = await searchVideos(query);
    console.log(`✅ Search successful, returning ${results.length} results`);
    return c.json(results);
  } catch (error) {
    console.error('❌ Error searching YouTube API route:', error);
    return c.json({ error: 'Failed to search YouTube' }, 500);
  }
});

/**
 * POST /api/generate
 * Generate the final audio file with all segments and countdowns
 */
api.post('/generate', async (c) => {
  const body = await c.req.json<GenerateRequest>().catch(() => null);
  
  if (!body || !Array.isArray(body.segments) || body.segments.length === 0) {
    return c.json({ error: 'No segments provided' }, 400);
  }

  // Only YouTube videos reach yt-dlp, as clean watch URLs (see youtube-url.ts).
  // A song with any other link is skipped like an unavailable video, so one
  // typo doesn't cost the host the whole mix.
  let validSongs = 0;
  for (const segment of body.segments) {
    const watchUrl = segment ? toYoutubeWatchUrl(segment.youtubeUrl) : null;
    if (segment && watchUrl) {
      segment.youtubeUrl = watchUrl;
      validSongs++;
    }
  }
  if (validSongs === 0) {
    return c.json({ error: 'None of the songs has a YouTube video link' }, 400);
  }

  const countdownSeconds = countdownChoice(body.countdownSeconds);
  const fadeOutSeconds = fadeOutChoice(body.fadeOutSeconds);

  pruneJobs();
  const jobId = uuidv4();
  jobs.set(jobId, {
    status: 'processing',
    phase: 'downloading',
    startedAt: Date.now(),
    songs: body.segments.map(() => ({ state: 'waiting' as const })),
  });
  
  // Log generation for analytics
  logGeneration(jobId, body.segments, { countdownSeconds, fadeOutSeconds }).catch(err => console.error('Logging generation error:', err));
  
  // Process in background
  processGeneration(jobId, body.segments, countdownSeconds, fadeOutSeconds).catch((error) => {
    console.error('Generation error:', error);
    updateJob(jobId, { status: 'error', error: error.message });
  });
  
  return c.json({ jobId });
});

/**
 * GET /api/status/:jobId
 * Check the status of a generation job
 */
api.get('/status/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = jobs.get(jobId);
  
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }
  
  return c.json(job);
});

/**
 * GET /api/download/:jobId
 * Download the generated audio file
 */
api.get('/download/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = jobs.get(jobId);
  
  if (!job || job.status !== 'complete' || !job.filename) {
    return c.json({ error: 'File not ready or not found' }, 404);
  }
  
  const filePath = join(TEMP_DIR, job.filename);
  // temp/ is cleaned daily, so an old mix can be gone while the job is known.
  if (!(await Bun.file(filePath).exists())) {
    return c.json({ error: 'This mix has expired. Generate it again.' }, 410);
  }
  
  try {
    const file = Bun.file(filePath);
    const fileStats = await stat(filePath);
    
    c.header('Content-Type', 'audio/mpeg');
    c.header('Content-Disposition', `attachment; filename="random-dance-${jobId.slice(0, 8)}.mp3"`);
    c.header('Content-Length', fileStats.size.toString());
    
    return c.body(await file.arrayBuffer());
  } catch (error) {
    console.error('Download error:', error);
    return c.json({ error: 'Failed to download file' }, 500);
  }
});

/**
 * GET /api/download-setlist/:jobId
 * The setlist as plain text, with the time each song starts in the MP3
 */
api.get('/download-setlist/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = jobs.get(jobId);

  if (!job || job.status !== 'complete' || !job.setlistFilename) {
    return c.json({ error: 'Setlist not ready or not found' }, 404);
  }

  const file = Bun.file(join(TEMP_DIR, job.setlistFilename));
  if (!(await file.exists())) {
    return c.json({ error: 'This setlist has expired. Generate the mix again.' }, 410);
  }

  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="random-dance-setlist-${jobId.slice(0, 8)}.txt"`);
  return c.body(await file.text());
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/contact
 * Send a contact form message via Resend, without exposing the recipient's email to the client
 */
api.post('/contact', async (c) => {
  const body = await c.req.json<{ email?: string; message?: string; website?: string }>().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid request' }, 400);
  }

  // Honeypot field: real users never fill in a field hidden via CSS, bots do.
  // Pretend success so bots don't learn to skip it.
  if (body.website) {
    return c.json({ success: true });
  }

  const email = (body.email || '').trim();
  const message = (body.message || '').trim();

  if (!email || !EMAIL_REGEX.test(email)) {
    return c.json({ error: 'Please provide a valid email address' }, 400);
  }

  if (!message || message.length > 5000) {
    return c.json({ error: 'Please provide a message (max 5000 characters)' }, 400);
  }

  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.CONTACT_TO_EMAIL;

  if (!apiKey || !toEmail) {
    console.error('Contact form submitted but RESEND_API_KEY or CONTACT_TO_EMAIL is not configured');
    return c.json({ error: 'Contact form is not configured' }, 500);
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.CONTACT_FROM_EMAIL || 'Contact Form <onboarding@resend.dev>',
        to: [toEmail],
        reply_to: email,
        subject: 'New message from Random Dance Generator contact form',
        text: `From: ${email}\n\n${message}`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Resend API error:', response.status, errorBody);
      return c.json({ error: 'Failed to send message' }, 502);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error sending contact message:', error);
    return c.json({ error: 'Failed to send message' }, 500);
  }
});

/**
 * Background processing function
 */
async function processGeneration(jobId: string, segments: SongSegment[], countdown: 3 | 5 = 5, fadeOut: 0 | 1 | 2 | 3 = 0) {
  const segmentPaths: string[] = [];
  const segmentSeconds: number[] = [];
  const successfulSegments: SongSegment[] = [];
  const failedSegments: FailedSegment[] = [];

  const skip = (index: number, failed: FailedSegment) => {
    failedSegments.push(failed);
    setSongState(jobId, index, 'skipped', failed.reason);
    // Shown as they happen, not only at the end.
    updateJob(jobId, { failedSegments: failedSegments.slice() });
  };

  try {
    await ensureCountdownAudio();
    const countdownPath = countdown === 3 && (await ensureShortCountdown()) ? COUNTDOWN_3S_PATH : COUNTDOWN_PATH;

    // Download each segment. A single segment failing (bad/blocked video,
    // yt-dlp/ffmpeg hiccup, etc.) shouldn't throw away everything already
    // downloaded, so failures are recorded and the rest of the mix continues.
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;

      // The route already cleaned every valid link; anything else never
      // reaches yt-dlp.
      if (!toYoutubeWatchUrl(segment.youtubeUrl)) {
        skip(i, {
          title: String(segment.title ?? ''),
          youtubeUrl: String(segment.youtubeUrl ?? ''),
          reason: 'Not a YouTube video link',
          index: i,
        });
        continue;
      }

      const segmentPath = join(TEMP_DIR, `${jobId}_segment_${i}.mp3`);

      setSongState(jobId, i, 'working');

      // Space out requests to YouTube so large batches don't read as bot-like bursts
      if (i > 0) {
        await sleep(1500);
      }

      try {
        await downloadSegment(
          segment.youtubeUrl,
          segment.startTime,
          segment.endTime,
          segmentPath
        );
        segmentPaths.push(segmentPath);
        successfulSegments.push(segment);
        // The real length, for the setlist's start times.
        const cutSeconds = parseTimeToSeconds(segment.endTime) - parseTimeToSeconds(segment.startTime);
        const length = await audioDuration(segmentPath).catch(() => cutSeconds);
        segmentSeconds.push(length);
        if (fadeOut > 0) {
          // A song without its fade is better than no song.
          await fadeOutEnd(segmentPath, fadeOut, length).catch((error) =>
            console.error(`Could not fade out "${segment.title}"; keeping the hard cut:`, error));
        }
        setSongState(jobId, i, 'done');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`Skipping segment "${segment.title}" (${segment.youtubeUrl}):`, reason);
        skip(i, {
          title: segment.title,
          youtubeUrl: segment.youtubeUrl,
          reason: extractErrorReason(reason),
          index: i,
        });
      }
    }

    if (segmentPaths.length === 0) {
      throw new Error('All segments failed to download');
    }

    // Concatenate all successfully-downloaded segments with countdown.
    // Failed segments were never added to segmentPaths, so no orphan
    // countdown is mixed in for songs that didn't make it in.
    updateJob(jobId, { phase: 'combining' });

    const outputFilename = `output_${jobId}.mp3`;
    const outputPath = join(TEMP_DIR, outputFilename);

    await concatenateWithCountdown(segmentPaths, countdownPath, outputPath);

    // Clean up segment files
    await cleanupTempFiles(segmentPaths);

    // Band and title of each song actually in the mix, for the setlist.
    const report = await generateReport(successfulSegments);

    // The setlist is a bonus: if it can't be written, the mix still ships.
    let setlistFilename: string | undefined;
    try {
      const countdownSeconds = await audioDuration(countdownPath);
      const mixSeconds = await audioDuration(outputPath).catch(() => undefined);
      const starts = songStartTimes(countdownSeconds, segmentSeconds, mixSeconds);
      const total = mixSeconds ?? segmentSeconds.reduce((t, s) => t + countdownSeconds + s, 0);
      setlistFilename = `${jobId}_setlist.txt`;
      await Bun.write(join(TEMP_DIR, setlistFilename), buildSetlist(report.playlist, starts, total, failedSegments, countdown, fadeOut));
    } catch (error) {
      console.error(`Could not write the setlist for job ${jobId}:`, error);
      setlistFilename = undefined;
    }

    updateJob(jobId, {
      status: 'complete',
      filename: outputFilename,
      setlistFilename,
      failedSegments: failedSegments.length > 0 ? failedSegments : undefined
    });
    console.log(`Generation complete: ${outputFilename}${failedSegments.length > 0 ? `, ${failedSegments.length} segment(s) skipped` : ''}`);

  } catch (error) {
    // Clean up on error
    await cleanupTempFiles(segmentPaths);
    throw error;
  }
}

export default api;
