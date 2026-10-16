/**
 * Builds the /random-dance/<group> landing pages.
 *
 * Every mix on these pages comes out of analytics.db: the songs are the ones
 * people actually put into generated mixes, and the start/end times are the
 * cut points those people chose (the most common pair per video). Nothing here
 * is invented, which is the whole point -- it is content no competitor has.
 *
 * Run with:  bun run scripts/build-landing-pages.ts
 */

import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const ORIGIN = 'https://kpopgenerator.cloud';
const OUT_DIR = join(process.cwd(), 'public', 'random-dance');

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface BandDef {
  slug: string;
  name: string;
  hangul?: string;
  match: RegExp;
  /** Earlier name, mentioned in the intro so people searching for it land right. */
  formerly?: string;
  /** Other names in titles, stripped from song names ("TXT"). */
  aliases?: string[];
  /** Members whose solo uploads belong on the group's page. */
  members?: { name: string; match: RegExp }[];
}

/**
 * A member's solo upload, matched only when the title starts with their name:
 * "LISA - ROCKSTAR", not j-hope's "MONA LISA".
 */
function solo(name: string, spelling = name): { name: string; match: RegExp } {
  return { name, match: new RegExp(`^(${spelling})(?![A-Za-z])`) };
}

/**
 * Only groups with a deep enough song pool in analytics.db get a page. A page
 * needs enough distinct songs to build several genuinely different mixes --
 * otherwise it is a thin doorway page, which Google treats as spam and which
 * is no use to a dancer either.
 */
export const BANDS: BandDef[] = [
  {
    slug: 'nct',
    name: 'NCT',
    hangul: '엔시티',
    aliases: ['NCT 127', 'NCT DREAM', 'NCT U', 'NCT WISH', 'NCT DOJAEJUNG', 'WayV', '威神V', '엔시티 127', '엔시티 드림', '엔시티 위시'],
    match: /\bNCT\b|엔시티|WayV/i,
  },
  { slug: 'bts', name: 'BTS', hangul: '방탄소년단', match: /\bBTS\b|방탄소년단/i },
  { slug: 'twice', name: 'TWICE', hangul: '트와이스', match: /\bTWICE\b|트와이스/i },
  { slug: 'stray-kids', name: 'Stray Kids', hangul: '스트레이 키즈', aliases: ['SKZ', 'Straykids'], match: /Stray ?Kids|스트레이 ?키즈|\bSKZ\b/i },
  { slug: 'itzy', name: 'ITZY', hangul: '있지', match: /\bITZY\b|있지/i },
  { slug: 'enhypen', name: 'ENHYPEN', hangul: '엔하이픈', match: /ENHYPEN|엔하이픈/i },
  { slug: 'le-sserafim', name: 'LE SSERAFIM', hangul: '르세라핌', match: /LE ?SSERAFIM|르세라핌/i },
  {
    slug: 'blackpink',
    name: 'BLACKPINK',
    hangul: '블랙핑크',
    match: /BLACKPINK|블랙핑크|BLΛƆKPIИK/i,
    members: [solo('JENNIE'), solo('LISA'), solo('ROSÉ', 'ROSÉ|ROSE'), solo('JISOO')],
  },
  { slug: 'ateez', name: 'ATEEZ', hangul: '에이티즈', match: /ATEEZ|에이티즈/i },
  { slug: 'seventeen', name: 'SEVENTEEN', hangul: '세븐틴', match: /SEVENTEEN|세븐틴/i },
  { slug: 'aespa', name: 'aespa', hangul: '에스파', match: /aespa|æspa|에스파/i },
  { slug: 'txt', name: 'TOMORROW X TOGETHER', hangul: '투모로우바이투게더', aliases: ['TXT'], match: /\bTXT\b|투모로우바이투게더|TOMORROW X TOGETHER/i },
  { slug: 'babymonster', name: 'BABYMONSTER', hangul: '베이비몬스터', match: /BABYMONSTER|베이비몬스터/i },
  { slug: 'boynextdoor', name: 'BOYNEXTDOOR', hangul: '보이넥스트도어', match: /BOYNEXTDOOR|보이넥스트도어/i },
  // Renamed from (G)I-DLE in 2025; the URL keeps the old name.
  { slug: 'g-i-dle', name: 'i-dle', hangul: '아이들', formerly: '(G)I-DLE', match: /\(G\)I-?DLE|\bi-dle\b|여자\(아이들\)|아이들/i },
  { slug: 'illit', name: 'ILLIT', hangul: '아일릿', match: /\bILLIT\b|아일릿/i },
  { slug: 'nmixx', name: 'NMIXX', hangul: '엔믹스', match: /NMIXX|엔믹스/i },
  { slug: 'katseye', name: 'KATSEYE', match: /KATSEYE/i },
  { slug: 'newjeans', name: 'NewJeans', hangul: '뉴진스', match: /New ?Jeans|뉴진스/i },
  { slug: 'red-velvet', name: 'Red Velvet', hangul: '레드벨벳', match: /Red ?Velvet|레드벨벳/i },
  { slug: 'xg', name: 'XG', match: /\bXG\b/ },
  { slug: 'ive', name: 'IVE', hangul: '아이브', match: /\bIVE\b|아이브/i },
];

// ---------------------------------------------------------------------------
// Mining analytics.db
// ---------------------------------------------------------------------------

export interface Video {
  url: string;
  videoId: string;
  title: string;
  song: string;
  uses: number;
  start: string;
  end: string;
  seconds: number;
  isPractice: boolean;
  /** Set for a member's solo song on a group page. */
  artist?: string;
}

/** Lyric videos, audio rips, reactions -- useless for a dance practice mix. */
const REJECT =
  /lyrics|color coded|reaction|funny|interview|teaser|behind|episode|vlog|explained|ranking|compilation|karaoke|instrumental|sped ?up|nightcore|cover by|tutorial|guide|countdown|playlist|full album|official audio|music audio|\[audio\]|\(audio\)|track film|live vs|#shorts/i;

/** Music videos and the performance/practice uploads dancers actually use. */
const ACCEPT =
  /\bMV\b|M\/V|official video|official music video|dance practice|performance video|choreography|dance video|studio choom|be original|relay dance/i;

const PRACTICE = /dance practice|choreography|performance video|studio choom|be original|relay dance|mirrored/i;

/**
 * Times in analytics.db are whatever people typed into the form, so alongside
 * "1:23" the table holds ":48", "25" and "1:51 ". Parse leniently here, then
 * re-emit canonically via formatClock so the generator only ever receives a
 * value its own validator accepts.
 */
export function toSeconds(t: string): number {
  const parts = t.trim().split(':');
  if (parts.length > 3) return NaN;
  let total = 0;
  for (const part of parts) {
    const n = part === '' ? 0 : Number(part);
    if (!Number.isFinite(n) || n < 0) return NaN;
    total = total * 60 + n;
  }
  return total;
}

export function formatClock(total: number): string {
  const t = Math.round(total);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function videoId(url: string): string {
  const m = url.match(/[?&]v=([\w-]{6,})/) || url.match(/youtu\.be\/([\w-]{6,})/);
  return m?.[1] ?? '';
}

/** Format labels that describe the upload rather than the song. */
const FORMAT_WORDS =
  /\b(official\s+)?(music\s+)?(video|mv|m\/v)\b|\bdance practice\b|\bperformance video\b|\bchoreography( practice)?( video)?\b|\bmirror(ed)?\b|\bstudio choom( original)?\b|\bbe original\b|\brelay dance\b|\b4k\b|\bver\.?\b|\bdance cover\b|\bcontest\b|\b1thek\b|\bzoomed\b|\boriginal song\b|\b(mv )?rehearsal\b/gi;

/** A bracketed chunk that is a tag, not part of the title. */
const BRACKET_TAG =
  /^\s*(mv|m\/v|4k|hd|fmv|mirrored|be original|studio choom.*|official.*|special.*|dance practice.*|performance.*|.*\bver\.?.*)\s*$/i;

/** A bracketed group that describes the upload: "(Official Performance Video)", "(Clean Version)". */
const FORMAT_GROUP =
  /official|video|performance|practice|mirror|\bver\b|\bver\.|version|\b4k\b|lyric|audio|clean|explicit|choreo|edition|live (clip|stage|ver)|studio choom|be original|\bmv\b|m\/v/i;

/**
 * Pull the song name out of a YouTube title. K-pop uploads are formulaic
 * enough that the quoted segment is almost always the track name; everything
 * else goes through stripFurniture as a fallback.
 *
 * `band` is every name the group goes by (see bandNames). `artist` is the
 * member on a solo upload: it helps find the song part of "LISA - ROCKSTAR",
 * but stays in the name, as in "like JENNIE".
 */
export function songName(title: string, band: string | string[], artist?: string): string {
  const names = typeof band === 'string' ? [band] : band;
  // Curly quotes first: they can hold an apostrophe, as in ‘Hit 'Em’.
  let quoted =
    // ’ before a letter is an apostrophe: ‘It’s Me’.
    title.match(/‘((?:[^‘’]|’(?=[A-Za-z]))+?)’(?![A-Za-z])/) ??
    title.match(/“([^“”]{2,60})”/) ??
    // Straight or mixed single quotes around an apostrophe inside a word:
    // 'It's Me', 'It’s Me’, 'NOT CUTE ANYMORE’.
    title.match(/(?<![A-Za-z])'((?:[^'‘’"“”]|['’](?=[A-Za-z]))+?)['’](?![A-Za-z])/) ??
    // Double quotes can hold an apostrophe too: "THAT'S A NO NO", "神메뉴(God's Menu)".
    title.match(/(?<![A-Za-z])"([^"“”]{2,60})"/) ??
    title.match(/['‘’"“”]([^'‘’"“”]{2,60})['‘’"“”]/);
  // ‘LOVE ver.’ names a version of the upload, not the song.
  if (quoted && /^\s*\S+\s+ver\.?\s*$/i.test(quoted[1]!)) quoted = null;
  // One letter in quotes is a tag ('C'), not a song; long ones are a sentence.
  if (quoted && (quoted[1]!.trim().length < 2 || quoted[1]!.length > 60)) quoted = null;
  const raw = quoted?.[1] ?? stripNames(songPart(cleanTitle(title, names), artist ? [...names, artist] : names), names);
  return tidy(preferLatin(raw)) || tidy(stripFurniture(title, names)) || title;
}

/** All the names a group goes by, longest first, for stripping from titles. */
export function bandNames(band: BandDef): string[] {
  return [band.name, band.formerly, band.hangul, ...(band.aliases ?? [])]
    .filter((n): n is string => !!n)
    .sort((a, b) => b.length - a.length);
}

/** A name as a whole word, so stripping "IVE" leaves "LIVE" alone. */
function namesPattern(names: string[]): RegExp | null {
  if (names.length === 0) return null;
  const alts = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?<![A-Za-z])(${alts})(?![A-Za-z])`, 'gi');
}

/**
 * "Artist - Song" with no quotes: keep the part that doesn't name the artist
 * ("BANG BANG - IVE ...", "LISA - ROCKSTAR", "[NCT DREAM - BOOM]"); when every
 * part does, the last one ("JENNIE - like JENNIE"). Dashes inside brackets
 * don't split.
 */
export function songPart(title: string, names: string[]): string {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < title.length; i++) {
    const c = title[i]!;
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if (depth === 0 && /[-–—]/.test(c) && title[i - 1] === ' ' && title[i + 1] === ' ') {
      parts.push(title.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(title.slice(from));
  const real = parts.filter((p) => /[A-Za-z0-9가-힣]/.test(tidy(p)));
  if (real.length < 2) return title;
  const named = namesPattern(names);
  return real.find((p) => !named || !new RegExp(named.source, 'i').test(p)) ?? real[real.length - 1]!;
}

/**
 * The title without what describes the upload: everything after a "|" or a
 * hashtag, bracketed tags and format groups. Other brackets keep their
 * contents, since some uploads wrap the whole title in brackets.
 */
function cleanTitle(title: string, names: string[] = []): string {
  // The first part that is more than the group's names: "SEVENTEEN | 세븐틴 | Super".
  const segments = title.split('|');
  const segment = segments.find((s) => /[A-Za-z0-9가-힣]/.test(tidy(stripNames(s, names)))) ?? segments[0] ?? title;
  return segment
    // A run of hashtags is promotion; a single one can be the song ("#BOMB ver.").
    // So is a title made only of hashtags ("#ITZY - #GOLD"): keep the words.
    .replace(/#\S.*$/, (tags: string, at: number) =>
      at > 0 && (tags.match(/#/g) ?? []).length > 1 ? ' ' : tags.replace(/#/g, ''),
    )
    .replace(/\[([^\]]*)\]/g, (_, inner: string) => (BRACKET_TAG.test(inner) || FORMAT_GROUP.test(inner) ? ' ' : ` ${inner} `))
    .replace(/\(([^()]*)\)/g, (group: string, inner: string) => (FORMAT_GROUP.test(inner) ? ' ' : group));
}

function stripNames(s: string, names: string[]): string {
  const named = namesPattern(names);
  return (
    s
      // Parenthesised hangul or Japanese next to a Latin name is the same name twice.
      .replace(/\(\s*[가-힣ぁ-んァ-ン一-龯\s]+\s*\)/g, ' ')
      .replace(/\s*\((feat|prod|with|ft)\.?[^)]*\)/gi, ' ')
      .replace(/\s(feat|ft)\.\s.*$/i, ' ')
      .replace(named ?? /$^/, ' ')
      .replace(FORMAT_WORDS, ' ')
      // A quote left without its pair ("WayV '无翼而飞 (Take Off)"); not an apostrophe ("90's").
      .replace(/(?<![A-Za-z0-9])['‘’"“”]|['‘’"“”](?![A-Za-z])/g, ' ')
  );
}

/**
 * Strip the parts of a YouTube title that describe the upload rather than the
 * track: bracketed tags, the group's own names, and format labels. Without
 * this, "Dope" and "DOPE Dance Practice" read as two different songs and both
 * end up in the same mix.
 */
export function stripFurniture(title: string, band: string | string[]): string {
  const names = typeof band === 'string' ? [band] : band;
  return stripNames(cleanTitle(title, names), names);
}

/**
 * K-pop titles often give the Korean name with the English one in brackets
 * ("피 땀 눈물 (Blood Sweat & Tears)"). On an English page the Latin name is the
 * useful one, and picking it consistently also stops the two spellings of one
 * song appearing in the same mix.
 */
export function preferLatin(name: string): string {
  const withoutCredits = name.replace(/\s*\((feat|prod|with|ft)\.?[^)]*\)/gi, ' ');
  if (!/[가-힣]/.test(withoutCredits)) return withoutCredits;
  const latin = [...withoutCredits.matchAll(/\(([^)]*[A-Za-z][^)]*)\)/g)]
    .map((m) => (m[1] ?? '').trim())
    .filter((s) => s.length >= 2);
  return latin[latin.length - 1] ?? withoutCredits;
}

/** Collapse whitespace and shave leftover separators from an extracted name. */
export function tidy(s: string): string {
  return s
    // Parens left empty by the strips above, e.g. "부석순 ( ) - 청바지".
    .replace(/\(\s*[^A-Za-z0-9가-힣]*\s*\)/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/[-–—]{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*-\s*/g, ' - ')
    .replace(/^[\s\-–—:,.]+|[\s\-–—:,.]+$/g, '')
    .slice(0, 60)
    .trim();
}

function loadVideos(): Video[] {
  const db = new Database(join(process.cwd(), 'analytics.db'), { readonly: true });
  const rows = db
    .query(
      `SELECT youtube_url AS url, title, start_time AS s, end_time AS e, COUNT(*) AS c
       FROM generation_songs
       WHERE title IS NOT NULL AND title NOT IN ('Song', '')
         AND start_time IS NOT NULL AND end_time IS NOT NULL
       GROUP BY youtube_url, start_time, end_time`,
    )
    .all() as { url: string; title: string; s: string; e: string; c: number }[];
  db.close();

  // Collapse to one entry per video, keeping the most frequently chosen cut.
  const byUrl = new Map<string, { title: string; uses: number; cuts: Map<string, number> }>();
  for (const r of rows) {
    let v = byUrl.get(r.url);
    if (!v) {
      v = { title: r.title, uses: 0, cuts: new Map() };
      byUrl.set(r.url, v);
    }
    v.uses += r.c;
    const key = `${r.s}|${r.e}`;
    v.cuts.set(key, (v.cuts.get(key) ?? 0) + r.c);
  }

  const out: Video[] = [];
  for (const [url, v] of byUrl) {
    if (REJECT.test(v.title) || !ACCEPT.test(v.title)) continue;
    const id = videoId(url);
    if (!id) continue;

    const modal = [...v.cuts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!modal) continue;
    const [rawStart, rawEnd] = modal[0].split('|');
    if (!rawStart || !rawEnd) continue;

    const startSec = toSeconds(rawStart);
    const endSec = toSeconds(rawEnd);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) continue;
    // From the rounded times, so the length shown matches the times shown
    // (and the cut the builder gets).
    const seconds = Math.round(endSec) - Math.round(startSec);
    // Guard against nonsense cuts (inverted, absurdly long, or a stray 0-length).
    if (seconds < 8 || seconds > 150) continue;

    out.push({
      // Rebuilt from the id: the stored URL is whatever a user submitted, and
      // it lands in an href on a public page.
      url: `https://www.youtube.com/watch?v=${id}`,
      videoId: id,
      title: v.title,
      song: '',
      uses: v.uses,
      start: formatClock(startSec),
      end: formatClock(endSec),
      seconds,
      isPractice: PRACTICE.test(v.title),
    });
  }
  return out;
}

/** One video per song title, so a mix never repeats a track via two uploads. */
export function dedupeBySong(videos: Video[]): Video[] {
  const seen = new Map<string, Video>();
  for (const v of videos) {
    const key = v.song.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
    const existing = seen.get(key);
    if (!existing || v.uses > existing.uses) seen.set(key, v);
  }
  return [...seen.values()].sort((a, b) => b.uses - a.uses);
}

// ---------------------------------------------------------------------------
// Mix construction
// ---------------------------------------------------------------------------

export interface Mix {
  id: string;
  name: string;
  blurb: string;
  songs: Video[];
}

const COUNTDOWN_SECONDS = 5;

export function runtime(songs: Video[]): number {
  return songs.reduce((s, v) => s + v.seconds, 0) + COUNTDOWN_SECONDS * (songs.length - 1);
}

export function fmt(total: number): string {
  const m = Math.floor(total / 60);
  const s = Math.round(total % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Deterministic shuffle, so rebuilding the site doesn't churn every page. */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

const MIN_MIX_SONGS = 5;
const MAX_MIX_SONGS = 10;
const MAX_MIXES = 10;

/** A group's Essentials are the group's songs; members' solos get a couple of seats. */
const MAX_ESSENTIAL_SOLOS = 2;

/** The first `count` videos, with at most `maxSolos` solo songs among them. */
export function capSolos(videos: Video[], count: number, maxSolos: number): Video[] {
  const out: Video[] = [];
  let solos = 0;
  for (const v of videos) {
    if (out.length >= count) break;
    if (v.artist) {
      if (solos >= maxSolos) continue;
      solos++;
    }
    out.push(v);
  }
  return out;
}

/** Would this mix just be a reshuffle of one we already kept? */
export function tooSimilar(mix: Mix, kept: Mix[]): boolean {
  const ids = new Set(mix.songs.map((s) => s.videoId));
  return kept.some((k) => {
    const overlap = k.songs.filter((s) => ids.has(s.videoId)).length;
    return overlap / Math.min(k.songs.length, mix.songs.length) > 0.7;
  });
}

export function buildMixes(band: BandDef, pool: Video[]): Mix[] {
  const byUses = [...pool].sort((a, b) => b.uses - a.uses);
  const byShort = [...pool].sort((a, b) => a.seconds - b.seconds);
  const byLong = [...pool].sort((a, b) => b.seconds - a.seconds);
  const practice = byUses.filter((v) => v.isPractice);
  const seed = band.slug.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const n = pool.length;

  // Mix length scales with the catalogue. A group with twelve songs in the pool
  // cannot support ten-song sets without every mix being the same mix, so their
  // pages get shorter, sharper sets instead of padded ones.
  const clamp = (x: number) => Math.max(MIN_MIX_SONGS, Math.min(MAX_MIX_SONGS, x));
  const big = clamp(Math.round(n * 0.4));
  const mid = clamp(Math.round(n * 0.3));
  const few = MIN_MIX_SONGS;
  const deepFrom = Math.max(3, Math.round(n * 0.3));

  const candidates: Mix[] = [
    {
      id: 'essentials',
      name: `${band.name} Essentials`,
      blurb: `The ${band.name} songs our users put into random dance mixes more than any others, each cut at the point they most often chose.`,
      songs: capSolos(byUses, mid, MAX_ESSENTIAL_SOLOS),
    },
    {
      id: 'quick-warmup',
      name: 'Quick Warm-Up',
      blurb: `Short segments to loosen up with before a longer run — the tightest cuts in the ${band.name} pool.`,
      songs: byShort.filter((v) => v.seconds >= 15).slice(0, few),
    },
    {
      id: 'chorus-rush',
      name: 'Chorus Rush',
      blurb: 'Every clip under 40 seconds. Fast switches, no time to catch your breath between hooks.',
      songs: byUses.filter((v) => v.seconds <= 40).slice(0, mid),
    },
    {
      id: 'full-sections',
      name: 'Long Sections',
      blurb: 'The longest cuts in the pool, for when you want to dance a full chorus and the section after it rather than just the hook.',
      songs: byLong.slice(0, Math.max(few, Math.round(mid * 0.8))),
    },
    {
      id: 'deep-cuts',
      name: 'Deep Cuts',
      blurb: `${band.name} tracks that get mixed regularly but never crack the top of the list. Good for an RPD crowd that knows the hits already.`,
      songs: byUses.slice(deepFrom).slice(0, mid),
    },
    {
      id: 'dance-practice',
      name: 'Dance Practice Edition',
      blurb: 'Built only from dance practice, choreography and performance uploads, so the audio matches the versions most covers learn from.',
      songs: practice.slice(0, mid),
    },
    {
      id: 'marathon',
      name: 'Marathon Set',
      blurb: `The long one: songs drawn across the whole ${band.name} pool, popular and obscure mixed together.`,
      songs: seededShuffle(byUses, seed).slice(0, big),
    },
    {
      id: 'starter-five',
      name: 'Starter Five',
      blurb: 'Five well-known songs at moderate segment lengths. A gentle first random dance if you are new to RPD.',
      songs: byUses.filter((v) => v.seconds >= 25 && v.seconds <= 50).slice(0, few),
    },
  ];

  const kept: Mix[] = [];
  for (const mix of candidates) {
    if (mix.songs.length < MIN_MIX_SONGS) continue;
    if (tooSimilar(mix, kept)) continue;
    kept.push(mix);
  }

  // Top up with randomised draws so every page offers a real choice of sets.
  // These are honest content for a random dance tool -- a different draw is the
  // product -- but they only ever fill the gap, never dominate the page.
  // Letters go to the draws that are kept, so a page never starts at "Set D".
  const letters = ['A', 'B', 'C', 'D', 'E'];
  let next = 0;
  for (let i = 0; i < 5 && kept.length < 5; i++) {
    const letter = letters[next] as string;
    const mix: Mix = {
      id: `shuffle-${letter.toLowerCase()}`,
      name: `Shuffle Set ${letter}`,
      blurb: `A randomised draw from the ${band.name} pool. Different songs from the sets above, same real cut points.`,
      songs: seededShuffle(byUses, seed * (i + 3) + 17).slice(0, Math.max(few, mid - 1)),
    };
    if (mix.songs.length < MIN_MIX_SONGS || tooSimilar(mix, kept)) continue;
    kept.push(mix);
    next++;
  }

  return kept.slice(0, MAX_MIXES);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Bump when landing.css or landing.js change: both are cached for a while. */
const ASSET_VERSION = 3;

/** "1 song" / "2 songs" -- the stat row reads badly without it. */
function plural(n: number, one: string, many = one + 's'): string {
  return n === 1 ? one : many;
}

/**
 * JSON for a <script> tag. JSON.stringify leaves `</script>` intact, and song
 * titles come straight from user input, so escape `<` to keep it inert.
 */
export function scriptJson(o: unknown, space?: number): string {
  return JSON.stringify(o, null, space).replace(/</g, '\\u003c');
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "1, 2 and 3" */
function listing(items: string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Two-digit numbers, as in the builder's setlist. */
const pad2 = (n: number) => String(n).padStart(2, '0');

const cover = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

/** The builder's dancer mark (public/index.html), so both pages share one top bar. */
const BRAND_MARK = `<svg class="brand-mark" width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--accent)"></rect><g transform="translate(32 32) scale(0.6) translate(-52.5 -46)" fill="var(--accentText)" stroke="var(--accentText)" stroke-linecap="round" stroke-linejoin="round"><circle cx="43.8" cy="10.5" r="5.2" stroke="none"></circle><circle cx="56.2" cy="10.5" r="5.2" stroke="none"></circle><ellipse cx="50" cy="20.5" rx="7.6" ry="8.6" stroke="none"></ellipse><path d="M46.5 26 L53.5 26 L54 34 L46 34 Z" stroke="none"></path><path d="M39 35 Q50 32 61 35 L59 46 Q57 51 57 56 L44 56 Q44 51 41 46 Z" stroke-width="2"></path><path d="M43.5 55 L57.5 55 L69 74 Q50 79 31 76 Z" stroke-width="2"></path><path d="M58 37 L66 23 L74 7" fill="none" stroke-width="7.5"></path><path d="M42 37 L30 46 L44 54" fill="none" stroke-width="7"></path><path d="M45 72 L44 90" fill="none" stroke-width="9"></path><path d="M56 72 L64 88" fill="none" stroke-width="8.5"></path></g></svg>`;

const CHEVRON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>`;
const HEART = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 12.6 12 20l-7.5-7.4A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 7.5 6z"></path></svg>`;
const PLAY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z"></path></svg>`;

const KOFI = 'https://ko-fi.com/dimitrisk80';

function shell(opts: {
  title: string;
  description: string;
  canonical: string;
  /** "page" on the hub itself, "true" on a group page inside it. */
  navCurrent: 'page' | 'true';
  jsonLd: object[];
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(opts.title)}</title>
    <meta name="description" content="${esc(opts.description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${opts.canonical}" />

    <meta property="og:type" content="website" />
    <meta property="og:url" content="${opts.canonical}" />
    <meta property="og:title" content="${esc(opts.title)}" />
    <meta property="og:description" content="${esc(opts.description)}" />
    <meta property="og:image" content="${ORIGIN}/assets/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:site_name" content="K-Pop Random Dance Generator" />
    <meta property="og:locale" content="en_US" />
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:title" content="${esc(opts.title)}" />
    <meta property="twitter:description" content="${esc(opts.description)}" />
    <meta property="twitter:image" content="${ORIGIN}/assets/og-image.png" />

    <!-- The theme chosen in the builder, before anything paints (Dark is the default). -->
    <script>
      try {
        if (localStorage.getItem("kpopgen:theme") === "light") document.documentElement.dataset.theme = "light";
      } catch (e) {}
    </script>

    <meta name="theme-color" content="#15171d" />
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
    <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@500;700&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/css/landing.css?v=${ASSET_VERSION}" />
${opts.jsonLd.map((o) => `    <script type="application/ld+json">\n${scriptJson(o, 2)}\n    </script>`).join('\n')}

    <script async src="https://www.googletagmanager.com/gtag/js?id=G-Q93H8H3JP4"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-Q93H8H3JP4');
    </script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="topbar">
      <div class="topbar-left">
        <a class="brand" href="/">
          ${BRAND_MARK}
          <span class="brand-name">K-Pop Random Dance Generator</span>
        </a>
        <nav class="mainnav" aria-label="Main">
          <a href="/">Builder</a>
          <a href="/random-dance/" aria-current="${opts.navCurrent}">Ready-made mixes</a>
          <a class="nav-how" href="/#how-it-works">How it works</a>
        </nav>
      </div>
      <div class="topbar-right">
        <div class="menu-wrap" data-menu>
          <button type="button" class="btn" aria-expanded="false" aria-controls="themeMenu">
            <span class="theme-swatch" aria-hidden="true"></span>
            <span class="theme-prefix">Theme: </span><span id="themeName">Dark</span>
            ${CHEVRON}
          </button>
          <div class="menu" id="themeMenu" hidden>
            <button type="button" class="menu-item" data-theme-choice="dark" aria-pressed="true">Dark <span class="check" aria-hidden="true">✓</span></button>
            <button type="button" class="menu-item" data-theme-choice="light" aria-pressed="false">Light <span class="check" aria-hidden="true">✓</span></button>
          </div>
        </div>
        <a class="btn btn-outline support-btn" href="${KOFI}" target="_blank" rel="noopener" data-support="landing-header">
          ${HEART}
          <span class="support-label">Support</span><span class="sr-only"> on Ko-fi (opens in a new tab)</span>
        </a>
      </div>
    </header>

${opts.body}

    <footer class="site-foot">
      <div class="foot-inner">
        <section class="foot-col" aria-labelledby="foot-build">
          <h2 id="foot-build">Make your own mix</h2>
          <p>Search YouTube, pick the part of each song, and get one MP3 with a 5-second countdown before every song. Free, no sign-up.</p>
          <p><a class="btn btn-primary" href="/">Open the builder</a></p>
        </section>
        <section class="foot-col" aria-labelledby="foot-support">
          <h2 id="foot-support">Enjoying the tool?</h2>
          <p>It's free and always will be. Support on Ko-fi helps pay for the servers.</p>
          <p class="foot-row">
            <a class="btn" href="${KOFI}" target="_blank" rel="noopener" data-support="landing-footer">${HEART} Support on Ko-fi<span class="sr-only"> (opens in a new tab)</span></a>
            <a class="foot-link" href="/#how-it-works">How it works</a>
            <a class="foot-link" href="/#contact">Contact us</a>
          </p>
        </section>
      </div>
      <p class="thanks">Made with 💜 for K-pop dance lovers · FREE · NO SIGN-UP</p>
    </footer>

    <div class="toast-region" id="toastRegion" role="status" aria-live="polite"></div>
    <script src="/app/landing.js?v=${ASSET_VERSION}"></script>
  </body>
</html>
`;
}

function crumbs(items: { name: string; href?: string }[]): string {
  const li = items
    .map((c) =>
      c.href
        ? `          <li><a href="${c.href}">${esc(c.name)}</a></li>`
        : `          <li><span aria-current="page">${esc(c.name)}</span></li>`,
    )
    .join('\n');
  return `      <nav class="crumbs" aria-label="Breadcrumb">
        <ol>
${li}
        </ol>
      </nav>`;
}

function tiles(items: [string, string][]): string {
  return `        <dl class="tiles${items.length === 3 ? ' tiles-3' : ''}">
${items.map(([k, v]) => `          <div class="tile"><dt class="tile-k">${esc(k)}</dt><dd class="tile-v">${esc(v)}</dd></div>`).join('\n')}
        </dl>`;
}

/** Song name as shown on a page, with the singer in front of a solo song. */
function displayName(v: Video): string {
  return v.artist ? `<span class="row-artist">${esc(v.artist)}</span> · ${esc(v.song)}` : esc(v.song);
}

export function renderMix(mix: Mix, band: BandDef): string {
  const id = `${band.slug}-${mix.id}`;
  const payload = {
    version: '1.0',
    name: `${band.name} - ${mix.name}`,
    shuffleEnabled: true,
    songs: mix.songs.map((s) => ({
      youtubeUrl: s.url,
      title: s.title,
      startTime: s.start,
      endTime: s.end,
      info: null,
      isExpanded: false,
    })),
  };

  const rows = mix.songs
    .map(
      (s, i) => `            <li class="row">
              <span class="row-num">${pad2(i + 1)}</span>
              <img class="row-thumb" src="${cover(s.videoId)}" width="64" height="36" alt="" loading="lazy" decoding="async" />
              <a class="row-title" href="${esc(s.url)}&amp;t=${toSeconds(s.start)}" target="_blank" rel="noopener nofollow">${displayName(s)}<span class="sr-only"> (opens YouTube in a new tab)</span></a>
              <span class="row-time"><span class="sr-only">Plays </span>${esc(s.start)}&ndash;${esc(s.end)}</span>
              <span class="row-len">${s.seconds}s</span>
            </li>`,
    )
    .join('\n');

  return `        <article class="panel mix" id="${id}" aria-labelledby="${id}-title">
          <div class="panel-head">
            <h2 class="mix-name" id="${id}-title"><span class="status-dot" aria-hidden="true"></span>${esc(mix.name)}</h2>
            <p class="mix-stats">${mix.songs.length} SONGS · ~${fmt(runtime(mix.songs))} · 5S COUNTDOWN</p>
          </div>
          <p class="mix-blurb">${esc(mix.blurb)}</p>
          <ol class="rows">
${rows}
          </ol>
          <div class="mix-foot">
            <button type="button" class="btn btn-primary js-load-mix" data-mix="${id}">${PLAY} Open in builder</button>
            <p class="mix-hint">Opens in this order. Press <b>Shuffle now</b>, then <b>Generate mix</b> to get the MP3.</p>
            <button type="button" class="link-btn js-download-mix" data-mix="${id}">Save as project file (.json)</button>
          </div>
          <script type="application/json" id="data-${id}">${scriptJson(payload)}</script>
        </article>`;
}

function otherGroups(bands: BandDef[]): string {
  return bands.map((b) => `          <a href="/random-dance/${b.slug}">${esc(b.name)}</a>`).join('\n');
}

function renderBandPage(band: BandDef, mixes: Mix[], pool: Video[], others: BandDef[]): string {
  const top = pool[0]!;
  const avg = Math.round(pool.reduce((s, v) => s + v.seconds, 0) / pool.length);
  const practiceCount = pool.filter((v) => v.isPractice).length;
  const soloists = [...new Set(pool.map((v) => v.artist).filter((a): a is string => !!a))];

  const title = `${band.name} Random Dance Mixes | ${mixes.length} Ready-Made Sets`;
  const description = `${mixes.length} ready-made ${band.name} random dance mixes with real cut points, from ${pool.length} songs. Open one in the builder or edit the timings yourself.`;
  const canonical = `${ORIGIN}/random-dance/${band.slug}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Random Dance Mixes', item: `${ORIGIN}/random-dance/` },
        { '@type': 'ListItem', position: 3, name: `${band.name} Mixes`, item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `${band.name} random dance mixes`,
      description,
      numberOfItems: mixes.length,
      itemListElement: mixes.map((m, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${band.name} - ${m.name}`,
        description: m.blurb,
        url: `${canonical}#${band.slug}-${m.id}`,
      })),
    },
  ];

  const aka = [
    band.hangul ? `<span lang="ko">${esc(band.hangul)}</span>` : '',
    band.formerly ? `formerly ${esc(band.formerly)}` : '',
  ].filter(Boolean);

  const body = `    <main id="main" class="page" tabindex="-1">
${crumbs([{ name: 'Home', href: '/' }, { name: 'Random dance mixes', href: '/random-dance/' }, { name: band.name }])}

      <header class="hero">
        <p class="eyebrow"><span class="status-dot" aria-hidden="true"></span>READY-MADE MIXES</p>
        <h1>${esc(band.name)} Random Dance Mixes</h1>
        <p class="lede">
          ${mixes.length} ready-made ${esc(band.name)} random dance sets you can open in the builder
          in one click. ${esc(band.name)}${aka.length ? ` (${aka.join(', ')})` : ''} appears in
          ${pool.length} distinct songs across the mixes people have built on this site, and every
          start and end time below is the cut point those people actually used, not a guess.${
            soloists.length
              ? `\n          Solo songs by ${listing(soloists.map(esc))} are included and marked with the singer's name.`
              : ''
          }
        </p>
${tiles([
  ['SONGS', String(pool.length)],
  [plural(mixes.length, 'MIX', 'MIXES'), String(mixes.length)],
  ['AVG CLIP', `${avg}s`],
  [plural(practiceCount, 'PRACTICE VIDEO').toUpperCase(), String(practiceCount)],
])}
        <p class="top-song">
          <span class="top-song-k">MOST MIXED NOW</span>
          <strong>${displayName(top)}</strong>
          <span class="top-song-time">usually ${esc(top.start)}&ndash;${esc(top.end)}</span>
        </p>
        <nav class="jump" aria-label="Mixes on this page">
${mixes.map((m) => `          <a href="#${band.slug}-${m.id}">${esc(m.name)}</a>`).join('\n')}
        </nav>
      </header>

      <div class="mixes">
${mixes.map((m) => renderMix(m, band)).join('\n')}
      </div>

      <section class="prose" aria-labelledby="how-title">
        <h2 id="how-title">How to use these ${esc(band.name)} mixes</h2>
        <p>
          Press <b>Open in builder</b> on any mix. The songs and their cut points load into the
          builder on the home page in the order shown here. Drop songs you don't know, move songs up
          or down, or nudge a start or end time in the editor. Press <b>Shuffle now</b> for a random
          order (that is the point of a random play dance), then <b>Generate mix</b> to get one MP3
          with a 5-second countdown before every song.
        </p>
        <p>
          Want to keep a set? <b>Save as project file</b> saves it as a .json file. Open it later in
          the builder from <b>Project &rarr; Open a saved file</b>, or send it to whoever is running
          your RPD event.
        </p>

        <h2>Where these cut points come from</h2>
        <p>
          Each clip is the segment most commonly chosen for that video by people using this
          generator. In practice that lands on the chorus or the dance break, because that is the
          part of a ${esc(band.name)} song a random play dance crowd knows and can actually follow.
          The pool is rebuilt as usage changes, so the mixes shift over time rather than sitting
          frozen at whatever was popular when the page was written.
        </p>
        <p>
          Lyric videos, audio rips and reaction uploads are filtered out, and each song appears
          only once even when several uploads of it exist, so a mix never plays you the same
          choreography twice.
        </p>
      </section>

      <section class="others" aria-labelledby="others-title">
        <h2 id="others-title">Mixes for other groups</h2>
        <div class="chips">
${otherGroups(others.filter((b) => b.slug !== band.slug))}
        </div>
        <a class="arrow-link" href="/random-dance/">All groups &rarr;</a>
      </section>
    </main>`;

  return shell({ title, description, canonical, navCurrent: 'true', jsonLd, body });
}

export interface Entry {
  band: BandDef;
  mixes: Mix[];
  pool: Video[];
  /** Mixes made on the site in the last RECENT_DAYS days that used the group. */
  recent: number;
}

/** How many groups on the hub get the MOST MIXED tag. */
const MOST_MIXED_TAGS = 5;

/** Entries in hub order: the most used lately first. */
export function rankEntries<T extends { recent: number; pool: unknown[] }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => b.recent - a.recent || b.pool.length - a.pool.length);
}

function renderHub(ranked: Entry[]): string {
  const totalMixes = ranked.reduce((s, e) => s + e.mixes.length, 0);
  const totalSongs = ranked.reduce((s, e) => s + e.pool.length, 0);
  const title = 'K-Pop Random Dance Mixes by Group | Ready-Made Sets';
  const description = `${totalMixes} ready-made K-Pop random dance mixes across ${ranked.length} groups, with real cut points. Open any set in the builder in one click.`;
  const canonical = `${ORIGIN}/random-dance/`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Random Dance Mixes', item: canonical },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'K-Pop random dance mixes by group',
      numberOfItems: ranked.length,
      itemListElement: ranked.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${e.band.name} random dance mixes`,
        url: `${ORIGIN}/random-dance/${e.band.slug}`,
      })),
    },
  ];

  const cards = ranked
    .map((e, i) => {
      // The card shows a group song, not a member's solo.
      const top = e.pool.find((v) => !v.artist) ?? e.pool[0]!;
      const tag = i < MOST_MIXED_TAGS ? `<span class="tag">MOST MIXED</span>` : '';
      return `          <li>
            <a class="band-card" href="/random-dance/${e.band.slug}">
              <img class="band-cover" src="${cover(top.videoId)}" width="320" height="180" alt="" loading="lazy" decoding="async" />
              <span class="band-top"><span class="band-rank">${pad2(i + 1)}</span>${tag}</span>
              <h3 class="band-name">${esc(e.band.name)}</h3>
              ${e.band.hangul ? `<span class="band-hangul" lang="ko">${esc(e.band.hangul)}</span>` : ''}
              <span class="band-meta">${e.mixes.length} MIXES · ${e.pool.length} SONGS</span>
              <span class="band-song">Most mixed: <b>${esc(top.song)}</b></span>
            </a>
          </li>`;
    })
    .join('\n');

  const body = `    <main id="main" class="page" tabindex="-1">
${crumbs([{ name: 'Home', href: '/' }, { name: 'Random dance mixes' }])}

      <header class="hero">
        <p class="eyebrow"><span class="status-dot" aria-hidden="true"></span>READY-MADE MIXES</p>
        <h1>K-Pop Random Dance Mixes by Group</h1>
        <p class="lede">
          ${totalMixes} ready-made random dance sets across ${ranked.length} groups. Every mix is
          built from songs people have actually put through this generator, cut at the timings they
          chose. Pick a group, open a mix in the builder, and generate the MP3, or change it first.
        </p>
${tiles([
  ['GROUPS', String(ranked.length)],
  ['MIXES', String(totalMixes)],
  ['SONGS', String(totalSongs)],
])}
      </header>

      <section class="groups" aria-labelledby="groups-title">
        <div class="section-head">
          <h2 id="groups-title">Groups</h2>
          <p class="section-note">RANKED BY MIXES MADE HERE IN THE LAST ${RECENT_DAYS} DAYS</p>
        </div>
        <ol class="band-grid">
${cards}
        </ol>
      </section>

      <section class="prose" aria-labelledby="rpd-title">
        <h2 id="rpd-title">What is a random play dance?</h2>
        <p>
          A random play dance (RPD) plays short segments of K-pop songs back to back in an order
          nobody knows in advance. When a song you know comes on, you step into the middle and
          dance it. It is the standard format for K-pop dance meet-ups in parks and convention
          halls, and it works just as well alone at home as a practice drill.
        </p>
        <p>
          The mixes here are starting points. Open any of them in the
          <a href="/">random dance generator</a>, cut songs you don't want, add your own songs from
          YouTube, and generate a single MP3 with a five-second countdown before every song.
        </p>
      </section>
    </main>`;

  return shell({ title, description, canonical, navCurrent: 'page', jsonLd, body });
}

function renderSitemap(entries: { band: BandDef }[]): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${ORIGIN}/`, freq: 'weekly', pri: '1.0' },
    { loc: `${ORIGIN}/random-dance/`, freq: 'weekly', pri: '0.9' },
    ...entries.map((e) => ({ loc: `${ORIGIN}/random-dance/${e.band.slug}`, freq: 'weekly', pri: '0.8' })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `   <url>
      <loc>${u.loc}</loc>
      <lastmod>${today}</lastmod>
      <changefreq>${u.freq}</changefreq>
      <priority>${u.pri}</priority>
   </url>`,
  )
  .join('\n')}
</urlset>
`;
}

const BAND_LINKS = { start: '<!-- BAND_LINKS:START -->', end: '<!-- BAND_LINKS:END -->', indent: '              ' };
const TOP_GROUPS = { start: '<!-- TOP_GROUPS:START -->', end: '<!-- TOP_GROUPS:END -->', indent: '              ' };

/** How many groups the builder's empty setlist suggests. */
const TOP_GROUP_CHIPS = 5;

/**
 * The page with the group links between two markers replaced, and everything
 * else left byte for byte; null when the markers are missing. The links are
 * bare <a> tags, so each page styles them through their container.
 */
export function replaceBandLinks(
  html: string,
  bands: { slug: string; name: string }[],
  markers: { start: string; end: string; indent: string } = BAND_LINKS,
): string | null {
  const from = html.indexOf(markers.start);
  const to = html.indexOf(markers.end);
  if (from === -1 || to === -1 || to < from) return null;
  const links = bands.map((b) => `\n${markers.indent}<a href="/random-dance/${b.slug}">${esc(b.name)}</a>`).join('');
  return html.slice(0, from + markers.start.length) + links + '\n' + markers.indent + html.slice(to);
}

// Every page that links the group pages.
const HOME_PAGES = ['index.html'];

/**
 * Rewrite the group links on the home page so the landing pages are reachable
 * from it: all groups in the footer, the top few in the empty setlist. Crawlers
 * need a path in from the site's strongest page, and a hardcoded list would
 * drift every time the pool changes which groups qualify.
 */
function updateHomeLinks(ranked: Entry[]): void {
  const bands = ranked.map((e) => e.band);
  for (const name of HOME_PAGES) {
    const path = join(process.cwd(), 'public', name);
    if (!existsSync(path)) continue;
    let html = readFileSync(path, 'utf-8');
    for (const [markers, list] of [
      [BAND_LINKS, bands],
      [TOP_GROUPS, bands.slice(0, TOP_GROUP_CHIPS)],
    ] as const) {
      const next = replaceBandLinks(html, list, markers);
      if (next === null) {
        console.warn(`  ! ${markers.start} markers missing from public/${name}; those links were not updated`);
        continue;
      }
      html = next;
    }
    writeFileSync(path, html);
    console.log(`  ${name}: linked ${ranked.length} group pages, top ${TOP_GROUP_CHIPS} in the empty setlist`);
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Does this upload belong to the band, and is it a member's solo song?
 * Undefined when it doesn't belong; `artist` is set for a solo song.
 */
export function bandMatch(band: BandDef, title: string): { artist?: string } | undefined {
  if (band.match.test(title)) return {};
  const member = band.members?.find((m) => m.match.test(title));
  return member ? { artist: member.name } : undefined;
}

/** "Katseye | Illit | Le sserafim": a mash-up, not one group's song. */
function isCompilation(title: string): boolean {
  return BANDS.filter((b) => b.match.test(title)).length >= 3;
}

/** The hub ranks groups by how many mixes used them in this many days. */
const RECENT_DAYS = 60;

/**
 * Mixes made in the last RECENT_DAYS days that used each band, by slug. Every
 * upload counts here, lyric videos included: this measures what people mix,
 * not which uploads make a good page.
 */
function recentMixCounts(bands: BandDef[]): Map<string, number> {
  const db = new Database(join(process.cwd(), 'analytics.db'), { readonly: true });
  const rows = db
    .query(
      `SELECT gs.generation_id AS g, gs.title AS t
       FROM generation_songs gs JOIN generations g ON g.id = gs.generation_id
       WHERE g.timestamp >= datetime('now', '-${RECENT_DAYS} days') AND gs.title IS NOT NULL`,
    )
    .all() as { g: number; t: string }[];
  db.close();

  const counts = new Map<string, number>();
  for (const band of bands) {
    const mixes = new Set<number>();
    for (const r of rows) if (bandMatch(band, r.t)) mixes.add(r.g);
    counts.set(band.slug, mixes.size);
  }
  return counts;
}

function main() {
  const videos = loadVideos();
  console.log(`Usable videos with real cut points: ${videos.length}`);

  const recent = recentMixCounts(BANDS);
  const entries: Entry[] = [];
  const claimed = new Set<string>();

  for (const band of BANDS) {
    const names = bandNames(band);
    const matched: Video[] = [];
    for (const v of videos) {
      if (claimed.has(v.url) || isCompilation(v.title)) continue;
      const hit = bandMatch(band, v.title);
      if (!hit) continue;
      claimed.add(v.url);
      v.artist = hit.artist;
      v.song = songName(v.title, names, hit.artist);
      matched.push(v);
    }
    const pool = dedupeBySong(matched);
    if (pool.length < 10) {
      console.log(`  skip ${band.name}: only ${pool.length} songs after dedupe`);
      continue;
    }
    const mixes = buildMixes(band, pool);
    if (mixes.length < 3) {
      console.log(`  skip ${band.name}: only ${mixes.length} distinct mixes`);
      continue;
    }
    entries.push({ band, mixes, pool, recent: recent.get(band.slug) ?? 0 });
  }

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const ranked = rankEntries(entries);
  const bandDefs = ranked.map((e) => e.band);
  for (const e of ranked) {
    writeFileSync(join(OUT_DIR, `${e.band.slug}.html`), renderBandPage(e.band, e.mixes, e.pool, bandDefs));
    console.log(
      `  ${e.band.name.padEnd(22)} ${String(e.mixes.length).padStart(2)} mixes, ${String(e.pool.length).padStart(2)} songs, used in ${e.recent} mixes lately`,
    );
  }
  writeFileSync(join(OUT_DIR, 'index.html'), renderHub(ranked));
  writeFileSync(join(process.cwd(), 'public', 'sitemap.xml'), renderSitemap(ranked));
  updateHomeLinks(ranked);

  const totalMixes = entries.reduce((s, e) => s + e.mixes.length, 0);
  console.log(`\nBuilt ${entries.length} group pages + hub, ${totalMixes} mixes total.`);
}

// Only build when run directly, so tests can import the helpers.
if (import.meta.main) main();
