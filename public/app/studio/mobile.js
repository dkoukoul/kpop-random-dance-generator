/**
 * Phones (below 900 px): the same page, laid out for a thumb.
 *
 * - A bottom bar switches between Search and My mix, and Generate.
 * - The Editor panel becomes a bottom sheet (by CSS only: the YouTube iframe
 *   is never moved, because moving it reloads it). It slides up when a song
 *   is tapped, and closes with Done, the grab bar (tap or drag down), or the
 *   phone's Back button.
 * - Generate opens a Mix sheet that holds the setlist's footer (tiles,
 *   progress, the ready card): that block is moved there on phones and back
 *   on wider screens.
 * - ☰ opens a menu sheet with Project, Theme, the links and Ko-fi.
 */
import { el, clock, pad2 } from "./util.js";
import { runtime } from "./setlist.js";
import { setTheme, currentTheme, openHowItWorks } from "./ui.js";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initMobile({ setlist, onGenerateState }) {
  const mq = window.matchMedia("(max-width: 899px)");
  const app = document.getElementById("app");
  const editorPanel = document.getElementById("editorPanel");
  const setlistPanel = document.getElementById("setlistPanel");
  const foot = document.getElementById("setlistFoot");
  const generateBtn = document.getElementById("generateBtn");

  /* ----- bottom bar ----- */
  const count = el("span", { class: "badge-count mono", text: "0" });
  const searchCell = el("button", { type: "button", class: "bb-cell", "aria-current": "page" }, iconSearch(), "Search");
  const mixCell = el("button", { type: "button", class: "bb-cell" }, iconList(), el("span", {}, "My mix ", count));
  const genSub = el("small", { class: "mono" });
  const genFill = el("span", { class: "bb-fill", "aria-hidden": "true" });
  const genLabel = el("span", { class: "bb-gen-label", text: "Generate" });
  const genCell = el("button", { type: "button", class: "bb-gen" }, genFill, genLabel, genSub);
  const bar = el("nav", { class: "bottom-bar", "aria-label": "Builder" }, searchCell, mixCell, genCell);
  document.body.append(bar);

  /* ----- sheets ----- */
  const mixBody = el("div", { class: "sheet-body" });
  const mixSheet = sheet("mixSheet", "Your mix", "MIX", mixBody);
  const menuBody = el("div", { class: "sheet-body menu-sheet" });
  const menuSheet = sheet("menuSheet", "Menu", "MENU", menuBody);
  const backdrop = el("div", { class: "sheet-backdrop", hidden: true });
  document.body.append(backdrop, mixSheet.node, menuSheet.node);

  // The Editor's own grab bar, Done, and Previous / Next song for phones.
  const editorGrab = el("button", { type: "button", class: "sheet-grab", "aria-label": "Close the editor" }, el("span"));
  const editorDone = el("button", { type: "button", class: "btn sheet-done", text: "Done" });
  editorPanel.prepend(editorGrab);
  editorPanel.querySelector(".panel-head").append(editorDone);
  const prevSong = el("button", { type: "button", class: "btn", text: "‹ Previous song" });
  const nextSong = el("button", { type: "button", class: "btn", text: "Next song ›" });
  const songNav = el("div", { class: "sheet-song-nav" }, prevSong, nextSong);
  editorPanel.append(songNav);

  let open = null; // "editor" | "mix" | "menu" | null
  let opener = null;

  function sheet(id, title, label, body) {
    const grab = el("button", { type: "button", class: "sheet-grab", "aria-label": `Close ${title.toLowerCase()}` }, el("span"));
    const done = el("button", { type: "button", class: "btn sheet-done", text: "Done" });
    const node = el("section", { class: "sheet", id, role: "dialog", "aria-modal": "true", "aria-labelledby": `${id}-title`, hidden: true },
      grab,
      el("div", { class: "sheet-head" }, el("h2", { class: "panel-label", id: `${id}-title` }, el("span", { class: "status-dot", "aria-hidden": "true" }), label), done),
      body);
    return { node, grab, done };
  }

  const sheetNode = (name) => (name === "editor" ? editorPanel : name === "mix" ? mixSheet.node : menuSheet.node);

  function openSheet(name) {
    if (!mq.matches || open === name) return;
    // Switching sheets reuses the history entry: going back first would land
    // after the new push and close the new sheet straight away.
    const switching = Boolean(open);
    if (switching) closeSheet({ silent: true, fromHistory: true });
    else opener = document.activeElement;
    open = name;
    const node = sheetNode(name);
    node.hidden = false;
    node.classList.add("is-open");
    if (node === editorPanel) {
      editorPanel.setAttribute("role", "dialog");
      editorPanel.setAttribute("aria-modal", "true");
    }
    backdrop.hidden = false;
    document.body.classList.add("sheet-open");
    if (!reducedMotion()) node.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
    if (switching && history.state && history.state.sheet) history.replaceState({ sheet: name }, "");
    else history.pushState({ sheet: name }, "");
    (node.querySelector(".sheet-done") || node).focus({ preventScroll: true });
  }

  function closeSheet({ silent = false, fromHistory = false } = {}) {
    if (!open) return;
    const name = open;
    const node = sheetNode(name);
    const finish = () => {
      if (open === name) return; // opened again meanwhile
      node.classList.remove("is-open");
      node.style.transform = "";
      if (node !== editorPanel) node.hidden = true;
    };
    if (node === editorPanel) {
      editorPanel.removeAttribute("role");
      editorPanel.removeAttribute("aria-modal");
    }
    backdrop.hidden = true;
    document.body.classList.remove("sheet-open");
    open = null;
    // Slides down the way it came (from where a drag left it), unless motion is off.
    if (reducedMotion() || silent) finish();
    else {
      const from = node.style.transform || "none";
      node.animate([{ transform: from }, { transform: "translateY(100%)" }], { duration: 200, easing: "ease-in" }).finished.then(finish, finish);
    }
    if (!fromHistory && history.state && history.state.sheet) history.back();
    // The opener may sit in a sheet that is hidden by now: fall back to the bar.
    if (!silent) {
      const target = opener && document.contains(opener) && opener.offsetParent !== null ? opener : bar.querySelector("[aria-current]");
      target?.focus({ preventScroll: true });
    }
  }

  // A reload with a sheet open leaves its history entry behind.
  if (history.state && history.state.sheet) history.replaceState(null, "");

  // Tab stays inside an open sheet.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !open || document.querySelector("dialog[open]")) return;
    const node = sheetNode(open);
    const items = [...node.querySelectorAll("button, a[href], input, [tabindex]:not([tabindex='-1']), iframe")].filter(
      (n) => !n.disabled && n.offsetParent !== null,
    );
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!node.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener("popstate", () => {
    if (open) closeSheet({ fromHistory: true });
  });
  backdrop.addEventListener("click", () => closeSheet());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open && !document.querySelector("dialog[open]")) closeSheet();
  });
  for (const s of [mixSheet, menuSheet]) s.done.addEventListener("click", () => closeSheet());
  editorDone.addEventListener("click", () => closeSheet());

  // Drag the grab bar down (> 120 px) to close. A tap, Enter or Space closes too.
  for (const [grab, name] of [[editorGrab, "editor"], [mixSheet.grab, "mix"], [menuSheet.grab, "menu"]]) {
    let startY = null;
    let moved = 0;
    let dragged = false;
    grab.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      startY = e.clientY;
      moved = 0;
      dragged = false;
      grab.setPointerCapture(e.pointerId);
    });
    grab.addEventListener("pointermove", (e) => {
      if (startY === null) return;
      moved = Math.max(0, e.clientY - startY);
      if (moved > 6) dragged = true;
      sheetNode(name).style.transform = `translateY(${moved}px)`;
    });
    grab.addEventListener("pointerup", () => {
      if (startY === null) return;
      startY = null;
      if (moved > 120) closeSheet();
      else sheetNode(name).style.transform = "";
    });
    grab.addEventListener("pointercancel", () => {
      startY = null;
      sheetNode(name).style.transform = "";
    });
    grab.addEventListener("click", () => {
      // A short drag that snapped back isn't a tap.
      if (dragged) {
        dragged = false;
        return;
      }
      if (open === name) closeSheet();
    });
  }

  /* ----- views ----- */
  function setView(view) {
    app.dataset.view = view;
    searchCell.toggleAttribute("aria-current", view === "search");
    mixCell.toggleAttribute("aria-current", view === "mix");
    if (view === "search") searchCell.setAttribute("aria-current", "page");
    if (view === "mix") mixCell.setAttribute("aria-current", "page");
    window.scrollTo({ top: 0 });
  }
  searchCell.addEventListener("click", () => setView("search"));
  mixCell.addEventListener("click", () => setView("mix"));

  // Tapping a song in My mix opens it in the Edit cut sheet.
  setlistPanel.addEventListener("click", (event) => {
    if (mq.matches && event.target.closest(".row-pick")) openSheet("editor");
  });
  prevSong.addEventListener("click", () => step(-1));
  nextSong.addEventListener("click", () => step(1));
  function step(delta) {
    const i = setlist.indexOf(setlist.selectedId);
    const next = setlist.songs[i + delta];
    if (next) setlist.select(next.id);
  }
  const syncSongNav = () => {
    const i = setlist.indexOf(setlist.selectedId);
    prevSong.disabled = i <= 0;
    nextSong.disabled = i === -1 || i >= setlist.songs.length - 1;
  };
  setlist.onChange(syncSongNav);
  syncSongNav();

  /* ----- Generate ----- */
  let genState = { state: "idle" };
  genCell.addEventListener("click", () => {
    if (genState.state === "ready") {
      // The ready card (Download MP3, the setlist, skipped songs) lives in the Mix sheet.
      openSheet("mix");
      foot.querySelector(".download-btn")?.focus({ preventScroll: true });
      return;
    }
    openSheet("mix");
    // Ready to go: start right away. Otherwise the sheet says what's missing.
    if (genState.state === "idle" && !generateBtn.disabled && !generateBtn.hidden) generateBtn.click();
  });
  onGenerateState((state) => {
    genState = state;
    bar.dataset.gen = state.state;
    if (state.state === "running") {
      genLabel.textContent = `GENERATING ${state.pct}%`;
      genFill.style.transform = `scaleX(${state.pct / 100})`;
    } else if (state.state === "ready") {
      genLabel.textContent = "Mix ready";
      genFill.style.transform = "";
      if (!reducedMotion()) {
        genCell.classList.remove("sweep");
        void genCell.offsetWidth;
        genCell.classList.add("sweep");
      }
    } else {
      genLabel.textContent = "Generate";
      genFill.style.transform = "";
    }
    syncCounts();
  });

  // Something in the mix sheet points at a song: show it.
  mixBody.addEventListener("click", (event) => {
    if (event.target.closest(".why-link")) {
      // Straight from the Mix sheet to the Edit cut sheet (one history entry).
      setView("mix");
      openSheet("editor");
    }
  });

  /* ----- ☰ menu ----- */
  const menuBtn = el("button", { type: "button", class: "btn menu-btn", "aria-label": "Menu", "aria-haspopup": "dialog" }, iconMenu());
  document.querySelector(".topbar-right").append(menuBtn);
  menuBtn.addEventListener("click", () => openSheet("menu"));

  const proxy = (label, id, small) =>
    el("button", { type: "button", class: "menu-item", onclick: () => { closeSheet({ silent: true }); document.getElementById(id).click(); } }, label, small ? el("small", { text: small }) : null);
  const themeBtn = (name) =>
    el("button", { type: "button", "aria-pressed": String(currentTheme() === name), "data-sheet-theme": name, text: name === "dark" ? "Dark" : "Light",
      onclick: () => {
        setTheme(name);
        for (const b of menuBody.querySelectorAll("[data-sheet-theme]")) b.setAttribute("aria-pressed", String(b.dataset.sheetTheme === name));
      } });
  menuBody.append(
    el("p", { class: "menu-label", text: "PROJECT" }),
    proxy("New mix", "newMixBtn"),
    proxy("Open a saved file…", "openFileBtn"),
    proxy("Save to a file", "saveFileBtn", "Your draft also saves in this browser"),
    el("div", { class: "menu-sep" }),
    el("p", { class: "menu-label", text: "THEME" }),
    el("div", { class: "seg", role: "group", "aria-label": "Theme" }, themeBtn("dark"), themeBtn("light")),
    el("p", { class: "menu-note", text: "Coming soon: fan-made colour themes for your favourite groups." }),
    el("div", { class: "menu-sep" }),
    el("a", { class: "menu-item", href: "/random-dance/" }, "Ready-made mixes", el("small", { text: "Sets for 20+ groups" })),
    el("button", {
      type: "button",
      class: "menu-item",
      text: "How it works",
      onclick: () => {
        // Wait for Back (closing the sheet) to finish, or the #how-it-works hash lands on its entry.
        window.addEventListener("popstate", () => setTimeout(() => openHowItWorks(), 0), { once: true });
        closeSheet({ silent: true });
      },
    }),
    el("button", { type: "button", class: "menu-item", text: "Contact us", onclick: () => { closeSheet({ silent: true }); document.querySelector('#helpMenu [data-contact=""]')?.click(); } }),
    el("button", { type: "button", class: "menu-item", text: "Report a problem", onclick: () => { closeSheet({ silent: true }); document.querySelector('#helpMenu [data-contact="problem"]')?.click(); } }),
    el("a", { class: "menu-item", href: "/", text: "Use the classic version", onclick: () => { try { localStorage.removeItem("kpopgen:ui"); } catch {} } }),
    el("a", { class: "menu-item menu-kofi", href: "https://ko-fi.com/dimitrisk80", target: "_blank", rel: "noopener", "data-support": "menu" }, "♥ Support on Ko-fi", el("span", { class: "sr-only", text: " (opens in a new tab)" })),
  );

  /* ----- counts on the bar ----- */
  let lastCount = null; // no bump for the songs a page opens with
  function syncCounts() {
    const n = setlist.songs.length;
    count.textContent = String(n);
    if (lastCount !== null && n !== lastCount && !reducedMotion()) {
      count.classList.remove("bump");
      void count.offsetWidth;
      count.classList.add("bump");
    }
    lastCount = n;
    if (genState.state === "idle" || genState.state === "failed") {
      genSub.textContent = n ? `${pad2(n)} SONGS · ${clock(runtime(setlist.songs))}` : "ADD SONGS";
    } else genSub.textContent = genState.state === "ready" ? "OPEN TO DOWNLOAD" : "";
    mixCell.setAttribute("aria-label", `My mix, ${n} song${n === 1 ? "" : "s"}`);
  }
  setlist.onChange(syncCounts);

  /* ----- crossing 900 px ----- */
  function apply() {
    if (mq.matches) {
      if (!app.dataset.view) app.dataset.view = setlist.songs.length ? "mix" : "search";
      setView(app.dataset.view);
      if (foot.parentElement !== mixBody) mixBody.append(foot);
    } else {
      if (open) closeSheet({ silent: true });
      if (foot.parentElement !== setlistPanel) setlistPanel.append(foot);
    }
  }
  mq.addEventListener("change", apply);
  apply();
  syncCounts();

  // An empty My mix offers a way back to Search.
  const empty = document.getElementById("setlistEmpty");
  empty.append(el("button", { type: "button", class: "btn mobile-only search-songs", text: "Search songs", onclick: () => { setView("search"); document.getElementById("searchInput").focus(); } }));

  return { setView, openSheet, closeSheet };
}

/* ----- icons ----- */
const NS = "http://www.w3.org/2000/svg";
function svgIcon(paths) {
  const s = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({ width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "aria-hidden": "true" })) s.setAttribute(k, v);
  for (const d of paths) {
    const node = d.startsWith("c:") ? document.createElementNS(NS, "circle") : document.createElementNS(NS, "path");
    if (d.startsWith("c:")) {
      const [cx, cy, r] = d.slice(2).split(",");
      node.setAttribute("cx", cx);
      node.setAttribute("cy", cy);
      node.setAttribute("r", r);
    } else node.setAttribute("d", d);
    s.append(node);
  }
  return s;
}
const iconSearch = () => svgIcon(["c:11,11,7", "m20 20-4-4"]);
const iconList = () => svgIcon(["M4 6h16M4 12h16M4 18h10"]);
const iconMenu = () => svgIcon(["M4 7h16M4 12h16M4 17h16"]);
