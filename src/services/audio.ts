import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';

/**
 * Concatenate multiple audio files with countdown audio between each segment
 * Uses ffmpeg's concat demuxer, then normalizes the output
 */
export async function concatenateWithCountdown(
  segmentPaths: string[],
  countdownPath: string,
  outputPath: string
): Promise<void> {
  if (segmentPaths.length === 0) {
    throw new Error('No segments provided');
  }

  // Create a file list for ffmpeg concat demuxer
  // Format: file 'path/to/file.mp3'
  const fileListPath = outputPath.replace('.mp3', '_filelist.txt');
  const tempConcatPath = outputPath.replace('.mp3', '_temp.mp3');
  
  const fileListContent = segmentPaths
    .map((segPath, index) => {
      // Add countdown before each segment (including the first one)
      const lines = [`file '${countdownPath}'`, `file '${segPath}'`];
      return lines.join('\n');
    })
    .join('\n');
  
  await writeFile(fileListPath, fileListContent, 'utf-8');
  
  console.log('File list content:', fileListContent);
  
  // Step 1: Concatenate all files
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',                    // Overwrite output
      '-f', 'concat',          // Concat demuxer
      '-safe', '0',            // Allow any path
      '-i', fileListPath,      // Input file list
      '-c:a', 'libmp3lame',    // Encode to MP3
      '-q:a', '2',             // Quality (2 is high quality)
      '-ar', '44100',          // Sample rate
      '-ac', '2',              // Stereo
      tempConcatPath
    ];
    
    console.log('Running ffmpeg concat:', 'ffmpeg', args.join(' '));
    
    const process = spawn('ffmpeg', args);
    
    let stderr = '';
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', async (code) => {
      // Clean up file list
      try {
        await unlink(fileListPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      if (code !== 0) {
        console.error('ffmpeg concat stderr:', stderr);
        reject(new Error(`ffmpeg concatenation failed: ${stderr}`));
        return;
      }
      resolve();
    });
  });

  // Step 2: Normalize the audio using loudnorm filter
  console.log('Normalizing audio...');
  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-i', tempConcatPath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',  // EBU R128 loudness normalization
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      '-ar', '44100',
      '-ac', '2',
      outputPath
    ];
    
    console.log('Running ffmpeg normalize:', 'ffmpeg', args.join(' '));
    
    const process = spawn('ffmpeg', args);
    
    let stderr = '';
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', async (code) => {
      // Clean up temp file
      try {
        await unlink(tempConcatPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      if (code !== 0) {
        console.error('ffmpeg normalize stderr:', stderr);
        reject(new Error(`ffmpeg normalization failed: ${stderr}`));
        return;
      }
      console.log('Audio normalization complete');
      resolve();
    });
  });
}

/**
 * Generate a simple countdown audio file using ffmpeg
 * Creates a beep countdown: beep...beep...beep...beep...beep (5 beeps, 1 second apart)
 */
export async function generateCountdownAudio(outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Generate 5 beeps, each 0.1 seconds, 1 second apart
    // Using sine wave at 880Hz (A5 note)
    const args = [
      '-y',
      '-f', 'lavfi',
      '-i', `anullsrc=r=44100:cl=stereo,aevalsrc='sin(880*2*PI*t)*(t<0.1)+0*(t>=0.1)':d=1[a1];
             anullsrc=r=44100:cl=stereo,aevalsrc='sin(880*2*PI*t)*(t<0.1)+0*(t>=0.1)':d=1[a2];
             anullsrc=r=44100:cl=stereo,aevalsrc='sin(880*2*PI*t)*(t<0.1)+0*(t>=0.1)':d=1[a3];
             anullsrc=r=44100:cl=stereo,aevalsrc='sin(880*2*PI*t)*(t<0.1)+0*(t>=0.1)':d=1[a4];
             anullsrc=r=44100:cl=stereo,aevalsrc='sin(1760*2*PI*t)*(t<0.2)+0*(t>=0.2)':d=1[a5];
             [a1][a2][a3][a4][a5]concat=n=5:v=0:a=1`,
      '-t', '5',
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      outputPath
    ];
    
    // Simpler approach: generate individual beeps and silence
    const simpleArgs = [
      '-y',
      '-f', 'lavfi',
      '-i', 'sine=frequency=880:duration=0.15',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=44100:cl=stereo:d=0.85',
      '-f', 'lavfi',
      '-i', 'sine=frequency=880:duration=0.15',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=44100:cl=stereo:d=0.85',
      '-f', 'lavfi',
      '-i', 'sine=frequency=880:duration=0.15',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=44100:cl=stereo:d=0.85',
      '-f', 'lavfi',
      '-i', 'sine=frequency=880:duration=0.15',
      '-f', 'lavfi',
      '-i', 'anullsrc=r=44100:cl=stereo:d=0.85',
      '-f', 'lavfi',
      '-i', 'sine=frequency=1760:duration=0.3',
      '-filter_complex', '[0][1][2][3][4][5][6][7][8]concat=n=9:v=0:a=1[out]',
      '-map', '[out]',
      '-c:a', 'libmp3lame',
      '-q:a', '2',
      '-ar', '44100',
      '-ac', '2',
      outputPath
    ];
    
    console.log('Generating countdown audio...');
    
    const process = spawn('ffmpeg', simpleArgs);
    
    let stderr = '';
    
    process.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    process.on('close', (code) => {
      if (code !== 0) {
        console.error('ffmpeg stderr:', stderr);
        reject(new Error(`Failed to generate countdown: ${stderr}`));
        return;
      }
      console.log('Countdown audio generated successfully');
      resolve();
    });
  });
}

/**
 * Clean up temporary files
 */
export async function cleanupTempFiles(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await unlink(path);
    } catch (e) {
      // Ignore errors for non-existent files
    }
  }
}
