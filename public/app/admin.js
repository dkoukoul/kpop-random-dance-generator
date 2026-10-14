/**
 * Admin Dashboard - JavaScript
 */

const loginSection = document.getElementById("login-section");
const dashboardSection = document.getElementById("dashboard-section");
const loginForm = document.getElementById("login-form");
const logoutBtn = document.getElementById("logout-btn");
const errorMsg = document.getElementById("error-msg");

// DOM elements for stats
const totalVisitsEl = document.getElementById("total-visits");
const totalGenerationsEl = document.getElementById("total-generations");
const topSongsBody = document.getElementById("top-songs-body");

// Session state
let authHeader = localStorage.getItem("adminAuth");

if (authHeader) {
  showDashboard();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;

  const credentials = btoa(`${username}:${password}`);
  const testAuthHeader = `Basic ${credentials}`;

  try {
    const response = await fetch("/api/stats", {
      headers: { Authorization: testAuthHeader },
    });

    if (response.ok) {
      authHeader = testAuthHeader;
      localStorage.setItem("adminAuth", authHeader);
      showDashboard();
    } else {
      showError();
    }
  } catch (err) {
    showError();
  }
});

logoutBtn.addEventListener("click", () => {
  authHeader = null;
  localStorage.removeItem("adminAuth");
  loginSection.classList.remove("hidden");
  dashboardSection.classList.add("hidden");
});

async function showDashboard() {
  loginSection.classList.add("hidden");
  dashboardSection.classList.remove("hidden");
  errorMsg.classList.add("hidden");

  await refreshStats();
}

async function refreshStats() {
  try {
    const response = await fetch("/api/stats", {
      headers: { Authorization: authHeader },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired or invalid
        logoutBtn.click();
      }
      return;
    }

    const data = await response.json();

    // Update stats
    totalVisitsEl.textContent = data.totalVisits.toLocaleString();
    totalGenerationsEl.textContent = data.totalGenerations.toLocaleString();

    // Update top songs table
    topSongsBody.innerHTML = "";
    data.topSongs.forEach((song) => {
      // Built with DOM APIs: these values come from user-submitted mixes.
      const tr = document.createElement("tr");

      const titleCell = document.createElement("td");
      titleCell.append(song.title ?? "");
      if (song.start_time && song.end_time) {
        const time = document.createElement("small");
        time.style.color = "var(--text-secondary)";
        time.textContent = `Time: ${song.start_time} - ${song.end_time}`;
        titleCell.append(document.createElement("br"), time);
      }

      const countCell = document.createElement("td");
      const count = document.createElement("strong");
      count.textContent = song.count;
      countCell.appendChild(count);

      const linkCell = document.createElement("td");
      const link = document.createElement("a");
      if (/^https?:\/\//i.test(song.youtube_url || "")) {
        link.href = song.youtube_url;
      }
      link.target = "_blank";
      link.className = "btn btn-secondary btn-sm";
      link.style.cssText = "padding: 2px 8px; font-size: 0.75rem;";
      link.textContent = "View";
      linkCell.appendChild(link);

      tr.append(titleCell, countCell, linkCell);
      topSongsBody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to fetch stats:", err);
  }
}

function showError() {
  errorMsg.classList.remove("hidden");
  setTimeout(() => errorMsg.classList.add("hidden"), 3000);
}
