/**
 * The Setlist panel: compact rows (number, title, group, cut, ↑ ↓ ×), the
 * duplicate warning, the empty state, and the SONGS / RUNTIME tiles.
 *
 * Keyboard: each row is one tab stop. ↑/↓ move between rows, Alt+↑/↓ move
 * the song, Delete removes it, Enter opens it in the editor.
 */
import { el, clock, pad2 } from "./util.js";
import { cutLength, findDuplicates, generateProblem, runtime, thumbUrl } from "./setlist.js";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * @param {object} opts
 * @param {ReturnType<import("./setlist.js").createSetlist>} opts.setlist
 * @param {(id: string) => void} opts.onRemove     remove with Undo
 * @param {(id: string) => void} opts.onRetry      look a song that wouldn't load up again
 * @param {() => void} opts.onShuffle
 */
export function initSetlistView({ setlist, onRemove, onRetry, onShuffle, onRemovedExtra }) {
  const body = document.getElementById("setlistBody");
  const empty = document.getElementById("setlistEmpty");
  const list = el("ol", { class: "rows", id: "setlistRows", "aria-label": "Songs in play order", "aria-describedby": "rowsHelp" });
  const help = el("p", { class: "sr-only", id: "rowsHelp", text: "Up and Down arrows go between songs. Alt plus Up or Down moves a song. Delete removes it." });
  const warnings = el("div", { class: "warnings" });
  const highlight = el("div", { class: "row-highlight", "aria-hidden": "true" });
  const listWrap = el("div", { class: "rows-wrap" }, highlight, list);
  body.append(warnings, listWrap, help);

  const tileSongs = document.getElementById("tileSongs");
  const tileRuntime = document.getElementById("tileRuntime");
  const statusLine = document.getElementById("statusLine");
  const shuffleBtn = document.getElementById("shuffleBtn");
  shuffleBtn.addEventListener("click", onShuffle);

  const rows = new Map(); // song id -> row element
  let focusId = null; // the row that holds the tab stop
  let shownTotal = 0;
  let countFrame = 0;

  /* ----- one row ----- */
  function buildRow(song) {
    const pick = el("button", { type: "button", class: "row-pick" },
      el("span", { class: "row-num mono" }),
      // A background image: a failed load leaves the plain box, no broken icon.
      el("span", { class: "row-thumb", "aria-hidden": "true", style: `background-image: url("${thumbUrl(song.videoId)}")` }),
      el("span", { class: "row-text" }, el("span", { class: "row-title" }), el("span", { class: "row-meta mono" })),
    );
    const up = el("button", { type: "button", class: "row-btn", tabindex: "-1", text: "↑" });
    const down = el("button", { type: "button", class: "row-btn", tabindex: "-1", text: "↓" });
    const remove = el("button", { type: "button", class: "row-btn row-x", tabindex: "-1", text: "×" });
    const done = el("span", { class: "row-done", "aria-hidden": "true", hidden: true, text: "✓" });
    const main = el("div", { class: "row-main" }, pick, done, up, down, remove);
    const errorBox = el("div", { class: "row-error", hidden: true });
    const row = el("li", { class: "row", dataset: { id: song.id } }, main, errorBox);

    pick.addEventListener("click", () => setlist.select(song.id));
    up.addEventListener("click", () => move(song.id, -1));
    down.addEventListener("click", () => move(song.id, 1));
    remove.addEventListener("click", () => {
      // The × goes away with its row; keep keyboard focus in the list.
      const songs = setlist.songs;
      const i = setlist.indexOf(song.id);
      const next = songs[i + 1] || songs[i - 1];
      onRemove(song.id);
      if (next && row.contains(document.activeElement)) focusRow(next.id);
    });
    row.addEventListener("keydown", (event) => onRowKey(event, song.id));
    row.addEventListener("focusin", () => {
      focusId = song.id;
      syncTabStops();
    });
    rows.set(song.id, row);
    return row;
  }

  function fillRow(row, song, index, dupIds) {
    const n = pad2(index + 1);
    const isDup = dupIds.has(song.id);
    const selected = song.id === setlist.selectedId;
    const range = `${clock(song.start)}→${clock(song.end)}`;
    const group = song.group ? song.group.toUpperCase() : song.info?.channel ? song.info.channel.toUpperCase() : "";
    const lead = [isDup ? "DUPLICATE" : "", group].filter(Boolean).join(" · ");
    const title = song.title || "Loading…";

    row.querySelector(".row-num").textContent = n;
    row.querySelector(".row-title").textContent = title;
    row.querySelector(".row-title").title = title;
    // Phones hide the group so the cut stays readable (see the CSS).
    row.querySelector(".row-meta").replaceChildren(
      lead ? el("span", { class: isDup ? "meta-lead" : "meta-lead meta-group", text: `${lead} · ` }) : "",
      el("span", { class: "meta-range", text: range }),
    );
    row.classList.toggle("is-selected", selected);
    row.classList.toggle("is-dup", isDup);
    row.classList.toggle("is-error", Boolean(song.loadError));

    const pick = row.querySelector(".row-pick");
    pick.setAttribute("aria-label", `Song ${n}: ${title}${group ? `, ${song.group || song.info.channel}` : ""}, ${range}${isDup ? ", duplicate" : ""}${song.loadError ? ", can't load" : ""}`);
    if (selected) pick.setAttribute("aria-current", "true");
    else pick.removeAttribute("aria-current");

    const [up, down, remove] = row.querySelectorAll(".row-btn");
    up.setAttribute("aria-label", `Move ${title} up`);
    down.setAttribute("aria-label", `Move ${title} down`);
    remove.setAttribute("aria-label", `Remove ${title}`);
    up.disabled = index === 0;
    down.disabled = index === setlist.songs.length - 1;

    const errorBox = row.querySelector(".row-error");
    errorBox.hidden = !song.loadError;
    if (song.loadError) {
      errorBox.replaceChildren(
        el("p", { text: song.loadError }),
        el("span", { class: "row-error-actions" },
          el("button", { type: "button", class: "btn btn-small", text: "Try again", onclick: () => onRetry(song.id) }),
          el("button", { type: "button", class: "btn btn-small", text: "Remove", onclick: () => onRemove(song.id) }),
        ),
      );
    }
  }

  /* ----- keyboard ----- */
  function syncTabStops() {
    const songs = setlist.songs;
    if (!songs.some((s) => s.id === focusId)) focusId = setlist.selectedId || songs[0]?.id || null;
    for (const [id, row] of rows) row.querySelector(".row-pick").tabIndex = id === focusId ? 0 : -1;
  }

  function focusRow(id) {
    focusId = id;
    syncTabStops();
    rows.get(id)?.querySelector(".row-pick")?.focus();
  }

  function move(id, delta) {
    if (setlist.move(id, delta)) {
      const song = setlist.find(id);
      announce(`Moved ${song.title || "song"} to ${setlist.indexOf(id) + 1}`);
    }
  }

  function onRowKey(event, id) {
    const songs = setlist.songs;
    const i = setlist.indexOf(id);
    if (event.target.closest(".row-error")) return;
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && event.altKey) {
      event.preventDefault();
      move(id, event.key === "ArrowUp" ? -1 : 1);
      focusRow(id);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = songs[i + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) focusRow(next.id);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? songs[0] : songs[songs.length - 1];
      if (next) focusRow(next.id);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      const next = songs[i + 1] || songs[i - 1];
      onRemove(id);
      if (next) focusRow(next.id);
    }
  }

  function announce(text) {
    const region = document.getElementById("announcer");
    region.textContent = "";
    setTimeout(() => (region.textContent = text), 30);
  }

  /* ----- whole list ----- */
  function render({ flip = null } = {}) {
    const songs = setlist.songs;
    const before = flip ? new Map([...rows].map(([id, r]) => [id, r.getBoundingClientRect().top])) : null;

    // Rows of removed songs go; rows are reused by id, so nothing re-mounts.
    const ids = new Set(songs.map((s) => s.id));
    for (const [id, row] of rows) {
      if (!ids.has(id)) {
        row.remove();
        rows.delete(id);
      }
    }
    const dups = findDuplicates(songs);
    const dupIds = new Set(dups.flatMap((d) => d.extraIds));
    songs.forEach((song, index) => {
      const row = rows.get(song.id) || buildRow(song);
      fillRow(row, song, index, dupIds);
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
    syncTabStops();

    // Duplicates: an inline warning with "Remove extra" (no popup).
    warnings.replaceChildren(
      ...dups.map((d) =>
        el("div", { class: "warn", role: "status" },
          el("span", { text: `${d.title || "A song"} is in the setlist ${d.extraIds.length === 1 ? "twice" : `${d.extraIds.length + 1} times`}.` }),
          el("button", {
            type: "button",
            class: "btn btn-small btn-warn",
            text: "Remove extra",
            onclick: () => {
              const removed = d.extraIds.map((id) => setlist.remove(id)).filter(Boolean);
              onRemovedExtra?.(d.title, removed);
            },
          }),
        ),
      ),
    );

    empty.hidden = songs.length > 0;
    listWrap.hidden = songs.length === 0;
    shuffleBtn.disabled = songs.length < 2;

    // Tiles and status bar
    tileSongs.textContent = pad2(songs.length);
    const total = runtime(songs);
    countTo(total);
    statusLine.textContent = `${songs.length} SONG${songs.length === 1 ? "" : "S"} · ${clock(total)} TOTAL · 5S COUNTDOWN BEFORE EACH SONG · 1 MP3`;

    placeHighlight();
    if (before && !reducedMotion()) slide(before, flip);
  }

  /** RUNTIME counts to the new total. */
  function countTo(total) {
    cancelAnimationFrame(countFrame);
    const from = shownTotal;
    shownTotal = total;
    if (reducedMotion() || from === total) {
      tileRuntime.textContent = clock(total);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / 300);
      const e = 1 - Math.pow(1 - p, 3);
      tileRuntime.textContent = clock(Math.round(from + (total - from) * e));
      if (p < 1) countFrame = requestAnimationFrame(step);
    };
    countFrame = requestAnimationFrame(step);
  }

  /** The pink selection highlight slides to the selected row. */
  function placeHighlight() {
    const row = rows.get(setlist.selectedId);
    if (!row || listWrap.hidden) {
      highlight.hidden = true;
      return;
    }
    highlight.hidden = false;
    highlight.style.transform = `translateY(${row.offsetTop}px)`;
    highlight.style.height = `${row.offsetHeight}px`;
  }

  /** Rows slide from where they were (FLIP); a shuffle staggers them. */
  function slide(before, mode) {
    let n = 0;
    for (const [id, row] of rows) {
      const old = before.get(id);
      if (old === undefined) continue;
      const dy = old - row.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      row.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], {
        duration: mode === "shuffle" ? 300 : 200,
        // Staggered, but a long setlist still settles within half a second.
        delay: mode === "shuffle" ? Math.min(n++, 8) * 30 : 0,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "backwards",
      });
    }
  }

  /** A row flashes: red when a message points at a problem, pink to say "it's here". */
  function flashRow(id, kind = "problem") {
    const row = rows.get(id);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    row.classList.remove("flash", "flash-info");
    void row.offsetWidth;
    row.classList.add(kind === "info" ? "flash-info" : "flash");
  }

  /** ✓ on the rows already in the mix being made ([] clears them). */
  function setDone(ids) {
    const done = new Set(ids);
    for (const [id, row] of rows) {
      const mark = row.querySelector(".row-done");
      const on = done.has(id);
      if (mark.hidden === on) mark.hidden = !on;
    }
  }

  /** A removed row folds away (fades and slides out) before it goes. */
  const folding = new Set();
  function fold(id) {
    const row = rows.get(id);
    if (!row || reducedMotion()) return Promise.resolve(true);
    if (folding.has(id)) return Promise.resolve(false);
    folding.add(id);
    row.inert = true; // on its way out: no more clicks
    return row
      .animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-12px)" }], { duration: 160, easing: "ease-in", fill: "forwards" })
      .finished.then(
        () => true,
        () => true,
      )
      .finally(() => folding.delete(id));
  }

  /** A newly added row fades in. */
  function markNew(id) {
    const row = rows.get(id);
    if (!row || reducedMotion()) return;
    row.classList.remove("row-in");
    void row.offsetWidth;
    row.classList.add("row-in");
    row.scrollIntoView({ block: "nearest" });
  }

  /** Where new rows land: the target of the "fly into the setlist" animation. */
  function endPoint() {
    const last = list.lastElementChild;
    const r = (last || list).getBoundingClientRect();
    return { x: r.left + 8, y: last ? r.bottom : r.top };
  }

  setlist.onChange((change) => {
    if (change.type === "select") {
      render();
      return;
    }
    render({ flip: change.type === "move" || change.type === "remove" ? "move" : change.type === "order" ? "shuffle" : null });
  });
  window.addEventListener("resize", placeHighlight);
  // The list can be measured while hidden (the phone's Search view); place
  // the highlight again whenever the list's size changes, e.g. when shown.
  if (typeof ResizeObserver === "function") new ResizeObserver(() => placeHighlight()).observe(list);
  render();

  return { render, flashRow, markNew, focusRow, endPoint, setDone, fold, generateProblem: () => generateProblem(setlist.songs), cutLength };
}
