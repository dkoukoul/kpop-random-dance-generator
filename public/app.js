/**
 * K-Pop Random Dance Generator - Frontend Application
 */

// State
const state = {
  songs: [],
  currentJobId: null,
  isGenerating: false,
  shuffleEnabled: false,
  compactViewEnabled: false,
  draggedIndex: null,
};

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
  songCardTemplate: document.getElementById("songCardTemplate"),
  randomOrderToggle: document.getElementById("randomOrderToggle"),
  compactViewToggle: document.getElementById("compactViewToggle"),
  dragHint: document.getElementById("dragHint"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),
  menuBtn: document.getElementById("menuBtn"),
  menuDropdown: document.getElementById("menuDropdown"),
};

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  elements.addSongBtn.addEventListener("click", addSong);
  elements.generateBtn.addEventListener("click", generateRandomDance);

  // Shuffle toggle
  elements.randomOrderToggle.addEventListener("change", (e) => {
    state.shuffleEnabled = e.target.checked;
  });

  // Compact view toggle
  elements.compactViewToggle.addEventListener("change", (e) => {
    state.compactViewEnabled = e.target.checked;
    rebuildSongList();
  });

  // Menu Toggle
  elements.menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    elements.menuDropdown.classList.toggle("hidden");
  });

  // Close menu when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !elements.menuDropdown.contains(e.target) &&
      e.target !== elements.menuBtn
    ) {
      elements.menuDropdown.classList.add("hidden");
    }
  });

  // Export/Import
  elements.exportBtn.addEventListener("click", () => {
    exportProject();
    elements.menuDropdown.classList.add("hidden");
  });

  elements.importBtn.addEventListener("click", () => {
    elements.importFile.click();
    elements.menuDropdown.classList.add("hidden");
  });

  elements.importFile.addEventListener("change", importProject);

  // Add first song card
  addSong();
});

/**
 * Add a new song card to the list
 */
function addSong() {
  const index = state.songs.length;
  const songData = {
    youtubeUrl: "",
    title: "",
    startTime: "0:00",
    endTime: "0:30",
    info: null,
  };
  state.songs.push(songData);

  // Clone template
  const template = elements.songCardTemplate.content.cloneNode(true);
  const card = template.querySelector(".song-card");
  card.dataset.index = index;

  // Set song number
  card.querySelector(".song-number").textContent = index + 1;

  // Get input elements
  const urlInput = card.querySelector(".url-input");
  const fetchBtn = card.querySelector(".btn-fetch");
  const startTimeInput = card.querySelector(".start-time");
  const endTimeInput = card.querySelector(".end-time");
  const removeBtn = card.querySelector(".btn-remove");

  // Debounce timer for auto-fetch
  let fetchDebounceTimer = null;

  // Event listeners
  urlInput.addEventListener("input", (e) => {
    const rawUrl = e.target.value;
    const cleanedUrl = cleanYouTubeUrl(rawUrl);

    // Update the input with cleaned URL if it was modified
    if (cleanedUrl && cleanedUrl !== rawUrl) {
      urlInput.value = cleanedUrl;
    }

    songData.youtubeUrl = cleanedUrl || rawUrl;
    updateGenerateButton();

    // Auto-fetch if valid YouTube URL (with debounce)
    if (isValidYouTubeUrl(songData.youtubeUrl) && !songData.info) {
      clearTimeout(fetchDebounceTimer);
      fetchDebounceTimer = setTimeout(() => {
        fetchVideoInfo(card, songData);
      }, 500); // Wait 500ms after typing stops
    }
  });

  // Handle paste event for immediate fetch
  urlInput.addEventListener("paste", (e) => {
    setTimeout(() => {
      const rawUrl = urlInput.value;
      const cleanedUrl = cleanYouTubeUrl(rawUrl);

      if (cleanedUrl && cleanedUrl !== rawUrl) {
        urlInput.value = cleanedUrl;
      }

      songData.youtubeUrl = cleanedUrl || rawUrl;
      updateGenerateButton();

      // Auto-fetch immediately on paste if valid
      if (isValidYouTubeUrl(songData.youtubeUrl) && !songData.info) {
        fetchVideoInfo(card, songData);
      }
    }, 10);
  });

  fetchBtn.addEventListener("click", () => fetchVideoInfo(card, songData));

  urlInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      fetchVideoInfo(card, songData);
    }
  });

  startTimeInput.addEventListener("input", (e) =>
    handleTimeInput(e, card, songData, "startTime"),
  );
  endTimeInput.addEventListener("input", (e) =>
    handleTimeInput(e, card, songData, "endTime"),
  );

  removeBtn.addEventListener("click", () => removeSong(card, index));

  // Drag and drop event handlers
  card.addEventListener("dragstart", (e) => {
    state.draggedIndex = parseInt(card.dataset.index);
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    state.draggedIndex = null;
    // Remove drag-over class from all cards
    document
      .querySelectorAll(".song-card")
      .forEach((c) => c.classList.remove("drag-over"));
  });

  card.addEventListener("dragover", (e) => {
    e.preventDefault();
    const draggingCard = document.querySelector(".song-card.dragging");
    if (draggingCard && draggingCard !== card) {
      card.classList.add("drag-over");
    }
  });

  card.addEventListener("dragleave", () => {
    card.classList.remove("drag-over");
  });

  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag-over");

    const fromIndex = state.draggedIndex;
    const toIndex = parseInt(card.dataset.index);

    if (fromIndex !== null && fromIndex !== toIndex) {
      // Reorder songs array
      const [movedSong] = state.songs.splice(fromIndex, 1);
      state.songs.splice(toIndex, 0, movedSong);

      // Rebuild the UI
      rebuildSongList();
    }
  });

  // Hide empty state if visible
  elements.emptyState.classList.add("hidden");

  // Show drag hint when there are 2+ songs
  updateDragHint();

  // Add card to list
  elements.songList.appendChild(card);

  // Focus URL input
  urlInput.focus();

  updateGenerateButton();
}

/**
 * Remove a song from the list
 */
function removeSong(card, index) {
  card.remove();
  state.songs.splice(index, 1);

  // Update indices for remaining cards
  document.querySelectorAll(".song-card").forEach((c, i) => {
    c.dataset.index = i;
    c.querySelector(".song-number").textContent = i + 1;
  });

  // Show empty state if no songs
  if (state.songs.length === 0) {
    elements.emptyState.classList.remove("hidden");
  }

  updateDragHint();
  updateGenerateButton();
}

/**
 * Fetch video info from YouTube
 */
async function fetchVideoInfo(card, songData) {
  const urlInput = card.querySelector(".url-input");
  const fetchBtn = card.querySelector(".btn-fetch");
  const fetchIcon = fetchBtn.querySelector(".fetch-icon");
  const songInfo = card.querySelector(".song-info");

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

    if (!response.ok) {
      throw new Error("Failed to fetch video info");
    }

    const info = await response.json();
    songData.info = info;
    songData.title = info.title;

    // Update UI
    card.querySelector(".song-thumbnail img").src = info.thumbnail;
    card.querySelector(".song-title").textContent = info.title;
    card.querySelector(".song-channel").textContent = info.channel;
    card.querySelector(".song-duration").textContent =
      `Duration: ${formatDuration(info.duration)}`;

    // Update compact view info
    const compactBand = card.querySelector(".compact-band");
    const compactTitle = card.querySelector(".compact-title");
    const parts = info.title.split(" - ");
    if (compactBand)
      compactBand.textContent = parts.length > 1 ? parts[0] : "Unknown";
    if (compactTitle)
      compactTitle.textContent =
        parts.length > 1 ? parts.slice(1).join(" - ") : info.title;

    // Set default end time to 30 seconds or video duration if shorter
    const defaultEndSeconds = Math.min(30, info.duration);
    card.querySelector(".end-time").value = formatDuration(defaultEndSeconds);
    songData.endTime = formatDuration(defaultEndSeconds);

    songInfo.classList.remove("hidden");
  } catch (error) {
    console.error("Error fetching video info:", error);
    alert("Failed to fetch video info. Please check the URL and try again.");
  } finally {
    fetchIcon.textContent = "🔍";
    fetchIcon.classList.remove("loading");
    fetchBtn.disabled = false;
    updateGenerateButton();
  }
}

/**
 * Generate the random dance audio
 */
async function generateRandomDance() {
  if (state.isGenerating) return;

  // Validate segments
  let segments = state.songs
    .filter((song) => song.youtubeUrl && song.youtubeUrl.trim() !== "")
    .map((song) => ({
      youtubeUrl: song.youtubeUrl,
      title: song.title || "Song", // Fallback title if not fetched
      startTime: song.startTime || "0:00",
      endTime: song.endTime || "0:30",
    }));

  if (segments.length === 0) {
    alert("Please add at least one song with a valid URL");
    return;
  }

  // Shuffle if enabled
  if (state.shuffleEnabled) {
    segments = shuffleArray([...segments]);
  }

  state.isGenerating = true;

  // Update UI
  elements.generateBtn.disabled = true;
  elements.generateBtn.classList.add("loading");
  elements.generateBtn.innerHTML =
    '<span class="btn-icon">⏳</span> Generating...';
  elements.progressContainer.classList.remove("hidden");
  elements.downloadSection.classList.add("hidden");
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
    alert("Failed to generate audio: " + error.message);
    resetGenerateButton();
  }
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
        // Update progress
        progress = Math.min(progress + 15, 90);
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
          resetGenerateButton();
        }, 500);
      } else if (status.status === "error") {
        throw new Error(status.error || "Unknown error");
      }
    } catch (error) {
      console.error("Poll error:", error);
      alert("Error: " + error.message);
      resetGenerateButton();
    }
  };

  poll();
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
 * Update generate button enabled state
 */
function updateGenerateButton() {
  // Enable if at least one song has a valid YouTube URL AND all times are valid
  const hasValidSongs = state.songs.some(
    (song) => song.youtubeUrl && song.youtubeUrl.trim() !== "",
  );

  // Check if any song has invalid time
  const hasInvalidTimes = state.songs.some((song) => {
    const startSec = parseTimeSeconds(song.startTime);
    const endSec = parseTimeSeconds(song.endTime);
    return startSec === null || endSec === null || endSec <= startSec;
  });

  elements.generateBtn.disabled =
    !hasValidSongs || hasInvalidTimes || state.isGenerating;
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
 * Rebuild the song list UI after reordering
 */
function rebuildSongList() {
  // Store current song data
  const songsData = [...state.songs];

  // Remove all cards except empty state
  document.querySelectorAll(".song-card").forEach((card) => card.remove());

  // Clear songs array
  state.songs = [];

  // Re-add each song
  songsData.forEach((songData) => {
    const index = state.songs.length;
    state.songs.push(songData);

    // Clone template
    const template = elements.songCardTemplate.content.cloneNode(true);
    const card = template.querySelector(".song-card");
    card.dataset.index = index;

    // Set song number
    card.querySelector(".song-number").textContent = index + 1;

    // Get input elements
    const urlInput = card.querySelector(".url-input");
    const fetchBtn = card.querySelector(".btn-fetch");
    const startTimeInput = card.querySelector(".start-time");
    const endTimeInput = card.querySelector(".end-time");
    const removeBtn = card.querySelector(".btn-remove");
    const songInfo = card.querySelector(".song-info");

    // Restore values
    urlInput.value = songData.youtubeUrl;
    startTimeInput.value = songData.startTime;
    endTimeInput.value = songData.endTime;

    // If we have video info, show it
    if (songData.info) {
      card.querySelector(".song-thumbnail img").src = songData.info.thumbnail;
      card.querySelector(".song-title").textContent = songData.info.title;
      card.querySelector(".song-channel").textContent = songData.info.channel;
      card.querySelector(".song-duration").textContent =
        `Duration: ${formatDuration(songData.info.duration)}`;
      songInfo.classList.remove("hidden");

      // Update compact view info
      const compactBand = card.querySelector(".compact-band");
      const compactTitle = card.querySelector(".compact-title");
      const parts = songData.info.title.split(" - ");
      if (compactBand)
        compactBand.textContent = parts.length > 1 ? parts[0] : "Unknown";
      if (compactTitle)
        compactTitle.textContent =
          parts.length > 1 ? parts.slice(1).join(" - ") : songData.info.title;
    }

    if (state.compactViewEnabled) {
      card.classList.add("compact");
    }

    // Debounce timer for auto-fetch
    let fetchDebounceTimer = null;

    // Event listeners
    urlInput.addEventListener("input", (e) => {
      const rawUrl = e.target.value;
      const cleanedUrl = cleanYouTubeUrl(rawUrl);
      if (cleanedUrl && cleanedUrl !== rawUrl) {
        urlInput.value = cleanedUrl;
      }
      songData.youtubeUrl = cleanedUrl || rawUrl;
      updateGenerateButton();
      if (isValidYouTubeUrl(songData.youtubeUrl) && !songData.info) {
        clearTimeout(fetchDebounceTimer);
        fetchDebounceTimer = setTimeout(
          () => fetchVideoInfo(card, songData),
          500,
        );
      }
    });

    urlInput.addEventListener("paste", (e) => {
      setTimeout(() => {
        const rawUrl = urlInput.value;
        const cleanedUrl = cleanYouTubeUrl(rawUrl);
        if (cleanedUrl && cleanedUrl !== rawUrl) urlInput.value = cleanedUrl;
        songData.youtubeUrl = cleanedUrl || rawUrl;
        updateGenerateButton();
        if (isValidYouTubeUrl(songData.youtubeUrl) && !songData.info) {
          fetchVideoInfo(card, songData);
        }
      }, 10);
    });

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
    removeBtn.addEventListener("click", () =>
      removeSong(card, parseInt(card.dataset.index)),
    );

    // Drag events
    card.addEventListener("dragstart", (e) => {
      state.draggedIndex = parseInt(card.dataset.index);
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      state.draggedIndex = null;
      document
        .querySelectorAll(".song-card")
        .forEach((c) => c.classList.remove("drag-over"));
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (document.querySelector(".song-card.dragging") !== card)
        card.classList.add("drag-over");
    });
    card.addEventListener("dragleave", () =>
      card.classList.remove("drag-over"),
    );
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");
      const fromIndex = state.draggedIndex;
      const toIndex = parseInt(card.dataset.index);
      if (fromIndex !== null && fromIndex !== toIndex) {
        const [movedSong] = state.songs.splice(fromIndex, 1);
        state.songs.splice(toIndex, 0, movedSong);
        rebuildSongList();
      }
    });

    elements.songList.appendChild(card);
  });

  elements.emptyState.classList.add("hidden");
  updateDragHint();
  updateGenerateButton();
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
    shuffleEnabled: state.shuffleEnabled,
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

      // Restore state
      state.songs = projectData.songs;
      state.shuffleEnabled = !!projectData.shuffleEnabled;

      // Update UI
      elements.randomOrderToggle.checked = state.shuffleEnabled;
      rebuildSongList();

      // Show success feedback?
      alert("Project imported successfully!");
    } catch (error) {
      console.error("Import error:", error);
      alert("Failed to import project: " + error.message);
    }

    // Reset file input so same file can be selected again
    event.target.value = "";
  };
  reader.readAsText(file);
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
 * Handle time input with auto-formatting
 */
function handleTimeInput(e, card, songData, field) {
  let value = e.target.value;

  // Auto-format 3 digits to M:SS (e.g., 123 -> 1:23)
  // Only if inserting text (not deleting)
  if (e.inputType !== "deleteContentBackward" && /^\d{3}$/.test(value)) {
    const formatted = `${value.charAt(0)}:${value.substring(1)}`;
    // Validate the seconds part before applying
    const secs = parseInt(value.substring(1));
    if (secs < 60) {
      value = formatted;
      e.target.value = value;
    }
  }

  songData[field] = value;
  checkTimeValidity(card, songData);
  updateGenerateButton();
}
