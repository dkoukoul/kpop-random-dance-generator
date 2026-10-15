/**
 * The mix builder's behaviour: adding songs, looking them up, the popular
 * cut, autosave, the Project menu and ready-made mixes from group pages.
 */
import { el, store } from "./util.js";
import { request } from "./api.js";
import { toast, announce, trackEvent } from "./ui.js";
import { createSetlist, DEFAULT_CUT, identifyGroup, newId, watchUrl } from "./setlist.js";
import {
  DRAFT_KEY,
  PENDING_MIX_KEY,
  fromDraft,
  fromPendingMix,
  fromProjectFile,
  projectFileName,
  signature,
  toDraft,
  toProjectFile,
} from "./project.js";
import { initSongs } from "./songs.js";
import { initSetlistView } from "./setlist-view.js";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initBuilder() {
  const setlist = createSetlist();
  let bands = [];
  const fullInfo = new Map(); // videoId -> info incl. heatmap (not saved)
  const lookups = new Map(); // videoId -> Promise

  /* ===== looking songs up ===== */

  const groupFor = (title, channel) => identifyGroup(title, channel, bands);

  /** Video info (title, length, thumbnail, replay curve), once per video. */
  function lookUp(videoId) {
    if (!lookups.has(videoId)) {
      const p = request(`/api/youtube/info?url=${encodeURIComponent(watchUrl(videoId))}`, { timeoutMs: 30000 })
        .then((info) => {
          fullInfo.set(videoId, info);
          return info;
        })
        .catch((error) => {
          lookups.delete(videoId); // "Try again" asks again
          throw error;
        });
      lookups.set(videoId, p);
    }
    return lookups.get(videoId);
  }

  /** Fill in a song's info; mark it "can't load" when YouTube says no. */
  async function fillInfo(id) {
    const song = setlist.find(id);
    if (!song) return;
    try {
      const info = await lookUp(song.videoId);
      const now = setlist.find(id);
      if (!now) return;
      const duration = Number(info.duration) || 0;
      const patch = {
        info: { title: info.title || "", thumbnail: info.thumbnail || "", channel: info.channel || "", duration },
        loadError: null,
      };
      if (!now.title) patch.title = info.title || "";
      if (!now.group) patch.group = groupFor(info.title, info.channel);
      // An untouched default cut can't run past the end of a short video.
      if (!now.cutSource && duration && now.end > duration) patch.end = Math.max(1, Math.floor(duration));
      setlist.update(id, patch, { type: "info" });
    } catch (error) {
      if (!setlist.find(id)) return;
      setlist.update(id, { loadError: "Couldn't load this video. It may be private or removed." }, { type: "info" });
    }
  }

  /** The community's most common cut; applied only to a cut nobody chose yet. */
  async function fillPopularCut(id) {
    const song = setlist.find(id);
    if (!song || song.popularCut) return;
    try {
      const { cut } = await request(`/api/popular-cut?url=${encodeURIComponent(song.youtubeUrl)}`);
      const now = setlist.find(id);
      if (!now) return;
      const start = cut ? parseCut(cut.startTime) : null;
      const end = cut ? parseCut(cut.endTime) : null;
      if (start === null || end === null || end <= start) {
        setlist.update(id, { popularChecked: true }, { type: "info" });
        return;
      }
      const popularCut = { start, end, uses: cut.uses };
      const patch = { popularCut, popularChecked: true };
      if (!now.cutSource) Object.assign(patch, { start, end, cutSource: "popular" });
      setlist.update(id, patch, { type: "cut" });
    } catch {
      // No popular cut then; the song keeps its cut.
      if (setlist.find(id)) setlist.update(id, { popularChecked: true }, { type: "info" });
    }
  }
  const parseCut = (t) => {
    if (typeof t !== "string" || !/^\d+(:\d+){0,2}$/.test(t.trim())) return null;
    return t.trim().split(":").reduce((a, n) => a * 60 + Number(n), 0);
  };

  function fillMissingFor(id) {
    const song = setlist.find(id);
    if (!song) return;
    if (!song.info) fillInfo(id);
    if (!song.popularCut && !song.popularChecked) fillPopularCut(id);
  }

  /** Look up what's missing, a few at a time so a 30-song mix doesn't flood the server. */
  function fillMissing() {
    setlist.songs.forEach((song, i) => {
      setTimeout(() => {
        if (!setlist.find(song.id)) return;
        fillMissingFor(song.id);
      }, i * 250);
    });
  }

  /* ===== adding ===== */

  function addSong(item, button) {
    const info = item.duration ? { title: item.title, thumbnail: item.thumbnail || "", channel: item.channel || "", duration: item.duration } : null;
    if (item.info) fullInfo.set(item.videoId, item.info);
    let fromTop = item.cut ? { start: parseCut(item.cut.startTime), end: parseCut(item.cut.endTime), uses: item.cut.uses } : null;
    if (fromTop && (fromTop.start === null || fromTop.end === null || fromTop.end <= fromTop.start)) fromTop = null;
    const end = info ? Math.min(DEFAULT_CUT.end, Math.max(1, Math.floor(info.duration))) : DEFAULT_CUT.end;
    const song = setlist.add({
      youtubeUrl: watchUrl(item.videoId),
      videoId: item.videoId,
      title: item.title || "",
      group: groupFor(item.title, item.channel),
      start: fromTop ? fromTop.start : DEFAULT_CUT.start,
      end: fromTop ? fromTop.end : end,
      cutSource: fromTop ? "popular" : null,
      popularCut: fromTop,
      info,
    });
    const n = setlist.indexOf(song.id) + 1;
    fly(button, song.title);
    view.markNew(song.id);
    toast(`Added ${song.title || "the song"} · #${n}`, {
      actionLabel: "Undo",
      onAction: () => {
        setlist.remove(song.id);
        announce(`Removed ${song.title}`);
      },
    });
    if (!info) fillInfo(song.id);
    if (!fromTop) fillPopularCut(song.id);
    trackEvent("add_song", { source: item.cut !== undefined ? "top10" : "search" });
  }

  /** The song "flies" from the + button into the setlist. */
  function fly(button, label) {
    if (!button || reducedMotion()) return;
    const from = button.getBoundingClientRect();
    const to = view.endPoint();
    const chip = el("div", { class: "fly-chip", text: label || "Song", "aria-hidden": "true" });
    document.body.append(chip);
    const x0 = Math.max(8, from.left - 120);
    const y0 = from.top;
    chip.style.left = `${x0}px`;
    chip.style.top = `${y0}px`;
    chip
      .animate(
        [
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
          { opacity: 1, offset: 0.75 },
          { transform: `translate(${to.x - x0}px, ${to.y - y0}px) scale(.85)`, opacity: 0 },
        ],
        { duration: 300, easing: "cubic-bezier(.5,0,.3,1)" },
      )
      .finished.finally(() => chip.remove());
  }

  async function removeSong(id) {
    if (!(await view.fold(id))) return; // already on its way out
    const removed = setlist.remove(id);
    if (!removed) return;
    const title = removed.song.title || "the song";
    announce(`Removed ${title}`);
    toast(`Removed ${title}`, {
      actionLabel: "Undo",
      onAction: () => {
        setlist.restore(removed);
        fillMissingFor(removed.song.id);
      },
    });
  }

  function shuffle() {
    if (setlist.songs.length < 2) return;
    const selected = setlist.selectedId;
    const previous = setlist.shuffle((s) => s.group);
    setlist.select(selected);
    announce("Shuffled. The numbers are the order of your mix.");
    // Undo puts back the old order of the songs as they are now (with any
    // edits made since), not the old song objects.
    const order = new Map(previous.map((s, i) => [s.id, i]));
    toast(`Shuffled ${setlist.songs.length} songs`, {
      actionLabel: "Undo",
      onAction: () => {
        const back = [...setlist.songs].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
        setlist.replace(back, { select: setlist.selectedId, type: "order" });
      },
    });
  }

  /** Replace the whole list (New mix, Open a file, a ready-made mix), with Undo. */
  function replaceAll(songs, message, undoMs = 6000) {
    const previous = setlist.songs;
    const selected = setlist.selectedId;
    setlist.replace(songs.map((s) => ({ ...s, id: newId() })));
    fillMissing();
    if (message) {
      toast(
        message,
        previous.length
          ? {
              actionLabel: "Undo",
              onAction: () => {
                setlist.replace(previous, { select: selected });
                fillMissing();
              },
              duration: undoMs,
            }
          : {},
      );
    }
  }

  const songs = initSongs({
    onAdd: addSong,
    isAdded: (videoId) => setlist.songs.some((s) => s.videoId === videoId),
    onAlready: (item, button) => {
      const existing = setlist.songs.find((s) => s.videoId === item.videoId);
      if (!existing) return addSong(item, button);
      setlist.select(existing.id);
      view.flashRow(existing.id, "info");
      toast(`Already in your setlist (#${setlist.indexOf(existing.id) + 1})`, { actionLabel: "Add again", onAction: () => addSong(item, button) });
    },
  });
  const view = initSetlistView({
    setlist,
    onRemove: removeSong,
    onRetry: (id) => fillInfo(id),
    onShuffle: shuffle,
    onRemovedExtra: (title, removed) => {
      toast(`Removed the extra ${title || "copy"}`, {
        actionLabel: "Undo",
        onAction: () =>
          removed
            .slice()
            .reverse()
            .forEach((r) => {
              setlist.restore(r);
              fillMissingFor(r.song.id);
            }),
      });
    },
  });

  /* ===== autosave ===== */

  const draftState = document.getElementById("draftState");
  const draftNote = document.getElementById("draftNote");
  let saveTimer = null;
  let lastSaved = null;
  let lastPulse = 0;

  function saveDraft() {
    clearTimeout(saveTimer);
    const songs = setlist.songs;
    const sig = signature(songs) + JSON.stringify(songs.map((s) => [s.title, s.cutSource]));
    if (sig === lastSaved) return;
    let ok;
    if (songs.length === 0) {
      store.remove(DRAFT_KEY);
      ok = true;
    } else {
      ok = store.set(DRAFT_KEY, JSON.stringify(toDraft(songs)));
    }
    lastSaved = sig;
    draftState.hidden = false;
    draftState.dataset.state = ok ? "saved" : "off";
    draftState.querySelector(".long").textContent = ok ? "DRAFT " : "NOT ";
    draftState.lastChild.textContent = "SAVED";
    draftState.setAttribute("aria-label", ok ? "Draft saved in this browser" : "Not saved");
    draftState.title = ok ? "Your draft is saved in this browser" : "Not saved: this browser blocks storage (private mode?). Use Project > Save to a file.";
    if (draftNote) draftNote.textContent = ok ? "Your draft also saves automatically in this browser." : "This browser won't save drafts. Use Save to a file.";
    // A pulse at most every 3 s, or dragging a handle would make it blink nonstop.
    if (ok && !reducedMotion() && Date.now() - lastPulse > 3000) {
      lastPulse = Date.now();
      draftState.classList.remove("pulse");
      void draftState.offsetWidth;
      draftState.classList.add("pulse");
    }
  }

  /* ===== Generate button: ready, or why not ===== */

  const generateBtn = document.getElementById("generateBtn");
  const generateWhy = document.getElementById("generateWhy");
  const skipLink = document.querySelector(".skip-link");

  skipLink.addEventListener("click", (event) => {
    const target = document.querySelector(skipLink.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  });

  function syncGenerate() {
    const problem = view.generateProblem();
    generateBtn.disabled = Boolean(problem);
    // While a mix is being made (or one is ready), the Generate area shows that instead.
    generateWhy.hidden = !problem || generateBtn.hidden;
    generateWhy.classList.toggle("is-problem", Boolean(problem && problem.id));
    if (!problem) generateWhy.replaceChildren();
    else if (problem.id) {
      // Pointing at a song: a click flashes that row and opens it.
      generateWhy.replaceChildren(
        el("button", {
          type: "button",
          class: "link-btn why-link",
          text: problem.message,
          onclick: () => {
            setlist.select(problem.id);
            view.flashRow(problem.id);
          },
        }),
      );
    } else generateWhy.replaceChildren(problem.message);
    // With nothing in the setlist yet, the useful place to skip to is the search.
    skipLink.href = setlist.songs.length ? "#editor-title" : "#searchInput";
    skipLink.textContent = setlist.songs.length ? "Skip to the editor" : "Skip to search";
  }

  setlist.onChange((change) => {
    syncGenerate();
    if (change.type === "select") return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 500);
    songs.refreshAdded();
  });
  window.addEventListener("pagehide", saveDraft);

  // Another tab changed the draft: say so instead of silently overwriting it.
  window.addEventListener("storage", (event) => {
    if (event.key !== DRAFT_KEY || !event.newValue) return;
    toast("Your mix changed in another tab.", { actionLabel: "Reload", onAction: () => location.reload(), duration: 15000 });
  });

  /* ===== Project menu ===== */

  const fileInput = document.getElementById("importFile");
  const enable = (id, handler) => {
    const b = document.getElementById(id);
    b.removeAttribute("aria-disabled");
    b.addEventListener("click", handler);
  };
  enable("newMixBtn", () => {
    if (setlist.songs.length === 0) return;
    replaceAll([], "Started a new mix");
  });
  enable("openFileBtn", () => fileInput.click());
  enable("saveFileBtn", () => {
    if (setlist.songs.length === 0) {
      toast("Add a song first, then save.");
      return;
    }
    const blob = new Blob([JSON.stringify(toProjectFile(setlist.songs), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: projectFileName() });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Saved to your downloads");
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const { songs, skipped } = fromProjectFile(await file.text());
      replaceAll(songs, `Opened ${file.name} (${songs.length} song${songs.length === 1 ? "" : "s"}${skipped ? `, ${skipped} without a YouTube link left out` : ""})`);
    } catch (error) {
      toast(error.message || "That file isn't a saved mix.");
    }
  });

  /* ===== start: a ready-made mix, else the draft ===== */

  function takePendingMix() {
    let raw = null;
    try {
      raw = sessionStorage.getItem(PENDING_MIX_KEY);
      sessionStorage.removeItem(PENDING_MIX_KEY);
    } catch {
      return null;
    }
    return fromPendingMix(raw);
  }

  const mix = takePendingMix();
  const draft = fromDraft(store.get(DRAFT_KEY));
  if (draft) {
    setlist.replace(draft.map((s) => ({ ...s, id: newId() })));
  }
  if (mix) {
    // The group page's order is kept; "Shuffle now" is one click away.
    // Replacing a saved draft gets a long Undo instead of a question first.
    replaceAll(mix.songs, `Loaded ${mix.name || "the ready-made mix"} (${mix.songs.length} songs). Shuffle now for a random order.`, 15000);
  } else {
    fillMissing();
  }
  if (draft && !mix) {
    draftState.hidden = false;
    lastSaved = signature(setlist.songs) + JSON.stringify(setlist.songs.map((s) => [s.title, s.cutSource]));
  }

  // The band list makes group names; songs restored before it arrived get them now.
  fetch("/api/bands")
    .then((r) => (r.ok ? r.text() : ""))
    .then((text) => {
      bands = text.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const s of setlist.songs) {
        const group = groupFor(s.info?.title || s.title, s.info?.channel || "");
        if (group && group !== s.group) setlist.update(s.id, { group }, { type: "info" });
      }
    })
    .catch(() => {});

  syncGenerate();
  return { setlist, view, fullInfo, lookUp, removeSong, generateBtn };
}
