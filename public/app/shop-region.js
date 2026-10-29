/**
 * Shop links (kpop.exchange, a US store) are only for visitors in the US and
 * Canada. We go by the browser's time zone: no IP lookup, nothing sent
 * anywhere. Loaded in <head> by the builder and the group pages; it sets
 * data-shop on <html>, and the CSS hides every .aff element without it.
 *
 * Preview from anywhere: open any page with ?shop-preview=on (remembered in
 * this browser, with a badge to turn it off) or ?shop-preview=off. Clicks in
 * preview are not sent to Google Analytics.
 */
(function (root) {
  var ZONES = [
    // United States
    "America/New_York", "America/Detroit", "America/Kentucky/Louisville", "America/Kentucky/Monticello",
    "America/Indiana/Indianapolis", "America/Indiana/Vincennes", "America/Indiana/Winamac", "America/Indiana/Marengo",
    "America/Indiana/Petersburg", "America/Indiana/Vevay", "America/Indiana/Tell_City", "America/Indiana/Knox",
    "America/Indianapolis", "America/Louisville", "America/Fort_Wayne", "America/Knox_IN",
    "America/Chicago", "America/Menominee", "America/North_Dakota/Center", "America/North_Dakota/New_Salem",
    "America/North_Dakota/Beulah", "America/Denver", "America/Boise", "America/Phoenix", "America/Los_Angeles",
    "America/Anchorage", "America/Juneau", "America/Sitka", "America/Metlakatla", "America/Yakutat", "America/Nome",
    "America/Adak", "Pacific/Honolulu", "EST5EDT", "CST6CDT", "MST7MDT", "PST8PDT",
    // Canada
    "America/St_Johns", "America/Halifax", "America/Glace_Bay", "America/Moncton", "America/Goose_Bay",
    "America/Toronto", "America/Montreal", "America/Nipigon", "America/Thunder_Bay", "America/Iqaluit",
    "America/Pangnirtung", "America/Atikokan", "America/Coral_Harbour", "America/Blanc-Sablon", "America/Winnipeg",
    "America/Rainy_River", "America/Resolute", "America/Rankin_Inlet", "America/Regina", "America/Swift_Current",
    "America/Edmonton", "America/Cambridge_Bay", "America/Yellowknife", "America/Inuvik", "America/Creston",
    "America/Dawson_Creek", "America/Fort_Nelson", "America/Whitehorse", "America/Dawson", "America/Vancouver",
  ];

  function inShopRegion(zone) {
    if (typeof zone !== "string") return false;
    return ZONES.indexOf(zone) !== -1 || /^(US|Canada)\//.test(zone);
  }

  var PREVIEW_KEY = "kpopgen:shopPreview";

  /** Reads ?shop-preview=on|off, stores it, and says whether preview is on. */
  function readPreview(search, storage) {
    var m = /[?&]shop-preview=(on|off)(&|$)/.exec(search || "");
    try {
      if (m && m[1] === "on") storage.setItem(PREVIEW_KEY, "1");
      if (m && m[1] === "off") storage.removeItem(PREVIEW_KEY);
      return storage.getItem(PREVIEW_KEY) === "1";
    } catch (e) {
      // Storage blocked (private mode, sandbox): the URL still counts for this page.
      return !!m && m[1] === "on";
    }
  }

  function showBadge() {
    var a = document.createElement("a");
    a.href = "?shop-preview=off";
    a.textContent = "US/CA shop preview · turn off";
    a.setAttribute("style", "position:fixed;left:12px;bottom:12px;z-index:9999;padding:6px 10px;border-radius:6px;" +
      "background:#2de2e6;color:#0b0c10;font:700 11px/1.2 ui-monospace,monospace;text-decoration:none;box-shadow:0 4px 12px rgba(0,0,0,.4)");
    document.body.appendChild(a);
  }

  root.kpopInShopRegion = inShopRegion;
  root.kpopReadShopPreview = readPreview;
  root.kpopShopPreview = false;
  try {
    root.kpopShopPreview = readPreview(location.search, localStorage);
  } catch (e) {}
  try {
    if (root.kpopShopPreview || inShopRegion(Intl.DateTimeFormat().resolvedOptions().timeZone)) document.documentElement.dataset.shop = "na";
    if (root.kpopShopPreview) {
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBadge);
      else showBadge();
    }
  } catch (e) {}
})(typeof window !== "undefined" ? window : globalThis);
