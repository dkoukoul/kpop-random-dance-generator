/**
 * Generate: start the mix, show one light per song while it is made, then
 * the ready card (Download MP3, the setlist with start times, skipped songs).
 *
 * The running job is remembered in this browser, so a reload picks it up.
 * A failed status check is retried; only a job the server no longer knows
 * (after a restart) or a real failure ends it.
 */
import { el, clock } from "./util.js";
import { request } from "./api.js";
import { announce, toast, trackEvent } from "./ui.js";
import { runtime } from "./setlist.js";
import { countdown, fadeOut } from "./mix-options.js";
import { signature, songToSaved } from "./project.js";
import { formatLeft, lights, plainError, readProgress } from "./progress.js";

const JOB_KEY = "kpopgen:studioJob";
const POLL_MS = 1500;
const RETRIES = [2000, 4000, 8000, 16000];
const RESUME_MAX_MS = 2 * 60 * 60 * 1000;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function remember(job) {
  try {
    localStorage.setItem(JOB_KEY, JSON.stringify(job));
  } catch {
    // Without storage a reload just can't resume.
  }
}
function forget() {
  try {
    localStorage.removeItem(JOB_KEY);
  } catch {
    // nothing saved
  }
}
function recall() {
  try {
    const job = JSON.parse(localStorage.getItem(JOB_KEY));
    if (job && job.jobId && Date.now() - job.startedAt < RESUME_MAX_MS) return job;
  } catch {
    // damaged entry
  }
  forget();
  return null;
}

/**
 * @param {object} opts
 * @param {ReturnType<import("./setlist.js").createSetlist>} opts.setlist
 * @param {object} opts.view  the setlist view (setDone, flashRow, generateProblem)
 * @param {(state: { state: "idle"|"running"|"ready"|"failed", pct?: number, jobId?: string }) => void} [opts.onState]
 */
export function initGenerate({ setlist, view, onState = () => {} }) {
  const foot = document.getElementById("setlistFoot");
  const button = document.getElementById("generateBtn");
  const why = document.getElementById("generateWhy");
  // Not a live region: the box is rebuilt every poll. Screen readers hear
  // each new song (announce), the toast and the focus move instead.
  const area = el("div", { class: "gen-area" });
  foot.append(area);

  let job = null; // { jobId, startedAt, signature, countdown, fadeOut, ids: [song ids in the order sent], runtime }
  let timer = null;
  let failures = 0;
  let polling = false;
  let lastStatus = null;

  // Clear the saved job only if it is this tab's (another tab may have its own).
  const forgetMine = (jobId) => {
    const saved = recall();
    if (!saved || saved.jobId === jobId) forget();
  };
  let lastSaid = "";

  const setIdle = () => {
    button.hidden = false;
    why.hidden = Boolean(!view.generateProblem());
    area.replaceChildren();
    onState({ state: "idle" });
  };

  /* ----- starting ----- */
  button.addEventListener("click", async () => {
    const problem = view.generateProblem();
    if (problem) {
      if (problem.id) {
        setlist.select(problem.id);
        view.flashRow(problem.id);
      }
      return;
    }
    const songs = setlist.songs;
    const segments = songs.map((s) => {
      const saved = songToSaved(s);
      return { youtubeUrl: saved.youtubeUrl, title: s.title || "Song", startTime: saved.startTime, endTime: saved.endTime, artist: s.info?.channel || "" };
    });
    const countdownSeconds = countdown.seconds;
    const fadeOutSeconds = fadeOut.seconds;
    button.disabled = true;
    try {
      const { jobId } = await request("/api/generate", { method: "POST", body: { segments, countdownSeconds, fadeOutSeconds }, timeoutMs: 30000 });
      job = { jobId, startedAt: Date.now(), signature: signature(songs), countdown: countdownSeconds, fadeOut: fadeOutSeconds, ids: songs.map((s) => s.id), titles: songs.map((s) => s.title), runtime: runtime(songs, countdownSeconds) };
      failures = 0;
      remember({ ...job, ids: undefined });
      trackEvent("generate_mix", { song_count: songs.length, countdown: countdownSeconds, fade_out: fadeOutSeconds, ui: "studio" });
      showRunning({ status: "processing", songs: songs.map(() => ({ state: "waiting" })), startedAt: job.startedAt });
      poll();
    } catch (error) {
      showFailed(error.message);
    } finally {
      button.disabled = false;
    }
  });

  /* ----- while it is made ----- */
  function showRunning(status) {
    lastStatus = status;
    button.hidden = true;
    why.hidden = true;
    const p = readProgress(status);
    const ledRow = el("div", { class: "leds", "aria-hidden": "true" },
      ...lights(p.states).map((s) => el("span", { class: `led is-${s}` })));
    const text = p.combining
      ? "Joining the songs into one MP3…"
      : `Song ${Math.max(1, p.current)} of ${p.total} · ${formatLeft(p.left)} left`;
    area.replaceChildren(
      el("div", { class: "gen-box" },
        el("div", { class: "gen-head mono" }, el("span", { text: failures ? "RECONNECTING…" : "GENERATING" }), el("span", { text: `${p.pct}%` })),
        ledRow,
        el("p", { class: "gen-text", text }),
        el("p", { class: "gen-note", text: "Keep this tab open. You can keep browsing the setlist." }),
      ),
    );
    if (job?.ids) view.setDone(job.ids.filter((_, i) => p.states[i] === "done"));
    // Say it out loud once per song, not on every poll.
    const say = p.combining ? "Joining the songs into one MP3" : p.total ? `Generating: song ${Math.max(1, p.current)} of ${p.total}` : "Generating your mix";
    if (say !== lastSaid) {
      lastSaid = say;
      announce(say);
    }
    onState({ state: "running", pct: p.pct, jobId: job?.jobId });
  }

  async function poll() {
    if (!job || polling) return;
    polling = true;
    clearTimeout(timer);
    let status;
    try {
      status = await request(`/api/status/${job.jobId}`, { timeoutMs: 15000 });
      failures = 0;
    } catch (error) {
      polling = false;
      if (error.status === 404) {
        end();
        showFailed("Your last mix was interrupted (the server restarted). Please generate it again.");
        return;
      }
      // A hiccup: try again a few times before giving up.
      if (failures < RETRIES.length) {
        timer = setTimeout(poll, RETRIES[failures++]);
        if (lastStatus) showRunning(lastStatus); // says RECONNECTING…
        return;
      }
      end();
      showFailed("Lost touch with the server while your mix was being made.");
      return;
    }
    polling = false;
    if (status.status === "complete") {
      const finished = job;
      end();
      showReady(finished, status);
      return;
    }
    if (status.status === "error") {
      end();
      showFailed(status.error);
      return;
    }
    showRunning(status);
    timer = setTimeout(poll, POLL_MS);
  }

  function end() {
    clearTimeout(timer);
    if (job) forgetMine(job.jobId);
  }

  /* ----- ready ----- */
  function showReady(finished, status) {
    job = null;
    lastSaid = "";
    onState({ state: "ready", jobId: finished.jobId });
    button.hidden = true;
    why.hidden = true;
    const songsChanged = finished.signature !== signature(setlist.songs);
    // Jobs saved before these options existed had a 5 s countdown and no fade.
    const optionsChanged = (finished.countdown || 5) !== countdown.seconds || (finished.fadeOut || 0) !== fadeOut.seconds;
    const changed = songsChanged || optionsChanged;
    const skipped = Array.isArray(status.failedSegments) ? status.failedSegments : [];
    const download = el("a", { class: "btn btn-primary download-btn", href: `/api/download/${finished.jobId}`, download: "" },
      "Download MP3",
      finished.runtime ? el("span", { class: "mono", text: ` · ${clock(finished.runtime)}` }) : null);
    if (!reducedMotion()) download.classList.add("sweep");
    download.addEventListener("click", () => trackEvent("download_mix", { ui: "studio" }));

    area.replaceChildren(
      el("div", { class: "ready" },
        el("p", { class: "ready-head mono", text: "✓ YOUR MIX IS READY" }),
        download,
        status.setlistFilename
          ? el("a", { class: "btn ready-setlist", href: `/api/download-setlist/${finished.jobId}`, download: "", text: "Download setlist with start times" })
          : null,
        skipped.length
          ? el("div", { class: "ready-skipped" },
              el("p", { text: `${skipped.length} song${skipped.length === 1 ? " was" : "s were"} skipped:` }),
              el("ul", {}, ...skipped.map((f) => el("li", {}, el("strong", { text: f.title || "A song" }), ` (${shortReason(f.reason)})`))))
          : null,
        changed ? el("p", { class: "ready-note", text: songsChanged ? "Your setlist changed since this mix was made." : "Your mix settings changed since this mix was made." }) : null,
        el("button", { type: "button", class: "link-btn ready-again", text: changed ? "Generate again with your changes" : "Edit and generate again", onclick: () => { view.setDone([]); setIdle(); button.focus(); } }),
        el("p", { class: "ready-kofi" },
          "Saved you an hour in Audacity? The tool stays free. ",
          el("a", { href: "https://ko-fi.com/dimitrisk80", target: "_blank", rel: "noopener", "data-support": "ready", text: "Support it on Ko-fi" }),
          el("span", { class: "sr-only", text: " (opens in a new tab)" }),
        ),
      ),
    );
    view.setDone(finished.ids ? finished.ids.filter((_, i) => status.songs?.[i]?.state === "done") : []);
    toast(skipped.length ? `Your mix is ready. ${skipped.length} song${skipped.length === 1 ? " was" : "s were"} skipped.` : "Your mix is ready to download");
    download.focus({ preventScroll: true });
    download.scrollIntoView({ block: "nearest" });
  }

  const shortReason = (reason) => {
    const r = String(reason || "");
    if (/unavailable|removed|private/i.test(r)) return "video unavailable";
    if (/not a youtube/i.test(r)) return "not a YouTube link";
    if (/403|forbidden/i.test(r)) return "YouTube refused the download";
    return "couldn't download";
  };

  /* ----- failed ----- */
  function showFailed(message) {
    job = null;
    lastSaid = "";
    onState({ state: "failed" });
    button.hidden = true;
    why.hidden = true;
    view.setDone([]);
    const retry = el("button", { type: "button", class: "generate-btn", text: "Try again", onclick: () => { setIdle(); button.click(); } });
    area.replaceChildren(
      el("div", { class: "gen-failed", role: "alert" },
        el("p", { class: "gen-failed-head mono", text: "GENERATION FAILED" }),
        el("p", { text: plainError(message) }),
      ),
      retry,
      el("button", { type: "button", class: "link-btn ready-again", text: "Still not working? Tell us",
        onclick: () => document.querySelector('[data-contact="problem"]')?.click() }),
    );
    // The Generate button that had focus is hidden now; keep keyboard users on the next step.
    retry.focus({ preventScroll: true });
  }

  /* ----- a job from before a reload ----- */
  const previous = recall();
  if (previous) {
    // The song ids of the old page are gone. Match the ✓ marks by position,
    // but only if the setlist is still the one that was sent.
    job = { ...previous, ids: previous.signature === signature(setlist.songs) ? setlist.songs.map((s) => s.id) : [] };
    failures = 0;
    showRunning({ status: "processing", songs: (previous.titles || []).map(() => ({ state: "waiting" })), startedAt: job.startedAt });
    poll();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && job && !polling) poll();
  });

  return { isBusy: () => Boolean(job) };
}
