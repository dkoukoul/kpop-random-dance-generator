/**
 * Landing page actions: hand a ready-made mix to the generator, or save it as
 * a project file.
 *
 * The handoff goes through sessionStorage rather than the URL because a
 * ten-song mix is well past a comfortable query-string length. app.js picks the
 * key up on load and clears it, so a refresh doesn't re-import.
 */

const HANDOFF_KEY = "pendingMix";


function readMix(id) {
  const el = document.getElementById("data-" + id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);
  } catch (err) {
    console.error("Bad mix payload", id, err);
    return null;
  }
}

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1600);
}

document.addEventListener("click", (event) => {
  const loadBtn = event.target.closest(".js-load-mix");
  if (loadBtn) {
    const mix = readMix(loadBtn.dataset.mix);
    if (!mix) return;
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(mix));
    } catch (err) {
      // Private mode or storage disabled - fall back to the file route.
      console.warn("sessionStorage unavailable, downloading instead", err);
      downloadMix(mix);
      return;
    }
    if (window.gtag) {
      window.gtag("event", "open_ready_made_mix", {
        mix_id: loadBtn.dataset.mix,
        song_count: mix.songs.length,
      });
    }
    window.location.href = "/";
    return;
  }

  const dlBtn = event.target.closest(".js-download-mix");
  if (dlBtn) {
    const mix = readMix(dlBtn.dataset.mix);
    if (!mix) return;
    downloadMix(mix);
    if (window.gtag) {
      window.gtag("event", "download_ready_made_mix", { mix_id: dlBtn.dataset.mix });
    }
    flash(dlBtn, "Saved");
  }
});

function downloadMix(mix) {
  const blob = new Blob([JSON.stringify(mix, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = (mix.name || "kpop-dance-project").replace(/[^\w-]+/g, "-").toLowerCase() + ".json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
