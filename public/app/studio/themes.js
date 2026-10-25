/**
 * The site's colour themes. Dark is the default (no data-theme on <html>);
 * every other id is :root[data-theme='<id>'] in css/studio.css and
 * css/landing.css. Album themes are fan-made colours taken from an album
 * cover: never logos or official art.
 *
 * The pre-paint scripts in index.html and scripts/build-landing-pages.ts list
 * the same ids (tests/studio/themes.test.ts keeps them in step).
 */
export const THEMES = [
  { id: "dark", name: "Dark" },
  { id: "light", name: "Light" },
  { id: "arirang", name: "ARIRANG", artist: "BTS", album: true },
  { id: "itsme", name: "It's Me", artist: "ILLIT", album: true, light: true },
  { id: "thisthat", name: "THIS & THAT", artist: "Stray Kids", album: true },
  { id: "lemonade", name: "LEMONADE", artist: "aespa", album: true },
];

export const DEFAULT_THEME = "dark";

/** A saved or typed id, or Dark when it isn't one we know. */
export function knownTheme(id) {
  return THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
}

export function themeName(id) {
  return THEMES.find((t) => t.id === knownTheme(id)).name;
}
