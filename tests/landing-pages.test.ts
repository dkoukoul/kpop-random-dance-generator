import { describe, expect, test } from 'bun:test';
import {
  BANDS,
  buildMixes,
  dedupeBySong,
  esc,
  formatClock,
  renderMix,
  scriptJson,
  seededShuffle,
  songName,
  toSeconds,
  tooSimilar,
  videoId,
  type Video,
} from '../scripts/build-landing-pages';

describe('toSeconds (lenient: parses whatever users typed)', () => {
  test.each([
    ['1:23', 83],
    [':48', 48],
    ['25', 25],
    ['1:51 ', 111],
    ['1:02:03', 3723],
  ])('%p -> %p', (input, seconds) => {
    expect(toSeconds(input)).toBe(seconds);
  });

  test.each(['abc', '-5', '1:2:3:4'])('%p is rejected', (input) => {
    expect(toSeconds(input)).toBeNaN();
  });
});

describe('formatClock', () => {
  test.each([
    [5, '0:05'],
    [83, '1:23'],
    [59.6, '1:00'],
    [3723, '1:02:03'],
  ])('%p -> %p', (seconds, clock) => {
    expect(formatClock(seconds)).toBe(clock);
  });

  test('always produces a time the generator accepts', () => {
    for (const raw of [':48', '25', '1:51 ', '0:7', '61']) {
      expect(formatClock(toSeconds(raw))).toMatch(/^(\d+:)?\d{1,2}:\d{2}$/);
    }
  });
});

describe('videoId', () => {
  test.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&index=2', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
  ])('%p', (url, id) => {
    expect(videoId(url)).toBe(id);
  });

  test.each(['Cupid', 'https://www.mureka.ai/song-detail/6AMCFq', ''])('no id in %p', (url) => {
    expect(videoId(url)).toBe('');
  });
});

describe('songName', () => {
  test.each([
    ["BTS (방탄소년단) 'Dynamite' Official MV", 'BTS', 'Dynamite'],
    ['TWICE "FANCY" M/V', 'TWICE', 'FANCY'],
    ["BTS (방탄소년단) '피 땀 눈물 (Blood Sweat & Tears)' Official MV", 'BTS', 'Blood Sweat & Tears'],
    ['[MV] SEVENTEEN(세븐틴) - MAESTRO', 'SEVENTEEN', 'MAESTRO'],
    ["SEVENTEEN (세븐틴) 'Super' Dance Practice (Mirrored ver.)", 'SEVENTEEN', 'Super'],
    ['ITZY WANNABE (Dance Practice) [4K]', 'ITZY', 'WANNABE'],
  ])('%p', (title, band, song) => {
    expect(songName(title, band)).toBe(song);
  });
});

const video = (n: number, over: Partial<Video> = {}): Video => ({
  url: `https://www.youtube.com/watch?v=vid${String(n).padStart(8, '0')}`,
  videoId: `vid${String(n).padStart(8, '0')}`,
  title: `Song ${n} MV`,
  song: `Song ${n}`,
  uses: 100 - n,
  start: '0:30',
  end: '1:00',
  seconds: 15 + ((n * 7) % 60),
  isPractice: n % 3 === 0,
  ...over,
});

describe('dedupeBySong', () => {
  test('keeps the most-used upload of each song, ignoring case and punctuation', () => {
    const mv = video(1, { song: 'Dope', uses: 5 });
    const practice = video(2, { song: 'DOPE!', uses: 9 });
    const other = video(3, { song: 'Fire', uses: 7 });
    expect(dedupeBySong([mv, practice, other])).toEqual([practice, other]);
  });
});

describe('seededShuffle', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);

  test('is deterministic, so rebuilding does not churn every page', () => {
    expect(seededShuffle(items, 42)).toEqual(seededShuffle(items, 42));
    expect(seededShuffle(items, 42)).not.toEqual(seededShuffle(items, 43));
  });

  test('returns a permutation and leaves the input alone', () => {
    const copy = [...items];
    expect([...seededShuffle(items, 7)].sort((a, b) => a - b)).toEqual(items);
    expect(items).toEqual(copy);
  });
});

describe('buildMixes', () => {
  const band = BANDS.find((b) => b.slug === 'twice')!;
  const pool = dedupeBySong(Array.from({ length: 24 }, (_, i) => video(i + 1)));
  const mixes = buildMixes(band, pool);

  test('builds between 3 and 10 mixes with unique ids', () => {
    expect(mixes.length).toBeGreaterThanOrEqual(3);
    expect(mixes.length).toBeLessThanOrEqual(10);
    expect(new Set(mixes.map((m) => m.id)).size).toBe(mixes.length);
  });

  test('every mix has 5 to 10 songs and never repeats a video', () => {
    for (const mix of mixes) {
      expect(mix.songs.length).toBeGreaterThanOrEqual(5);
      expect(mix.songs.length).toBeLessThanOrEqual(10);
      expect(new Set(mix.songs.map((s) => s.videoId)).size).toBe(mix.songs.length);
    }
  });

  test('no mix is a near-copy of an earlier one', () => {
    mixes.forEach((mix, i) => expect(tooSimilar(mix, mixes.slice(0, i))).toBe(false));
  });

  test('is deterministic', () => {
    expect(buildMixes(band, pool).map((m) => m.songs.map((s) => s.videoId))).toEqual(
      mixes.map((m) => m.songs.map((s) => s.videoId)),
    );
  });
});

describe('BANDS', () => {
  test('slugs are unique and pass the server route guard', () => {
    // src/index.ts only serves /random-dance/:slug for slugs matching this.
    const slugs = BANDS.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  test.each([
    ['ive', "IVE 아이브 'LOVE DIVE' MV", true],
    ['ive', 'BTS LIVE performance video', false],
    ['nct', "NCT 127 엔시티 127 'Fact Check' MV", true],
    ['stray-kids', 'SKZ "MANIAC" Dance Practice', true],
    ['g-i-dle', "(G)I-DLE - 'Queencard' Official Music Video", true],
    ['xg', 'xg not uppercase', false],
  ])('%s matches %p: %p', (slug, title, expected) => {
    expect(BANDS.find((b) => b.slug === slug)!.match.test(title)).toBe(expected);
  });
});

describe('output escaping (titles and URLs on the pages come from user input)', () => {
  test('esc escapes everything that matters in HTML and attributes', () => {
    expect(esc(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  test('scriptJson cannot close its <script> tag and still parses back', () => {
    const payload = { title: 'x </script><script>alert(1)</script> <!--' };
    const out = scriptJson(payload);
    expect(out).not.toContain('<');
    expect(JSON.parse(out)).toEqual(payload);
  });

  test('a hostile title in a mix renders inert', () => {
    const evil = video(1, { title: `BTS 'Dope' MV </script><script>alert(1)</script>`, song: '<img src=x onerror=alert(1)>' });
    const html = renderMix({ id: 'm', name: 'Mix', blurb: 'b', songs: [evil] }, BANDS[0]!);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});
