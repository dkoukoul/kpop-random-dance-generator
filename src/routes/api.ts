import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { join } from 'path';
import { mkdir, access, stat } from 'fs/promises';
import type { GenerateRequest, SongSegment } from '../types';
import { getVideoInfo, downloadSegment, searchVideos } from '../services/youtube';
import { generateReport, saveReport } from '../services/report';
import { concatenateWithCountdown, generateCountdownAudio, cleanupTempFiles } from '../services/audio';

const api = new Hono();

// Store for tracking generation jobs
const jobs = new Map<string, {
  status: 'processing' | 'complete' | 'error';
  filename?: string;
  reportFilename?: string;
  error?: string;
  progress?: string;
}>();

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
    return c.json({ error: 'Failed to fetch video info' }, 500);
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

/**
 * Background processing function
 */
async function processGeneration(jobId: string, segments: SongSegment[]) {
  const segmentPaths: string[] = [];
  
  try {
    await ensureCountdownAudio();
    
    // Download each segment
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (!segment) continue;
      
      const segmentPath = join(TEMP_DIR, `${jobId}_segment_${i}.mp3`);
      
      jobs.set(jobId, { 
        status: 'processing', 
        progress: `Downloading segment ${i + 1}/${segments.length}: ${segment.title}` 
      });
      
      await downloadSegment(
        segment.youtubeUrl,
        segment.startTime,
        segment.endTime,
        segmentPath
      );
      
      segmentPaths.push(segmentPath);
    }
    
    // Concatenate all segments with countdown
    jobs.set(jobId, { status: 'processing', progress: 'Combining audio...' });
    
    const outputFilename = `output_${jobId}.mp3`;
    const outputPath = join(TEMP_DIR, outputFilename);
    
    await concatenateWithCountdown(segmentPaths, COUNTDOWN_PATH, outputPath);
    
    // Clean up segment files
    await cleanupTempFiles(segmentPaths);
    
    // Generate Report
    console.log(`Generating report for job ${jobId}...`);
    const report = generateReport(segments);
    const reportPath = await saveReport(report, jobId, TEMP_DIR);
    const reportFilename = reportPath.split('/').pop()!; // Extract filename
    
    jobs.set(jobId, { 
      status: 'complete', 
      filename: outputFilename,
      reportFilename: reportFilename
    });
    console.log(`Generation complete: ${outputFilename}, Report: ${reportFilename}`);
    
  } catch (error) {
    // Clean up on error
    await cleanupTempFiles(segmentPaths);
    throw error;
  }
}

export default api;
