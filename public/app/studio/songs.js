/**
 * The Songs panel: Search (words or a pasted YouTube link) and Top 10.
 * Adding a song is up to the caller (`onAdd`); this module only finds them.
 */
import { el, clock } from "./util.js";
import { request } from "./api.js";
import { isPlaylistLink, looksLikeLink, watchUrl, youtubeVideoId } from "./setlist.js";

const PAGE = 10; // results shown at a time; the server is asked for 20 once

/**
 * @param {object} opts
 * @param {(item: object, button: HTMLElement) => void} opts.onAdd  item: { videoId, title, channel, thumbnail, duration, cut?, startTime?, endTime? }
 * @param {(videoId: string) => boolean} opts.isAdded
 * @param {(item: object) => void} opts.onAlready  the ✓ of a song already in the setlist was pressed
 */
export function initSongs({ onAdd, isAdded, onAlready }) {
  const tabs = [document.getElementById("tabSearch"), document.getElementById("tabTop")];
  const panes = { tabSearch: document.getElementById("searchPane"), tabTop: document.getElementById("topPane") };
  const form = document.getElementById("searchForm");
  const input = document.getElementById("searchInput");
  const results = document.getElementById("searchResults");
  const count = document.getElementById("resultCount");
  const more = document.getElementById("showMore");
  const top = document.getElementById("topList");

  let all = []; // the last search's results
  let shown = 0;
  let searchSeq = 0;
  let topLoaded = false;
  // The sync function of every + / ✓ on screen, per list, so a new search
  // doesn't forget the Top 10 buttons.
  const syncs = { search: new Set(), top: new Set() };

  /* ----- tabs (arrow keys move between them) ----- */
  const selectTab = (tab, { focus = false } = {}) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      panes[t.id].hidden = !on;
    }
    if (focus) tab.focus();
    if (tab.id === "tabTop" && !topLoaded) loadTop();
  };
  for (const t of tabs) {
    t.disabled = false;
    t.addEventListener("click", () => selectTab(t));
    t.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const i = tabs.indexOf(t);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[next], { focus: true });
    });
  }
  input.disabled = false;
  form.querySelector("button[type=submit]").disabled = false;

  /* ----- add buttons ----- */
  const addButton = (item, list) => {
    const button = el("button", { type: "button", class: "add-btn" });
    let wasAdded = null;
    const sync = () => {
      const added = isAdded(item.videoId);
      // "+ Add" pops into "✓ Added".
      if (wasAdded === false && added) {
        button.classList.remove("pop");
        void button.offsetWidth;
        button.classList.add("pop");
      }
      wasAdded = added;
      button.replaceChildren(added ? "✓" : "+", el("span", { class: "add-label", text: added ? "Added" : "Add" }));
      button.classList.toggle("is-added", added);
      button.setAttribute("aria-label", `${added ? "Already added" : "Add"}: ${item.title}`);
      button.title = added ? "Already in your setlist" : "Add to setlist";
    };
    sync();
    // ✓ shows where the song is (with "Add again"); it never adds a copy by itself.
    button.addEventListener("click", () => (isAdded(item.videoId) ? onAlready(item, button) : onAdd(item, button)));
    syncs[list].add(sync);
    return button;
  };

  /** Re-check every ✓ after the setlist changed. */
  const refreshAdded = () => {
    for (const set of Object.values(syncs)) for (const sync of set) sync();
  };

  const resultRow = (item, meta, list = "search") =>
    el(
      "li",
      { class: "result" },
      // Phones show the thumbnail: it tells a music video from a dance practice.
      item.thumbnail ? el("img", { class: "result-thumb", src: item.thumbnail, alt: "", loading: "lazy", decoding: "async" }) : null,
      el("div", { class: "result-text" }, el("div", { class: "result-title", text: item.title, title: item.title }), el("div", { class: "result-meta mono", text: meta })),
      addButton(item, list),
    );

  const skeleton = (n) => Array.from({ length: n }, () => el("li", { class: "result skeleton", "aria-hidden": "true" }, el("div", { class: "shimmer" })));

  const message = (text, action) =>
    el("li", { class: "result-msg" }, el("p", { text }), action || null);

  /* ----- search ----- */
  const resetButtons = () => syncs.search.clear();

  const showResults = () => {
    resetButtons();
    const slice = all.slice(0, shown);
    results.replaceChildren(
      ...slice.map((item) => resultRow(item, [item.channel ? item.channel.toUpperCase() : "", item.duration ? clock(item.duration) : ""].filter(Boolean).join(" · "))),
    );
    count.textContent = `${slice.length} OF ${all.length} RESULT${all.length === 1 ? "" : "S"}`;
    count.hidden = false;
    const left = all.length - shown;
    more.hidden = all.length <= PAGE;
    more.disabled = left <= 0;
    more.textContent = left > 0 ? "Show more results" : "No more results";
  };

  const fail = (text, retry) => {
    resetButtons();
    count.hidden = true;
    more.hidden = true;
    results.replaceChildren(message(text, retry ? el("button", { type: "button", class: "btn", text: "Try again", onclick: retry }) : null));
  };

  async function search(raw) {
    const query = raw.trim();
    if (!query) return;
    const seq = ++searchSeq;
    const current = () => seq === searchSeq;
    count.hidden = true;
    more.hidden = true;
    results.setAttribute("aria-busy", "true");
    results.replaceChildren(...skeleton(6));

    try {
      const videoId = youtubeVideoId(query);
      if (videoId) {
        // A pasted YouTube link: that one video, ready to add.
        let info = null;
        try {
          info = await request(`/api/youtube/info?url=${encodeURIComponent(watchUrl(videoId))}`, { timeoutMs: 30000 });
        } catch (error) {
          if (!current()) return;
          fail(error.status === 400 ? "That's not a YouTube video link." : "Couldn't load this video. It may be private or removed.", () => search(query));
          return;
        }
        if (!current()) return;
        all = [{ videoId, title: info.title, channel: info.channel, thumbnail: info.thumbnail, duration: info.duration, info }];
        shown = 1;
        showResults();
        count.textContent = "YOUTUBE LINK";
        return;
      }
      if (isPlaylistLink(query)) {
        fail("Paste one video link, not a playlist.");
        return;
      }
      if (looksLikeLink(query)) {
        fail("That's not a YouTube link. Paste one like youtube.com/watch?v=… or youtu.be/…");
        return;
      }

      const list = await request(`/api/youtube/search?q=${encodeURIComponent(query)}&limit=20`, { timeoutMs: 45000 });
      if (!current()) return;
      all = (Array.isArray(list) ? list : [])
        .map((r) => ({ videoId: youtubeVideoId(r.url), title: r.title, channel: r.channel, thumbnail: r.thumbnail, duration: r.duration }))
        .filter((r) => r.videoId);
      shown = Math.min(PAGE, all.length);
      if (all.length === 0) {
        fail(`No songs found for "${query}". Check the spelling or paste a YouTube link.`);
        return;
      }
      showResults();
    } catch (error) {
      if (current()) fail("Search didn't work. YouTube may be slow right now.", () => search(query));
    } finally {
      if (current()) results.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    search(input.value);
  });
  // Pasting a link searches straight away.
  input.addEventListener("paste", () => {
    setTimeout(() => {
      if (youtubeVideoId(input.value)) search(input.value);
    });
  });
  more.addEventListener("click", () => {
    const firstNew = shown;
    shown = Math.min(all.length, shown + PAGE);
    showResults();
    results.children[firstNew]?.querySelector("button")?.focus();
  });

  /* ----- Top 10 ----- */
  async function loadTop() {
    topLoaded = true;
    syncs.top.clear();
    top.setAttribute("aria-busy", "true");
    top.replaceChildren(...skeleton(6));
    try {
      const list = await request("/api/top-songs");
      const rows = (Array.isArray(list) ? list : []).filter((r) => youtubeVideoId(r.youtube_url));
      if (rows.length === 0) {
        top.replaceChildren(message("No songs yet. Search to add the first one."));
        return;
      }
      top.replaceChildren(
        ...rows.map((r, i) => {
          const videoId = youtubeVideoId(r.youtube_url);
          const item = {
            videoId,
            title: r.title || "Unknown title",
            channel: "",
            thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            duration: 0,
            cut: r.cut || null,
          };
          const row = resultRow(item, `USED ${r.count} TIME${r.count === 1 ? "" : "S"}`, "top");
          row.prepend(el("span", { class: `rank mono${i < 3 ? " is-top" : ""}`, text: String(i + 1).padStart(2, "0"), "aria-hidden": "true" }));
          return row;
        }),
      );
    } catch {
      topLoaded = false;
      top.replaceChildren(
        message("Couldn't load Top 10.", el("span", { class: "msg-actions" },
          el("button", { type: "button", class: "btn", text: "Try again", onclick: loadTop }),
          el("button", { type: "button", class: "link-btn", text: "Search instead", onclick: () => { selectTab(tabs[0]); input.focus(); } }),
        )),
      );
    } finally {
      top.removeAttribute("aria-busy");
    }
  }

  return { refreshAdded, search };
}
