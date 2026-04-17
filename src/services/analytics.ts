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
    start_time TEXT,
    end_time TEXT,
    FOREIGN KEY (generation_id) REFERENCES generations(id)
  )
`);

// Migration: Add start_time and end_time columns if they don't exist
try {
  db.run('ALTER TABLE generation_songs ADD COLUMN start_time TEXT');
} catch (error) {
  // Column already exists, ignore error
}

try {
  db.run('ALTER TABLE generation_songs ADD COLUMN end_time TEXT');
} catch (error) {
  // Column already exists, ignore error
}

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

    const insertSong = db.prepare('INSERT INTO generation_songs (generation_id, youtube_url, title, start_time, end_time) VALUES (?, ?, ?, ?, ?)');
    
    for (const segment of segments) {
      insertSong.run(generationId, segment.youtubeUrl, segment.title, segment.startTime, segment.endTime);
    }
  } catch (error) {
    console.error('Failed to log generation:', error);
  }
}

export function getStats() {
  const totalVisits = db.query('SELECT COUNT(*) as count FROM visits').get() as { count: number };
  const totalGenerations = db.query('SELECT COUNT(*) as count FROM generations').get() as { count: number };
  const topSongs = db.query(`
    SELECT title, youtube_url, start_time, end_time, COUNT(*) as count 
    FROM generation_songs 
    GROUP BY youtube_url, start_time, end_time 
    ORDER BY count DESC 
    LIMIT 10
  `).all();

  return {
    totalVisits: totalVisits.count,
    totalGenerations: totalGenerations.count,
    topSongs
  };
}
