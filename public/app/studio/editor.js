/**
 * The Editor panel: the one YouTube player, the "Most replayed" strip, the
 * timeline with the cut, and the cutting and listening controls.
 *
 * PINK = cutting (handles, range, scissors). CYAN = listening (playhead, Preview).
 */
import { el, clock, pad2, parseTime } from "./util.js";
import { createPlayer } from "./player.js";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const SVG = "http://www.w3.org/2000/svg";

const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};

// Icons from the design (aria-hidden).
const icon = {
  scissorsStart: () =>
    svg("svg", { width: 24, height: 18, viewBox: "0 0 32 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "snip-icon" },
      svg("circle", { cx: 6, cy: 6, r: 3 }), svg("circle", { cx: 6, cy: 18, r: 3 }), svg("path", { d: "M8.12 8.12 12 12" }), svg("path", { d: "M20 4 8.12 15.88" }), svg("path", { d: "M14.8 14.8 20 20" }), svg("path", { d: "M29 3h-3v18h3" })),
  scissorsEnd: () =>
    svg("svg", { width: 24, height: 18, viewBox: "0 0 32 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "snip-icon" },
      svg("path", { d: "M3 3h3v18H3" }),
      svg("g", { transform: "translate(32 0) scale(-1 1)" }, svg("circle", { cx: 6, cy: 6, r: 3 }), svg("circle", { cx: 6, cy: 18, r: 3 }), svg("path", { d: "M8.12 8.12 12 12" }), svg("path", { d: "M20 4 8.12 15.88" }), svg("path", { d: "M14.8 14.8 20 20" }))),
  play: () => svg("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": "true" }, svg("path", { d: "M7 4.5v15l12.5-7.5z" })),
  ending: () =>
    svg("svg", { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }, svg("path", { d: "M5 5v14l9-7z" }), svg("path", { d: "M18 5v14" })),
};

/**
 * What a person typed into START / END, in seconds, or null. Digits only:
 * 1-2 are seconds ("83" = 1:23), 3-4 are m:ss ("123" = 1:23, "1234" = 12:34),
 * because phone number pads have no colon. Otherwise "1:23" or "1:02:03".
 */
export function readTypedTime(value) {
  const v = String(value).trim();
  if (/^\d{5,}$/.test(v)) return null;
  if (/^\d{3,4}$/.test(v)) {
    const s = Number(v.slice(-2));
    if (s > 59) return null;
    return Number(v.slice(0, -2)) * 60 + s;
  }
  return parseTime(v);
}

/** The SVG path of the "Most replayed" curve (values 0..1) in a 100 x 20 box. */
export function heatPath(values) {
  if (!Array.isArray(values) || values.length === 0) return "";
  const n = values.length;
  let d = "M0,20";
  values.forEach((v, i) => {
    const x = (i / Math.max(1, n - 1)) * 100;
    const y = 20 - Math.min(1, Math.max(0.04, v)) * 19;
    d += ` L${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return `${d} L100,20 Z`;
}

/**
 * @param {object} opts
 * @param {ReturnType<import("./setlist.js").createSetlist>} opts.setlist
 * @param {Map<string, object>} opts.fullInfo   videoId -> info with heatmap
 * @param {(videoId: string) => Promise<object>} opts.lookUp
 * @param {(id: string, message: string) => void} opts.onLoadError
 */
export function initEditor({ setlist, fullInfo, lookUp, onLoadError }) {
  const body = document.getElementById("editorBody");
  const empty = document.getElementById("editorEmpty");
  const head = document.querySelector("#editorPanel .panel-head");

  /* ----- header: SONG 03 / 10  ‹ › ----- */
  const counter = el("span", { class: "ed-counter mono", "aria-live": "off" });
  const prevBtn = el("button", { type: "button", class: "btn square-sm", "aria-label": "Previous song", text: "‹" });
  const nextBtn = el("button", { type: "button", class: "btn square-sm", "aria-label": "Next song", text: "›" });
  const nav = el("div", { class: "ed-nav", hidden: true }, counter, prevBtn, nextBtn);
  head.append(nav);

  /* ----- body ----- */
  const name = el("span", { class: "ed-name" });
  const group = el("span", { class: "ed-group" });
  const titleLine = el("h3", { class: "ed-title" }, name, group);

  const host = el("div", { id: "ytHost" });
  const badge = el("span", { class: "ph-badge mono", "aria-hidden": "true", text: "00:00" });
  const videoShimmer = el("div", { class: "video-cover shimmer", hidden: true, "aria-hidden": "true" });
  const videoMsg = el("div", { class: "video-cover video-msg", hidden: true });
  const video = el("div", { class: "video" }, host, badge, videoShimmer, videoMsg);

  const heatLabel = el("span", { text: "MOST REPLAYED ON YOUTUBE" });
  const phLabel = el("span", { class: "ph-label", text: "PLAYHEAD 00:00" });
  const heatShape = svg("path", { d: "", fill: "var(--heat)" });
  const heat = svg("svg", { class: "heat", viewBox: "0 0 100 20", preserveAspectRatio: "none", "aria-hidden": "true" }, heatShape);
  const heatSummary = el("span", { class: "sr-only" });
  const track = el("div", { class: "track" });
  const range = el("div", { class: "range" });
  const playhead = el("div", { class: "playhead", "aria-hidden": "true" });
  const handle = (which) =>
    el("div", { class: `handle handle-${which}`, role: "slider", tabindex: "0", "aria-label": which === "start" ? "Cut start" : "Cut end", "aria-valuemin": "0" });
  const startHandle = handle("start");
  const endHandle = handle("end");
  const timeline = el("div", { class: "timeline" }, heat, track, range, playhead, startHandle, endHandle);
  const durLabel = el("span", { text: "00:00" });
  const cutLabel = el("span", { class: "cut-len", text: "CUT 0s" });
  const timelineBlock = el("div", { class: "tl-block" },
    el("div", { class: "tl-head mono" }, heatLabel, phLabel),
    timeline,
    el("div", { class: "tl-foot mono" }, el("span", { text: "00:00" }), cutLabel, durLabel),
    heatSummary,
  );

  const source = el("div", { class: "cut-source", "aria-live": "polite" });

  const stepper = (which) => {
    const label = which === "start" ? "START" : "END";
    const minus = el("button", { type: "button", class: "step", text: "−1s", "aria-label": `${label === "START" ? "Start" : "End"} 1 second earlier` });
    const plus = el("button", { type: "button", class: "step", text: "+1s", "aria-label": `${label === "START" ? "Start" : "End"} 1 second later` });
    const input = el("input", { class: "step-input mono", id: `cut-${which}`, inputmode: "numeric", autocomplete: "off", spellcheck: "false", "aria-label": `Cut ${which}, minutes and seconds` });
    const box = el("div", { class: "stepper", role: "group", "aria-label": `Cut ${which}` },
      minus, el("label", { class: "step-mid", for: `cut-${which}` }, el("span", { class: "step-label mono", text: label }), input), plus);
    return { box, minus, plus, input };
  };
  const startStep = stepper("start");
  const endStep = stepper("end");
  const snipStart = el("button", { type: "button", class: "snip" }, icon.scissorsStart(), el("span", { class: "snip-text" }));
  const snipEnd = el("button", { type: "button", class: "snip" }, icon.scissorsEnd(), el("span", { class: "snip-text" }));
  const cuts = el("div", { class: "cuts" },
    el("div", { class: "cut-col" }, el("span", { class: "cut-cap mono", "aria-hidden": "true", text: "CUT START" }), startStep.box, snipStart),
    el("div", { class: "cut-col" }, el("span", { class: "cut-cap mono", "aria-hidden": "true", text: "CUT END" }), endStep.box, snipEnd));

  const previewRange = el("span", { class: "listen-range mono" });
  const endingRange = el("span", { class: "listen-range mono" });
  const previewBtn = el("button", { type: "button", class: "listen-btn listen-preview" }, el("span", { class: "listen-title" }, icon.play(), "Preview cut"), previewRange);
  const endingBtn = el("button", { type: "button", class: "listen-btn listen-ending" }, el("span", { class: "listen-title" }, icon.ending(), "Check the ending"), endingRange);
  const listen = el("div", { class: "listen" }, previewBtn, endingBtn);
  // One line for "why": a typed time that isn't a time, or listening that can't work here.
  const cutMsg = el("p", { class: "cut-msg", id: "cutMsg", role: "status", hidden: true });

  // The player has no controls of its own, so say how to use it.
  const videoHint = el("p", { class: "hint video-hint", text: "Tap the video to play or pause · tap the timeline to jump" });

  const editor = el("div", { class: "editor", hidden: true }, titleLine, video, videoHint, timelineBlock, source, cuts, cutMsg, listen);
  body.append(editor);

  /* ----- state ----- */
  let current = null; // the song shown
  let apiFailed = false; // YouTube's player script didn't load
  let time = 0; // playhead, seconds
  let playerDuration = 0;
  let heatId = null;

  const player = createPlayer(host, {
    onTime: (t) => {
      time = t;
      drawPlayhead();
    },
    onState: (state) => {
      // "unstarted" comes and goes while a range starts: only real play/stop events count.
      if (state === "playing" || state === "buffering") syncListenLabels(true);
      else if (state === "paused" || state === "ended" || state === "cued") syncListenLabels(false);
      if (state === "cued" || state === "playing") {
        videoShimmer.hidden = true;
        const d = player.duration();
        if (d && Math.abs(d - playerDuration) > 0.5) {
          playerDuration = d;
          drawCut();
        }
      }
    },
    onError: (code, videoId) => {
      videoShimmer.hidden = true;
      if (code === "api") apiFailed = true;
      if (!current) return;
      // An error about the previous video, after a quick switch, isn't this one's.
      if (videoId && videoId !== current.videoId) return;
      if (code === 101 || code === 150 || code === 153) {
        showVideoMessage("This video can't play here, but it still works in your mix. Set the cut by typing the times.", true);
        setListening(false, "Preview isn't available for this video: YouTube doesn't allow playing it here.");
      } else if (code === 100) {
        showVideoMessage("Couldn't load this video. It may be private or removed.", false);
        onLoadError(current.id, "Couldn't load this video. It may be private or removed.");
      } else if (code === "api") {
        showVideoMessage("The YouTube player didn't load. Check your connection, or type the times.", false);
        setListening(false, "Preview needs the YouTube player, which didn't load.");
      } else {
        showVideoMessage("This video didn't play. Try again, or type the times.", false);
      }
    },
  });

  function setListening(enabled, reason = "") {
    previewBtn.disabled = !enabled;
    endingBtn.disabled = !enabled;
    for (const b of [previewBtn, endingBtn]) {
      if (enabled) b.removeAttribute("aria-describedby");
      else b.setAttribute("aria-describedby", "cutMsg");
    }
    showCutMessage(reason);
  }

  function showCutMessage(text) {
    cutMsg.textContent = text;
    cutMsg.hidden = !text;
  }

  function showVideoMessage(text, withLink) {
    videoMsg.replaceChildren(
      el("p", { text }),
      withLink && current ? el("a", { href: current.youtubeUrl, target: "_blank", rel: "noopener", class: "arrow-link", text: "Open on YouTube →" }) : null,
    );
    videoMsg.hidden = false;
  }

  const duration = () => {
    const s = current;
    if (!s) return 1;
    const known = s.info?.duration || playerDuration;
    return Math.max(known || 0, s.end + (known ? 0 : 30), 1);
  };
  const pct = (sec) => `${Math.min(100, Math.max(0, (sec / duration()) * 100))}%`;

  /* ----- drawing ----- */
  function drawPlayhead() {
    const txt = clock(time);
    badge.textContent = txt;
    phLabel.textContent = `PLAYHEAD ${txt}`;
    playhead.style.left = pct(time);
    snipStart.querySelector(".snip-text").textContent = `Start at ${txt}`;
    snipEnd.querySelector(".snip-text").textContent = `End at ${txt}`;
    snipStart.setAttribute("aria-label", `Start the cut at ${txt}`);
    snipEnd.setAttribute("aria-label", `End the cut at ${txt}`);
  }

  function drawCut() {
    const s = current;
    if (!s) return;
    const d = duration();
    range.style.left = pct(s.start);
    range.style.width = `calc(${pct(s.end)} - ${pct(s.start)})`;
    startHandle.style.left = pct(s.start);
    endHandle.style.left = pct(s.end);
    for (const [h, v, min, max] of [[startHandle, s.start, 0, s.end - 1], [endHandle, s.end, s.start + 1, Math.floor(d)]]) {
      h.setAttribute("aria-valuemin", String(min));
      h.setAttribute("aria-valuemax", String(Math.max(min, max)));
      h.setAttribute("aria-valuenow", String(v));
      h.setAttribute("aria-valuetext", clock(v));
    }
    if (document.activeElement !== startStep.input) startStep.input.value = clock(s.start);
    if (document.activeElement !== endStep.input) endStep.input.value = clock(s.end);
    durLabel.textContent = clock(s.info?.duration || playerDuration || 0);
    cutLabel.textContent = `CUT ${Math.max(0, s.end - s.start)}s`;
    previewRange.textContent = `${clock(s.start)} → ${clock(s.end)}`;
    endingRange.textContent = `${clock(Math.max(s.start, s.end - 3))} → ${clock(s.end)}`;
    drawSource();
    drawPlayhead();
  }

  /** The fixed-height line under the timeline: where the cut came from. */
  function drawSource() {
    const s = current;
    const chip = (text, popular) => el("span", { class: `src-chip mono${popular ? " is-popular" : ""}`, text });
    const pop = s.popularCut;
    if (pop && pop.start === s.start && pop.end === s.end) {
      source.replaceChildren(chip("POPULAR CUT", true), el("span", { class: "src-text", text: "Most used by other hosts" }));
    } else if (pop) {
      source.replaceChildren(
        chip("YOUR CUT"),
        el("button", { type: "button", class: "link-btn", text: "Back to popular cut", onclick: () => setCut({ start: pop.start, end: pop.end }) }),
      );
    } else if (!s.popularChecked && !s.cutSource) {
      source.replaceChildren(chip("CHECKING…"), el("span", { class: "src-text", text: "Looking for a popular cut" }));
    } else {
      source.replaceChildren(chip("YOUR CUT"), el("span", { class: "src-text", text: "No popular cut for this video yet" }));
    }
  }

  function drawHeat() {
    const values = fullInfo.get(current.videoId)?.heatmap;
    const has = Array.isArray(values) && values.length > 0;
    heat.classList.toggle("is-empty", !has);
    heatLabel.textContent = has ? "MOST REPLAYED ON YOUTUBE" : "NO REPLAY DATA";
    heatShape.setAttribute("d", has ? heatPath(values) : "");
    if (has && current.videoId !== heatId && !reducedMotion()) {
      heat.classList.remove("draw");
      void heat.getBoundingClientRect();
      heat.classList.add("draw");
    }
    heatId = has ? current.videoId : null;
    if (has) {
      // Where the peak is, for people who can't see the curve.
      let best = 0;
      values.forEach((v, i) => {
        if (i > 2 && v > values[best]) best = i;
      });
      const d = current.info?.duration || playerDuration;
      heatSummary.textContent = d ? `Most replayed around ${clock((best / values.length) * d)}.` : "";
    } else heatSummary.textContent = "";
  }

  function drawHeader() {
    const songs = setlist.songs;
    const i = current ? setlist.indexOf(current.id) : -1;
    counter.textContent = `SONG ${pad2(i + 1)} / ${pad2(songs.length)}`;
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i === -1 || i >= songs.length - 1;
  }

  /* ----- showing a song ----- */
  function show(song) {
    const switched = !current || current.id !== song.id || current.videoId !== song.videoId;
    current = song;
    editor.hidden = false;
    empty.hidden = true;
    nav.hidden = false;
    name.textContent = song.title || "Loading…";
    name.title = song.title || "";
    group.textContent = song.group || song.info?.channel || "";
    if (switched) {
      videoMsg.hidden = true;
      setListening(true);
      if (apiFailed) {
        showVideoMessage("The YouTube player didn't load. Check your connection, or type the times.", false);
        setListening(false, "Preview needs the YouTube player, which didn't load.");
      }
      playerDuration = 0;
      time = song.start;
      if (player.videoId !== song.videoId && !apiFailed) {
        videoShimmer.hidden = false;
        player.cue(song.videoId, song.start);
      }
      if (!reducedMotion()) {
        titleLine.classList.remove("swap");
        void titleLine.offsetWidth;
        titleLine.classList.add("swap");
      }
      if (!fullInfo.has(song.videoId)) lookUp(song.videoId).then(() => current && current.videoId === song.videoId && drawHeat()).catch(() => {});
      // Get the next and previous songs ready, so switching is instant.
      const i = setlist.indexOf(song.id);
      for (const n of [setlist.songs[i + 1], setlist.songs[i - 1]]) if (n && !fullInfo.has(n.videoId)) lookUp(n.videoId).catch(() => {});
    }
    drawHeader();
    drawCut();
    drawHeat();
  }

  function hide() {
    current = null;
    editor.hidden = true;
    empty.hidden = false;
    nav.hidden = true;
    player.pause();
  }

  /* ----- changing the cut ----- */
  function setCut(patch, { animate } = {}) {
    if (!current) return;
    const d = duration();
    let start = patch.start ?? current.start;
    let end = patch.end ?? current.end;
    // Moving one side never pushes the other: it stops one second short of it.
    if (patch.start !== undefined && patch.end === undefined) start = Math.min(start, end - 1);
    if (patch.end !== undefined && patch.start === undefined) end = Math.max(end, start + 1);
    start = Math.max(0, Math.min(Math.round(start), Math.floor(d) - 1));
    end = Math.max(start + 1, Math.min(Math.round(end), Math.ceil(d)));
    if (start === current.start && end === current.end) {
      drawCut();
      return;
    }
    setlist.update(current.id, { start, end, cutSource: "user" }, { type: "cut" });
    if (animate) bump(animate);
  }

  /** The scissors snip and the handle flashes; the ±1s digits roll. */
  function bump({ which, kind, dir }) {
    if (reducedMotion()) return;
    const restart = (node, cls) => {
      node.classList.remove(cls);
      void node.getBoundingClientRect();
      node.classList.add(cls);
    };
    if (kind === "snip") {
      restart((which === "start" ? snipStart : snipEnd).querySelector(".snip-icon"), "snipping");
      restart(which === "start" ? startHandle : endHandle, "flashing");
    } else {
      const input = (which === "start" ? startStep : endStep).input;
      restart(input, dir > 0 ? "roll-up" : "roll-down");
    }
  }

  const nudge = (which, delta) =>
    setCut(which === "start" ? { start: current.start + delta } : { end: current.end + delta }, { animate: { which, kind: "roll", dir: delta } });

  startStep.minus.addEventListener("click", () => nudge("start", -1));
  startStep.plus.addEventListener("click", () => nudge("start", 1));
  endStep.minus.addEventListener("click", () => nudge("end", -1));
  endStep.plus.addEventListener("click", () => nudge("end", 1));

  for (const [which, step] of [["start", startStep], ["end", endStep]]) {
    const commit = () => {
      const v = readTypedTime(step.input.value);
      if (v === null) {
        step.input.setAttribute("aria-invalid", "true");
        step.input.setAttribute("aria-describedby", "cutMsg");
        showCutMessage(`That isn't a time. Type minutes and seconds, like 1:05.`);
        return false;
      }
      step.input.removeAttribute("aria-invalid");
      step.input.removeAttribute("aria-describedby");
      showCutMessage(
        which === "start" && v >= current.end
          ? `The start must be before the end (${clock(current.end)}), so it was set just before it.`
          : which === "end" && v <= current.start
            ? `The end must be after the start (${clock(current.start)}), so it was set just after it.`
            : "",
      );
      setCut(which === "start" ? { start: v } : { end: v });
      step.input.value = clock(which === "start" ? current.start : current.end);
      return true;
    };
    step.input.addEventListener("change", commit);
    step.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        step.input.value = clock(which === "start" ? current.start : current.end);
        step.input.removeAttribute("aria-invalid");
        showCutMessage("");
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        nudge(which, event.key === "ArrowUp" ? 1 : -1);
        step.input.value = clock(which === "start" ? current.start : current.end);
      }
    });
    step.input.addEventListener("focus", () => step.input.select());
    step.input.addEventListener("blur", () => {
      if (step.input.getAttribute("aria-invalid") === "true") {
        step.input.value = clock(which === "start" ? current.start : current.end);
        step.input.removeAttribute("aria-invalid");
        showCutMessage("");
      }
    });
  }

  snipStart.addEventListener("click", () => setCut({ start: Math.round(time) }, { animate: { which: "start", kind: "snip" } }));
  snipEnd.addEventListener("click", () => setCut({ end: Math.round(time) }, { animate: { which: "end", kind: "snip" } }));
  // While one of them plays, it reads "Stop" (the visible pause on touch screens).
  let listening = null; // the listen button that started the playback
  const listenTo = (btn, from, to) => {
    if (!current) return;
    if (listening === btn && player.isPlaying()) {
      player.pause();
      return;
    }
    listening = btn;
    player.playRange(from, to);
  };
  const syncListenLabels = (playing) => {
    for (const [btn, label] of [[previewBtn, "Preview cut"], [endingBtn, "Check the ending"]]) {
      const stop = playing && listening === btn;
      btn.querySelector(".listen-title").lastChild.textContent = stop ? "Stop" : label;
      btn.setAttribute("aria-pressed", String(stop));
    }
    if (!playing) listening = null;
  };
  previewBtn.addEventListener("click", () => current && listenTo(previewBtn, current.start, current.end));
  endingBtn.addEventListener("click", () => current && listenTo(endingBtn, Math.max(current.start, current.end - 3), current.end));
  prevBtn.addEventListener("click", () => step(-1));
  nextBtn.addEventListener("click", () => step(1));

  function step(delta) {
    const i = setlist.indexOf(current?.id);
    const next = setlist.songs[i + delta];
    if (next) setlist.select(next.id);
  }

  /* ----- timeline: click to move the playhead, drag or arrow the handles ----- */
  const secondsAt = (clientX) => {
    const r = timeline.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration();
  };

  timeline.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".handle") || !current) return;
    const t = secondsAt(event.clientX);
    time = t;
    player.seek(t);
    drawPlayhead();
  });

  for (const [h, which] of [[startHandle, "start"], [endHandle, "end"]]) {
    h.addEventListener("pointerdown", (event) => {
      if (!current) return;
      event.preventDefault();
      h.setPointerCapture(event.pointerId);
      h.classList.add("dragging");
      const move = (e) => setCut(which === "start" ? { start: secondsAt(e.clientX) } : { end: secondsAt(e.clientX) });
      const up = () => {
        h.classList.remove("dragging");
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        // Hear where the cut now starts.
        if (which === "start") player.seek(current.start);
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
    h.addEventListener("keydown", (event) => {
      if (!current) return;
      const value = which === "start" ? current.start : current.end;
      const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 };
      let next = null;
      if (event.key in steps) next = value + steps[event.key];
      else if (event.key === "Home") next = which === "start" ? 0 : current.start + 1;
      else if (event.key === "End") next = which === "start" ? current.end - 1 : duration();
      if (next === null) return;
      event.preventDefault();
      setCut(which === "start" ? { start: next } : { end: next });
    });
  }

  /* ----- shortcuts when nothing else wants the keys ----- */
  document.addEventListener("keydown", (event) => {
    // AltGr (Ctrl+Alt on some layouts) types [ and ] on many keyboards.
    const altGr = event.getModifierState && event.getModifierState("AltGraph");
    if (!current || event.metaKey || ((event.ctrlKey || event.altKey) && !altGr)) return;
    const t = event.target;
    if (t.closest && t.closest("input, textarea, select, [role=slider], [role=tab], dialog")) return;
    // On a button or link, Space and the other keys keep their usual meaning; K still plays.
    if (t.closest && t.closest("button, a") && event.key !== "k") return;
    if (event.key === "k" || event.key === " ") {
      event.preventDefault();
      if (player.isPlaying()) player.pause();
      else player.play();
    } else if (event.key === "[") {
      setCut({ start: Math.round(time) }, { animate: { which: "start", kind: "snip" } });
    } else if (event.key === "]") {
      setCut({ end: Math.round(time) }, { animate: { which: "end", kind: "snip" } });
    }
  });

  /* ----- follow the setlist ----- */
  setlist.onChange((change) => {
    const selected = setlist.selected;
    if (!selected) {
      hide();
      return;
    }
    if (change.type === "select" || !current || current.id !== selected.id) {
      show(selected);
      return;
    }
    // Same song, new data (cut, info, order).
    const videoChanged = current.videoId !== selected.videoId;
    current = selected;
    if (videoChanged) show(selected);
    else {
      name.textContent = selected.title || "Loading…";
      name.title = selected.title || "";
      group.textContent = selected.group || selected.info?.channel || "";
      drawHeader();
      drawCut();
      if (change.type === "info") drawHeat();
    }
  });

  if (setlist.selected) show(setlist.selected);

  return { player, show: () => setlist.selected && show(setlist.selected) };
}
