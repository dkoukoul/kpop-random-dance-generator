import { Database } from 'bun:sqlite';
import { join } from 'path';

const CACHE_DB_PATH = join(process.cwd(), 'cache.db');
const db = new Database(CACHE_DB_PATH);

// Initialize cache table
db.run(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT,
    expires_at INTEGER
  )
`);

export function getCache<T>(key: string): T | null {
  const now = Math.floor(Date.now() / 1000);
  const row = db.query('SELECT value FROM cache WHERE key = ? AND expires_at > ?').get(key, now) as { value: string } | null;
  
  if (row) {
    try {
      return JSON.parse(row.value) as T;
    } catch (e) {
      return null;
    }
  }
  return null;
}

export function setCache(key: string, value: any, ttlSeconds: number) {
  const expires_at = Math.floor(Date.now() / 1000) + ttlSeconds;
  const valueStr = JSON.stringify(value);
  
  db.run('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)', [key, valueStr, expires_at]);
}

// Optional: cleanup expired entries
export function cleanupCache() {
  const now = Math.floor(Date.now() / 1000);
  db.run('DELETE FROM cache WHERE expires_at < ?', [now]);
}
