import { Database } from 'bun:sqlite';
import { join } from 'path';

// Tests point this at a throwaway file so they never touch the live cache.
const CACHE_DB_PATH = process.env.CACHE_DB_PATH || join(process.cwd(), 'cache.db');
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

/** Delete expired entries; returns how many were removed. */
export function cleanupCache(): number {
  const now = Math.floor(Date.now() / 1000);
  const { changes } = db.run('DELETE FROM cache WHERE expires_at < ?', [now]);
  // After a big purge, give the space back to the disk too.
  if (changes > 1000) db.run('VACUUM');
  return changes;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Run cleanupCache now and then once a day. Lookups are cached for a day or
 * more and were never deleted, so the file grew without bound.
 */
export function startCacheCleanup(): void {
  const run = () => {
    try {
      const removed = cleanupCache();
      if (removed > 0) console.log(`🧹 Removed ${removed} expired cache entries`);
    } catch (error) {
      console.error('Cache cleanup failed:', error);
    }
  };
  run();
  setInterval(run, DAY_MS).unref();
}
