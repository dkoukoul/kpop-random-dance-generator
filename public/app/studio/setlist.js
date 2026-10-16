/**
 * The setlist: the songs of the mix, in the order they will play.
 *
 * No DOM here, so `bun test` covers it. Times are whole seconds; project
 * files and the server use "m:ss" (see project.js).
 *
 * A song: {
 *   id,            stable key for the page (not saved)
 *   youtubeUrl,    clean https://www.youtube.com/watch?v=<id>
 *   videoId,
 *   title,         what the list shows
 *   start, end,    the cut, in seconds
 *   cutSource,     "popular" | "user" | "mix" | "import" | "draft" | null (not chosen yet)
 *   popularCut,    { start, end, uses } or null: kept after an edit, for "Back to popular cut"
 *   info,          { title, thumbnail, channel, duration } or null until looked up
 * }
 */

export const COUNTDOWN_SECONDS = 5;
export const DEFAULT_CUT = { start: 0, end: 30 };

/** The 11-character video ID of a YouTube video link (or a bare ID); null otherwise. */
export function youtubeVideoId(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (/^[\w-]{11}$/.test(value)) return value;
  let url;
  try {
    url = new URL(/^((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(value) ? `https://${value}` : value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === "youtu.be") id = url.pathname.split("/")[1];
  else if (/^((www|m|music)\.)?youtube(-nocookie)?\.com$/.test(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = (url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/]+)/) || [])[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export const watchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;
/** YouTube's 320x180 cover image; known before the video's info is looked up. */
export const thumbUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

/** Does this look like a link (as opposed to search words)? */
export function looksLikeLink(text) {
  return /^(https?:\/\/|www\.|m\.|youtu\.be\/|youtube\.com\/)/i.test(String(text).trim()) || /\b[\w-]+\.[a-z]{2,}\//i.test(String(text));
}

/** A playlist link without a video in it. */
export function isPlaylistLink(text) {
  return /[?&]list=/.test(text) && !youtubeVideoId(text);
}

let nextId = 1;
export const newId = () => `s${nextId++}`;

/** Length of one song's cut in seconds (0 when the cut is not valid). */
export const cutLength = (song) => Math.max(0, song.end - song.start);

/** Total length of the MP3: every cut plus a countdown before each. */
export function runtime(songs) {
  return songs.reduce((t, s) => t + cutLength(s) + COUNTDOWN_SECONDS, 0);
}

/**
 * Songs that are in the list more than once: one entry per video, with the
 * ids of every copy after the first (those are what "Remove extra" removes).
 */
export function findDuplicates(songs) {
  const byVideo = new Map();
  for (const song of songs) {
    if (!song.videoId) continue;
    if (!byVideo.has(song.videoId)) byVideo.set(song.videoId, []);
    byVideo.get(song.videoId).push(song);
  }
  const out = [];
  for (const [videoId, copies] of byVideo) {
    if (copies.length > 1) out.push({ videoId, title: copies[0].title, extraIds: copies.slice(1).map((s) => s.id) });
  }
  return out;
}

/**
 * Why Generate can't run yet, or null. `index` points at the song to fix
 * (-1 when it is about the list as a whole).
 */
export function generateProblem(songs) {
  if (songs.length === 0) return { index: -1, message: "Add at least one song to generate." };
  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    const n = String(i + 1).padStart(2, "0");
    if (s.loadError) return { index: i, id: s.id, message: `Song ${n} can't load. Fix or remove it to generate.` };
    if (!(s.end > s.start)) return { index: i, id: s.id, message: `Song ${n}: the end must be after the start.` };
    if (s.info && s.info.duration && s.end > s.info.duration + 1) {
      return { index: i, id: s.id, message: `Song ${n}: the end is after the video ends.` };
    }
  }
  return null;
}

/** Fisher-Yates, in place. */
export function shuffleArray(array, random = Math.random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Reorder an already shuffled list so no group plays twice in a row where
 * that's possible. Songs whose group isn't
 * known never count as a repeat.
 */
export function spreadOutGroups(songs, groupOf) {
  let remaining = songs.map((song, i) => {
    const g = groupOf(song);
    return { song, group: g ? g.toLowerCase() : `#${i}` };
  });
  const result = [];
  let last = null;
  while (remaining.length > 0) {
    const counts = new Map();
    for (const { group } of remaining) counts.set(group, (counts.get(group) || 0) + 1);
    const limit = Math.ceil((remaining.length - 1) / 2);
    const forced = [...counts].find(([group, count]) => group !== last && count > limit);
    let pick = forced ? remaining.findIndex((r) => r.group === forced[0]) : remaining.findIndex((r) => r.group !== last);
    if (pick === -1) pick = 0;
    result.push(remaining[pick].song);
    last = remaining[pick].group;
    remaining = remaining.filter((_, k) => k !== pick);
  }
  return result;
}

/**
 * The group of a song from its title and channel, using the server's band
 * list (longest names first, whole words). '' when unknown.
 */
export function identifyGroup(title, channel, bandList) {
  const check = (text, band) => {
    if (!text || !band) return false;
    const escaped = band.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-zA-Z0-9])${escaped}([^a-zA-Z0-9]|$)`, "i").test(text);
  };
  const bands = [...(bandList || [])].sort((a, b) => b.length - a.length);
  for (const band of bands) if (check(title, band)) return band;
  for (const band of bands) if (check(channel, band)) return band;
  const parts = String(title || "").split(" - ");
  return parts.length > 1 ? parts[0].trim() : "";
}

/**
 * The setlist store. Every change goes through here and notifies listeners
 * with what happened, so the page can animate and autosave.
 */
export function createSetlist() {
  let songs = [];
  let selectedId = null;
  const listeners = new Set();

  const emit = (change) => {
    for (const fn of listeners) fn(change);
  };
  const indexOf = (id) => songs.findIndex((s) => s.id === id);

  return {
    get songs() {
      return songs;
    },
    get selectedId() {
      return selectedId;
    },
    get selected() {
      return songs.find((s) => s.id === selectedId) || null;
    },
    find: (id) => songs.find((s) => s.id === id) || null,
    indexOf,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Add at the end (or at `index`). The first song added is selected. */
    add(song, index = songs.length) {
      const s = { id: newId(), cutSource: null, popularCut: null, info: null, ...song };
      songs = [...songs.slice(0, index), s, ...songs.slice(index)];
      if (!selectedId) selectedId = s.id;
      emit({ type: "add", id: s.id, index });
      return s;
    },

    /** Remove; returns what Undo needs. */
    remove(id) {
      const index = indexOf(id);
      if (index === -1) return null;
      const song = songs[index];
      songs = songs.filter((s) => s.id !== id);
      if (selectedId === id) selectedId = songs[Math.min(index, songs.length - 1)]?.id ?? null;
      emit({ type: "remove", id, index });
      return { song, index };
    },

    /** Put a removed song back where it was. */
    restore({ song, index }) {
      if (indexOf(song.id) !== -1) return;
      const at = Math.min(index, songs.length);
      songs = [...songs.slice(0, at), song, ...songs.slice(at)];
      if (!selectedId) selectedId = song.id;
      emit({ type: "add", id: song.id, index: at });
    },

    /** Move a song by `delta` places; false when it can't move. */
    move(id, delta) {
      const from = indexOf(id);
      const to = from + delta;
      if (from === -1 || to < 0 || to >= songs.length) return false;
      const next = songs.slice();
      const [s] = next.splice(from, 1);
      next.splice(to, 0, s);
      songs = next;
      emit({ type: "move", id, from, to });
      return true;
    },

    /** New random order, groups spread out; returns the old order for Undo. */
    shuffle(groupOf = (s) => s.group, random = Math.random) {
      const previous = songs;
      if (songs.length < 2) return previous;
      songs = spreadOutGroups(shuffleArray(songs.slice(), random), groupOf);
      emit({ type: "order" });
      return previous;
    },

    /** Set the whole list (load, undo of a shuffle or a load). */
    replace(next, { select = next[0]?.id ?? null, type = "replace" } = {}) {
      songs = next.slice();
      selectedId = select && next.some((s) => s.id === select) ? select : (next[0]?.id ?? null);
      emit({ type });
    },

    /** Change one song's fields. */
    update(id, patch, { type = "update" } = {}) {
      const index = indexOf(id);
      if (index === -1) return null;
      const next = songs.slice();
      next[index] = { ...songs[index], ...patch };
      songs = next;
      emit({ type, id, patch });
      return next[index];
    },

    select(id) {
      if (id === selectedId || indexOf(id) === -1) return;
      selectedId = id;
      emit({ type: "select", id });
    },
  };
}
