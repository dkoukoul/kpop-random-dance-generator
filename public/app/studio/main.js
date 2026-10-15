/**
 * The new mix builder ("Studio"): boot.
 */
import { store } from "./util.js";
import { loadVersion, trackVisit } from "./api.js";
import { initContact, initHowItWorks, initMenus, initSupportTracking, initTheme } from "./ui.js";

// While both pages exist, remember that this browser uses the new one, so
// "Open in generator" on the group pages comes back here (see landing.js).
const UI_KEY = "kpopgen:ui";
store.set(UI_KEY, "studio");
document.getElementById("classicLink")?.addEventListener("click", () => store.remove(UI_KEY));

initMenus();
initTheme();
initContact();
initHowItWorks();
initSupportTracking();

trackVisit();

loadVersion()
  .then((version) => {
    if (!version) return;
    document.getElementById("versionNumber").textContent = version;
    document.getElementById("versionLine").hidden = false;
  })
  .catch(() => {});
