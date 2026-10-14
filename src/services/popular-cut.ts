import type { Database } from 'bun:sqlite';

/**
 * The most common cut the community picked for one video, taken from the
 * songs in past generations. Powers the "Popular cut" prefill on new cards.
 */
export interface PopularCut {
  startTime: string;
  endTime: string;
  uses: number;
}

/** A cut needs this many uses before it is suggested to anyone. */
export const MIN_USES = 3;

// The card default. Most of these are songs nobody cut, so they are not
// counted: they would drown out the cuts people actually chose.
const DEFAULT_START = 0;
const DEFAULT_END = 30;

/**
 * Pull the 11-character video ID out of any YouTube URL form the app stores
 * (watch?v=, youtu.be/, shorts/, embed/, with or without extra params).
 */
export function extractVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/)([\w-]{11})(?![\w-])/);
  return match ? match[1]! : null;
}

/** "1:23", "01:02:03" or "83" to seconds; null when it isn't a time. */
export function parseTime(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parts = value.trim().split(':');
  if (parts.length === 0 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** Seconds to "m:ss" / "h:mm:ss", the same format the frontend writes. */
export function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${String(mins).padStart(2, '0')}:${ss}` : `${mins}:${ss}`;
}

/**
 * Build videoId -> most common cut, for every video with a cut used at least
 * `minUses` times. One grouped scan of generation_songs; the URL and time
 * normalisation happens here because the stored values come in many shapes.
 */
export function computePopularCuts(db: Database, minUses = MIN_USES): Map<string, PopularCut> {
  const rows = db
    .query(
      `SELECT youtube_url, start_time, end_time, COUNT(*) AS n
       FROM generation_songs
       WHERE start_time IS NOT NULL AND end_time IS NOT NULL
       GROUP BY youtube_url, start_time, end_time`,
    )
    .all() as { youtube_url: string; start_time: string; end_time: string; n: number }[];

  // videoId -> "start-end" (in seconds) -> uses
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const videoId = extractVideoId(row.youtube_url);
    const start = parseTime(row.start_time);
    const end = parseTime(row.end_time);
    if (!videoId || start === null || end === null || end <= start) continue;
    if (start === DEFAULT_START && end === DEFAULT_END) continue;

    let cuts = counts.get(videoId);
    if (!cuts) counts.set(videoId, (cuts = new Map()));
    const key = `${start}-${end}`;
    cuts.set(key, (cuts.get(key) ?? 0) + row.n);
  }

  const popular = new Map<string, PopularCut>();
  for (const [videoId, cuts] of counts) {
    let bestKey: string | null = null;
    let bestUses = 0;
    for (const [key, uses] of cuts) {
      // Ties go to the earlier start so the answer doesn't depend on row order.
      if (uses > bestUses || (uses === bestUses && bestKey !== null && compareKeys(key, bestKey) < 0)) {
        bestKey = key;
        bestUses = uses;
      }
    }
    if (bestKey === null || bestUses < minUses) continue;
    const [start, end] = bestKey.split('-').map(Number) as [number, number];
    popular.set(videoId, { startTime: formatTime(start), endTime: formatTime(end), uses: bestUses });
  }
  return popular;
}

function compareKeys(a: string, b: string): number {
  const [aStart, aEnd] = a.split('-').map(Number) as [number, number];
  const [bStart, bEnd] = b.split('-').map(Number) as [number, number];
  return aStart - bStart || aEnd - bEnd;
}

/**
 * Returns a lookup by URL that rebuilds the whole index at most once per
 * `ttlMs`, so a request is a Map lookup rather than a table scan.
 */
export function createPopularCutLookup(db: Database, ttlMs = 10 * 60 * 1000) {
  let index: Map<string, PopularCut> | null = null;
  let builtAt = 0;

  return (url: string): PopularCut | null => {
    const videoId = extractVideoId(url);
    if (!videoId) return null;
    if (!index || Date.now() - builtAt > ttlMs) {
      index = computePopularCuts(db);
      builtAt = Date.now();
    }
    return index.get(videoId) ?? null;
  };
}
