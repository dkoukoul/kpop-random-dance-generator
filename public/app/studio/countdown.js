/**
 * The countdown before each song: 3 or 5 seconds, remembered in this browser.
 *
 * Every `.seg[data-countdown]` group on the page (the COUNTDOWN tile, and the
 * row in My mix on phones) is a 3s / 5s toggle kept in sync with it.
 */
import { COUNTDOWN_SECONDS } from "./setlist.js";

const KEY = "kpopgen:countdown";
const CHOICES = [3, 5];
const listeners = new Set();

function load() {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (CHOICES.includes(saved)) return saved;
  } catch {
    // no storage: the default
  }
  return COUNTDOWN_SECONDS;
}

let seconds = load();

export const countdown = {
  get seconds() {
    return seconds;
  },
  set(next) {
    if (!CHOICES.includes(next) || next === seconds) return;
    seconds = next;
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // only this visit then
    }
    sync();
    for (const fn of listeners) fn(seconds);
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function sync() {
  for (const button of document.querySelectorAll(".seg[data-countdown] button")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === seconds));
  }
}

export function initCountdown() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest(".seg[data-countdown] button");
    if (button) countdown.set(Number(button.dataset.seconds));
  });
  sync();
}
