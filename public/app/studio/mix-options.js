/**
 * The mix options, each remembered in this browser:
 * - countdown: 3 or 5 seconds before each song
 * - fadeOut: 0 (none), 1, 2 or 3 seconds at the end of each song
 *
 * Every `.seg[data-countdown]` / `.seg[data-fade]` group on the page (the mix
 * options in the setlist footer, and the rows in My mix on phones) is a toggle
 * kept in sync with its option. Buttons carry the value in `data-seconds`.
 */
import { COUNTDOWN_SECONDS } from "./setlist.js";

function option(key, choices, fallback, selector) {
  const listeners = new Set();

  function load() {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null && choices.includes(Number(saved))) return Number(saved);
    } catch {
      // no storage: the default
    }
    return fallback;
  }

  let seconds = load();

  function sync() {
    for (const button of document.querySelectorAll(`${selector} button`)) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.seconds) === seconds));
    }
  }

  return {
    selector,
    sync,
    get seconds() {
      return seconds;
    },
    set(next) {
      if (!choices.includes(next) || next === seconds) return;
      seconds = next;
      try {
        localStorage.setItem(key, String(next));
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
}

export const countdown = option("kpopgen:countdown", [3, 5], COUNTDOWN_SECONDS, ".seg[data-countdown]");
export const fadeOut = option("kpopgen:fadeout", [0, 1, 2, 3], 0, ".seg[data-fade]");

const OPTIONS = [countdown, fadeOut];

export function initMixOptions() {
  document.addEventListener("click", (event) => {
    for (const opt of OPTIONS) {
      const button = event.target.closest(`${opt.selector} button`);
      if (button) opt.set(Number(button.dataset.seconds));
    }
  });
  for (const opt of OPTIONS) opt.sync();
}
