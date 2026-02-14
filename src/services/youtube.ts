import { spawn } from 'child_process';
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
    const proc = Bun.spawn([
      YTDLP_PATH,
      '--dump-json',
      '--no-download',
      '--skip-download',
      '--flat-playlist',
      '--no-playlist',
      '--ignore-errors',
      '--no-check-certificate',
      '--no-warnings',
      '--quiet',
      '--extractor-args', 'youtube:player_client=web',
      url
    ], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(`❌ yt-dlp info failed (exit ${exitCode}): ${stderrText}`);
      throw new Error(`yt-dlp failed: ${stderrText}`);
    }

    if (!stdoutText.trim()) {
      throw new Error('No video info returned');
    }

    const info = JSON.parse(stdoutText);
    
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
    console.error('❌ Failed to fetch/parse video info:', e);
    throw new Error('Failed to fetch video info');
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
      '--extractor-args', 'youtube:player_client=web',
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

/**
 * Download a specific segment of audio from a YouTube video
 * Uses yt-dlp's --download-sections to only download the required portion
 */
export async function downloadSegment(
  url: string,
  startTime: string,
  endTime: string,
  outputPath: string
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
      url
    ];
    
    console.log(`Downloading segment: ${startTime} - ${endTime} from ${url}`);
    
    const process = spawn(YTDLP_PATH, args);
    
    let stderr = '';
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp download failed: ${stderr}`));
        return;
      }
      resolve();
    });
  });
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
