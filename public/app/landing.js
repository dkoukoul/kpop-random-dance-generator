/**
 * Group pages (/random-dance/*): hand a ready-made mix to the builder, save
 * it as a project file, the theme menu, and Support tracking.
 *
 * The handoff goes through sessionStorage rather than the URL because a
 * ten-song mix is well past a comfortable query-string length. The builder
 * picks the key up on load and clears it, so a refresh doesn't re-import.
 */

const HANDOFF_KEY = "pendingMix";
const THEME_KEY = "kpopgen:theme";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function track(name, params) {
  if (typeof window.gtag === "function") window.gtag("event", name, params);
}

/* ===== Toast: one short message at a time ===== */

let toastTimer = null;

function toast(message) {
  const region = document.getElementById("toastRegion");
  if (!region) return;
  clearTimeout(toastTimer);
  region.textContent = "";
  const box = document.createElement("div");
  box.className = "toast";
  box.textContent = message;
  region.append(box);
  toastTimer = setTimeout(() => box.remove(), 6000);
}

/* ===== Mixes ===== */

function readMix(id) {
  const el = document.getElementById("data-" + id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch (err) {
    console.error("Bad mix payload", id, err);
    return null;
  }
}

function downloadMix(mix) {
  const blob = new Blob([JSON.stringify(mix, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (mix.name || "kpop-dance-project").replace(/[^\w-]+/g, "-").toLowerCase() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.addEventListener("click", (event) => {
  const loadBtn = event.target.closest(".js-load-mix");
  if (loadBtn) {
    const mix = readMix(loadBtn.dataset.mix);
    if (!mix) return;
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(mix));
    } catch (err) {
      // Private mode or storage disabled: the file route still works.
      console.warn("sessionStorage unavailable, downloading instead", err);
      downloadMix(mix);
      toast("Your browser blocked opening the mix directly, so it was saved as a file. In the builder, open it from Project → Open a saved file.");
      return;
    }
    track("open_ready_made_mix", { mix_id: loadBtn.dataset.mix, song_count: mix.songs.length });
    loadBtn.disabled = true;
    loadBtn.lastChild.textContent = " Opening…";
    window.location.href = "/";
    return;
  }

  const dlBtn = event.target.closest(".js-download-mix");
  if (dlBtn) {
    const mix = readMix(dlBtn.dataset.mix);
    if (!mix) return;
    downloadMix(mix);
    track("download_ready_made_mix", { mix_id: dlBtn.dataset.mix });
    toast("Saved. Open it in the builder from Project → Open a saved file.");
    return;
  }

  const support = event.target.closest("[data-support]");
  if (support) track("support_click", { location: support.dataset.support });
});

// Back from the builder via the browser's back button: the page comes from
// the back/forward cache with the button still saying "Opening…".
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  for (const btn of document.querySelectorAll(".js-load-mix:disabled")) {
    btn.disabled = false;
    btn.lastChild.textContent = " Open in builder";
  }
});

/* ===== Theme menu: Dark (default) or Light, shared with the builder ===== */

const menuWrap = document.querySelector("[data-menu]");
const menuButton = menuWrap?.querySelector("button[aria-expanded]");
const menu = menuButton && document.getElementById(menuButton.getAttribute("aria-controls"));

function setMenu(open, { focusButton = false } = {}) {
  menuButton.setAttribute("aria-expanded", String(open));
  menu.hidden = !open;
  if (open) menu.querySelector("[aria-pressed='true']")?.focus();
  else if (focusButton) menuButton.focus();
}

function syncTheme() {
  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const name = document.getElementById("themeName");
  if (name) name.textContent = theme === "light" ? "Light" : "Dark";
  for (const b of document.querySelectorAll("[data-theme-choice]")) {
    b.setAttribute("aria-pressed", String(b.dataset.themeChoice === theme));
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  const panel = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim();
  if (meta && panel) meta.content = panel;
}

function setTheme(theme) {
  const root = document.documentElement;
  if (!reducedMotion()) {
    root.classList.add("theme-fade");
    setTimeout(() => root.classList.remove("theme-fade"), 260);
  }
  if (theme === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (err) {
    // Storage blocked: the theme still applies to this page.
  }
  syncTheme();
}

if (menu) {
  syncTheme();
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  for (const b of menu.querySelectorAll("[data-theme-choice]")) {
    b.addEventListener("click", () => {
      setTheme(b.dataset.themeChoice);
      setMenu(false, { focusButton: true });
    });
  }
  menuWrap.addEventListener("keydown", (event) => {
    if (menu.hidden) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      setMenu(false, { focusButton: true });
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const items = [...menu.querySelectorAll("button")];
      event.preventDefault();
      const at = items.indexOf(document.activeElement);
      const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next].focus();
    }
  });
  menuWrap.addEventListener("focusout", (event) => {
    if (!menu.hidden && !menuWrap.contains(event.relatedTarget)) setMenu(false);
  });
  document.addEventListener("click", (event) => {
    if (!menu.hidden && !menuWrap.contains(event.target)) setMenu(false);
  });
}
