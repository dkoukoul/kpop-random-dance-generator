/**
 * Moving a setlist in and out of the page: project files, the autosaved
 * draft, and ready-made mixes handed over by the group pages.
 *
 * The formats are the classic page's, so files and drafts work in both:
 * - project file: { version: "1.0", timestamp, songs: [{ youtubeUrl, title,
 *   startTime, endTime, cutSource?, popularUses?, info? }] }
 * - draft (localStorage "kpopgen:draft"): { version: 1, savedAt, songs: [same] }
 * - ready-made mix (sessionStorage "pendingMix"): { name?, songs: [{ youtubeUrl,
 *   title, startTime, endTime }] }
 * Studio adds `popularCut` to each song; the classic page ignores it.
 *
 * No DOM here, so `bun test` covers it.
 */
import { parseTime, shortTime } from "./util.js";
import { DEFAULT_CUT, watchUrl, youtubeVideoId } from "./setlist.js";

export const DRAFT_KEY = "kpopgen:draft";
export const PENDING_MIX_KEY = "pendingMix";

const CUT_SOURCES = new Set(["popular", "user", "mix", "import", "draft"]);

function cleanInfo(info) {
  if (!info || typeof info !== "object") return null;
  const duration = Number(info.duration);
  return {
    title: typeof info.title === "string" ? info.title : "",
    thumbnail: typeof info.thumbnail === "string" ? info.thumbnail : "",
    channel: typeof info.channel === "string" ? info.channel : "",
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
  };
}

function cleanPopularCut(cut) {
  if (!cut || typeof cut !== "object") return null;
  const start = parseTime(cut.startTime ?? cut.start);
  const end = parseTime(cut.endTime ?? cut.end);
  const uses = Number(cut.uses);
  if (start === null || end === null || end <= start) return null;
  return { start, end, uses: Number.isFinite(uses) ? uses : 0 };
}

/**
 * One saved song (file, draft or mix) to a setlist song, or null when it has
 * no YouTube video. `source` is the cutSource a song gets when it has none:
 * a cut that came from a file or a draft is the user's and is never replaced.
 */
export function songFromSaved(saved, source) {
  if (!saved || typeof saved !== "object") return null;
  const videoId = youtubeVideoId(saved.youtubeUrl);
  if (!videoId) return null;
  let start = parseTime(saved.startTime);
  let end = parseTime(saved.endTime);
  if (start === null) start = DEFAULT_CUT.start;
  if (end === null) end = Math.max(start + 1, DEFAULT_CUT.end);
  const info = cleanInfo(saved.info);
  const cutSource = source === "mix" ? "mix" : CUT_SOURCES.has(saved.cutSource) ? saved.cutSource : source;
  let popularCut = cleanPopularCut(saved.popularCut);
  // A classic draft keeps only the number of uses of a popular cut it applied.
  if (!popularCut && saved.cutSource === "popular" && saved.popularUses) {
    popularCut = { start, end, uses: Number(saved.popularUses) || 0 };
  }
  return {
    youtubeUrl: watchUrl(videoId),
    videoId,
    title: (typeof saved.title === "string" && saved.title.trim()) || info?.title || "",
    start,
    end,
    cutSource,
    popularCut,
    info: info && info.duration ? info : null,
  };
}

/** A setlist song in the shared saved shape. */
export function songToSaved(song) {
  return {
    youtubeUrl: song.youtubeUrl,
    title: song.title || "",
    startTime: shortTime(song.start),
    endTime: shortTime(song.end),
    cutSource: song.cutSource || null,
    popularUses: song.cutSource === "popular" && song.popularCut ? song.popularCut.uses : null,
    popularCut: song.popularCut
      ? { startTime: shortTime(song.popularCut.start), endTime: shortTime(song.popularCut.end), uses: song.popularCut.uses }
      : null,
    info: song.info
      ? { title: song.info.title, thumbnail: song.info.thumbnail, channel: song.info.channel, duration: song.info.duration }
      : null,
  };
}

/** Read a list of saved songs; `skipped` counts entries without a YouTube video. */
function readSongs(list, source) {
  const songs = [];
  let skipped = 0;
  for (const saved of list) {
    const song = songFromSaved(saved, source);
    if (song) songs.push(song);
    else skipped++;
  }
  return { songs, skipped };
}

/* ===== Project files ===== */

export function toProjectFile(songs, now = new Date()) {
  return {
    version: "1.0",
    timestamp: now.toISOString(),
    songs: songs.map(songToSaved),
    // The order on screen is the order of the mix; the classic page must not reshuffle it.
    shuffleEnabled: false,
  };
}

/** Parse a project file's text. Throws an Error with a message for people. */
export function fromProjectFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a saved mix.");
  }
  if (!data || !Array.isArray(data.songs)) throw new Error("That file isn't a saved mix.");
  const result = readSongs(data.songs, "import");
  if (result.songs.length === 0) throw new Error("That file has no YouTube songs in it.");
  return result;
}

export function projectFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `kpop-dance-mix-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/* ===== Draft (autosave) ===== */

export function toDraft(songs, now = Date.now()) {
  return { version: 1, savedAt: now, songs: songs.map(songToSaved) };
}

/** A saved draft's songs, or null when there is no usable draft. */
export function fromDraft(raw) {
  if (!raw) return null;
  let draft;
  try {
    draft = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!draft || !Array.isArray(draft.songs) || draft.songs.length === 0) return null;
  const { songs } = readSongs(draft.songs, "draft");
  return songs.length > 0 ? songs : null;
}

/** Which songs, in which order, with which cuts: to tell if anything changed. */
export function signature(songs) {
  return JSON.stringify(songs.map((s) => [s.videoId, s.start, s.end]));
}

/* ===== Starter mix for a first visit ===== */

export const VISITED_KEY = "kpopgen:visited";

/**
 * Five well-known songs so a first visit doesn't open on an empty page. The
 * cuts are the community's popular cuts; cutSource stays null, so the live
 * popular cut (with its number of uses) still fills in.
 */
const STARTER = [
  { youtubeUrl: "https://www.youtube.com/watch?v=gdZLi9oWNZg", title: "BTS (방탄소년단) 'Dynamite' Official MV", startTime: "1:05", endTime: "1:23" },
  { youtubeUrl: "https://www.youtube.com/watch?v=IHNzOHi8sJs", title: "BLACKPINK - '뚜두뚜두 (DDU-DU DDU-DU)' M/V", startTime: "0:53", endTime: "1:35" },
  { youtubeUrl: "https://www.youtube.com/watch?v=TQTlCHxyuu8", title: "Stray Kids \"神메뉴(God's Menu)\" M/V", startTime: "0:47", endTime: "1:29" },
  { youtubeUrl: "https://www.youtube.com/watch?v=i0p1bmr0EmE", title: "TWICE(트와이스) \"What is Love?\" M/V", startTime: "1:37", endTime: "2:08" },
  { youtubeUrl: "https://www.youtube.com/watch?v=Vk5-c_v4gMU", title: "ILLIT (아일릿) 'Magnetic' Official MV", startTime: "0:42", endTime: "1:24" },
];

export function starterSongs() {
  return STARTER.map((saved) => songFromSaved(saved, null));
}

/** First visit: nothing saved, no ready-made mix coming in, never been here. */
export function isFirstVisit({ draft, mix, visited }) {
  return !draft && !mix && !visited;
}

/* ===== Ready-made mixes from the group pages ===== */

/**
 * The songs of a handed-over mix, in the page's order (the cut is the mix's:
 * never replaced by a popular cut). Null when there is nothing usable.
 */
export function fromPendingMix(raw) {
  if (!raw) return null;
  let mix;
  try {
    mix = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!mix || !Array.isArray(mix.songs)) return null;
  const { songs } = readSongs(mix.songs, "mix");
  if (songs.length === 0) return null;
  return { name: typeof mix.name === "string" ? mix.name : "", songs };
}
