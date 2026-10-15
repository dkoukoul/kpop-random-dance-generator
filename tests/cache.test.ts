import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { cleanupCache, getCache, setCache } from '../src/services/cache';

const key = (name: string) => `test:${name}:${crypto.randomUUID()}`;

describe('cache', () => {
  test('returns what was stored', () => {
    const k = key('roundtrip');
    setCache(k, [{ title: 'FANCY', duration: 214 }], 60);
    expect(getCache<unknown>(k)).toEqual([{ title: 'FANCY', duration: 214 }]);
  });

  test('returns null for a key that was never stored', () => {
    expect(getCache(key('missing'))).toBeNull();
  });

  test('replaces an existing value', () => {
    const k = key('replace');
    setCache(k, 'old', 60);
    setCache(k, 'new', 60);
    expect(getCache<string>(k)).toBe('new');
  });

  test('treats an expired entry as missing', () => {
    const k = key('expired');
    setCache(k, 'stale', -1);
    expect(getCache(k)).toBeNull();
  });

  test('cleanupCache deletes expired rows and keeps live ones', () => {
    const expired = key('cleanup-expired');
    const live = key('cleanup-live');
    setCache(expired, 1, -10);
    setCache(live, 2, 60);
    expect(cleanupCache()).toBeGreaterThanOrEqual(1);

    const db = new Database(process.env.CACHE_DB_PATH!, { readonly: true });
    const keys = db.query('SELECT key FROM cache WHERE key IN (?, ?)').all(expired, live) as { key: string }[];
    db.close();
    expect(keys.map((r) => r.key)).toEqual([live]);
  });
});
