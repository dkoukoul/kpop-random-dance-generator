/**
 * Reading a generation job's status for the page: one light per song,
 * a percentage, and how long is left. No DOM here, so `bun test` covers it.
 */

// About how long one song takes on the live server (download + 1.5 s spacing),
// used until the job has finished a song or two.
export const SECONDS_PER_SONG = 7.5;
// Joining the songs and evening out the volume at the end.
const COMBINE_SECONDS = 8;
// More lights than this become hair-thin; songs then share a light.
export const MAX_LIGHTS = 20;

/** "about 40 s" / "about 3 min" / "a few seconds". */
export function formatLeft(seconds) {
  if (!(seconds > 0)) return "a few seconds";
  if (seconds < 15) return "a few seconds";
  if (seconds < 60) return `about ${Math.round(seconds / 5) * 5} s`;
  return `about ${Math.round(seconds / 60)} min`;
}

/**
 * @param {object} status  what /api/status returned ({ status, phase, songs: [{state}], startedAt })
 * @param {number} now     Date.now()
 * @returns {{ done: number, total: number, current: number, pct: number, left: number, combining: boolean, states: string[] }}
 */
export function readProgress(status, now = Date.now()) {
  const states = Array.isArray(status.songs) ? status.songs.map((s) => s.state) : [];
  const total = states.length || status.progressTotal || 0;
  const finished = states.filter((s) => s === "done" || s === "skipped").length;
  const combining = status.phase === "combining" || status.status === "complete";
  const working = states.indexOf("working");
  const current = combining ? total : working >= 0 ? working + 1 : Math.min(total, finished + 1);

  // Pace: the time so far over the songs finished, once there are some.
  const elapsed = status.startedAt ? Math.max(0, (now - status.startedAt) / 1000) : 0;
  const pace = finished >= 2 && elapsed > 0 ? elapsed / finished : SECONDS_PER_SONG;
  const left = combining ? (status.status === "complete" ? 0 : COMBINE_SECONDS / 2) : Math.max(0, (total - finished) * pace + COMBINE_SECONDS);

  // Downloads are most of the work; the last 10% is joining.
  const pct = status.status === "complete" ? 100 : combining ? 95 : total ? Math.min(90, Math.round((finished / total) * 90)) : 0;

  return { done: finished, total, current, pct, left, combining, states };
}

/**
 * The lights: one per song, or at most MAX_LIGHTS with songs sharing one.
 * A light is "done" when all its songs are done or skipped, "working" when
 * one of them is being made, else "waiting".
 */
export function lights(states, max = MAX_LIGHTS) {
  if (states.length <= max) return states.map((s) => (s === "skipped" ? "done" : s));
  const out = [];
  for (let i = 0; i < max; i++) {
    const from = Math.floor((i * states.length) / max);
    const to = Math.floor(((i + 1) * states.length) / max);
    const group = states.slice(from, to);
    if (group.includes("working")) out.push("working");
    else if (group.every((s) => s === "done" || s === "skipped")) out.push("done");
    else out.push("waiting");
  }
  return out;
}

/** A yt-dlp / server error as one plain sentence. */
export function plainError(message) {
  const m = String(message || "");
  if (/all segments failed/i.test(m)) return "None of the songs could be downloaded. YouTube may be blocking downloads right now. Please try again in a few minutes.";
  if (/timed? ?out|took too long/i.test(m)) return "YouTube didn't answer in time. Your setlist is safe. Please try again in a minute.";
  if (/403|forbidden|sign in|bot/i.test(m)) return "YouTube refused the download. Please try again in a few minutes.";
  if (/ffmpeg/i.test(m)) return "Something went wrong while joining the songs. Please try again.";
  if (/youtube video link/i.test(m)) return m;
  // Our own messages (server restart, lost connection) are already plain.
  if (/interrupted|lost touch/i.test(m)) return m;
  return "Something went wrong while making your mix. Your setlist is safe. Please try again.";
}
