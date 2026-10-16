import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BANDS,
  bandMatch,
  bandNames,
  buildMixes,
  capSolos,
  dedupeBySong,
  esc,
  formatClock,
  rankEntries,
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
    // Curly quotes can hold an apostrophe.
    ["MEOVV(미야오) - ‘Hit 'Em’ PERFORMANCE VIDEO", 'MEOVV', "Hit 'Em"],
    ["ILLIT (아일릿) 'It's Me' Official MV", 'ILLIT', "It's Me"],
    ['ILLIT (아일릿) ‘It’s Me’ Official MV', 'ILLIT', 'It’s Me'],
    ["BLACKPINK - '마지막처럼 (AS IF IT'S YOUR LAST)' M/V", 'BLACKPINK', "AS IF IT'S YOUR LAST"],
    ["TXT - 'I'll See You There Tomorrow' Dance Practice Mirrored", 'TXT', "I'll See You There Tomorrow"],
    ["ILLIT (아일릿) 'NOT CUTE ANYMORE’ Official MV", 'ILLIT', 'NOT CUTE ANYMORE'],
    // Mixed quotes and double quotes holding an apostrophe.
    ["ILLIT (아일릿) 'It’s Me’ Official MV (Performance ver.)", 'ILLIT', 'It’s Me'],
    ['ITZY "THAT\'S A NO NO" Dance Practice', 'ITZY', "THAT'S A NO NO"],
    ['Stray Kids "神메뉴(God\'s Menu)" M/V', 'Stray Kids', "God's Menu"],
    ['NMIXX "Party O’Clock" M/V', 'NMIXX', 'Party O’Clock'],
    // An unpaired quote is dropped, an apostrophe after a digit is kept.
    ["WayV 威神V '无翼而飞 (Take Off) Dance Practice Mirror", ['WayV', '威神V'], '无翼而飞 (Take Off)'],
    ["[NCT U - 90's Love] dance practice mirrored", 'NCT', "90's Love"],
    // Titles that start with the group's names or with hashtags.
    ['SEVENTEEN | 세븐틴 | Super (Mirrored Dance Practice)', ['SEVENTEEN', '세븐틴'], 'Super'],
    ['#ITZY - #GOLD | Dance Practice', 'ITZY', 'GOLD'],
    // "Artist - Song" with no quotes: the song, not what is left of the artist.
    ['[NCT DREAM - BOOM] dance practice mirrored', 'NCT', 'BOOM'],
    ['BANG BANG - IVE  Obsessed with the flow of this choreography⚡️#BANGBANG #IVE', 'IVE', 'BANG BANG'],
    ['GO! (Clean Version) - CORTIS', 'CORTIS', 'GO!'],
    ['Monster High Fright Song ft. KATSEYE | Official Music Video | Monster High', 'KATSEYE', 'Monster High Fright Song'],
    // A short name is stripped as a word, not from inside another word.
    ['IVE - LIVE WIRE (Dance Practice)', 'IVE', 'LIVE WIRE'],
  ])('%p', (title, band, song) => {
    expect(songName(title, band)).toBe(song);
  });

  test.each([
    ['ROSÉ & Bruno Mars - APT. (Official Music Video)', 'ROSÉ', 'APT'],
    ['JENNIE - like JENNIE (Official Video)', 'JENNIE', 'like JENNIE'],
    ['JENNIE - like JENNIE (Official Live Performance Video l NPOP LIMITED EDITION - SIDE A)', 'JENNIE', 'like JENNIE'],
    ['LISA - SaWaDiKa (Dance Performance Video)', 'LISA', 'SaWaDiKa'],
    ['JENNIE - Mantra (Official Performance Video)', 'JENNIE', 'Mantra'],
  ])('solo %p', (title, artist, song) => {
    expect(songName(title, ['BLACKPINK', '블랙핑크'], artist)).toBe(song);
  });

  test('strips every name the group goes by', () => {
    const txt = BANDS.find((b) => b.slug === 'txt')!;
    expect(songName('TXT-STICK WITH YOU Dance Practice', bandNames(txt))).toBe('STICK WITH YOU');
    const idle = BANDS.find((b) => b.slug === 'g-i-dle')!;
    expect(songName('(G)I-DLE - Nxde (Dance Practice)', bandNames(idle))).toBe('Nxde');
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
    ['g-i-dle', "i-dle (아이들) 'Good Thing' Official Music Video", true],
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
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});


describe('solo songs on a group page', () => {
  const blackpink = BANDS.find((b) => b.slug === 'blackpink')!;

  test.each([
    ["BLACKPINK - 'JUMP' M/V", {}],
    ['JENNIE - like JENNIE (Official Video)', { artist: 'JENNIE' }],
    ['ROSÉ & Bruno Mars - APT. (Official Music Video)', { artist: 'ROSÉ' }],
    ['LISA - ROCKSTAR (Official Music Video)', { artist: 'LISA' }],
    ["j-hope ‘MONA LISA’ Official MV", undefined],
    ['IZONE LA VIE EN ROSE [audio full]', undefined],
    ['HANA / ROSE -Music Video-', undefined],
  ])('%p', (title, expected) => {
    expect(bandMatch(blackpink, title)).toEqual(expected);
  });

  test('Essentials keeps at most a couple of solos', () => {
    const pool = Array.from({ length: 12 }, (_, i) => video(i + 1, i < 6 ? { artist: 'JENNIE' } : {}));
    const picked = capSolos(pool, 8, 2);
    expect(picked).toHaveLength(8);
    expect(picked.filter((v) => v.artist)).toHaveLength(2);
  });

  test('a solo row names the singer', () => {
    const html = renderMix({ id: 'm', name: 'Mix', blurb: 'b', songs: [video(1, { artist: 'LISA', song: 'ROCKSTAR' })] }, blackpink);
    expect(html).toContain('<span class="row-artist">LISA</span> · ROCKSTAR');
  });
});

describe('the hub order', () => {
  test('most used lately first; ties go to the bigger pool', () => {
    const e = (slug: string, recent: number, songs: number) => ({ slug, recent, pool: Array(songs) });
    expect(rankEntries([e('a', 5, 10), e('b', 9, 10), e('c', 5, 20)]).map((x) => x.slug)).toEqual(['b', 'c', 'a']);
  });
});

describe('a mix panel', () => {
  const band = BANDS.find((b) => b.slug === 'twice')!;
  const html = renderMix({ id: 'essentials', name: 'TWICE Essentials', blurb: 'The hits.', songs: [video(1), video(2)] }, band);

  test('keeps the anchor the structured data links to, under an H2', () => {
    expect(html).toContain('id="twice-essentials"');
    expect(html).toMatch(/<h2 class="mix-name" id="twice-essentials-title">/);
  });

  test('opens in the builder and says what happens next', () => {
    expect(html).toContain('js-load-mix" data-mix="twice-essentials"');
    expect(html).toContain('Opens in this order.');
    expect(html).toContain('id="data-twice-essentials"');
  });

  test('song links start at the cut, with a valid query string', () => {
    expect(html).toContain('href="https://www.youtube.com/watch?v=vid00000001&amp;t=30"');
  });
});

describe('landing.css', () => {
  const root = join(import.meta.dir, '..', 'public', 'css');
  const tokens = (file: string) => {
    const css = readFileSync(join(root, file), 'utf-8');
    const from = css.indexOf('/* ===== Tokens ===== */');
    const to = css.indexOf('/* ===== Base ===== */');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    return css.slice(from, to).trim();
  };

  test('uses the same colour tokens as the builder', () => {
    expect(tokens('landing.css')).toBe(tokens('studio.css'));
  });
});
