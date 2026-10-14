import { spawn } from 'child_process';
import { unlink } from 'fs/promises';
import type { VideoInfo } from '../types';

// Get yt-dlp path from environment, fallback to 'yt-dlp'
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';

import { getCache, setCache } from './cache';

/**
 * Extract video information using yt-dlp --dump-json
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  console.log(`🔍 [Bun.spawn] Fetching info for: ${url}`);
  try {
    // Use minimal flags to avoid format selection issues
    const proc = Bun.spawn([
      YTDLP_PATH,
      '--dump-json',
      '--no-download',
      '--skip-download', 
      '--no-playlist',
      '--no-check-certificate',
      url
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    console.log(`📥 yt-dlp info exited with code ${exitCode}`);
    if (stdoutText.trim()) {
      console.log(`📤 stdout: ${stdoutText.substring(0, 500)}${stdoutText.length > 500 ? '...' : ''}`);
    }
    if (stderrText.trim()) {
      console.log(`⚠️ stderr: ${stderrText}`);
    }

    // Handle case where yt-dlp returns empty output or fails
    if (!stdoutText.trim()) {
      console.error('❌ Empty response from yt-dlp');
      if (exitCode !== 0) {
        console.error(`❌ yt-dlp info failed (exit ${exitCode}): ${stderrText}`);
        throw new Error(`yt-dlp failed with exit code ${exitCode}: ${stderrText}`);
      }
      throw new Error('No video info returned - yt-dlp produced empty output');
    }

    // Even with non-zero exit code, try to parse if we have output
    let info;
    try {
      info = JSON.parse(stdoutText);
    } catch (parseError) {
      console.error('❌ Failed to parse JSON response:', parseError);
      console.error('Raw stdout:', stdoutText);
      throw new Error('Invalid JSON response from yt-dlp');
    }
    
    // In flat-playlist mode, individual thumbnails might be in thumbnails array
    let thumbnailUrl = info.thumbnail || '';
    if (!thumbnailUrl && info.thumbnails && info.thumbnails.length > 0) {
      // Pick the last one (usually highest quality)
      thumbnailUrl = info.thumbnails[info.thumbnails.length - 1].url;
    }

    return {
      title: info.title || 'Unknown Title',
      duration: info.duration || 0,
      thumbnail: thumbnailUrl,
      channel: info.channel || info.uploader || 'Unknown',
    };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    console.error('❌ Failed to fetch/parse video info:', errorMessage);
    console.error('Full error:', e);
    throw new Error(`Failed to fetch video info: ${errorMessage}`);
  }
}

export async function searchVideos(query: string, limit: number = 5): Promise<VideoInfo[]> {
  const cacheKey = `search:${query}:${limit}`;
  const cached = getCache<VideoInfo[]>(cacheKey);
  
  if (cached) {
    console.log(`🎯 Cache hit for search: "${query}"`);
    return cached;
  }

  console.log(`🔍 [Bun.spawn] Searching YouTube: "${query}" (limit: ${limit})`);
  
  try {
    const proc = Bun.spawn([
      YTDLP_PATH,
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--no-download',
      '--skip-download',
      '--ignore-errors',
      '--no-check-certificate',
      '--no-playlist',
      '--flat-playlist',
      '--no-warnings',
      '--quiet',
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    console.log(`📥 yt-dlp search exited with code ${exitCode}`);

    if (stdoutText.trim() === '') {
      if (exitCode !== 0) {
        console.error(`❌ yt-dlp search failed (exit ${exitCode}): ${stderrText}`);
        throw new Error(`yt-dlp search failed: ${stderrText}`);
      }
      return [];
    }

    const lines = stdoutText.trim().split('\n');
    console.log(`✅ Found ${lines.length} search results`);

    const results = lines.map(line => {
      try {
        const info = JSON.parse(line);
        
        let thumbnailUrl = info.thumbnail || '';
        if (!thumbnailUrl && info.thumbnails && info.thumbnails.length > 0) {
          thumbnailUrl = info.thumbnails[info.thumbnails.length - 1].url;
        }

        return {
          title: info.title || 'Unknown Title',
          duration: info.duration || 0,
          thumbnail: thumbnailUrl,
          channel: info.channel || info.uploader || 'Unknown',
          url: info.webpage_url || info.url || (info.id ? `https://www.youtube.com/watch?v=${info.id}` : '')
        };
      } catch (e) {
        console.error('⚠️ Failed to parse a search result line:', e);
        return null;
      }
    }).filter(item => item !== null) as VideoInfo[];

    // Cache results for 24 hours
    setCache(cacheKey, results, 24 * 60 * 60);
    
    return results;

  } catch (error) {
    console.error('❌ Bun.spawn search error:', error);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Hard ceiling on a single yt-dlp invocation so a wedged process can't stall
// an entire generation job forever.
const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 1000;

// Ceiling across all retries and client fallbacks for one segment. Without this,
// repeated timeouts could chain into tens of minutes on a single song.
const SEGMENT_BUDGET_MS = 8 * 60 * 1000;

// YouTube periodically breaks extraction for whichever player client yt-dlp
// picks by default (the default client's media URLs start returning 403).
// Trying a couple of alternates keeps downloads working during the window
// between YouTube's change and a yt-dlp release that handles it.
// `null` means "let yt-dlp choose", which is the fast path that normally works.
const PLAYER_CLIENT_FALLBACKS: (string | null)[] = [null, 'web_embedded', 'tv_embedded', 'mweb'];

// YouTube's anti-bot challenge and its own rate-limit cooldown are transient -
// a short backoff and retry often succeeds where an immediate retry wouldn't.
function isTransientYoutubeError(message: string): boolean {
  return /sign in to confirm you.?re not a bot/i.test(message) ||
    /rate-limited by youtube/i.test(message) ||
    /content isn.?t available, try again later/i.test(message) ||
    /too many requests/i.test(message) ||
    /HTTP Error 5\d\d/i.test(message) ||
    /timed out|timeout/i.test(message);
}

// Symptoms of the current player client being blocked or broken rather than the
// video being unavailable. A different client usually succeeds immediately, so
// these are worth a fallback rather than a backoff.
// Note: `--download-sections` hands the media URL to ffmpeg, so a 403 there
// surfaces only as "ffmpeg exited with code 8".
function isClientBlockedError(message: string): boolean {
  return /HTTP Error 403|403 Forbidden/i.test(message) ||
    /ffmpeg exited with code 8/i.test(message) ||
    /requested format is not available/i.test(message) ||
    /unable to download video data/i.test(message) ||
    /only images are available/i.test(message) ||
    /the page needs to be reloaded/i.test(message) ||
    /po token/i.test(message) ||
    /sabr/i.test(message);
}

/**
 * Download a specific segment of audio from a YouTube video
 * Uses yt-dlp's --download-sections to only download the required portion
 * Post-processes with ffmpeg to trim container cue-point rounding excess
 *
 * Resilience has two layers: transient bot-check/rate-limit failures get a
 * backoff and retry on the same client, while failures that look like the
 * client itself being blocked move on to the next client in the fallback list.
 */
export async function downloadSegment(
  url: string,
  startTime: string,
  endTime: string,
  outputPath: string,
  maxRetries: number = 2
): Promise<void> {
  let lastError: Error = new Error('Download failed');
  const deadline = Date.now() + SEGMENT_BUDGET_MS;

  for (const playerClient of PLAYER_CLIENT_FALLBACKS) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (Date.now() >= deadline) {
        console.warn(`⌛ Giving up on ${url} after ${SEGMENT_BUDGET_MS / 60000} minutes`);
        throw lastError;
      }

      try {
        await attemptDownloadSegment(url, startTime, endTime, outputPath, playerClient);
        if (playerClient) {
          console.log(`✅ Downloaded ${url} using fallback player client "${playerClient}"`);
        }
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (isTransientYoutubeError(lastError.message) && attempt < maxRetries && Date.now() + 5000 * (attempt + 1) < deadline) {
          const backoffMs = 5000 * (attempt + 1);
          console.warn(`⏳ Transient YouTube error for ${url}, retrying in ${backoffMs / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
          await sleep(backoffMs);
          continue;
        }

        if (isClientBlockedError(lastError.message)) {
          console.warn(`🔁 Player client "${playerClient ?? 'default'}" blocked for ${url}, trying next client`);
        } else {
          // Genuinely unavailable video (private, deleted, geo-blocked):
          // no client or retry will help.
          throw lastError;
        }
        break;
      }
    }
  }

  throw lastError;
}

function attemptDownloadSegment(
  url: string,
  startTime: string,
  endTime: string,
  outputPath: string,
  playerClient: string | null = null
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sectionArg = `*${startTime}-${endTime}`;

    const args = [
      '--download-sections', sectionArg,
      '-x',                    // Extract audio
      '--audio-format', 'mp3', // Convert to MP3
      '-o', outputPath,        // Output path
      '--no-playlist',         // Don't download playlists
      '--quiet',               // Less output
      '--no-warnings',
      // Let yt-dlp absorb brief network/CDN hiccups before we fall back
      '--retries', '3',
      '--fragment-retries', '3',
      '--extractor-retries', '2',
      '--socket-timeout', '30',
    ];

    if (playerClient) {
      args.push('--extractor-args', `youtube:player_client=${playerClient}`);
    }

    args.push(url);

    console.log(`Downloading segment: ${startTime} - ${endTime} from ${url}${playerClient ? ` [client: ${playerClient}]` : ''}`);

    const process = spawn(YTDLP_PATH, args);

    let stderr = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      process.kill('SIGKILL');
      finish(() => reject(new Error(`yt-dlp download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`)));
    }, DOWNLOAD_TIMEOUT_MS);

    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Without this, a spawn failure (missing binary, EACCES) would leave the
    // promise pending forever and hang the job.
    process.on('error', (err) => {
      finish(() => reject(new Error(`Failed to run yt-dlp: ${err.message}`)));
    });

    process.on('close', async (code) => {
      if (settled) return;

      if (code !== 0) {
        finish(() => reject(new Error(`yt-dlp download failed: ${stderr}`)));
        return;
      }

      // Trim excess duration caused by container cue-point rounding
      try {
        await trimSegmentToExactDuration(outputPath, startTime, endTime);
      } catch (err) {
        console.warn(`Failed to trim segment ${outputPath}:`, err);
      }

      finish(resolve);
    });
  });
}

/**
 * Trim a downloaded MP3 segment to its exact expected duration.
 * yt-dlp --download-sections often starts from the nearest container cue point
 * (which can be up to ~10 seconds earlier), so we trim the excess from the start.
 */
async function trimSegmentToExactDuration(
  filePath: string,
  startTime: string,
  endTime: string
): Promise<void> {
  const expectedDuration = parseTimeToSeconds(endTime) - parseTimeToSeconds(startTime);
  const trimmedPath = filePath.replace('.mp3', '_trimmed.mp3');
  
  // Get actual duration using ffprobe
  const durationStr = await new Promise<string>((resolve, reject) => {
    const probe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    
    let output = '';
    probe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    probe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed with code ${code}`));
        return;
      }
      resolve(output.trim());
    });
  });
  
  const actualDuration = parseFloat(durationStr);
  const excess = actualDuration - expectedDuration;
  
  // Only trim if there's meaningful excess (> 0.5s)
  if (excess > 0.5 && expectedDuration > 0 && actualDuration > 0) {
    console.log(`Trimming ${excess.toFixed(2)}s from start of ${filePath} (actual: ${actualDuration.toFixed(2)}s, expected: ${expectedDuration.toFixed(2)}s)`);
    
    await new Promise<void>((resolve, reject) => {
      const args = [
        '-y',
        '-i', filePath,
        '-ss', excess.toFixed(3),
        '-t', expectedDuration.toFixed(3),
        '-c:a', 'libmp3lame',
        '-q:a', '2',
        '-ar', '44100',
        '-ac', '2',
        trimmedPath
      ];
      
      const trimProcess = spawn('ffmpeg', args);
      let stderr = '';
      
      trimProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      trimProcess.on('close', async (trimCode) => {
        if (trimCode !== 0) {
          reject(new Error(`ffmpeg trim failed: ${stderr}`));
          return;
        }
        
        try {
          await unlink(filePath);
          await Bun.write(filePath, Bun.file(trimmedPath));
          await unlink(trimmedPath);
        } catch (e) {
          reject(e);
          return;
        }
        
        resolve();
      });
    });
  }
}

/**
 * Parse time string (MM:SS or HH:MM:SS) to seconds
 */
export function parseTimeToSeconds(time: string): number {
  const parts = time.split(':').map(Number);
  if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  } else if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  return 0;
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
export function formatSecondsToTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
