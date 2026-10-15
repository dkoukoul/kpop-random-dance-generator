import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  computePopularCuts,
  computeTopSongs,
  createPopularCutLookup,
  createTopSongsLookup,
  extractVideoId,
  parseTime,
} from '../src/services/popular-cut';

const ID = 'dQw4w9WgXcQ';

function makeDb(rows: [url: string, start: string | null, end: string | null][]) {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE generation_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, generation_id INTEGER,
    youtube_url TEXT, title TEXT, start_time TEXT, end_time TEXT)`);
  const insert = db.prepare('INSERT INTO generation_songs (youtube_url, start_time, end_time) VALUES (?, ?, ?)');
  for (const row of rows) insert.run(...row);
  return db;
}

function times<T>(n: number, row: T): T[] {
  return Array.from({ length: n }, () => row);
}

describe('extractVideoId', () => {
  test('handles every stored URL shape', () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractVideoId(`https://youtube.com/watch?feature=share&v=${ID}&t=42`)).toBe(ID);
    expect(extractVideoId(`https://youtu.be/${ID}?si=abc`)).toBe(ID);
    expect(extractVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(extractVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
  });

  test('rejects things that are not YouTube links', () => {
    expect(extractVideoId('Blackpink ')).toBeNull();
    expect(extractVideoId('https://example.com/song/123')).toBeNull();
    expect(extractVideoId('')).toBeNull();
    expect(extractVideoId(null)).toBeNull();
  });
});

describe('parseTime', () => {
  test('parses m:ss, h:mm:ss and plain seconds', () => {
    expect(parseTime('1:23')).toBe(83);
    expect(parseTime('01:23')).toBe(83);
    expect(parseTime('1:02:03')).toBe(3723);
    expect(parseTime('45')).toBe(45);
  });

  test('rejects junk', () => {
    expect(parseTime(null)).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(parseTime('1:2a')).toBeNull();
    expect(parseTime('1::3')).toBeNull();
  });
});

describe('computePopularCuts', () => {
  test('returns the most common cut once it has 3 uses', () => {
    const db = makeDb([
      ...times(3, [`https://www.youtube.com/watch?v=${ID}`, '0:40', '1:12'] as [string, string, string]),
      ...times(2, [`https://www.youtube.com/watch?v=${ID}`, '1:00', '1:30'] as [string, string, string]),
    ]);
    expect(computePopularCuts(db).get(ID)).toEqual({ startTime: '0:40', endTime: '1:12', uses: 3 });
  });

  test('stays silent below the threshold', () => {
    const db = makeDb(times(2, [`https://www.youtube.com/watch?v=${ID}`, '0:40', '1:12'] as [string, string, string]));
    expect(computePopularCuts(db).has(ID)).toBe(false);
  });

  test('counts the same cut across URL and time spellings', () => {
    const db = makeDb([
      [`https://www.youtube.com/watch?v=${ID}`, '0:40', '1:12'],
      [`https://youtu.be/${ID}?si=xyz`, '00:40', '01:12'],
      [`https://www.youtube.com/watch?v=${ID}&list=RD123`, '40', '72'],
    ]);
    expect(computePopularCuts(db).get(ID)).toEqual({ startTime: '0:40', endTime: '1:12', uses: 3 });
  });

  test('ignores the untouched 0:00-0:30 default, nulls and backwards cuts', () => {
    const db = makeDb([
      ...times(10, [`https://www.youtube.com/watch?v=${ID}`, '0:00', '0:30'] as [string, string, string]),
      ...times(10, [`https://www.youtube.com/watch?v=${ID}`, null, null] as [string, null, null]),
      ...times(10, [`https://www.youtube.com/watch?v=${ID}`, '1:30', '1:00'] as [string, string, string]),
      ...times(3, [`https://www.youtube.com/watch?v=${ID}`, '0:50', '1:29'] as [string, string, string]),
    ]);
    expect(computePopularCuts(db).get(ID)).toEqual({ startTime: '0:50', endTime: '1:29', uses: 3 });
  });

  test('breaks ties on the earlier start', () => {
    const db = makeDb([
      ...times(3, [`https://www.youtube.com/watch?v=${ID}`, '1:00', '1:30'] as [string, string, string]),
      ...times(3, [`https://www.youtube.com/watch?v=${ID}`, '0:40', '1:12'] as [string, string, string]),
    ]);
    expect(computePopularCuts(db).get(ID)?.startTime).toBe('0:40');
  });
});

describe('createPopularCutLookup', () => {
  test('returns null when there is no data for the video', () => {
    const lookup = createPopularCutLookup(makeDb([]));
    expect(lookup(`https://www.youtube.com/watch?v=${ID}`)).toBeNull();
  });

  test('returns null for a URL without a video ID', () => {
    const lookup = createPopularCutLookup(makeDb([]));
    expect(lookup('not a url')).toBeNull();
  });

  test('a failing rebuild returns null instead of throwing', () => {
    const db = new Database(':memory:'); // no generation_songs table
    const lookup = createPopularCutLookup(db);
    expect(lookup(`https://www.youtube.com/watch?v=${ID}`)).toBeNull();
  });

  test('looks up by any URL spelling and caches the index', () => {
    const db = makeDb(times(3, [`https://www.youtube.com/watch?v=${ID}`, '0:40', '1:12'] as [string, string, string]));
    const lookup = createPopularCutLookup(db);
    expect(lookup(`https://youtu.be/${ID}`)?.uses).toBe(3);

    // New rows are not seen until the cache expires.
    db.run('INSERT INTO generation_songs (youtube_url, start_time, end_time) VALUES (?, ?, ?)', [
      `https://www.youtube.com/watch?v=${ID}`, '0:40', '1:12',
    ]);
    expect(lookup(`https://youtu.be/${ID}`)?.uses).toBe(3);
  });
});

describe('computeTopSongs', () => {
  function topDb(rows: [url: string, title: string, start: string, end: string][]) {
    const db = new Database(':memory:');
    db.run(`CREATE TABLE generation_songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, generation_id INTEGER,
      youtube_url TEXT, title TEXT, start_time TEXT, end_time TEXT)`);
    const insert = db.prepare('INSERT INTO generation_songs (youtube_url, title, start_time, end_time) VALUES (?, ?, ?, ?)');
    for (const row of rows) insert.run(...row);
    return db;
  }
  const OTHER = 'otherVideo1';

  test('counts every URL form of a video as one song, with its most used title', () => {
    const db = topDb([
      ...times(2, [`https://www.youtube.com/watch?v=${ID}`, 'BTS - Dynamite', '0:52', '1:22'] as [string, string, string, string]),
      [`https://youtu.be/${ID}?si=x`, 'Dynamite (MV)', '0:52', '1:22'],
      [`https://www.youtube.com/shorts/${ID}`, 'BTS - Dynamite', '0:00', '0:30'],
      [`https://www.youtube.com/watch?v=${OTHER}`, 'Other', '0:10', '0:40'],
      ['not a link', 'Typed title', '0:00', '0:30'],
    ]);
    expect(computeTopSongs(db)).toEqual([
      {
        videoId: ID,
        youtube_url: `https://www.youtube.com/watch?v=${ID}`,
        title: 'BTS - Dynamite',
        count: 4,
        start_time: '0:52',
        end_time: '1:22',
        cut: { startTime: '0:52', endTime: '1:22', uses: 3 },
      },
      {
        videoId: OTHER,
        youtube_url: `https://www.youtube.com/watch?v=${OTHER}`,
        title: 'Other',
        count: 1,
        start_time: '0:10',
        end_time: '0:40',
        cut: null,
      },
    ]);
  });

  test('falls back to the default cut when nobody chose one', () => {
    const db = topDb([[`https://youtu.be/${ID}`, 'X', '0:00', '0:30']]);
    expect(computeTopSongs(db)[0]).toMatchObject({ start_time: '0:00', end_time: '0:30', cut: null });
  });

  test('keeps the 10 most used', () => {
    const rows: [string, string, string, string][] = [];
    for (let i = 0; i < 12; i++) {
      const id = `vid${String(i).padStart(8, '0')}`;
      for (let n = 0; n <= i; n++) rows.push([`https://youtu.be/${id}`, `Song ${i}`, '0:00', '0:30']);
    }
    const top = computeTopSongs(topDb(rows));
    expect(top).toHaveLength(10);
    expect(top[0]!.title).toBe('Song 11');
    expect(top.map((t) => t.count)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  });

  test('the lookup caches the list', () => {
    const db = topDb([[`https://youtu.be/${ID}`, 'X', '0:00', '0:30']]);
    const lookup = createTopSongsLookup(db, 60_000);
    expect(lookup()).toHaveLength(1);
    db.run(`INSERT INTO generation_songs (youtube_url, title, start_time, end_time) VALUES ('https://youtu.be/${OTHER}', 'Y', '0:00', '0:30')`);
    expect(lookup()).toHaveLength(1);
  });
});
