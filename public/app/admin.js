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
      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td>${song.title}</td>
                <td><strong>${song.count}</strong></td>
                <td><a href="${song.youtube_url}" target="_blank" class="btn btn-secondary btn-sm" style="padding: 2px 8px; font-size: 0.75rem;">View</a></td>
            `;
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
