/**
 * Page chrome for the mix builder: menus, theme, toasts, the contact dialog,
 * "How it works" links and Support tracking.
 */
import { el, store } from "./util.js";
import { sendContact } from "./api.js";
import { DEFAULT_THEME, knownTheme, themeName } from "./themes.js";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ===== Menus: disclosure buttons (aria-expanded) with a panel ===== */

const menus = [];

export function closeMenus(except) {
  for (const m of menus) if (m !== except) setMenu(m, false);
}

function setMenu(menu, open, { focusButton = false } = {}) {
  menu.button.setAttribute("aria-expanded", String(open));
  menu.panel.hidden = !open;
  if (!open && focusButton) menu.button.focus();
}

export function initMenus() {
  for (const wrap of document.querySelectorAll("[data-menu]")) {
    const button = wrap.querySelector("button[aria-expanded]");
    const panel = document.getElementById(button.getAttribute("aria-controls"));
    const menu = { wrap, button, panel };
    menus.push(menu);

    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      closeMenus(menu);
      setMenu(menu, open);
      if (open) (panel.querySelector("[aria-pressed='true']") ?? panel.querySelector("button:not([aria-disabled='true']), a"))?.focus();
    });

    wrap.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.stopPropagation();
        setMenu(menu, false, { focusButton: true });
      }
      // Up/Down move between items, as people expect in a menu.
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !panel.hidden) {
        const items = [...panel.querySelectorAll("button, a")].filter((i) => i.getAttribute("aria-disabled") !== "true");
        if (items.length === 0) return;
        event.preventDefault();
        const at = items.indexOf(document.activeElement);
        const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
        items[next].focus();
      }
    });

    // Leaving the menu with Tab closes it.
    wrap.addEventListener("focusout", (event) => {
      if (!panel.hidden && !wrap.contains(event.relatedTarget)) setMenu(menu, false);
    });

    // Picking an item closes the menu (the item's own handler still runs).
    panel.addEventListener("click", (event) => {
      const item = event.target.closest("button, a");
      if (item && item.getAttribute("aria-disabled") !== "true") setMenu(menu, false);
    });
  }

  document.addEventListener("click", (event) => {
    for (const m of menus) if (!m.wrap.contains(event.target)) setMenu(m, false);
  });
}

/* ===== Theme: Dark (default), Light or an album theme, remembered per browser ===== */

const THEME_KEY = "kpopgen:theme";

export function currentTheme() {
  return knownTheme(document.documentElement.dataset.theme);
}

export function setTheme(theme) {
  const root = document.documentElement;
  if (!reducedMotion()) {
    root.classList.add("theme-fade");
    setTimeout(() => root.classList.remove("theme-fade"), 260);
  }
  theme = knownTheme(theme);
  if (theme === DEFAULT_THEME) delete root.dataset.theme;
  else root.dataset.theme = theme;
  store.set(THEME_KEY, theme);
  syncThemeMenu();
}

function syncThemeMenu() {
  const theme = currentTheme();
  const name = document.getElementById("themeName");
  if (name) name.textContent = themeName(theme);
  for (const b of document.querySelectorAll("[data-theme-choice]")) {
    b.setAttribute("aria-pressed", String(b.dataset.themeChoice === theme));
  }
  // The phone menu sheet's buttons too: one choice, whichever menu made it.
  for (const b of document.querySelectorAll("[data-sheet-theme]")) {
    b.setAttribute("aria-pressed", String(b.dataset.sheetTheme === theme));
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || meta.content;
}

export function initTheme() {
  syncThemeMenu();
  for (const b of document.querySelectorAll("[data-theme-choice]")) {
    b.addEventListener("click", () => {
      setTheme(b.dataset.themeChoice);
      // The menu closes; focus goes back to the Theme button.
      b.closest("[data-menu]")?.querySelector("button[aria-expanded]")?.focus();
    });
  }
}

/* ===== Toasts: one at a time, 6 s, paused while hovered or focused ===== */

let activeToast = null;

/**
 * Show a short message, optionally with one action (e.g. Undo).
 * Returns a function that closes it.
 */
export function toast(message, { actionLabel, onAction, duration = 6000 } = {}) {
  const region = document.getElementById("toastRegion");
  if (activeToast) activeToast.close();

  const box = el("div", { class: "toast" }, el("span", { text: message }));
  let timer = null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    box.remove();
    if (activeToast && activeToast.box === box) activeToast = null;
  };
  const start = () => {
    clearTimeout(timer);
    timer = setTimeout(close, duration);
  };

  if (actionLabel && onAction) {
    box.append(
      el("button", {
        type: "button",
        class: "btn btn-outline",
        text: actionLabel,
        onclick: () => {
          close();
          onAction();
        },
      }),
    );
  }
  box.addEventListener("mouseenter", () => clearTimeout(timer));
  box.addEventListener("mouseleave", start);
  box.addEventListener("focusin", () => clearTimeout(timer));
  box.addEventListener("focusout", start);

  region.replaceChildren(box);
  activeToast = { box, close };
  start();
  return close;
}

/** Say something to screen readers only (e.g. "Moved Dynamite to 3"). */
export function announce(text) {
  const region = document.getElementById("announcer");
  if (!region) return;
  // Clearing first makes a repeat of the same text be read again.
  region.textContent = "";
  setTimeout(() => {
    region.textContent = text;
  }, 30);
}

/* ===== Contact dialog ===== */

export function initContact() {
  const dialog = document.getElementById("contactDialog");
  const form = document.getElementById("contactForm");
  const email = document.getElementById("contactEmail");
  const message = document.getElementById("contactMessage");
  const website = document.getElementById("contactWebsite");
  const status = document.getElementById("contactStatus");
  const send = document.getElementById("contactSend");
  let opener = null;
  let closeTimer = null;

  const showStatus = (text, kind) => {
    status.textContent = text;
    status.className = `form-status ${kind}`;
    status.hidden = false;
  };

  const open = (kind) => {
    opener = document.activeElement;
    clearTimeout(closeTimer);
    status.hidden = true;
    if (kind === "problem" && !message.value.trim()) message.value = "Problem: ";
    // The "Problem: " start only belongs to a problem report.
    if (kind !== "problem" && message.value.trim() === "Problem:") message.value = "";
    dialog.showModal();
    if (kind === "problem") {
      message.focus();
      message.setSelectionRange(message.value.length, message.value.length);
    } else {
      email.focus();
    }
  };

  for (const trigger of document.querySelectorAll("[data-contact]")) {
    trigger.addEventListener("click", () => open(trigger.dataset.contact));
  }
  // The group pages link here as /#contact.
  if (location.hash === "#contact") {
    history.replaceState(null, "", location.pathname + location.search);
    open("");
  }
  for (const closer of dialog.querySelectorAll("[data-close]")) {
    closer.addEventListener("click", () => dialog.close());
  }
  // A click on the backdrop (outside the box) closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    // A menu item that opened it is hidden by now, so go back to its menu button.
    // After a tick, because the browser restores focus itself after this event.
    const menuButton = opener?.closest("[data-menu]")?.querySelector("button[aria-expanded]");
    const target = menuButton || opener;
    setTimeout(() => {
      if (target && document.contains(target)) target.focus();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!email.value.trim() || !email.checkValidity()) {
      showStatus("Please enter your email address, so we can answer.", "err");
      email.focus();
      return;
    }
    if (!message.value.trim() || message.value.trim() === "Problem:") {
      showStatus("Please write a message.", "err");
      message.focus();
      return;
    }
    send.disabled = true;
    send.textContent = "Sending…";
    try {
      await sendContact({ email: email.value.trim(), message: message.value.trim(), website: website.value });
      form.reset();
      showStatus("Message sent. Thanks for getting in touch!", "ok");
      closeTimer = setTimeout(() => {
        if (dialog.open) dialog.close();
      }, 1800);
    } catch (error) {
      // The message stays in the box, so nothing is lost.
      showStatus(`${error.message || "Couldn't send the message."} Please try again.`, "err");
    } finally {
      send.disabled = false;
      send.textContent = "Send";
    }
  });
}

/* ===== "How it works": open that section when a link jumps to it ===== */

export function openHowItWorks({ focus = true } = {}) {
  const section = document.getElementById("how-it-works");
  if (!section) return;
  section.open = true;
  section.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
  if (focus) section.querySelector("summary")?.focus({ preventScroll: true });
}

export function initHowItWorks() {
  for (const link of document.querySelectorAll("[data-open-how]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      history.replaceState(null, "", "#how-it-works");
      openHowItWorks();
    });
  }
  if (location.hash === "#how-it-works") openHowItWorks({ focus: false });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#how-it-works") openHowItWorks();
  });
}

/* ===== Support (Ko-fi) clicks, per placement ===== */

export function trackEvent(name, params) {
  if (typeof window.gtag === "function") window.gtag("event", name, params);
}

export function initSupportTracking() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-support]");
    if (link) trackEvent("support_click", { location: link.dataset.support });
    const shop = event.target.closest("[data-aff]");
    if (shop && !window.kpopShopPreview) trackEvent("affiliate_click", { location: shop.dataset.aff, link: shop.dataset.affLink, group: shop.dataset.affGroup || "" });
  });
}
