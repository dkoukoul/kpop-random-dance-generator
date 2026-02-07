import { spawn } from 'child_process';
import type { VideoInfo } from '../types';

// Get yt-dlp path from environment, fallback to 'yt-dlp'
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';

/**
 * Extract video information using yt-dlp --dump-json
 */
export async function getVideoInfo(url: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const process = spawn(YTDLP_PATH, ['--dump-json', '--no-download', url]);
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr}`));
        return;
      }
      
      try {
        const info = JSON.parse(stdout);
        resolve({
          title: info.title || 'Unknown Title',
          duration: info.duration || 0,
          thumbnail: info.thumbnail || '',
          channel: info.channel || info.uploader || 'Unknown',
        });
      } catch (e) {
        reject(new Error('Failed to parse video info'));
      }
    });
  });
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
