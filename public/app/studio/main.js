/**
 * The new mix builder ("Studio"): boot.
 */
import { store } from "./util.js";
import { loadVersion, trackVisit } from "./api.js";
import { initContact, initHowItWorks, initMenus, initSupportTracking, initTheme } from "./ui.js";
import { initBuilder } from "./builder.js";
import { initEditor } from "./editor.js";
import { initGenerate } from "./generate.js";

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

const builder = initBuilder();
initEditor({
  setlist: builder.setlist,
  fullInfo: builder.fullInfo,
  lookUp: builder.lookUp,
  onLoadError: (id, message) => builder.setlist.update(id, { loadError: message }, { type: "info" }),
});

initGenerate({ setlist: builder.setlist, view: builder.view });

trackVisit();

loadVersion()
  .then((version) => {
    if (!version) return;
    document.getElementById("versionNumber").textContent = version;
    document.getElementById("versionLine").hidden = false;
  })
  .catch(() => {});
