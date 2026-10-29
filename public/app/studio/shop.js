/**
 * Shop links (kpop.exchange affiliate) in the builder: one line on the ready
 * card and one item in the mobile menu. US and Canada only (app/shop-region.js
 * sets data-shop on <html>, and the CSS hides .aff elements without it).
 *
 * Which link each group gets comes from /app/shop-links.json, which the group
 * page build writes after checking the store's stock.
 */

import { el } from "./util.js";

export const BEST_SELLERS = "https://www.kpop.exchange/collections/best-sellers";

/** A group gets its own line when it has at least this many songs... */
const MIN_GROUP_SONGS = 3;
/** ...and at least this share of the setlist. */
const MIN_GROUP_SHARE = 0.4;

export const inShopRegion = () => document.documentElement.dataset.shop === "na";

/** The affiliate URL, tagged with where in the builder it was shown. */
export function shopUrl(url, placement) {
  const u = new URL(url);
  u.searchParams.set("aff", "206");
  u.searchParams.set("utm_source", "kpopgenerator");
  u.searchParams.set("utm_medium", "affiliate");
  u.searchParams.set("utm_content", placement);
  return u.toString();
}

let links = null;

/** Loads the link list once, only for visitors who will see it. */
export function loadShopLinks() {
  if (!inShopRegion()) return;
  fetch("/app/shop-links.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      links = {
        fallback: data.fallback,
        groups: data.groups.map((g) => ({ ...g, re: new RegExp(g.match, g.flags) })),
      };
    })
    .catch(() => {});
}

/**
 * The link for a finished setlist: the group most of it is from, or the
 * fallback (mystery album) when no group stands out.
 * @returns {{kind: string, url: string, group?: string}}
 */
export function pickShopLink(songs, data) {
  const counts = new Map();
  for (const song of songs) {
    const text = [song.group, song.title, song.info?.title].filter(Boolean).join(" ");
    const g = data.groups.find((g) => g.re.test(text));
    if (g) counts.set(g, (counts.get(g) || 0) + 1);
  }
  let top = null;
  for (const [g, n] of counts) if (!top || n > top.n) top = { g, n };
  if (top && top.n >= MIN_GROUP_SONGS && top.n / songs.length >= MIN_GROUP_SHARE) {
    return { kind: top.g.kind, url: top.g.url, group: top.g.name };
  }
  return { kind: data.fallback.kind, url: data.fallback.url };
}

/**
 * The ready card's shop line, or null (outside the region, or not loaded yet).
 * Never throws: a bad shop-links.json must not take the download card with it.
 */
export function readyShopLine(songs) {
  try {
    return shopLine(songs);
  } catch {
    return null;
  }
}

function shopLine(songs) {
  if (!links || !inShopRegion() || !songs.length) return null;
  const pick = pickShopLink(songs, links);
  const [lead, label] =
    pick.kind === "group"
      ? [`Lots of ${pick.group} in this set. `, `Shop ${pick.group} albums & merch`]
      : pick.kind === "mystery"
        ? ["Feeling lucky? ", "Get a mystery K-pop album"]
        : ["", "Popular K-pop albums at kpop.exchange"];
  return el("a", {
      class: "ready-shop aff",
      href: shopUrl(pick.url, "ready"),
      target: "_blank",
      rel: "sponsored noopener",
      "data-aff": "ready",
      "data-aff-link": pick.kind,
      "data-aff-group": pick.group,
    },
    el("span", { class: "ready-shop-text" }, lead, el("u", {}, label, el("span", { "aria-hidden": "true", text: " ↗" }))),
    el("span", { class: "aff-label", text: pick.kind === "mystery" ? "You get a random album · Affiliate link · kpop.exchange" : "Affiliate link · kpop.exchange" }),
    el("span", { class: "sr-only", text: " (opens in a new tab)" }),
  );
}
