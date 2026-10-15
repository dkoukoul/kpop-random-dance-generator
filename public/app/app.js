/**
 * K-Pop Random Dance Generator - Frontend Application
 */

// State
const state = {
  songs: [],
  currentJobId: null,
  isGenerating: false,
  compactViewEnabled: false,
  draggedIndex: null,
  bandList: [],
};

// YouTube IFrame API readiness
let ytApiReady = false;
const ytApiPendingCallbacks = [];
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  const callbacks = ytApiPendingCallbacks.splice(0);
  callbacks.forEach((cb) => cb());
};

// Live YT.Player instances, kept out of songData so JSON.stringify(state.songs)
// (used by exportProject) never touches a player object.
const previewPlayers = new WeakMap();

// DOM Elements
const elements = {
  songList: document.getElementById("songList"),
  emptyState: document.getElementById("emptyState"),
  addSongBtn: document.getElementById("addSongBtn"),
  generateBtn: document.getElementById("generateBtn"),
  progressContainer: document.getElementById("progressContainer"),
  progressFill: document.getElementById("progressFill"),
  progressText: document.getElementById("progressText"),
  downloadSection: document.getElementById("downloadSection"),
  downloadLink: document.getElementById("downloadLink"),
  downloadReportLink: document.getElementById("downloadReportLink"),
  failedSongsSection: document.getElementById("failedSongsSection"),
  failedSongsCount: document.getElementById("failedSongsCount"),
  failedSongsList: document.getElementById("failedSongsList"),
  generateErrorSection: document.getElementById("generateErrorSection"),
  generateErrorText: document.getElementById("generateErrorText"),
  songCardTemplate: document.getElementById("songCardTemplate"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  compactViewToggle: document.getElementById("compactViewToggle"),
  dragHint: document.getElementById("dragHint"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  menuBtn: document.getElementById("menuBtn"),
  menuDropdown: document.getElementById("menuDropdown"),
  statsBar: document.getElementById("statsBar"),
  totalLengthVal: document.getElementById("totalLengthVal"),
  totalSongs: document.getElementById("totalSongs"),
  sidebarSearchInput: document.getElementById("sidebarSearchInput"),
  searchResults: document.getElementById("searchResults"),
  searchLoading: document.getElementById("searchLoading"),
  searchResultTemplate: document.getElementById("searchResultTemplate"),
  bandBreakdown: document.getElementById("bandBreakdown"),
  varietyBar: document.getElementById("varietyBar"),
  topSongsList: document.getElementById("topSongsList"),
  topSongsLoading: document.getElementById("topSongsLoading"),
  duplicateModal: document.getElementById("duplicateModal"),
  duplicateList: document.getElementById("duplicateList"),
  removeDuplicatesBtn: document.getElementById("removeDuplicatesBtn"),
  proceedWithDuplicatesBtn: document.getElementById("proceedWithDuplicatesBtn"),
  contactBtn: document.getElementById("contactBtn"),
  contactModal: document.getElementById("contactModal"),
  contactForm: document.getElementById("contactForm"),
  contactEmail: document.getElementById("contactEmail"),
  contactMessage: document.getElementById("contactMessage"),
  contactWebsite: document.getElementById("contactWebsite"),
  contactSendBtn: document.getElementById("contactSendBtn"),
  contactCancelBtn: document.getElementById("contactCancelBtn"),
  contactStatus: document.getElementById("contactStatus"),
  topSongsSection: document.getElementById("topSongsSection"),
  generateHint: document.getElementById("generateHint"),
  draftBanner: document.getElementById("draftBanner"),
  replaceMixModal: document.getElementById("replaceMixModal"),
  replaceMixText: document.getElementById("replaceMixText"),
  openReadyMixBtn: document.getElementById("openReadyMixBtn"),
  keepMyMixBtn: document.getElementById("keepMyMixBtn"),
  toast: document.getElementById("toast"),
};

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  // Load version number
  loadVersion();
  
  elements.addSongBtn.addEventListener("click", () => addSong({ focus: true }));
  elements.generateBtn.addEventListener("click", generateRandomDance);

  elements.shuffleBtn.addEventListener("click", shuffleSongs);

  // Compact view toggle
  elements.compactViewToggle.addEventListener("change", (e) => {
    state.compactViewEnabled = e.target.checked;
    saveSettings();
    // Update all songs to match global preference
    state.songs.forEach((song) => {
      song.isExpanded = !state.compactViewEnabled;
    });
    rebuildSongList();
  });

  // Options menu
  elements.menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenuOpen(elements.menuDropdown.classList.contains("hidden"));
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !elements.menuDropdown.contains(e.target) &&
      !elements.menuBtn.contains(e.target)
    ) {
      setMenuOpen(false);
    }
  });

  // ...or when keyboard focus moves out of it. A click on a non-focusable
  // part of the menu (a toggle's label) blurs to nothing (relatedTarget is
  // null); closing then would swallow the click, so leave that to the
  // click-outside handler above.
  elements.menuDropdown.parentElement.addEventListener("focusout", (e) => {
    if (
      e.relatedTarget &&
      !elements.menuDropdown.parentElement.contains(e.relatedTarget)
    ) {
      setMenuOpen(false);
    }
  });

  // Escape closes the open modal or the Options menu
  document.addEventListener("keydown", handleOverlayKeydown);

  // Export/Import
  elements.exportBtn.addEventListener("click", () => {
    exportProject();
    setMenuOpen(false, { focusButton: true });
  });

  elements.importBtn.addEventListener("click", () => {
    elements.importFile.click();
    setMenuOpen(false);
  });

  elements.importFile.addEventListener("change", importProject);

  // Contact modal
  elements.contactBtn.addEventListener("click", openContactModal);
  elements.contactCancelBtn.addEventListener("click", closeContactModal);
  elements.contactModal.addEventListener("click", (e) => {
    if (e.target === elements.contactModal) closeContactModal();
  });
  elements.contactForm.addEventListener("submit", submitContactForm);

  // Start from a ready-made mix (landing page), the saved draft, or an
  // empty card
  applySavedSettings();
  startMix();

  elements.draftBanner
    .querySelector(".draft-banner-fresh")
    .addEventListener("click", startFresh);
  elements.draftBanner
    .querySelector(".draft-banner-close")
    .addEventListener("click", hideDraftBanner);
  // Last chance to save an edit made within the save delay
  window.addEventListener("pagehide", saveDraft);

  // Fetch bands list for variety tracking
  fetchBands().then(() => {
    updateStats();
  });

  // On phones the sidebar sits above the song list; keep it short
  if (window.matchMedia("(max-width: 900px)").matches) {
    elements.topSongsSection.open = false;
  }

  // Drag-and-drop doesn't work on touch screens; only the arrows do
  if (window.matchMedia("(hover: none) and (pointer: coarse)").matches) {
    elements.dragHint.textContent = "💡 Use ↑ ↓ to reorder songs";
  }

  initToast();

  // Sidebar Search
  let searchDebounceTimer = null;
  elements.sidebarSearchInput.addEventListener("input", (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchDebounceTimer);

    if (query.length < 2) {
      return;
    }

    searchDebounceTimer = setTimeout(() => {
      performSearch(query);
    }, 500);
  });
  elements.sidebarSearchInput.addEventListener("keydown", (e) => {
    const query = e.target.value.trim();
    if (e.key !== "Enter" || query.length < 2) return;
    clearTimeout(searchDebounceTimer);
    performSearch(query);
    // On phones, close the keyboard so the results (and toasts) can be seen
    if (window.matchMedia("(hover: none)").matches) e.target.blur();
  });

  // Track visit
  trackVisit();

  // Load top songs
  loadTopSongs();
});

/**
 * Track user visit
 */
async function trackVisit() {
  try {
    await fetch("/api/visit", { method: "POST" });
  } catch (error) {
    console.warn("Failed to track visit:", error);
  }
}

/**
 * Toast: a short message near the bottom of the screen, with an optional
 * action button (e.g. "Undo"). One element is reused, so a new toast
 * replaces the current one. It stays while hovered or focused.
 */
let toastTimer = null;
let toastDuration = 0;

function initToast() {
  const toast = elements.toast;
  const pause = () => clearTimeout(toastTimer);
  const resume = () => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, Math.min(toastDuration, 3000));
  };
  toast.addEventListener("mouseenter", pause);
  toast.addEventListener("mouseleave", resume);
  toast.addEventListener("focusin", pause);
  toast.addEventListener("focusout", resume);

  // Keep clear of the Generate bar while the page scrolls under the toast
  let frame = 0;
  const reposition = () => {
    if (frame || !toast.classList.contains("visible")) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      positionToast();
    });
  };
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition);
}

function showToast(message, { actionLabel, onAction } = {}) {
  const toast = elements.toast;
  const text = toast.querySelector(".toast-text");
  const action = toast.querySelector(".toast-action");

  text.textContent = message;
  if (actionLabel && onAction) {
    action.textContent = actionLabel;
    action.onclick = () => {
      hideToast();
      onAction();
    };
    action.classList.remove("hidden");
  } else {
    action.onclick = null;
    action.classList.add("hidden");
  }

  positionToast();
  toast.classList.add("visible");
  // Longer when there's something to click
  toastDuration = actionLabel ? 8000 : 3500;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, toastDuration);
}

/**
 * Low on the screen, but above the Generate bar when that's at the bottom of
 * the screen (stuck there, or about to be)
 */
function positionToast() {
  const bar = document.querySelector(".generate-section").getBoundingClientRect();
  const barAtBottom =
    bar.top > 0 && bar.top < window.innerHeight && bar.bottom > window.innerHeight - 80;
  elements.toast.style.bottom = barAtBottom
    ? `${window.innerHeight - bar.top + 12}px`
    : "";

  // Two columns on wide screens: center it under the song list
  const list = elements.songList.getBoundingClientRect();
  elements.toast.style.left =
    window.innerWidth > 900 ? `${list.left + list.width / 2}px` : "";
}

function hideToast() {
  clearTimeout(toastTimer);
  elements.toast.classList.remove("visible");
}

/**
 * Load and display version number from package.json
 */
async function loadVersion() {
  try {
    const response = await fetch("/package.json");
    if (response.ok) {
      const data = await response.json();
      const versionElement = document.getElementById("versionNumber");
      if (versionElement) {
        versionElement.textContent = data.version;
      }
    }
  } catch (error) {
    console.warn("Failed to load version:", error);
  }
}

/**
 * Add a new, empty song card to the end of the list
 */
function addSong({ focus = false } = {}) {
  const songData = {
    youtubeUrl: "",
    title: "",
    startTime: "0:00",
    endTime: "0:30",
    info: null,
    isExpanded: !state.compactViewEnabled,
  };
  state.songs.push(songData);

  const card = insertSongCard(songData, state.songs.length - 1);
  renumberCards();

  if (focus) card.querySelector(".url-input").focus();

  updateGenerateButton();
  updateStats();
  return card;
}

/**
 * Build the card for a song and wire up its controls. Handlers read the
 * card's position from data-index at event time (renumberCards keeps it
 * current), so a card stays correct after songs around it move or go.
 */
function createSongCard(songData) {
  const template = elements.songCardTemplate.content.cloneNode(true);
  const card = template.querySelector(".song-card");

  const urlInput = card.querySelector(".url-input");
  const fetchBtn = card.querySelector(".btn-fetch");
  const startTimeInput = card.querySelector(".start-time");
  const endTimeInput = card.querySelector(".end-time");
  const removeBtn = card.querySelector(".btn-remove");
  const toggleBtn = card.querySelector(".btn-toggle");

  urlInput.value = songData.youtubeUrl;
  startTimeInput.value = songData.startTime;
  endTimeInput.value = songData.endTime;
  if (songData.info) renderSongInfo(card, songData.info);

  if (songData.isExpanded === undefined) {
    songData.isExpanded = !state.compactViewEnabled;
  }
  card.classList.toggle("compact", !songData.isExpanded);
  renderCutSource(card, songData);
  card
    .querySelector(".btn-reset-cut")
    .addEventListener("click", () => resetCut(card, songData));

  // Clean the URL as it's typed or pasted, and look the video up once it's a
  // valid YouTube link (straight away on paste, after a pause when typing).
  let fetchDebounceTimer = null;
  const onUrlChange = (immediate) => {
    const rawUrl = urlInput.value;
    const cleanedUrl = cleanYouTubeUrl(rawUrl);
    if (cleanedUrl && cleanedUrl !== rawUrl) {
      urlInput.value = cleanedUrl;
    }
    songData.youtubeUrl = cleanedUrl || rawUrl;
    showSongError(card, "");
    updateGenerateButton();

    if (isValidYouTubeUrl(songData.youtubeUrl) && !songData.info) {
      clearTimeout(fetchDebounceTimer);
      if (immediate) {
        fetchVideoInfo(card, songData);
      } else {
        fetchDebounceTimer = setTimeout(() => fetchVideoInfo(card, songData), 500);
      }
    }
  };
  urlInput.addEventListener("input", () => onUrlChange(false));
  urlInput.addEventListener("paste", () => setTimeout(() => onUrlChange(true), 10));

  fetchBtn.addEventListener("click", () => fetchVideoInfo(card, songData));
  urlInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") fetchVideoInfo(card, songData);
  });

  startTimeInput.addEventListener("input", (e) =>
    handleTimeInput(e, card, songData, "startTime"),
  );
  endTimeInput.addEventListener("input", (e) =>
    handleTimeInput(e, card, songData, "endTime"),
  );
  // Typed digits are read as a time straight away ("123" = 1:23); show
  // them formatted once the field is left. Plain seconds that can't be
  // m:ss ("160") are shown as m:ss too.
  const formatOnLeave = (input, field) => {
    if (/^\d+$/.test(songData[field])) {
      songData[field] = formatDuration(Number(songData[field]));
    }
    input.value = songData[field];
  };
  startTimeInput.addEventListener("change", () => formatOnLeave(startTimeInput, "startTime"));
  endTimeInput.addEventListener("change", () => formatOnLeave(endTimeInput, "endTime"));

  removeBtn.addEventListener("click", () =>
    removeSong(card, parseInt(card.dataset.index)),
  );

  card
    .querySelector(".btn-move-up")
    .addEventListener("click", () => nudgeSong(card, -1));
  card
    .querySelector(".btn-move-down")
    .addEventListener("click", () => nudgeSong(card, 1));

  const syncToggleLabel = () => {
    toggleBtn.setAttribute("aria-expanded", String(songData.isExpanded));
    toggleBtn.setAttribute("aria-label", songData.isExpanded ? "Collapse song" : "Expand song");
  };
  syncToggleLabel();
  toggleBtn.addEventListener("click", () => {
    songData.isExpanded = !songData.isExpanded;
    card.classList.toggle("compact", !songData.isExpanded);
    syncToggleLabel();
    if (!songData.isExpanded) pausePreviewPlayer(songData);
  });

  // Preview player controls
  card
    .querySelector(".btn-preview-play")
    .addEventListener("click", () => togglePreviewPlayback(songData));
  card
    .querySelector(".btn-preview-toggle")
    .addEventListener("click", () => togglePreviewVideoVisibility(card));
  card
    .querySelector(".btn-set-start")
    .addEventListener("click", () => setTimeFromPlayer(card, songData, "startTime"));
  card
    .querySelector(".btn-set-end")
    .addEventListener("click", () => setTimeFromPlayer(card, songData, "endTime"));
  card
    .querySelector(".btn-play-ending")
    .addEventListener("click", () => playEnding(songData));
  card.querySelectorAll(".btn-nudge").forEach((btn) => {
    btn.addEventListener("click", () =>
      nudgeTime(card, songData, btn.dataset.field, Number(btn.dataset.delta)),
    );
  });

  // Drag and drop - only allow dragging from card header
  const songCardHeader = card.querySelector(".song-card-header");

  songCardHeader.addEventListener("dragstart", (e) => {
    state.draggedIndex = parseInt(card.dataset.index);
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  songCardHeader.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    state.draggedIndex = null;
    document
      .querySelectorAll(".song-card")
      .forEach((c) => c.classList.remove("drag-over"));
  });

  songCardHeader.addEventListener("dragover", (e) => {
    e.preventDefault();
    const draggingCard = document.querySelector(".song-card.dragging");
    if (draggingCard && draggingCard !== card) {
      card.classList.add("drag-over");
    }
  });

  songCardHeader.addEventListener("dragleave", () => {
    card.classList.remove("drag-over");
  });

  songCardHeader.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag-over");

    const fromIndex = state.draggedIndex;
    const toIndex = parseInt(card.dataset.index);

    if (fromIndex !== null && fromIndex !== toIndex) {
      moveSong(fromIndex, toIndex);
    }
  });

  return card;
}

/**
 * Create a song's card and put it at `index` in the list. The timeline and
 * preview player are set up after the card is in the page.
 */
function insertSongCard(songData, index) {
  const card = createSongCard(songData);
  const next = elements.songList.querySelectorAll(".song-card")[index] || null;
  elements.songList.insertBefore(card, next);

  if (songData.info) {
    initTimeline(card, songData);
    initPreviewPlayer(card, songData);
  }
  return card;
}

/**
 * Bring every card's index and number in line with its place in the list
 */
function renumberCards() {
  const cards = elements.songList.querySelectorAll(".song-card");
  cards.forEach((card, i) => {
    card.dataset.index = i;
    card.querySelector(".song-number").textContent = i + 1;

    const upBtn = card.querySelector(".btn-move-up");
    const downBtn = card.querySelector(".btn-move-down");
    upBtn.disabled = i === 0;
    downBtn.disabled = i === cards.length - 1;
    upBtn.setAttribute("aria-label", `Move song ${i + 1} up`);
    downBtn.setAttribute("aria-label", `Move song ${i + 1} down`);
    card.querySelector(".btn-remove").setAttribute("aria-label", `Remove song ${i + 1}`);
  });

  elements.emptyState.classList.toggle("hidden", cards.length > 0);
  elements.shuffleBtn.disabled = cards.length < 2;
  updateDragHint();
}

/**
 * Show a video's title, channel, thumbnail and duration on its card
 */
function renderSongInfo(card, info) {
  card.querySelector(".song-thumbnail img").src = info.thumbnail;
  card.querySelector(".song-title").textContent = info.title;
  card.querySelector(".song-channel").textContent = info.channel;
  // No duration: null while a Top Song is still being looked up, 0 if unknown
  card.querySelector(".song-duration").textContent = info.duration
    ? `Duration: ${formatDuration(info.duration)}`
    : info.duration === null ? "Duration: loading…" : "";
  card.querySelector(".song-info").classList.remove("hidden");

  // Compact view shows "Band  Song": strip the band from "Band - Song" titles
  const band = identifyBand(info.title, info.channel);
  let displayTitle = info.title;
  if (band && band !== "Unknown" && displayTitle.includes(band)) {
    const parts = displayTitle.split(" - ");
    if (parts.length > 1 && parts[0].toLowerCase().includes(band.toLowerCase())) {
      displayTitle = parts.slice(1).join(" - ");
    }
  }
  card.querySelector(".compact-band").textContent = band;
  card.querySelector(".compact-title").textContent = displayTitle;
}

/**
 * Move the song at `from` to position `to`. Only that card moves in the
 * page; moving a node reloads the iframe inside it, so its preview player
 * is rebuilt.
 */
function moveSong(from, to) {
  if (from === to || to < 0 || to >= state.songs.length) return;

  const cards = elements.songList.querySelectorAll(".song-card");
  const card = cards[from];
  const songData = state.songs[from];

  destroyPreviewPlayer(songData);
  state.songs.splice(from, 1);
  state.songs.splice(to, 0, songData);
  elements.songList.insertBefore(card, to > from ? cards[to].nextSibling : cards[to]);
  renumberCards();

  if (songData.info) initPreviewPlayer(card, songData);
  updateGenerateButton();
  updateStats();
}

/**
 * Move a song one place up (-1) or down (+1) from its arrow buttons. Focus
 * stays on the arrow so it can be pressed again; at the end of the list that
 * arrow is disabled, so focus goes to the other one.
 */
function nudgeSong(card, delta) {
  const from = parseInt(card.dataset.index);
  moveSong(from, from + delta);

  const sameBtn = card.querySelector(delta < 0 ? ".btn-move-up" : ".btn-move-down");
  const otherBtn = card.querySelector(delta < 0 ? ".btn-move-down" : ".btn-move-up");
  (sameBtn.disabled ? otherBtn : sameBtn).focus();
}

/**
 * Remove a song from the list, with an Undo for songs that had a video
 */
function removeSong(card, index) {
  const songData = state.songs[index];
  if (songData) {
    if (songData.timelineCleanup) songData.timelineCleanup();
    destroyPreviewPlayer(songData);
  }

  // Keep keyboard focus in the list instead of dropping it on the page
  const hadFocus = card.contains(document.activeElement);
  const nextCard = card.nextElementSibling?.classList.contains("song-card")
    ? card.nextElementSibling
    : card.previousElementSibling;

  card.remove();
  state.songs.splice(index, 1);
  renumberCards();

  if (hadFocus) {
    const target = nextCard?.classList.contains("song-card")
      ? nextCard.querySelector(".btn-remove")
      : elements.addSongBtn;
    target.focus();
  }

  if (songData && songData.youtubeUrl) {
    showToast(`Removed: ${songData.title || `song #${index + 1}`}`, {
      actionLabel: "Undo",
      onAction: () => restoreSong(songData, index),
    });
  }

  updateGenerateButton();
  updateStats();
}

/**
 * Put a removed song back where it was (Undo)
 */
function restoreSong(songData, index) {
  // A quick second press on Undo (before the toast finishes hiding) must not
  // add the same song twice
  if (state.songs.includes(songData)) return;

  const at = Math.min(index, state.songs.length);
  state.songs.splice(at, 0, songData);
  const card = insertSongCard(songData, at);
  renumberCards();

  // Undo pressed from the keyboard: focus would be lost with the hiding
  // toast. Put it on the card itself, not a button, so a quick second Enter
  // doesn't act on the restored song.
  if (elements.toast.contains(document.activeElement)) {
    card.tabIndex = -1;
    card.focus();
  }
  updateGenerateButton();
  updateStats();
}

/**
 * Find the card currently showing a song, or null if the song is gone.
 * rebuildSongList() replaces every card, so a card reference held across an
 * await or a timer can be stale.
 */
function findCardForSong(songData) {
  const index = state.songs.indexOf(songData);
  if (index === -1) return null;
  return document.querySelector(`.song-card[data-index="${index}"]`);
}

/**
 * Fetch video info from YouTube
 */
async function fetchVideoInfo(card, songData) {
  const urlInput = card.querySelector(".url-input");
  const fetchBtn = card.querySelector(".btn-fetch");
  const fetchIcon = fetchBtn.querySelector(".fetch-icon");

  const url = urlInput.value.trim();
  if (!url) return;

  // Show loading state
  fetchIcon.textContent = "⏳";
  fetchIcon.classList.add("loading");
  fetchBtn.disabled = true;

  try {
    const response = await fetch(
      `/api/youtube/info?url=${encodeURIComponent(url)}`,
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to fetch video info");
    }

    const info = data;
    songData.info = info;
    songData.title = info.title;

    // A popular cut belongs to the video it was found for. When the card now
    // holds a different video, go back to the default (and ask again below).
    const hadOtherPopularCut =
      songData.cutSource === "popular" &&
      songData.popularCutFor &&
      extractYouTubeVideoId(songData.popularCutFor) !== extractYouTubeVideoId(url);
    if (hadOtherPopularCut) {
      songData.cutSource = undefined;
      songData.popularUses = null;
      songData.startTime = "0:00";
      songData.endTime = "0:30";
    }

    // Set default end time to 30 seconds or video duration if shorter, but
    // only while the song still has the untouched 0:00-0:30 cut. A cut from a
    // landing page, a pending mix or the user is kept.
    const hasDefaultCut =
      parseTimeSeconds(songData.startTime) === 0 &&
      parseTimeSeconds(songData.endTime) === 30;
    if (hasDefaultCut) {
      songData.endTime = formatDuration(Math.min(30, info.duration));
    }

    // The list may have been rebuilt while the lookup was in flight
    // (e.g. by fetchBands), so write to the song's current card. The info is
    // kept on the song even if it has no card (removed, Undo may follow).
    if (!card.isConnected) {
      card = findCardForSong(songData);
      if (!card) return;
    }
    renderSongInfo(card, info);
    showSongError(card, "");
    if (hadOtherPopularCut) {
      card.querySelector(".start-time").value = songData.startTime;
      renderCutSource(card, songData);
      checkTimeValidity(card, songData);
    }
    if (hasDefaultCut) card.querySelector(".end-time").value = songData.endTime;
    applyPopularCut(songData);

    // Initialize timeline
    initTimeline(card, songData);
    initPreviewPlayer(card, songData);
  } catch (error) {
    console.error("Error fetching video info:", error);
    // A Top Song's length is now unknown (0), no longer "loading"
    if (songData.info && songData.info.duration === null) songData.info.duration = 0;
    if (!card.isConnected) card = findCardForSong(songData);
    if (card) {
      showSongError(card, "Couldn't load this video: private or removed?");
      if (songData.info) renderSongInfo(card, songData.info);
    }
  } finally {
    fetchIcon.textContent = "🔍";
    fetchIcon.classList.remove("loading");
    fetchBtn.disabled = false;
    updateGenerateButton();
    updateStats();
  }
}

/**
 * Find duplicate songs based on YouTube video ID
 * Returns an array of duplicate groups
 */
function findDuplicates() {
  const urlMap = new Map();

  state.songs.forEach((song, index) => {
    if (!song.youtubeUrl || !song.youtubeUrl.trim()) return;

    const videoId = extractYouTubeVideoId(song.youtubeUrl);
    if (!videoId) return;

    if (!urlMap.has(videoId)) {
      urlMap.set(videoId, []);
    }
    urlMap.get(videoId).push({ index, song });
  });

  const duplicates = [];
  for (const [videoId, occurrences] of urlMap.entries()) {
    if (occurrences.length > 1) {
      duplicates.push({
        videoId,
        occurrences,
        title: occurrences[0].song.title || occurrences[0].song.youtubeUrl,
      });
    }
  }

  return duplicates;
}

/**
 * Show the duplicate detection modal
 */
function showDuplicateModal(duplicates, segments) {
  // Build the duplicate list HTML
  elements.duplicateList.innerHTML = "";

  duplicates.forEach((group) => {
    const groupEl = document.createElement("div");
    groupEl.className = "duplicate-group";

    const headerEl = document.createElement("div");
    headerEl.className = "duplicate-group-header";

    const badgeEl = document.createElement("span");
    badgeEl.className = "duplicate-badge";
    badgeEl.textContent = `${group.occurrences.length}x`;

    const titleEl = document.createElement("span");
    titleEl.className = "duplicate-group-title";
    titleEl.textContent = group.title || "Unknown Song";
    titleEl.title = group.title || "Unknown Song";

    headerEl.appendChild(badgeEl);
    headerEl.appendChild(titleEl);

    const detailsEl = document.createElement("ul");
    detailsEl.className = "duplicate-group-details";

    group.occurrences.forEach((occ) => {
      const li = document.createElement("li");
      const start = occ.song.startTime || "0:00";
      const end = occ.song.endTime || "0:30";
      li.textContent = `Song #${occ.index + 1}: ${start} → ${end}`;
      detailsEl.appendChild(li);
    });

    groupEl.appendChild(headerEl);
    groupEl.appendChild(detailsEl);
    elements.duplicateList.appendChild(groupEl);
  });

  // Handle button clicks
  const onRemoveDuplicates = () => {
    cleanupModalListeners();
    closeDuplicateModal();
    removeDuplicatesAndGenerate(segments);
  };

  const onProceedWithDuplicates = () => {
    cleanupModalListeners();
    closeDuplicateModal();
    startGeneration(segments);
  };

  // Clicking outside the dialog does nothing (an explicit choice is needed);
  // Escape closes it without generating.
  function cleanupModalListeners() {
    elements.removeDuplicatesBtn.removeEventListener("click", onRemoveDuplicates);
    elements.proceedWithDuplicatesBtn.removeEventListener("click", onProceedWithDuplicates);
  }

  elements.removeDuplicatesBtn.addEventListener("click", onRemoveDuplicates);
  elements.proceedWithDuplicatesBtn.addEventListener("click", onProceedWithDuplicates);
  openModal(elements.duplicateModal, { onClose: cleanupModalListeners });
}

/**
 * Close the duplicate detection modal
 */
function closeDuplicateModal() {
  closeModal(elements.duplicateModal);
}

/**
 * Open the contact modal
 */
function openContactModal() {
  elements.contactStatus.classList.add("hidden");
  openModal(elements.contactModal);
}

/**
 * Close the contact modal
 */
function closeContactModal() {
  closeModal(elements.contactModal);
}

/**
 * Modals: focus moves into the dialog when it opens and stays inside it
 * (Tab wraps), Escape closes it, and focus goes back to whatever opened it.
 */
let activeModal = null;

function focusableIn(container) {
  return [
    ...container.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.tabIndex !== -1 && el.offsetParent !== null);
}

function openModal(modal, { onClose } = {}) {
  activeModal = { modal, opener: document.activeElement, onClose };
  modal.classList.remove("hidden");
  const first = focusableIn(modal)[0];
  if (first) first.focus();
}

function closeModal(modal) {
  modal.classList.add("hidden");
  if (!activeModal || activeModal.modal !== modal) return;

  const { opener, onClose } = activeModal;
  activeModal = null;
  if (onClose) onClose();
  if (opener && opener.isConnected) opener.focus();
}

/**
 * Open or close the Options menu, keeping aria-expanded in step
 */
function setMenuOpen(open, { focusButton = false } = {}) {
  const wasOpen = !elements.menuDropdown.classList.contains("hidden");
  elements.menuDropdown.classList.toggle("hidden", !open);
  elements.menuBtn.setAttribute("aria-expanded", String(open));
  if (open && !wasOpen) {
    focusableIn(elements.menuDropdown)[0]?.focus();
  }
  if (!open && wasOpen && focusButton) elements.menuBtn.focus();
}

/**
 * Escape closes the open modal (or else the Options menu); Tab stays inside
 * an open modal.
 */
function handleOverlayKeydown(e) {
  if (activeModal) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal(activeModal.modal);
    } else if (e.key === "Tab") {
      const items = focusableIn(activeModal.modal);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!activeModal.modal.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
    return;
  }

  if (e.key === "Escape" && !elements.menuDropdown.classList.contains("hidden")) {
    setMenuOpen(false, { focusButton: true });
  }
}

/**
 * Submit the contact form to the backend, which relays it via Resend
 */
async function submitContactForm(e) {
  e.preventDefault();

  elements.contactSendBtn.disabled = true;
  elements.contactStatus.classList.add("hidden");

  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: elements.contactEmail.value,
        message: elements.contactMessage.value,
        website: elements.contactWebsite.value,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Failed to send message");
    }

    elements.contactStatus.textContent = "Message sent! Thanks for reaching out.";
    elements.contactStatus.classList.remove("hidden", "error");
    elements.contactStatus.classList.add("success");
    elements.contactForm.reset();

    setTimeout(closeContactModal, 1500);
  } catch (error) {
    elements.contactStatus.textContent = error.message || "Something went wrong. Please try again.";
    elements.contactStatus.classList.remove("hidden", "success");
    elements.contactStatus.classList.add("error");
  } finally {
    elements.contactSendBtn.disabled = false;
  }
}

/**
 * Remove duplicate songs (keep first occurrence) and generate
 */
function removeDuplicatesAndGenerate(originalSegments) {
  const seenVideoIds = new Set();
  const uniqueSegments = [];

  for (const segment of originalSegments) {
    const videoId = extractYouTubeVideoId(segment.youtubeUrl);
    if (videoId && seenVideoIds.has(videoId)) {
      continue;
    }
    if (videoId) {
      seenVideoIds.add(videoId);
    }
    uniqueSegments.push(segment);
  }

  // Also update the state.songs array to remove duplicates visually
  const seenIndices = new Set();
  const uniqueSongs = [];
  state.songs.forEach((song) => {
    const videoId = extractYouTubeVideoId(song.youtubeUrl);
    if (videoId && seenIndices.has(videoId)) {
      return;
    }
    if (videoId) {
      seenIndices.add(videoId);
    }
    uniqueSongs.push(song);
  });

  state.songs = uniqueSongs;
  rebuildSongList();

  startGeneration(uniqueSegments);
}

/**
 * Start the actual generation process
 */
async function startGeneration(segments) {
  if (segments.length === 0) {
    showToast("No songs left to generate after removing duplicates.");
    resetGenerateButton();
    return;
  }

  state.isGenerating = true;

  // Update UI
  elements.generateBtn.disabled = true;
  elements.generateBtn.classList.add("loading");
  elements.generateBtn.innerHTML =
    '<span class="btn-icon">⏳</span> Generating...';
  elements.progressContainer.classList.remove("hidden");
  elements.downloadSection.classList.add("hidden");
  elements.failedSongsSection.classList.add("hidden");
  elements.generateErrorSection.classList.add("hidden");
  elements.progressFill.style.width = "10%";
  elements.progressText.textContent = "Starting generation...";

  try {
    // Start generation
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments }),
    });

    if (!response.ok) {
      throw new Error("Failed to start generation");
    }

    const { jobId } = await response.json();
    state.currentJobId = jobId;

    // Poll for status
    await pollJobStatus(jobId);
  } catch (error) {
    console.error("Generation error:", error);
    showGenerateError("Couldn't start generating: " + error.message);
    resetGenerateButton();
  }
}

/**
 * Generate the random dance audio
 */
async function generateRandomDance() {
  if (state.isGenerating) return;

  // Validate segments
  const segments = state.songs
    .filter((song) => song.youtubeUrl && song.youtubeUrl.trim() !== "")
    .map((song) => ({
      youtubeUrl: song.youtubeUrl,
      title: song.title || "Song", // Fallback title if not fetched
      startTime: song.startTime || "0:00",
      endTime: song.endTime || "0:30",
      artist: song.info?.channel || "", // Include channel for band detection
    }));

  if (segments.length === 0) {
    showToast("Add at least one song with a YouTube link first.");
    return;
  }

  // Check for duplicates
  const duplicates = findDuplicates();
  if (duplicates.length > 0) {
    showDuplicateModal(duplicates, segments);
    return;
  }

  await startGeneration(segments);
}

/**
 * Poll job status until complete
 */
async function pollJobStatus(jobId) {
  const pollInterval = 2000; // 2 seconds
  let progress = 10;

  const poll = async () => {
    try {
      const response = await fetch(`/api/status/${jobId}`);
      const status = await response.json();

      if (status.status === "processing") {
        // Update progress. While downloading segments, scale linearly with
        // actual song count (status.progressCurrent/progressTotal) so a
        // 150-song mix doesn't look nearly done after song 4. Reserve the
        // top of the bar for the final combine-audio step, which has no
        // song count of its own.
        if (status.progressTotal) {
          progress = Math.max(
            progress,
            5 + Math.round((status.progressCurrent / status.progressTotal) * 85)
          );
        } else {
          progress = Math.max(progress, 95);
        }
        elements.progressFill.style.width = `${progress}%`;
        elements.progressText.textContent = status.progress || "Processing...";

        // Continue polling
        setTimeout(poll, pollInterval);
      } else if (status.status === "complete") {
        // Success!
        elements.progressFill.style.width = "100%";
        elements.progressText.textContent = "Complete!";

        setTimeout(() => {
          elements.progressContainer.classList.add("hidden");
          elements.downloadSection.classList.remove("hidden");
          elements.downloadLink.href = `/api/download/${jobId}`;
          elements.downloadReportLink.href = `/api/download-report/${jobId}`;
          showFailedSongs(status.failedSegments);
          resetGenerateButton();
        }, 500);
      } else if (status.status === "error") {
        showGenerateError(status.error || "Unknown error");
        resetGenerateButton();
      }
    } catch (error) {
      console.error("Poll error:", error);
      showGenerateError(error.message || "Lost connection while checking generation status");
      resetGenerateButton();
    }
  };

  poll();
}

/**
 * Show the list of songs that were skipped because they failed to download
 */
function showFailedSongs(failedSegments) {
  if (!failedSegments || failedSegments.length === 0) {
    elements.failedSongsSection.classList.add("hidden");
    return;
  }

  elements.failedSongsCount.textContent = failedSegments.length;
  elements.failedSongsList.innerHTML = "";

  for (const failed of failedSegments) {
    const li = document.createElement("li");

    const titleSpan = document.createElement("span");
    titleSpan.textContent = failed.title || failed.youtubeUrl;
    li.appendChild(titleSpan);

    const reasonSpan = document.createElement("span");
    reasonSpan.className = "failed-song-reason";
    reasonSpan.textContent = failed.reason || "Failed to download";
    li.appendChild(reasonSpan);

    elements.failedSongsList.appendChild(li);
  }

  elements.failedSongsSection.classList.remove("hidden");
}

/**
 * Show a generation error message and hide the progress bar
 */
function showGenerateError(message) {
  elements.progressContainer.classList.add("hidden");
  elements.generateErrorText.textContent = message;
  elements.generateErrorSection.classList.remove("hidden");
}

/**
 * Reset generate button to initial state
 */
function resetGenerateButton() {
  state.isGenerating = false;
  elements.generateBtn.classList.remove("loading");
  elements.generateBtn.innerHTML =
    '<span class="btn-icon">✨</span> Generate Random Dance';
  updateGenerateButton();
}

/**
 * The first thing stopping Generate, or null if the mix is ready.
 * `index`/`field` point at the song and input to fix.
 */
function findGenerateProblem() {
  for (let i = 0; i < state.songs.length; i++) {
    const song = state.songs[i];
    const startSec = parseTimeSeconds(song.startTime);
    const endSec = parseTimeSeconds(song.endTime);
    if (startSec === null) {
      return { index: i, field: "startTime", message: `Song #${i + 1}: start time isn't a time (use m:ss)` };
    }
    if (endSec === null) {
      return { index: i, field: "endTime", message: `Song #${i + 1}: end time isn't a time (use m:ss)` };
    }
    if (endSec <= startSec) {
      return { index: i, field: "endTime", message: `Song #${i + 1}: end must be after start` };
    }
  }

  const hasValidSongs = state.songs.some(
    (song) => song.youtubeUrl && song.youtubeUrl.trim() !== "",
  );
  if (!hasValidSongs) {
    // The normal starting point, not an error
    return { index: -1, message: "Add at least one song with a YouTube link" };
  }
  return null;
}

/**
 * Enable or disable Generate, and say why it's disabled
 */
function updateGenerateButton() {
  // Every edit to the list ends up here, so it's also where the draft is saved
  scheduleDraftSave();

  const problem = findGenerateProblem();
  elements.generateBtn.disabled = !!problem || state.isGenerating;

  const hint = elements.generateHint;
  const link = hint.querySelector(".generate-hint-link");
  if (!problem || state.isGenerating) {
    hint.classList.add("hidden");
    return;
  }
  hint.querySelector(".generate-hint-text").textContent = problem.message;
  hint.classList.toggle("problem", problem.index >= 0);
  link.classList.toggle("hidden", problem.index < 0);
  link.onclick = () => showProblemInput(problem);
  hint.classList.remove("hidden");
}

/**
 * "Show me": scroll to the card with the problem and focus its time input
 */
function showProblemInput(problem) {
  const card = elements.songList.querySelectorAll(".song-card")[problem.index];
  if (!card) return;
  const input = card.querySelector(problem.field === "startTime" ? ".start-time" : ".end-time");
  card.scrollIntoView({ block: "center", behavior: smoothScroll() });
  input.focus({ preventScroll: true });
  input.classList.remove("flash");
  void input.offsetWidth; // restart the animation
  input.classList.add("flash");
}

/** "smooth", unless the user asked for less motion */
function smoothScroll() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Show (or with "" clear) a lookup error on a song card
 */
function showSongError(card, message) {
  const el = card.querySelector(".song-error");
  el.textContent = message;
  el.classList.toggle("hidden", !message);
}

/**
 * Format seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Check if a URL is a valid YouTube URL
 */
function isValidYouTubeUrl(url) {
  if (!url) return false;
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=[\w-]+/,
    /^https?:\/\/youtu\.be\/[\w-]+/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\/[\w-]+/,
  ];
  return patterns.some((pattern) => pattern.test(url));
}

/**
 * Clean a YouTube URL by removing unnecessary parameters
 * Keeps only the video ID
 */
function cleanYouTubeUrl(url) {
  if (!url) return url;

  try {
    // Handle youtu.be short URLs
    const shortMatch = url.match(/youtu\.be\/([\w-]+)/);
    if (shortMatch) {
      return `https://www.youtube.com/watch?v=${shortMatch[1]}`;
    }

    // Handle youtube.com/shorts URLs
    const shortsMatch = url.match(/youtube\.com\/shorts\/([\w-]+)/);
    if (shortsMatch) {
      return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
    }

    // Handle regular youtube.com URLs
    const urlObj = new URL(url);
    if (urlObj.hostname.includes("youtube.com")) {
      const videoId = urlObj.searchParams.get("v");
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
  } catch (e) {
    // Invalid URL, return as-is
  }

  return url;
}

/**
 * Rebuild every card from state.songs (after a reorder, a view change or a
 * load). Cards are replaced, so card references held elsewhere go stale.
 */
function rebuildSongList() {
  state.songs.forEach((songData) => destroyPreviewPlayer(songData));
  document.querySelectorAll(".song-card").forEach((card) => card.remove());

  state.songs.forEach((songData, index) => insertSongCard(songData, index));
  renumberCards();

  updateGenerateButton();
  updateStats();
}

/**
 * Show/hide drag hint based on song count
 */
function updateDragHint() {
  if (state.songs.length >= 2) {
    elements.dragHint.classList.add("visible");
  } else {
    elements.dragHint.classList.remove("visible");
  }
}

/**
 * "Shuffle": put the songs in a random order, on screen, so the numbers
 * match the MP3. Where possible the same group never plays twice in a row.
 * Undo puts the old order back.
 */
function shuffleSongs() {
  if (state.songs.length < 2) return;
  const previous = [...state.songs];

  state.songs = spreadOutGroups(shuffleArray([...state.songs]));
  rebuildSongList();

  showToast(`Shuffled ${state.songs.length} songs`, {
    actionLabel: "Undo",
    onAction: () => {
      // Only if the list is still the same set of songs
      if (previous.length !== state.songs.length || !previous.every((s) => state.songs.includes(s))) return;
      state.songs = previous;
      rebuildSongList();
    },
  });
}

/**
 * Reorder (an already shuffled list) so no group plays twice in a row where
 * that's possible. Songs are taken in shuffled order, skipping ones from the
 * group that just played, except when one group has so many songs left that
 * it must go now for the rest to work out. Songs whose group isn't known
 * never count as a repeat.
 */
function spreadOutGroups(songs) {
  const groupOf = (song, i) => {
    const band = song.info ? identifyBand(song.info.title, song.info.channel) : "Unknown";
    return band === "Unknown" ? `#${i}` : band.toLowerCase();
  };
  let remaining = songs.map((song, i) => ({ song, group: groupOf(song, i) }));
  const result = [];
  let last = null;

  while (remaining.length > 0) {
    const counts = new Map();
    remaining.forEach(({ group }) => counts.set(group, (counts.get(group) || 0) + 1));

    // A group with more than half of what's left (after this pick) can't
    // wait: picking anything else would force a repeat later
    const limit = Math.ceil((remaining.length - 1) / 2);
    const forced = [...counts].find(([group, count]) => group !== last && count > limit);

    let pick = forced
      ? remaining.findIndex(({ group }) => group === forced[0])
      : remaining.findIndex(({ group }) => group !== last);
    if (pick === -1) pick = 0; // only the last group is left: a repeat can't be avoided

    result.push(remaining[pick].song);
    last = remaining[pick].group;
    remaining = remaining.filter((_, k) => k !== pick);
  }
  return result;
}

/**
 * Shuffle an array using Fisher-Yates algorithm
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Export project to JSON file
 */
function exportProject() {
  const projectData = {
    version: "1.0",
    timestamp: new Date().toISOString(),
    songs: state.songs,
  };

  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(projectData, null, 2));
  const downloadAnchorNode = document.createElement("a");
  downloadAnchorNode.setAttribute("href", dataStr);
  downloadAnchorNode.setAttribute("download", "kpop-dance-project.json");
  document.body.appendChild(downloadAnchorNode); // required for firefox
  downloadAnchorNode.click();
  downloadAnchorNode.remove();
}

/**
 * Import project from JSON file
 */
function importProject(event) {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const contents = e.target.result;
      const projectData = JSON.parse(contents);

      // Basic validation
      if (!projectData.songs || !Array.isArray(projectData.songs)) {
        throw new Error("Invalid project file format");
      }

      // Restore state. The file's cuts are the user's: never prefill over them.
      state.songs = projectData.songs.map((song) => ({
        ...song,
        cutSource: song.cutSource || "import",
      }));

      // Update UI
      hideToast(); // an Undo from before would act on the old list
      hideDraftBanner();
      rebuildSongList();

      showToast(`Loaded project (${state.songs.length} songs)`);
    } catch (error) {
      console.error("Import error:", error);
      showToast("Couldn't load that project file: " + error.message);
    }

    // Reset file input so same file can be selected again
    event.target.value = "";
  };
  reader.readAsText(file);
}

/**
 * Decide what the page starts with: a ready-made mix handed over from a
 * landing page, the draft saved from the last visit, or one empty card. A
 * ready-made mix only replaces a saved draft if the user says so.
 */
function startMix() {
  const mix = takePendingMix();
  const draft = readDraft();

  try {
    if (mix && draft) {
      restoreDraft(draft, { banner: false });
      askToReplaceDraft(mix, draft.songs.length);
    } else if (mix) {
      loadMix(mix);
    } else if (draft) {
      restoreDraft(draft);
    } else {
      addSong();
    }
  } catch (error) {
    // A draft this version can't read must not break the page on every visit
    console.error("Failed to restore the saved mix:", error);
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      // Blocked storage: nothing saved to remove
    }
    hideDraftBanner();
    restoredDraftSignature = null;
    state.songs = [];
    rebuildSongList();
    // A ready-made mix handed over at the same time is still opened
    if (mix) loadMix(mix);
    else addSong();
  }
  draftSavingEnabled = true;
}

function askToReplaceDraft(mix, savedCount) {
  elements.replaceMixText.textContent =
    `You have a saved mix with ${savedCount} song${savedCount === 1 ? "" : "s"}. ` +
    `Opening the ready-made mix (${mix.songs.length} songs) will replace it.`;
  elements.openReadyMixBtn.onclick = () => {
    closeModal(elements.replaceMixModal);
    loadMix(mix);
    saveDraft();
  };
  elements.keepMyMixBtn.onclick = () => closeModal(elements.replaceMixModal);
  // Escape or closing keeps the saved mix
  openModal(elements.replaceMixModal);
}

/**
 * Autosave: the songs (not players or handlers) go to localStorage shortly
 * after every change, so a refresh or the back button doesn't lose the mix.
 * Storage can be blocked or full; then the page just works without it.
 */
const DRAFT_KEY = "kpopgen:draft";
const SETTINGS_KEY = "kpopgen:settings";
let draftSavingEnabled = false; // off until startMix() has run
let draftSaveTimer = null;
let restoredDraftSignature = null; // to hide the banner on the first edit

function scheduleDraftSave() {
  if (!draftSavingEnabled) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraft, 300);
}

function draftSongs() {
  return state.songs
    .filter((song) => song.youtubeUrl && song.youtubeUrl.trim())
    .map((song) => ({
      youtubeUrl: song.youtubeUrl,
      title: song.title || "",
      startTime: song.startTime,
      endTime: song.endTime,
      cutSource: song.cutSource || null,
      popularUses: song.popularUses || null,
      info: song.info
        ? {
            title: song.info.title,
            thumbnail: song.info.thumbnail,
            channel: song.info.channel,
            duration: song.info.duration,
          }
        : null,
    }));
}

/** Which songs, in which order, with which cuts */
function draftSignature(songs = draftSongs()) {
  return JSON.stringify(songs.map((s) => [s.youtubeUrl, s.startTime, s.endTime]));
}

function saveDraft() {
  clearTimeout(draftSaveTimer);
  if (!draftSavingEnabled) return;

  const songs = draftSongs();
  if (restoredDraftSignature !== null && draftSignature(songs) !== restoredDraftSignature) {
    restoredDraftSignature = null;
    hideDraftBanner();
  }

  try {
    if (songs.length === 0) {
      localStorage.removeItem(DRAFT_KEY);
    } else {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), songs }));
    }
  } catch (error) {
    // Private mode, blocked or full storage: nothing to do
  }
}

function readDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (draft && Array.isArray(draft.songs) && draft.songs.length > 0) return draft;
  } catch (error) {
    // Blocked storage or a damaged entry: start without it
  }
  return null;
}

function restoreDraft(draft, { banner = true } = {}) {
  state.songs = draft.songs
    .filter((song) => song && typeof song.youtubeUrl === "string")
    .map((song) => ({
      youtubeUrl: song.youtubeUrl,
      title: song.title || "",
      startTime: song.startTime || "0:00",
      endTime: song.endTime || "0:30",
      // A restored cut is the user's: never prefill over it
      cutSource: song.cutSource || "draft",
      popularUses: song.popularUses || null,
      // So a popular cut is dropped if the card is switched to another video
      popularCutFor: song.cutSource === "popular" ? song.youtubeUrl : undefined,
      info: song.info && song.info.duration ? song.info : null,
      isExpanded: !state.compactViewEnabled,
    }));
  if (state.songs.length === 0) {
    addSong();
    return;
  }

  rebuildSongList();
  lookUpMissingInfo();
  restoredDraftSignature = draftSignature();
  if (banner) {
    const n = state.songs.length;
    showDraftBanner(`Restored your mix (${n} song${n === 1 ? "" : "s"})`);
  }
}

function showDraftBanner(message) {
  elements.draftBanner.querySelector(".draft-banner-text").textContent = message;
  elements.draftBanner.classList.remove("hidden");
}

function hideDraftBanner() {
  elements.draftBanner.classList.add("hidden");
}

/**
 * Clear the list (from the restore banner), with Undo
 */
function startFresh() {
  const previous = state.songs;
  hideDraftBanner();
  restoredDraftSignature = null;

  previous.forEach((songData) => destroyPreviewPlayer(songData));
  state.songs = [];
  rebuildSongList();
  addSong();
  saveDraft();

  showToast("Started a new mix", {
    actionLabel: "Undo",
    onAction: () => {
      state.songs.forEach((songData) => destroyPreviewPlayer(songData));
      state.songs = previous;
      rebuildSongList();
      saveDraft();
    },
  });
}

/**
 * Remembered view settings
 */
function applySavedSettings() {
  let settings = {};
  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch (error) {
    // Blocked storage: defaults
  }
  state.compactViewEnabled = settings.compactView === true;
  elements.compactViewToggle.checked = state.compactViewEnabled;
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ compactView: state.compactViewEnabled }),
    );
  } catch (error) {
    // Blocked storage: not remembered
  }
}

/**
 * Look up titles, thumbnails and durations for songs that don't have them.
 * Staggered because each lookup spawns a yt-dlp process on the server and a
 * ten-song mix would otherwise fire ten at once. The card is looked up when
 * the timer fires, because fetchBands() may rebuild the list (replacing
 * every card) in the meantime.
 */
function lookUpMissingInfo() {
  state.songs
    .filter((songData) => songData.youtubeUrl && !songData.info)
    .forEach((songData, i) => {
      setTimeout(() => {
        const card = findCardForSong(songData);
        if (card && !songData.info) fetchVideoInfo(card, songData);
      }, i * 400);
    });
}

/**
 * Take the ready-made mix a /random-dance/ landing page handed over, if any.
 * It's removed straight away so a refresh doesn't import it again.
 */
function takePendingMix() {
  let raw = null;
  try {
    raw = sessionStorage.getItem("pendingMix");
    sessionStorage.removeItem("pendingMix");
  } catch (error) {
    return null; // storage blocked; nothing handed over
  }
  if (!raw) return null;

  try {
    const mix = JSON.parse(raw);
    if (!mix || !Array.isArray(mix.songs) || mix.songs.length === 0) return null;
    return mix;
  } catch (error) {
    console.error("Failed to read ready-made mix:", error);
    return null;
  }
}

/**
 * Load a ready-made mix. The payload is the same shape as an exported
 * project file, minus the video metadata -- the landing pages only know the
 * URL and the cut points, so the titles and thumbnails are fetched here.
 */
function loadMix(mix) {
  hideToast(); // an Undo from before would act on the old list
  hideDraftBanner();
  restoredDraftSignature = null;
  state.songs.forEach((songData) => destroyPreviewPlayer(songData));

  state.songs = mix.songs.map((song) => ({
    youtubeUrl: song.youtubeUrl || "",
    title: song.title || "",
    startTime: song.startTime || "0:00",
    endTime: song.endTime || "0:30",
    cutSource: "mix", // never replaced by a popular cut
    info: null,
    isExpanded: !state.compactViewEnabled,
  }));
  rebuildSongList();
  lookUpMissingInfo();

  // The mix plays in the order shown (the landing pages already shuffled
  // it); point out the button for a fresh order
  showToast("Tip: press Shuffle for a new random order");
}

/**
 * Validate time format (MM:SS or HH:MM:SS) and values
 */
function validateTimeInput(timeStr) {
  if (!timeStr) return false;

  // Check format
  const timeRegex =
    /^(\d+:)?([0-5]?\d):([0-5]\d)$|^([0-5]?\d):([0-5]\d)$|^\d+$/;
  // This regex allows: H:MM:SS, MM:SS, M:SS, or just seconds

  // Simpler approach: split by colon
  const parts = timeStr.split(":").map(Number);

  if (parts.some(isNaN)) return false;

  if (parts.length === 1) {
    // Just seconds
    return parts[0] >= 0;
  } else if (parts.length === 2) {
    // MM:SS
    const [mins, secs] = parts;
    return mins >= 0 && secs >= 0 && secs <= 59;
  } else if (parts.length === 3) {
    // HH:MM:SS
    const [hrs, mins, secs] = parts;
    return hrs >= 0 && mins >= 0 && secs >= 0 && secs <= 59 && mins <= 59;
  }

  return false;
}

/**
 * Parse time string to seconds
 */
function parseTimeSeconds(timeStr) {
  if (!timeStr) return null;

  const parts = timeStr.split(":").map(Number);
  if (parts.some(isNaN)) return null;

  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];

  return null;
}

/**
 * Check validity of start/end times for a card
 */
function checkTimeValidity(card, songData) {
  const startTimeInput = card.querySelector(".start-time");
  const endTimeInput = card.querySelector(".end-time");

  const isStartValid = validateTimeInput(songData.startTime);
  const isEndValid = validateTimeInput(songData.endTime);

  const startSec = parseTimeSeconds(songData.startTime);
  const endSec = parseTimeSeconds(songData.endTime);

  // Check format validity
  if (!isStartValid) startTimeInput.classList.add("invalid");
  else startTimeInput.classList.remove("invalid");

  if (!isEndValid) endTimeInput.classList.add("invalid");
  else endTimeInput.classList.remove("invalid");

  // Check logical validity (End > Start)
  if (isStartValid && isEndValid && startSec !== null && endSec !== null) {
    if (endSec <= startSec) {
      endTimeInput.classList.add("invalid");
      startTimeInput.classList.add("invalid");
    } else {
      // Only remove if individual format is valid
      if (isStartValid) startTimeInput.classList.remove("invalid");
      if (isEndValid) endTimeInput.classList.remove("invalid");
    }
  }
}

/**
 * Prefill a new song with the community's most common cut for its video
 * (3+ uses), unless the cut was already set: by the user, a landing-page
 * mix, a saved draft or a project file. Asked once per video per song.
 */
async function applyPopularCut(songData) {
  const url = songData.youtubeUrl;
  if (!canPrefillCut(songData) || !url || songData.popularCutFor === url) return;
  songData.popularCutFor = url;

  try {
    const response = await fetch(`/api/popular-cut?url=${encodeURIComponent(url)}`);
    if (!response.ok) return;
    const { cut } = await response.json();

    // Things may have moved on while the request was out
    if (!cut || songData.youtubeUrl !== url || !canPrefillCut(songData)) return;
    const duration = songData.info && songData.info.duration;
    if (duration && parseTimeSeconds(cut.endTime) > duration) return;

    songData.startTime = cut.startTime;
    songData.endTime = cut.endTime;
    songData.cutSource = "popular";
    songData.popularUses = cut.uses;

    const card = findCardForSong(songData);
    if (card) {
      card.querySelector(".start-time").value = cut.startTime;
      card.querySelector(".end-time").value = cut.endTime;
      if (duration) updateTimelinePositions(card, songData, duration);
      seekPreviewPlayer(songData, parseTimeSeconds(cut.startTime));
      checkTimeValidity(card, songData);
      renderCutSource(card, songData);
    }
    updateGenerateButton();
    updateStats();
  } catch (error) {
    console.warn("Popular cut lookup failed:", error);
  }
}

/** Only a cut nobody has chosen yet may be prefilled */
function canPrefillCut(songData) {
  return !songData.cutSource;
}

/**
 * The user changed the cut: it's theirs now, so drop the popular-cut note
 * and never prefill over it
 */
function markCutEdited(card, songData) {
  if (songData.cutSource === "user") return;
  songData.cutSource = "user";
  renderCutSource(card, songData);
}

/**
 * Show "★ Popular cut · used N times · Use 0:00–0:30" for prefilled cuts
 */
function renderCutSource(card, songData) {
  const isPopular = songData.cutSource === "popular";
  card.querySelector(".cut-source").classList.toggle("hidden", !isPopular);
  card.querySelector(".compact-star").classList.toggle("hidden", !isPopular);
  if (isPopular) {
    const uses = songData.popularUses;
    card.querySelector(".cut-source-text").textContent =
      `★ Popular cut · used ${uses} time${uses === 1 ? "" : "s"}`;
  }
}

/**
 * Back to the plain 0:00–0:30 default (end capped at the video's length)
 */
function resetCut(card, songData) {
  const duration = songData.info && songData.info.duration;
  setCutTime(card, songData, "startTime", 0);
  setCutTime(card, songData, "endTime", duration ? Math.min(30, duration) : 30);
  card.querySelector(".start-time").focus();
}

/**
 * Read digits as a time, for phone number pads (they have no colon):
 * "45" -> "0:45", "123" -> "1:23", "1234" -> "12:34". Anything else,
 * including 3-4 digits whose last two aren't valid seconds, is unchanged.
 */
function normalizeTimeInput(value) {
  const trimmed = value.trim();
  if (/^\d{1,2}$/.test(trimmed)) return formatDuration(Number(trimmed));
  const match = trimmed.match(/^(\d{1,2})(\d{2})$/);
  if (match && Number(match[2]) < 60) return `${Number(match[1])}:${match[2]}`;
  return value;
}

/**
 * Handle time input with auto-formatting
 */
function handleTimeInput(e, card, songData, field) {
  const value = normalizeTimeInput(e.target.value);
  songData[field] = value;

  // Update timeline if video info exists
  if (songData.info && songData.info.duration) {
    updateTimelinePositions(card, songData, songData.info.duration);
  }

  if (validateTimeInput(value)) {
    const seconds = parseTimeSeconds(value);
    if (seconds !== null) seekPreviewPlayer(songData, seconds);
  }

  markCutEdited(card, songData);

  checkTimeValidity(card, songData);
  updateGenerateButton();
  updateStats();
}

/**
 * Update the statistics bar
 */
function updateStats() {
  if (state.songs.length === 0) {
    elements.statsBar.classList.add("hidden");
    return;
  }

  elements.statsBar.classList.remove("hidden");

  let totalSeconds = 0;
  const bandCounts = {};
  const totalSongs = state.songs.length;

  state.songs.forEach((song) => {
    // Duration
    const start = parseTimeSeconds(song.startTime) || 0;
    const end = parseTimeSeconds(song.endTime) || 0;
    if (end > start) {
      totalSeconds += end - start;
      // Add countdown (5s) for each segment
      totalSeconds += 5;
    }
    console.log(`Song: ${song.title}, Duration: ${totalSeconds}`);
    // Band Variety counting
    let band = "Unknown";
    if (song.info) {
      band = identifyBand(song.info.title, song.info.channel);
    }
    bandCounts[band] = (bandCounts[band] || 0) + 1;
  });

  // Update UI - Duration
  elements.totalLengthVal.textContent = formatDuration(totalSeconds);

  // Update UI - Band Variety Summary
  const uniqueBandsCount = Object.keys(bandCounts).length;
  elements.totalSongs.textContent = `${totalSongs}`;

  // Render Detailed Breakdown
  renderBandBreakdown(bandCounts, totalSongs);
}

/**
 * Render the band breakdown list and variety bar
 */
function renderBandBreakdown(counts, total) {
  // Clear containers
  elements.bandBreakdown.innerHTML = "";
  elements.varietyBar.innerHTML = "";

  // Sort bands by count descending
  const sortedBands = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  // Colors for segments (a nice K-Pop palette)
  const colors = [
    "#a855f7", // Primary purple
    "#ec4899", // Pink
    "#06b6d4", // Cyan
    "#f59e0b", // Amber
    "#10b981", // Emerald
    "#3b82f6", // Blue
    "#ef4444", // Red
  ];

  sortedBands.forEach(([band, count], index) => {
    const percent = Math.round((count / total) * 100);
    const color = colors[index % colors.length];

    // Add to breakdown list
    const statItem = document.createElement("div");
    statItem.className = "band-stat";
    const dot = document.createElement("span");
    dot.className = "band-color-dot";
    dot.style.backgroundColor = color;
    const name = document.createElement("span");
    name.className = "band-name";
    name.textContent = band;
    const percentEl = document.createElement("span");
    percentEl.className = "band-percent";
    percentEl.textContent = `${percent}%`;
    statItem.append(dot, name, percentEl);
    elements.bandBreakdown.appendChild(statItem);

    // Add to variety bar
    const segment = document.createElement("div");
    segment.className = "variety-segment";
    segment.style.width = `${(count / total) * 100}%`;
    segment.style.backgroundColor = color;
    segment.title = `${band}: ${percent}%`;
    elements.varietyBar.appendChild(segment);
  });
}

/**
 * Perform YouTube search via API
 */
let latestSearch = 0;

async function performSearch(query) {
  elements.searchLoading.classList.remove("hidden");
  // A slow reply (e.g. a pasted link's lookup) mustn't replace newer results
  const searchId = ++latestSearch;
  const isCurrent = () => searchId === latestSearch;

  try {
    // A pasted YouTube link: show that one video, ready to add
    const url = cleanYouTubeUrl(query);
    if (isValidYouTubeUrl(url)) {
      const response = await fetch(`/api/youtube/info?url=${encodeURIComponent(url)}`);
      if (!isCurrent()) return;
      if (!response.ok) {
        elements.searchResults.innerHTML =
          '<div class="search-empty"><p>Couldn\'t load this video: private or removed?</p></div>';
        return;
      }
      const info = await response.json();
      if (isCurrent()) displaySearchResults([{ ...info, url }]);
      return;
    }

    const response = await fetch(
      `/api/youtube/search?q=${encodeURIComponent(query)}`,
    );
    if (!response.ok) throw new Error("Search failed");

    const results = await response.json();
    if (isCurrent()) displaySearchResults(results);
  } catch (error) {
    console.error("Search error:", error);
    if (isCurrent()) {
      elements.searchResults.innerHTML =
        '<div class="search-empty"><p>Error searching YouTube</p></div>';
    }
  } finally {
    if (isCurrent()) elements.searchLoading.classList.add("hidden");
  }
}

/**
 * Display search results in the sidebar
 */
function displaySearchResults(results) {
  elements.searchResults.innerHTML = "";

  if (!results || results.length === 0) {
    elements.searchResults.innerHTML =
      '<div class="search-empty"><p>No results found</p></div>';
    return;
  }

  results.forEach((result) => {
    const template = elements.searchResultTemplate.content.cloneNode(true);
    const item = template.querySelector(".search-result-item");

    item.querySelector(".result-thumbnail img").src = result.thumbnail;
    item.querySelector(".result-duration").textContent = formatDuration(
      result.duration,
    );
    item.querySelector(".result-title").textContent = result.title;
    item.querySelector(".result-channel").textContent = result.channel;

    item
      .querySelector(".btn-add-result")
      .setAttribute("aria-label", `Add ${result.title} to mix`);
    item.querySelector(".btn-add-result").addEventListener("click", () => {
      addSearchResultToProject(result);
    });

    elements.searchResults.appendChild(item);
  });
}

/**
 * Load top songs from analytics
 */
async function loadTopSongs() {
  elements.topSongsLoading.classList.remove("hidden");
  elements.topSongsList.innerHTML = "";

  try {
    const response = await fetch("/api/top-songs");
    if (!response.ok) throw new Error("Failed to fetch top songs");

    const topSongs = await response.json();
    displayTopSongs(topSongs);
  } catch (error) {
    console.error("Error loading top songs:", error);
    elements.topSongsList.innerHTML =
      '<div class="top-songs-empty"><p>Unable to load top songs</p></div>';
  } finally {
    elements.topSongsLoading.classList.add("hidden");
  }
}

/**
 * Display top songs in the sidebar
 */
function displayTopSongs(topSongs) {
  elements.topSongsList.innerHTML = "";

  if (!topSongs || topSongs.length === 0) {
    elements.topSongsList.innerHTML =
      '<div class="top-songs-empty"><p>No songs generated yet</p></div>';
    return;
  }

  topSongs.forEach((song, index) => {
    const songItem = document.createElement("div");
    songItem.className = "top-song-item";

    // Extract YouTube video ID for thumbnail
    const videoId = extractYouTubeVideoId(song.youtube_url);
    const thumbnail = videoId 
      ? `https://img.youtube.com/vi/${videoId}/default.jpg`
      : "";

    // Built with DOM APIs: titles come from user-submitted mixes.
    const rank = document.createElement("div");
    rank.className = `top-song-rank ${index < 3 ? "top-3" : ""}`;
    rank.textContent = index + 1;

    const thumbBox = document.createElement("div");
    thumbBox.className = "top-song-thumbnail";
    const img = document.createElement("img");
    img.src = thumbnail;
    img.alt = "";
    thumbBox.appendChild(img);

    const info = document.createElement("div");
    info.className = "top-song-info";
    const title = document.createElement("div");
    title.className = "top-song-title";
    title.textContent = song.title || "Unknown Title";
    const used = document.createElement("div");
    used.className = "top-song-channel";
    used.textContent = `Used ${song.count} time${song.count > 1 ? "s" : ""}`;
    info.append(title, used);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "top-song-add-btn";
    addBtn.title = "Add to mix";
    addBtn.setAttribute("aria-label", `Add ${song.title || "this song"} to mix`);
    addBtn.textContent = "+";

    songItem.append(rank, thumbBox, info, addBtn);

    // Add click event to add song
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addTopSongToProject(song);
    });

    // Also allow clicking the whole item
    songItem.addEventListener("click", () => {
      addTopSongToProject(song);
    });

    elements.topSongsList.appendChild(songItem);
  });
}

/**
 * Extract YouTube video ID from URL
 */
function extractYouTubeVideoId(url) {
  if (!url) return null;
  
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]+)/,
    /(?:youtu\.be\/)([\w-]+)/,
    /(?:youtube\.com\/shorts\/)([\w-]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Add a top song to the project. Top Songs don't know the video's length,
 * so the card shows what we have and the real details are looked up.
 */
function addTopSongToProject(song) {
  const videoId = extractYouTubeVideoId(song.youtube_url);
  const result = {
    url: song.youtube_url,
    title: song.title || "Unknown Title",
    channel: "",
    thumbnail: videoId 
      ? `https://img.youtube.com/vi/${videoId}/default.jpg`
      : "",
    duration: null, // filled in by fetchVideoInfo below
  };

  const { card, songData } = addSearchResultToProject(result);
  fetchVideoInfo(card, songData);
}

/**
 * Add a selected search result to the project
 */
function addSearchResultToProject(result) {
  // Check if first song is empty, if so, use it
  let targetSong;
  if (
    state.songs.length === 1 &&
    !state.songs[0].youtubeUrl &&
    !state.songs[0].info
  ) {
    targetSong = state.songs[0];
    const firstCard = document.querySelector('.song-card[data-index="0"]');
    if (firstCard) {
      populateCardWithResult(firstCard, targetSong, result);
      showToast(`Added: ${result.title} (#1)`);
      return { card: firstCard, songData: targetSong };
    }
  }

  // Otherwise add a new song. No focus: on phones that would scroll away
  // from the search results and open the keyboard.
  const card = addSong();
  const songData = state.songs[state.songs.length - 1];
  populateCardWithResult(card, songData, result);
  showToast(`Added: ${result.title} (#${state.songs.length})`);
  return { card, songData };
}

function populateCardWithResult(card, songData, result) {
  const urlInput = card.querySelector(".url-input");
  urlInput.value = result.url;
  songData.youtubeUrl = result.url;

  // We already have the info from search, so we can populate immediately
  songData.info = {
    title: result.title,
    thumbnail: result.thumbnail,
    channel: result.channel,
    duration: result.duration,
  };
  songData.title = result.title;

  renderSongInfo(card, songData.info);

  // Set default end time (when the length is known; otherwise the lookup
  // that follows does it)
  if (result.duration) {
    const defaultEndSeconds = Math.min(30, result.duration);
    card.querySelector(".end-time").value = formatDuration(defaultEndSeconds);
    songData.endTime = formatDuration(defaultEndSeconds);
  }

  // Initialize timeline
  initTimeline(card, songData);
  initPreviewPlayer(card, songData);
  applyPopularCut(songData);

  updateGenerateButton();
  updateStats();
}

/**
 * Fetch the list of bands from the server
 */
async function fetchBands() {
  try {
    const response = await fetch("/api/bands");
    if (response.ok) {
      const text = await response.text();
      state.bandList = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      console.log(
        `✅ Loaded ${state.bandList.length} bands for variety matching`,
      );
      rebuildSongList();
    }
  } catch (error) {
    console.error("Failed to fetch band list:", error);
  }
}

/**
 * Identify the band from a song title and channel
 */
function identifyBand(title, channel) {
  if (!title) return "Unknown";
  if (!state.bandList || state.bandList.length === 0) {
    const parts = title.split(" - ");
    return parts.length > 1 ? parts[0] : channel || "Unknown";
  }

  // Sort by length descending to match more specific names first
  const sortedBands = [...state.bandList].sort((a, b) => b.length - a.length);

  // Helper to check for a match with word boundaries
  const checkMatch = (text, band) => {
    if (!text || !band) return false;
    // Escape band name for regex
    const escapedBand = band.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Handle special characters in K-Pop names by allowing them in boundaries
    const regex = new RegExp(
      `(^|[^a-zA-Z0-9])${escapedBand}([^a-zA-Z0-9]|$)`,
      "i",
    );
    return regex.test(text);
  };

  // Try title first
  for (const band of sortedBands) {
    if (checkMatch(title, band)) return band;
  }

  // Try channel if title doesn't match
  for (const band of sortedBands) {
    if (checkMatch(channel, band)) return band;
  }

  // Fallback to title split
  const parts = title.split(" - ");
  return parts.length > 1 ? parts[0] : channel || "Unknown";
}

/**
 * Destroy any existing YT.Player + sync interval for a song
 */
function destroyPreviewPlayer(songData) {
  const entry = previewPlayers.get(songData);
  if (!entry) return;

  if (entry.syncInterval) clearInterval(entry.syncInterval);
  try {
    entry.player.destroy();
  } catch (e) {
    // Player may already be torn down (e.g. iframe removed with its card)
  }
  previewPlayers.delete(songData);
}

/**
 * Pause playback for a song's preview player, if it exists
 */
function pausePreviewPlayer(songData) {
  const entry = previewPlayers.get(songData);
  if (entry && entry.player && typeof entry.player.pauseVideo === "function") {
    entry.player.pauseVideo();
  }
}

/**
 * Seek a song's preview player to a given time, if it exists
 */
function seekPreviewPlayer(songData, seconds) {
  const entry = previewPlayers.get(songData);
  if (entry && entry.player && typeof entry.player.seekTo === "function") {
    entry.player.seekTo(seconds, true);
  }
}

/**
 * Create (or recreate) the inline YouTube preview player for a song card
 */
function initPreviewPlayer(card, songData) {
  const wrapper = card.querySelector(".preview-player-wrapper");
  const playerBox = card.querySelector(".preview-player-box");
  const playBtn = card.querySelector(".btn-preview-play");
  const setStartBtn = card.querySelector(".btn-set-start");
  const setEndBtn = card.querySelector(".btn-set-end");
  const endingBtn = card.querySelector(".btn-play-ending");

  if (!wrapper || !songData.info || !songData.info.duration) return;

  const videoId = extractYouTubeVideoId(songData.youtubeUrl);
  if (!videoId) return;

  destroyPreviewPlayer(songData);

  // YT.Player replaces its mount element with an iframe, so the node can't
  // be reused across re-inits (e.g. re-fetching a URL) - give it a fresh one.
  playerBox.innerHTML = "";
  const mount = document.createElement("div");
  playerBox.appendChild(mount);

  playBtn.disabled = true;
  setStartBtn.disabled = true;
  setEndBtn.disabled = true;
  endingBtn.disabled = true;

  const timelineProgress = card.querySelector(".timeline-progress");
  if (timelineProgress) timelineProgress.style.width = "0%";

  const videoDuration = songData.info.duration;

  const create = () => {
    const player = new YT.Player(mount, {
      videoId,
      playerVars: { rel: 0, playsinline: 1 },
      events: {
        onReady: () => {
          playBtn.disabled = false;
          setStartBtn.disabled = false;
          setEndBtn.disabled = false;
          endingBtn.disabled = false;
        },
        onStateChange: (e) =>
          onPreviewStateChange(e, card, songData, videoDuration),
      },
    });
    previewPlayers.set(songData, { player, syncInterval: null });
  };

  if (ytApiReady && window.YT && window.YT.Player) {
    create();
  } else {
    ytApiPendingCallbacks.push(create);
  }
}

/**
 * Handle YouTube player state changes: sync the timeline playhead and
 * loop playback within the selected start/end segment
 */
function onPreviewStateChange(event, card, songData, videoDuration) {
  const entry = previewPlayers.get(songData);
  if (!entry) return;

  const playBtn = card.querySelector(".btn-preview-play");

  if (event.data === YT.PlayerState.PLAYING) {
    if (playBtn) {
      playBtn.textContent = "⏸";
      playBtn.setAttribute("aria-label", "Pause preview");
    }

    if (entry.syncInterval) clearInterval(entry.syncInterval);
    entry.syncInterval = setInterval(() => {
      const player = entry.player;
      if (!player || typeof player.getCurrentTime !== "function") return;

      const currentTime = player.getCurrentTime();
      const startTime = parseTimeSeconds(songData.startTime) || 0;
      const endTime = parseTimeSeconds(songData.endTime) || videoDuration;

      if (currentTime >= endTime) {
        player.seekTo(startTime, true);
        player.pauseVideo();
        return;
      }

      const timelineProgress = card.querySelector(".timeline-progress");
      if (timelineProgress) {
        const percent = Math.min(100, (currentTime / videoDuration) * 100);
        timelineProgress.style.width = `${percent}%`;
      }
    }, 250);
  } else {
    if (playBtn) {
      playBtn.textContent = "▶";
      playBtn.setAttribute("aria-label", "Play preview");
    }
    if (entry.syncInterval) {
      clearInterval(entry.syncInterval);
      entry.syncInterval = null;
    }
  }
}

/**
 * Play/pause the preview, starting from the segment's start time if the
 * player is currently outside the selected [start, end] range
 */
function togglePreviewPlayback(songData) {
  const entry = previewPlayers.get(songData);
  if (!entry || !entry.player) return;
  const player = entry.player;

  if (player.getPlayerState() === YT.PlayerState.PLAYING) {
    player.pauseVideo();
    return;
  }

  const startTime = parseTimeSeconds(songData.startTime) || 0;
  const endTime = parseTimeSeconds(songData.endTime) || 0;
  const currentTime = player.getCurrentTime();
  if (currentTime < startTime || currentTime >= endTime) {
    player.seekTo(startTime, true);
  }
  player.playVideo();
}

/**
 * Show/hide the embedded video box (playback is unaffected either way)
 */
function togglePreviewVideoVisibility(card) {
  const playerBox = card.querySelector(".preview-player-box");
  const toggleBtn = card.querySelector(".btn-preview-toggle");
  if (!playerBox || !toggleBtn) return;
  const nowHidden = playerBox.classList.toggle("hidden");
  toggleBtn.textContent = nowHidden ? "👁 Show video" : "🙈 Hide video";
}

/**
 * Set the song's start/end time from the preview player's current position
 */
function setTimeFromPlayer(card, songData, field) {
  const entry = previewPlayers.get(songData);
  if (!entry || !entry.player) return;

  setCutTime(card, songData, field, Math.floor(entry.player.getCurrentTime()), { seek: false });
}

/**
 * Move the start or end of the cut by `delta` seconds (the ±1s buttons),
 * staying inside the video and keeping the cut at least 1s long
 */
function nudgeTime(card, songData, field, delta) {
  const duration = songData.info && songData.info.duration ? songData.info.duration : Infinity;
  const start = parseTimeSeconds(songData.startTime) ?? 0;
  const end = parseTimeSeconds(songData.endTime) ?? 0;

  let next;
  if (field === "startTime") {
    next = Math.max(0, Math.min(start + delta, end - 1));
  } else {
    next = Math.min(duration, Math.max(end + delta, start + 1));
  }
  if (next === (field === "startTime" ? start : end)) return;

  if (field === "startTime") {
    setCutTime(card, songData, field, next);
  } else {
    // Seeking to the end itself would stop playback (the preview stops at
    // the end of the cut), so go to just before it: if the preview is
    // playing, the user hears the new ending straight away
    setCutTime(card, songData, field, next, { seek: false });
    seekPreviewPlayer(songData, Math.max(start, next - 3));
  }
}

/**
 * Write a new start/end time (in seconds) to the song, its input, the
 * timeline and the Generate check, and move the preview there
 */
function setCutTime(card, songData, field, seconds, { seek = true } = {}) {
  const formatted = formatDuration(seconds);
  songData[field] = formatted;

  const input = card.querySelector(field === "startTime" ? ".start-time" : ".end-time");
  if (input) input.value = formatted;

  if (songData.info && songData.info.duration) {
    updateTimelinePositions(card, songData, songData.info.duration);
  }
  if (seek) seekPreviewPlayer(songData, seconds);
  markCutEdited(card, songData);
  checkTimeValidity(card, songData);
  updateGenerateButton();
  updateStats();
}

/**
 * Play the last 3 seconds of the cut, to check where it ends (playback
 * stops at the end of the cut on its own)
 */
function playEnding(songData) {
  const entry = previewPlayers.get(songData);
  if (!entry || !entry.player) return;

  const start = parseTimeSeconds(songData.startTime) || 0;
  const end = parseTimeSeconds(songData.endTime) || 0;
  entry.player.seekTo(Math.max(start, end - 3), true);
  entry.player.playVideo();
}

/**
 * Initialize timeline component for a song card
 */
function initTimeline(card, songData) {
  console.log('🔍 initTimeline called', { 
    hasInfo: !!songData.info, 
    duration: songData.info?.duration,
    title: songData.info?.title 
  });

  const timelineWrapper = card.querySelector(".timeline-wrapper");
  const timelineTrack = card.querySelector(".timeline-track");
  const timelineRange = card.querySelector(".timeline-range");
  const startHandle = card.querySelector(".timeline-handle-start");
  const endHandle = card.querySelector(".timeline-handle-end");
  const timelineMarkers = card.querySelector(".timeline-markers");
  const timelineCurrentTime = card.querySelector(".timeline-current-time");
  const timelineDuration = card.querySelector(".timeline-duration");
  const timelineTotal = card.querySelector(".timeline-total");

  console.log('🔍 Timeline elements found:', {
    wrapper: !!timelineWrapper,
    track: !!timelineTrack,
    startHandle: !!startHandle,
    endHandle: !!endHandle
  });

  if (!songData.info || !songData.info.duration) {
    console.log('⚠️ No video info, hiding timeline');
    if (timelineWrapper) timelineWrapper.classList.add("hidden");
    return;
  }

  console.log('✅ Showing timeline for video:', songData.info.title);
  if (timelineWrapper) timelineWrapper.classList.remove("hidden");

  const videoDuration = songData.info.duration;
  console.log('📊 Video duration:', videoDuration, 'seconds');

  // Re-fetching a video re-runs this on the same card; drop the old handlers
  if (songData.timelineCleanup) songData.timelineCleanup();

  // Create markers
  renderTimelineMarkers(timelineMarkers, videoDuration);

  // Update timeline positions
  updateTimelinePositions(card, songData, videoDuration);

  // Mouse/Touch event handlers for start handle
  const onStartHandleDown = (e) => {
    e.preventDefault();
    startHandle.classList.add("dragging");
    handleTimelineDragStart(e, card, songData, "start", videoDuration);
  };

  // Mouse/Touch event handlers for end handle
  const onEndHandleDown = (e) => {
    e.preventDefault();
    endHandle.classList.add("dragging");
    handleTimelineDragStart(e, card, songData, "end", videoDuration);
  };

  // Click on track to jump
  const onTrackClick = (e) => {
    const rect = timelineTrack.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const clickTime = percentage * videoDuration;

    // Determine which handle to move (closer one)
    const startTime = parseTimeSeconds(songData.startTime) || 0;
    const endTime = parseTimeSeconds(songData.endTime) || 0;
    const distToStart = Math.abs(clickTime - startTime);
    const distToEnd = Math.abs(clickTime - endTime);

    if (distToStart < distToEnd) {
      // Move start handle
      const newStart = Math.min(clickTime, endTime - 1);
      songData.startTime = formatDuration(newStart);
      card.querySelector(".start-time").value = songData.startTime;
      seekPreviewPlayer(songData, newStart);
    } else {
      // Move end handle
      const newEnd = Math.max(clickTime, startTime + 1);
      songData.endTime = formatDuration(newEnd);
      card.querySelector(".end-time").value = songData.endTime;
      seekPreviewPlayer(songData, newEnd);
    }

    updateTimelinePositions(card, songData, videoDuration);
    markCutEdited(card, songData);
    checkTimeValidity(card, songData);
    updateGenerateButton();
    updateStats();
  };

  startHandle.addEventListener("mousedown", onStartHandleDown);
  startHandle.addEventListener("touchstart", onStartHandleDown);

  endHandle.addEventListener("mousedown", onEndHandleDown);
  endHandle.addEventListener("touchstart", onEndHandleDown);

  timelineTrack.addEventListener("click", onTrackClick);

  // Keyboard navigation
  const onStartHandleKey = (e) =>
    handleTimelineKeydown(e, card, songData, "start", videoDuration);
  const onEndHandleKey = (e) =>
    handleTimelineKeydown(e, card, songData, "end", videoDuration);
  startHandle.addEventListener("keydown", onStartHandleKey);
  endHandle.addEventListener("keydown", onEndHandleKey);

  // Store cleanup function
  songData.timelineCleanup = () => {
    startHandle.removeEventListener("mousedown", onStartHandleDown);
    startHandle.removeEventListener("touchstart", onStartHandleDown);
    endHandle.removeEventListener("mousedown", onEndHandleDown);
    endHandle.removeEventListener("touchstart", onEndHandleDown);
    timelineTrack.removeEventListener("click", onTrackClick);
    startHandle.removeEventListener("keydown", onStartHandleKey);
    endHandle.removeEventListener("keydown", onEndHandleKey);
  };
}

/**
 * Render timeline markers based on duration
 */
function renderTimelineMarkers(container, duration) {
  container.innerHTML = "";

  // Calculate marker intervals based on duration
  let majorInterval, minorInterval;
  if (duration <= 60) {
    majorInterval = 10;
    minorInterval = 5;
  } else if (duration <= 300) {
    majorInterval = 30;
    minorInterval = 10;
  } else if (duration <= 600) {
    // For songs 10 minutes or less
    majorInterval = 60;
    minorInterval = 20;
  } else if (duration <= 1800) {
    // For songs 30 minutes or less
    majorInterval = 300; // 5 minutes
    minorInterval = 60;  // 1 minute
  } else {
    // For very long content (> 30 minutes)
    majorInterval = 600; // 10 minutes
    minorInterval = 120; // 2 minutes
  }

  // Add markers - ensure we don't exceed the video duration
  const markerCount = Math.floor(duration / minorInterval);
  
  for (let i = 0; i <= markerCount; i++) {
    const time = i * minorInterval;
    
    // Skip if time exceeds duration
    if (time > duration) break;
    
    const marker = document.createElement("div");
    marker.className = `timeline-marker ${time % majorInterval === 0 ? "major" : ""}`;
    
    if (time % majorInterval === 0) {
      marker.textContent = formatDuration(time);
    }
    
    container.appendChild(marker);
  }
  
  // Always add a final marker at the exact end if it's not already there
  const lastMarkerTime = markerCount * minorInterval;
  if (lastMarkerTime < duration && duration - lastMarkerTime > minorInterval * 0.2) {
    // Add end marker if there's significant time remaining (> 20% of interval)
    const endMarker = document.createElement("div");
    endMarker.className = "timeline-marker";
    endMarker.textContent = formatDuration(duration);
    container.appendChild(endMarker);
  }
}

/**
 * Update timeline handle positions based on current times
 */
function updateTimelinePositions(card, songData, videoDuration) {
  const timelineRange = card.querySelector(".timeline-range");
  const startHandle = card.querySelector(".timeline-handle-start");
  const endHandle = card.querySelector(".timeline-handle-end");
  const timelineCurrentTime = card.querySelector(".timeline-current-time");
  const timelineDuration = card.querySelector(".timeline-duration");
  const timelineTotal = card.querySelector(".timeline-total");

  const startTime = parseTimeSeconds(songData.startTime) || 0;
  const endTime = parseTimeSeconds(songData.endTime) || 0;
  const duration = Math.max(0, endTime - startTime);

  const startPercent = (startTime / videoDuration) * 100;
  const endPercent = (endTime / videoDuration) * 100;

  // Update range
  timelineRange.style.left = `${startPercent}%`;
  timelineRange.style.width = `${Math.max(0, endPercent - startPercent)}%`;

  // Update handles
  startHandle.style.left = `${startPercent}%`;
  endHandle.style.left = `${endPercent}%`;

  // Update ARIA values (in seconds, read out as m:ss)
  for (const [handle, seconds] of [[startHandle, startTime], [endHandle, endTime]]) {
    handle.setAttribute("aria-valuemax", Math.round(videoDuration));
    handle.setAttribute("aria-valuenow", Math.round(seconds));
    handle.setAttribute("aria-valuetext", formatDuration(seconds));
  }

  // Update time displays
  timelineCurrentTime.textContent = formatDuration(startTime);
  timelineDuration.textContent = `Duration: ${formatDuration(duration)}`;
  timelineTotal.textContent = `Total: ${formatDuration(videoDuration)}`;

  // Validate and show error state
  const timelineTrack = card.querySelector(".timeline-track");
  if (endTime <= startTime) {
    timelineTrack.classList.add("invalid");
  } else {
    timelineTrack.classList.remove("invalid");
  }
}

/**
 * Handle timeline drag start
 */
function handleTimelineDragStart(e, card, songData, handleType, videoDuration) {
  const timelineTrack = card.querySelector(".timeline-track");
  const startHandle = card.querySelector(".timeline-handle-start");
  const endHandle = card.querySelector(".timeline-handle-end");
  const tooltip = document.createElement("div");
  tooltip.className = "timeline-tooltip";

  if (handleType === "start") {
    startHandle.appendChild(tooltip);
  } else {
    endHandle.appendChild(tooltip);
  }

  const handleMove = (moveEvent) => {
    handleTimelineDrag(moveEvent, card, songData, handleType, videoDuration, tooltip);
  };

  const handleUp = () => {
    document.removeEventListener("mousemove", handleMove);
    document.removeEventListener("mouseup", handleUp);
    document.removeEventListener("touchmove", handleMove);
    document.removeEventListener("touchend", handleUp);

    startHandle.classList.remove("dragging");
    endHandle.classList.remove("dragging");
    tooltip.remove();

    const finalTime = parseTimeSeconds(
      songData[handleType === "start" ? "startTime" : "endTime"],
    );
    if (finalTime !== null) seekPreviewPlayer(songData, finalTime);

    markCutEdited(card, songData);

    checkTimeValidity(card, songData);
    updateGenerateButton();
    updateStats();
  };

  document.addEventListener("mousemove", handleMove);
  document.addEventListener("mouseup", handleUp);
  document.addEventListener("touchmove", handleMove);
  document.addEventListener("touchend", handleUp);
}

/**
 * Handle timeline drag movement
 */
function handleTimelineDrag(e, card, songData, handleType, videoDuration, tooltip) {
  const clientX = e.type.includes("touch") ? e.touches[0].clientX : e.clientX;
  const timelineTrack = card.querySelector(".timeline-track");
  const rect = timelineTrack.getBoundingClientRect();

  let percentage = (clientX - rect.left) / rect.width;
  percentage = Math.max(0, Math.min(1, percentage));

  const newTime = percentage * videoDuration;
  const startTime = parseTimeSeconds(songData.startTime) || 0;
  const endTime = parseTimeSeconds(songData.endTime) || 0;

  if (handleType === "start") {
    // Don't allow start handle to cross end handle
    const maxStart = Math.max(0, endTime - 1);
    const clampedTime = Math.min(newTime, maxStart);
    songData.startTime = formatDuration(clampedTime);
    card.querySelector(".start-time").value = songData.startTime;
    tooltip.textContent = formatDuration(clampedTime);
  } else {
    // Don't allow end handle to cross start handle
    const minEnd = Math.min(videoDuration, startTime + 1);
    const clampedTime = Math.max(newTime, minEnd);
    songData.endTime = formatDuration(clampedTime);
    card.querySelector(".end-time").value = songData.endTime;
    tooltip.textContent = formatDuration(clampedTime);
  }

  updateTimelinePositions(card, songData, videoDuration);
}

/**
 * Handle keyboard navigation for timeline handles
 */
function handleTimelineKeydown(e, card, songData, handleType, videoDuration) {
  const step = e.shiftKey ? 5 : 1; // Shift for larger steps
  let startTime = parseTimeSeconds(songData.startTime) || 0;
  let endTime = parseTimeSeconds(songData.endTime) || 0;

  switch (e.key) {
    case "ArrowLeft":
    case "ArrowDown":
      e.preventDefault();
      if (handleType === "start") {
        startTime = Math.max(0, startTime - step);
        songData.startTime = formatDuration(startTime);
        card.querySelector(".start-time").value = songData.startTime;
      } else {
        endTime = Math.max(startTime + 1, endTime - step);
        songData.endTime = formatDuration(endTime);
        card.querySelector(".end-time").value = songData.endTime;
      }
      break;

    case "ArrowRight":
    case "ArrowUp":
      e.preventDefault();
      if (handleType === "start") {
        startTime = Math.min(endTime - 1, startTime + step);
        songData.startTime = formatDuration(startTime);
        card.querySelector(".start-time").value = songData.startTime;
      } else {
        endTime = Math.min(videoDuration, endTime + step);
        songData.endTime = formatDuration(endTime);
        card.querySelector(".end-time").value = songData.endTime;
      }
      break;

    case "Home":
      e.preventDefault();
      if (handleType === "start") {
        songData.startTime = formatDuration(0);
        card.querySelector(".start-time").value = songData.startTime;
      } else {
        endTime = Math.max(startTime + 1, 1);
        songData.endTime = formatDuration(endTime);
        card.querySelector(".end-time").value = songData.endTime;
      }
      break;

    case "End":
      e.preventDefault();
      if (handleType === "start") {
        startTime = Math.max(0, endTime - 1);
        songData.startTime = formatDuration(startTime);
        card.querySelector(".start-time").value = songData.startTime;
      } else {
        songData.endTime = formatDuration(videoDuration);
        card.querySelector(".end-time").value = songData.endTime;
      }
      break;

    default:
      return;
  }

  const finalTime = parseTimeSeconds(
    songData[handleType === "start" ? "startTime" : "endTime"],
  );
  if (finalTime !== null) seekPreviewPlayer(songData, finalTime);

  updateTimelinePositions(card, songData, videoDuration);
  markCutEdited(card, songData);
  checkTimeValidity(card, songData);
  updateGenerateButton();
  updateStats();
}
