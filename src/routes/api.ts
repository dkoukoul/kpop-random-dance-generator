import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { mkdir, access, stat } from 'fs/promises';
import type { GenerateRequest, SongSegment, FailedSegment } from '../types';
import { getVideoInfo, downloadSegment, searchVideos } from '../services/youtube';
import { generateReport, saveReport } from '../services/report';
import { concatenateWithCountdown, generateCountdownAudio, cleanupTempFiles } from '../services/audio';
import { logVisit, logGeneration, getStats } from '../services/analytics';

const api = new Hono();

// Store for tracking generation jobs
const jobs = new Map<string, {
  status: 'processing' | 'complete' | 'error';
  filename?: string;
  reportFilename?: string;
  error?: string;
  progress?: string;
  progressCurrent?: number;
  progressTotal?: number;
  failedSegments?: FailedSegment[];
}>();

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

// Initialize
ensureDirs();
ensureCountdownAudio();

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
 * GET /api/top-songs
 * Get top 10 most used songs in generations (Public)
 */
api.get('/top-songs', async (c) => {
  const stats = getStats();
  return c.json(stats.topSongs);
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
  
  try {
    const info = await getVideoInfo(url);
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
  const body = await c.req.json<GenerateRequest>();
  
  if (!body.segments || body.segments.length === 0) {
    return c.json({ error: 'No segments provided' }, 400);
  }
  
  const jobId = uuidv4();
  jobs.set(jobId, { status: 'processing', progress: 'Starting...' });
  
  // Log generation for analytics
  logGeneration(jobId, body.segments).catch(err => console.error('Logging generation error:', err));
  
  // Process in background
  processGeneration(jobId, body.segments).catch((error) => {
    console.error('Generation error:', error);
    jobs.set(jobId, { status: 'error', error: error.message });
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
 * GET /api/download-report/:jobId
 * Download the generated report JSON file
 */
api.get('/download-report/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const job = jobs.get(jobId);
  
  if (!job || job.status !== 'complete' || !job.reportFilename) {
    return c.json({ error: 'Report not ready or not found' }, 404);
  }
  
  const filePath = join(TEMP_DIR, job.reportFilename);
  
  try {
    const file = Bun.file(filePath);
    
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="random-dance-report-${jobId.slice(0, 8)}.json"`);
    
    return c.body(await file.text());
  } catch (error) {
    console.error('Report download error:', error);
    return c.json({ error: 'Failed to download report' }, 500);
  }
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/contact
 * Send a contact form message via Resend, without exposing the recipient's email to the client
 */
api.post('/contact', async (c) => {
  const body = await c.req.json<{ email?: string; message?: string; website?: string }>();

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
async function processGeneration(jobId: string, segments: SongSegment[]) {
  const segmentPaths: string[] = [];
  const successfulSegments: SongSegment[] = [];
  const failedSegments: FailedSegment[] = [];

  try {
    await ensureCountdownAudio();

    // Download each segment. A single segment failing (bad/blocked video,
    // yt-dlp/ffmpeg hiccup, etc.) shouldn't throw away everything already
    // downloaded, so failures are recorded and the rest of the mix continues.
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;

      const segmentPath = join(TEMP_DIR, `${jobId}_segment_${i}.mp3`);

      jobs.set(jobId, {
        status: 'processing',
        progress: `Downloading segment ${i + 1}/${segments.length}: ${segment.title}`,
        progressCurrent: i + 1,
        progressTotal: segments.length
      });

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
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`Skipping segment "${segment.title}" (${segment.youtubeUrl}):`, reason);
        failedSegments.push({
          title: segment.title,
          youtubeUrl: segment.youtubeUrl,
          reason: extractErrorReason(reason)
        });
      }
    }

    if (segmentPaths.length === 0) {
      throw new Error('All segments failed to download');
    }

    // Concatenate all successfully-downloaded segments with countdown.
    // Failed segments were never added to segmentPaths, so no orphan
    // countdown is mixed in for songs that didn't make it in.
    jobs.set(jobId, { status: 'processing', progress: 'Combining audio...' });

    const outputFilename = `output_${jobId}.mp3`;
    const outputPath = join(TEMP_DIR, outputFilename);

    await concatenateWithCountdown(segmentPaths, COUNTDOWN_PATH, outputPath);

    // Clean up segment files
    await cleanupTempFiles(segmentPaths);

    // Generate Report (only reflects songs actually included in the mix)
    console.log(`Generating report for job ${jobId}...`);
    const report = await generateReport(successfulSegments, failedSegments);
    const reportPath = await saveReport(report, jobId, TEMP_DIR);
    const reportFilename = reportPath.split('/').pop()!; // Extract filename

    jobs.set(jobId, {
      status: 'complete',
      filename: outputFilename,
      reportFilename: reportFilename,
      failedSegments: failedSegments.length > 0 ? failedSegments : undefined
    });
    console.log(`Generation complete: ${outputFilename}, Report: ${reportFilename}${failedSegments.length > 0 ? `, ${failedSegments.length} segment(s) skipped` : ''}`);

  } catch (error) {
    // Clean up on error
    await cleanupTempFiles(segmentPaths);
    throw error;
  }
}

export default api;
