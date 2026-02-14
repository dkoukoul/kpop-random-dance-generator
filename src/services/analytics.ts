import { Database } from 'bun:sqlite';
import { join } from 'path';
import type { SongSegment } from '../types';

const DB_PATH = join(process.cwd(), 'analytics.db');
const db = new Database(DB_PATH);

// Initialize database
db.run(`
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    job_id TEXT,
    song_count INTEGER
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS generation_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    generation_id INTEGER,
    youtube_url TEXT,
    title TEXT,
    FOREIGN KEY (generation_id) REFERENCES generations(id)
  )
`);

export async function logVisit(userAgent: string, ip: string) {
  try {
    db.run('INSERT INTO visits (user_agent, ip) VALUES (?, ?)', [userAgent, ip]);
  } catch (error) {
    console.error('Failed to log visit:', error);
  }
}

export async function logGeneration(jobId: string, segments: SongSegment[]) {
  try {
    const result = db.prepare('INSERT INTO generations (job_id, song_count) VALUES (?, ?)').run(jobId, segments.length);
    const generationId = result.lastInsertRowid;

    const insertSong = db.prepare('INSERT INTO generation_songs (generation_id, youtube_url, title) VALUES (?, ?, ?)');
    
    for (const segment of segments) {
      insertSong.run(generationId, segment.youtubeUrl, segment.title);
    }
  } catch (error) {
    console.error('Failed to log generation:', error);
  }
}

export function getStats() {
  const totalVisits = db.query('SELECT COUNT(*) as count FROM visits').get() as { count: number };
  const totalGenerations = db.query('SELECT COUNT(*) as count FROM generations').get() as { count: number };
  const topSongs = db.query(`
    SELECT title, youtube_url, COUNT(*) as count 
    FROM generation_songs 
    GROUP BY youtube_url 
    ORDER BY count DESC 
    LIMIT 10
  `).all();

  return {
    totalVisits: totalVisits.count,
    totalGenerations: totalGenerations.count,
    topSongs
  };
}
