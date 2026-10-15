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
 * `ttlMs`, so a request is a Map lookup rather than a table scan. If a
 * rebuild fails (e.g. the database is locked), the previous index is kept
 * and the next attempt waits for the next `ttlMs` too, so a broken query
 * can't turn every request into a failing full scan.
 */
export function createPopularCutLookup(db: Database, ttlMs = 10 * 60 * 1000) {
  let index = new Map<string, PopularCut>();
  let builtAt = -Infinity;

  return (url: string): PopularCut | null => {
    const videoId = extractVideoId(url);
    if (!videoId) return null;
    if (Date.now() - builtAt > ttlMs) {
      builtAt = Date.now();
      try {
        index = computePopularCuts(db);
      } catch (error) {
        console.error('Failed to build the popular-cut index:', error);
      }
    }
    return index.get(videoId) ?? null;
  };
}

export interface TopSong {
  videoId: string;
  youtube_url: string;
  title: string;
  count: number;
  /** The cut to add it with: the most used one people chose, else the 0:00-0:30 default. */
  start_time: string;
  end_time: string;
  /** The popular cut (3+ uses), as /api/popular-cut gives it; null when there's none. */
  cut: PopularCut | null;
}

/**
 * The most used videos in past mixes, one row per video however its URL was
 * written, with the title it was most often saved under.
 */
export function computeTopSongs(db: Database, limit = 10): TopSong[] {
  const rows = db
    .query(
      `SELECT youtube_url, title, COUNT(*) AS n
       FROM generation_songs
       GROUP BY youtube_url, title`,
    )
    .all() as { youtube_url: string; title: string | null; n: number }[];

  const byVideo = new Map<string, { count: number; titles: Map<string, number> }>();
  for (const row of rows) {
    const videoId = extractVideoId(row.youtube_url);
    if (!videoId) continue;
    let v = byVideo.get(videoId);
    if (!v) byVideo.set(videoId, (v = { count: 0, titles: new Map() }));
    v.count += row.n;
    const title = row.title?.trim();
    if (title) v.titles.set(title, (v.titles.get(title) ?? 0) + row.n);
  }

  const top = [...byVideo.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, limit);
  if (top.length === 0) return [];

  const anyCut = computePopularCuts(db, 1);
  return top.map(([videoId, v]) => {
    const title = [...v.titles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown Title';
    const best = anyCut.get(videoId) ?? null;
    return {
      videoId,
      youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      count: v.count,
      start_time: best?.startTime ?? formatTime(DEFAULT_START),
      end_time: best?.endTime ?? formatTime(DEFAULT_END),
      cut: best && best.uses >= MIN_USES ? best : null,
    };
  });
}

/** computeTopSongs, rebuilt at most once per `ttlMs` (it runs on every page view). */
export function createTopSongsLookup(db: Database, ttlMs = 10 * 60 * 1000) {
  let cached: TopSong[] = [];
  let builtAt = -Infinity;
  return (): TopSong[] => {
    if (Date.now() - builtAt > ttlMs) {
      builtAt = Date.now();
      try {
        cached = computeTopSongs(db);
      } catch (error) {
        console.error('Failed to build the top songs list:', error);
      }
    }
    return cached;
  };
}
