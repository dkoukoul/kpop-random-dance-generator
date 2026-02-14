import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { execSync } from 'child_process';
import api from './routes/api';

const app = new Hono();

/**
 * Check if required dependencies are installed
 */
function checkDependencies() {
  const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
  const dependencies = ['ffmpeg', ytdlpPath];
  
  console.log('🔍 Checking dependencies...');
  
  for (const dep of dependencies) {
    try {
      // Use --version or similar to check if binary exists and is executable
      const cmd = dep.includes('yt-dlp') ? `${dep} --version` : `${dep} -version`;
      execSync(cmd, { stdio: 'ignore' });
      console.log(`✅ ${dep} is available`);
    } catch (e) {
      console.error(`❌ Error: Required dependency '${dep}' not found.`);
      console.error(`Please ensure it is installed and in your PATH, or check your .env configuration.`);
      process.exit(1);
    }
  }
}

// Check dependencies before starting
checkDependencies();

// Serve static files from public directory
app.use('/*', serveStatic({ root: './public' }));

// Mount API routes
app.route('/api', api);

// Fallback to index.html for SPA-like behavior
app.get('/', serveStatic({ path: './public/index.html' }));

// Serve admin page
app.get('/admin', serveStatic({ path: './public/admin.html' }));

const port = process.env.PORT || 3000;

console.log(`🎵 K-Pop Random Dance Generator running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 60, // Increase timeout to 60s for long YouTube searches
};
