/**
 * Shop links (kpop.exchange, a US store) are only for visitors in the US and
 * Canada. We go by the browser's time zone: no IP lookup, nothing sent
 * anywhere. Loaded in <head> by the builder and the group pages; it sets
 * data-shop on <html>, and the CSS hides every .aff element without it.
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

  root.kpopInShopRegion = inShopRegion;
  try {
    if (inShopRegion(Intl.DateTimeFormat().resolvedOptions().timeZone)) document.documentElement.dataset.shop = "na";
  } catch (e) {}
})(typeof window !== "undefined" ? window : globalThis);
