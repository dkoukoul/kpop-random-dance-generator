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
}

/**
 * Only groups with a deep enough song pool in analytics.db get a page. A page
 * needs enough distinct songs to build several genuinely different mixes --
 * otherwise it is a thin doorway page, which Google treats as spam and which
 * is no use to a dancer either.
 */
export const BANDS: BandDef[] = [
  { slug: 'nct', name: 'NCT', hangul: '엔시티', match: /\bNCT\b|엔시티|WayV/i },
  { slug: 'bts', name: 'BTS', hangul: '방탄소년단', match: /\bBTS\b|방탄소년단/i },
  { slug: 'twice', name: 'TWICE', hangul: '트와이스', match: /\bTWICE\b|트와이스/i },
  { slug: 'stray-kids', name: 'Stray Kids', hangul: '스트레이 키즈', match: /Stray ?Kids|스트레이 ?키즈|\bSKZ\b/i },
  { slug: 'itzy', name: 'ITZY', hangul: '있지', match: /\bITZY\b|있지/i },
  { slug: 'enhypen', name: 'ENHYPEN', hangul: '엔하이픈', match: /ENHYPEN|엔하이픈/i },
  { slug: 'le-sserafim', name: 'LE SSERAFIM', hangul: '르세라핌', match: /LE ?SSERAFIM|르세라핌/i },
  { slug: 'blackpink', name: 'BLACKPINK', hangul: '블랙핑크', match: /BLACKPINK|블랙핑크|BLΛƆKPIИK/i },
  { slug: 'ateez', name: 'ATEEZ', hangul: '에이티즈', match: /ATEEZ|에이티즈/i },
  { slug: 'seventeen', name: 'SEVENTEEN', hangul: '세븐틴', match: /SEVENTEEN|세븐틴/i },
  { slug: 'aespa', name: 'aespa', hangul: '에스파', match: /aespa|æspa|에스파/i },
  { slug: 'txt', name: 'TOMORROW X TOGETHER', hangul: '투모로우바이투게더', match: /\bTXT\b|투모로우바이투게더|TOMORROW X TOGETHER/i },
  { slug: 'babymonster', name: 'BABYMONSTER', hangul: '베이비몬스터', match: /BABYMONSTER|베이비몬스터/i },
  { slug: 'boynextdoor', name: 'BOYNEXTDOOR', hangul: '보이넥스트도어', match: /BOYNEXTDOOR|보이넥스트도어/i },
  { slug: 'g-i-dle', name: '(G)I-DLE', hangul: '여자아이들', match: /\(G\)I-?DLE|여자\(아이들\)|아이들/i },
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
  /\b(official\s+)?(music\s+)?(video|mv|m\/v)\b|\bdance practice\b|\bperformance video\b|\bchoreography( practice)?( video)?\b|\bmirrored\b|\bstudio choom( original)?\b|\bbe original\b|\brelay dance\b|\b4k\b|\bver\.?\b|\bdance cover\b|\bcontest\b|\b1thek\b|\bzoomed\b|\boriginal song\b/gi;

/** A bracketed chunk that is a tag, not part of the title. */
const BRACKET_TAG =
  /^\s*(mv|m\/v|4k|hd|fmv|mirrored|be original|studio choom.*|official.*|special.*|dance practice.*|performance.*|.*\bver\.?.*)\s*$/i;

/**
 * Pull the song name out of a YouTube title. K-pop uploads are formulaic
 * enough that the quoted segment is almost always the track name; everything
 * else goes through stripFurniture as a fallback.
 */
export function songName(title: string, band: string): string {
  const quoted = title.match(/['‘’"“”]([^'‘’"“”]{2,60})['‘’"“”]/);
  const raw = quoted?.[1] ?? stripFurniture(title, band);
  return tidy(preferLatin(raw)) || tidy(stripFurniture(title, band)) || title;
}

/**
 * Strip the parts of a YouTube title that describe the upload rather than the
 * track: bracketed tags, the group's own name, hangul transliterations of it,
 * and format labels. Without this, "Dope" and "DOPE Dance Practice" read as two
 * different songs and both end up in the same mix.
 */
export function stripFurniture(title: string, band: string): string {
  const bandPattern = band.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (title.split('|')[0] ?? title)
    // Drop bracketed tags outright; keep the contents of anything else, since
    // some uploads wrap the whole title in brackets.
    .replace(/\[([^\]]*)\]/g, (_, inner: string) => (BRACKET_TAG.test(inner) ? ' ' : ` ${inner} `))
    // Parenthesised hangul next to a Latin name is the same name twice.
    .replace(/\(\s*[가-힣\s]+\s*\)/g, ' ')
    .replace(/\s*\((feat|prod|with|ft)\.?[^)]*\)/gi, ' ')
    .replace(new RegExp(bandPattern, 'gi'), ' ')
    .replace(FORMAT_WORDS, ' ');
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
    const seconds = endSec - startSec;
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
      songs: byUses.slice(0, mid),
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
  const letters = ['A', 'B', 'C', 'D', 'E'];
  for (let i = 0; i < letters.length && kept.length < 5; i++) {
    const letter = letters[i] as string;
    const mix: Mix = {
      id: `shuffle-${letter.toLowerCase()}`,
      name: `Shuffle Set ${letter}`,
      blurb: `A randomised draw from the ${band.name} pool. Different songs from the sets above, same real cut points.`,
      songs: seededShuffle(byUses, seed * (i + 3) + 17).slice(0, Math.max(few, mid - 1)),
    };
    if (mix.songs.length < MIN_MIX_SONGS || tooSimilar(mix, kept)) continue;
    kept.push(mix);
  }

  return kept.slice(0, MAX_MIXES);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

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

function shell(opts: {
  title: string;
  description: string;
  canonical: string;
  bodyClass?: string;
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

    <meta name="theme-color" content="#8b5cf6" />
    <link rel="icon" type="image/png" href="/assets/favicon.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/css/landing.css" />
${opts.jsonLd.map((o) => `    <script type="application/ld+json">\n${scriptJson(o, 2)}\n    </script>`).join('\n')}

    <script async src="https://www.googletagmanager.com/gtag/js?id=G-Q93H8H3JP4"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-Q93H8H3JP4');
    </script>
  </head>
  <body class="${opts.bodyClass ?? ''}">
${opts.body}
    <script src="/app/landing.js"></script>
  </body>
</html>
`;
}

export function renderMix(mix: Mix, band: BandDef): string {
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
      (s, i) => `            <li class="mix-song">
              <span class="mix-song-num">${i + 1}</span>
              <span class="mix-song-name">
                <a href="${esc(s.url)}&t=${toSeconds(s.start)}" target="_blank" rel="noopener nofollow">${esc(s.song)}</a>
              </span>
              <span class="mix-song-time">${esc(s.start)}&ndash;${esc(s.end)}</span>
              <span class="mix-song-len">${s.seconds}s</span>
            </li>`,
    )
    .join('\n');

  return `        <article class="mix-card" id="${band.slug}-${mix.id}">
          <header class="mix-head">
            <h3>${esc(mix.name)}</h3>
            <p class="mix-blurb">${esc(mix.blurb)}</p>
            <p class="mix-meta">
              <span>${mix.songs.length} songs</span>
              <span>~${fmt(runtime(mix.songs))} total</span>
              <span>5s countdown between tracks</span>
            </p>
          </header>
          <ol class="mix-songs">
${rows}
          </ol>
          <div class="mix-actions">
            <button class="btn btn-primary js-load-mix" data-mix="${band.slug}-${mix.id}">Open in generator</button>
            <button class="btn btn-ghost js-download-mix" data-mix="${band.slug}-${mix.id}">Download .json</button>
          </div>
          <script type="application/json" id="data-${band.slug}-${mix.id}">${scriptJson(payload)}</script>
        </article>`;
}

function renderBandPage(band: BandDef, mixes: Mix[], pool: Video[], others: BandDef[]): string {
  const top = pool[0]!;
  const avg = Math.round(pool.reduce((s, v) => s + v.seconds, 0) / pool.length);
  const practiceCount = pool.filter((v) => v.isPractice).length;

  const title = `${band.name} Random Dance Mixes | ${mixes.length} Ready-Made Sets`;
  const description = `${mixes.length} ready-made ${band.name} random dance mixes with real cut points, from ${pool.length} songs. Open one in the generator or edit the timings yourself.`;
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

  const nav = others
    .filter((b) => b.slug !== band.slug)
    .map((b) => `        <a href="/random-dance/${b.slug}">${esc(b.name)}</a>`)
    .join('\n');

  const body = `    <div class="page">
      <header class="site-head">
        <a class="brand" href="/"><span class="brand-icon">🎵</span> K-Pop Random Dance Generator</a>
      </header>

      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a> <span>/</span>
        <a href="/random-dance/">Random Dance Mixes</a> <span>/</span>
        <span aria-current="page">${esc(band.name)}</span>
      </nav>

      <main>
        <h1>${esc(band.name)} Random Dance Mixes</h1>
        <p class="lede">
          ${mixes.length} ready-made ${esc(band.name)} random dance sets you can open in the generator
          in one click${band.hangul ? `. ${esc(band.name)} (${esc(band.hangul)})` : ''} appears in
          ${pool.length} distinct songs across the mixes people have built on this site, and every
          start and end time below is the cut point those people actually used &mdash; not a guess.
        </p>

        <ul class="stat-row">
          <li><strong>${pool.length}</strong><span>${plural(pool.length, 'song')} in the pool</span></li>
          <li><strong>${mixes.length}</strong><span>ready-made ${plural(mixes.length, 'mix', 'mixes')}</span></li>
          <li><strong>${avg}s</strong><span>average clip length</span></li>
          <li><strong>${practiceCount}</strong><span>dance practice ${plural(practiceCount, 'video')}</span></li>
        </ul>

        <p class="note">
          Most-mixed ${esc(band.name)} track right now: <strong>${esc(top.song)}</strong>,
          usually cut from ${esc(top.start)} to ${esc(top.end)}.
        </p>

        <section class="mixes">
${mixes.map((m) => renderMix(m, band)).join('\n')}
        </section>

        <section class="prose">
          <h2>How to use these ${esc(band.name)} mixes</h2>
          <p>
            Press <em>Open in generator</em> on any mix. The songs and their timings load straight
            into the generator on the home page, where you can drop tracks you don't know, drag the
            order around, or nudge a start time before generating the audio file. The songs open in
            a random order, and <em>Shuffle</em> gives you a new one whenever you like &mdash; which
            is the point of a random play dance.
          </p>
          <p>
            Prefer to keep a set? <em>Download .json</em> saves it as a project file you can re-import
            later from the generator's Import button, or send to whoever is running your RPD event.
          </p>

          <h2>Where these cut points come from</h2>
          <p>
            Each clip below is the segment most commonly chosen for that video by people using this
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

        <section class="other-bands">
          <h2>Mixes for other groups</h2>
          <div class="band-links">
${nav}
          </div>
        </section>
      </main>

      <footer class="site-foot">
        <p><a class="btn btn-primary" href="/">Build your own mix &rarr;</a></p>
        <p class="fine">Made with 💜 for K-Pop dance lovers.</p>
      </footer>
    </div>`;

  return shell({ title, description, canonical, jsonLd, body });
}

function renderHub(entries: { band: BandDef; mixes: Mix[]; pool: Video[] }[]): string {
  const totalMixes = entries.reduce((s, e) => s + e.mixes.length, 0);
  const title = 'K-Pop Random Dance Mixes by Group | Ready-Made Sets';
  const description = `${totalMixes} ready-made K-Pop random dance mixes across ${entries.length} groups, with real cut points. Open any set in the generator in one click.`;
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
      numberOfItems: entries.length,
      itemListElement: entries.map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${e.band.name} random dance mixes`,
        url: `${ORIGIN}/random-dance/${e.band.slug}`,
      })),
    },
  ];

  const cards = entries
    .map(
      (e) => `          <a class="band-card" href="/random-dance/${e.band.slug}">
            <h2>${esc(e.band.name)}</h2>
            ${e.band.hangul ? `<p class="band-hangul">${esc(e.band.hangul)}</p>` : ''}
            <p class="band-meta">${e.mixes.length} mixes &middot; ${e.pool.length} songs</p>
          </a>`,
    )
    .join('\n');

  const body = `    <div class="page">
      <header class="site-head">
        <a class="brand" href="/"><span class="brand-icon">🎵</span> K-Pop Random Dance Generator</a>
      </header>

      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a> <span>/</span>
        <span aria-current="page">Random Dance Mixes</span>
      </nav>

      <main>
        <h1>K-Pop Random Dance Mixes by Group</h1>
        <p class="lede">
          ${totalMixes} ready-made random dance sets across ${entries.length} groups. Every mix is
          built from songs people have actually put through this generator, cut at the timings they
          chose. Pick a group, open a mix, and generate the audio &mdash; or edit it first.
        </p>

        <div class="band-grid">
${cards}
        </div>

        <section class="prose">
          <h2>What is a random play dance?</h2>
          <p>
            A random play dance (RPD) plays short segments of K-pop songs back to back in an order
            nobody knows in advance. When a song you know comes on, you step into the middle and
            dance it. It is the standard format for K-pop dance meet-ups in parks and convention
            halls, and it works just as well alone at home as a practice drill.
          </p>
          <p>
            The mixes here are starting points. Open any of them in the
            <a href="/">random dance generator</a>, cut songs you don't want, add your own YouTube
            links, and generate a single audio file with a five-second countdown between each track.
          </p>
        </section>
      </main>

      <footer class="site-foot">
        <p><a class="btn btn-primary" href="/">Build your own mix &rarr;</a></p>
        <p class="fine">Made with 💜 for K-Pop dance lovers.</p>
      </footer>
    </div>`;

  return shell({ title, description, canonical, jsonLd, body });
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

/**
 * Rewrite the group links on the home page so the landing pages are reachable
 * from it. Crawlers need a path in from the site's strongest page, and a
 * hardcoded list would drift every time the pool changes which groups qualify.
 */
function updateHomeLinks(entries: { band: BandDef }[]): void {
  const path = join(process.cwd(), 'public', 'index.html');
  const html = readFileSync(path, 'utf-8');
  const start = '<!-- BAND_LINKS:START -->';
  const end = '<!-- BAND_LINKS:END -->';
  const from = html.indexOf(start);
  const to = html.indexOf(end);
  if (from === -1 || to === -1) {
    console.warn('  ! BAND_LINKS markers missing from public/index.html; home page links not updated');
    return;
  }
  const links = entries
    .map((e) => `\n              <a href="/random-dance/${e.band.slug}">${esc(e.band.name)}</a>`)
    .join('');
  writeFileSync(path, html.slice(0, from + start.length) + links + '\n              ' + html.slice(to));
  console.log(`  home page: linked ${entries.length} group pages`);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function main() {
  const videos = loadVideos();
  console.log(`Usable videos with real cut points: ${videos.length}`);

  const entries: { band: BandDef; mixes: Mix[]; pool: Video[] }[] = [];
  const claimed = new Set<string>();

  for (const band of BANDS) {
    const matched = videos.filter((v) => !claimed.has(v.url) && band.match.test(v.title));
    for (const v of matched) {
      claimed.add(v.url);
      v.song = songName(v.title, band.name);
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
    entries.push({ band, mixes, pool });
  }

  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const bandDefs = entries.map((e) => e.band);
  for (const e of entries) {
    writeFileSync(join(OUT_DIR, `${e.band.slug}.html`), renderBandPage(e.band, e.mixes, e.pool, bandDefs));
    console.log(`  ${e.band.name.padEnd(22)} ${String(e.mixes.length).padStart(2)} mixes, ${e.pool.length} songs`);
  }
  writeFileSync(join(OUT_DIR, 'index.html'), renderHub(entries));
  writeFileSync(join(process.cwd(), 'public', 'sitemap.xml'), renderSitemap(entries));
  updateHomeLinks(entries);

  const totalMixes = entries.reduce((s, e) => s + e.mixes.length, 0);
  console.log(`\nBuilt ${entries.length} group pages + hub, ${totalMixes} mixes total.`);
}

// Only build when run directly, so tests can import the helpers.
if (import.meta.main) main();
