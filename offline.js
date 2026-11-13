/* The 29 World — offline support.
   Registers the service worker (notif-sw.js) on every page so the app shell is saved
   for fast, flaky-Wi-Fi-friendly loading, and shows a small banner while the device has
   no connection. Money actions need the internet, so the banner says changes can't save. */
(function () {
  "use strict";

  // Reuse an existing registration (device alerts register the same worker) rather than replace it.
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) return navigator.serviceWorker.register("notif-sw.js?v=8b9d8c7a");
      }).catch(function () { /* the app works fine without it */ });
    });
  }

  var bar = null, hideTimer = null;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "t29OfflineBar";
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-live", "polite");
    bar.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));" +
      "z-index:99999;max-width:min(92vw,460px);padding:10px 16px;border-radius:12px;font:600 14px/1.35 system-ui,-apple-system,'Segoe UI',sans-serif;" +
      "text-align:center;box-shadow:var(--shadow-pop);color:#fff;background:#1f2b44;border:1px solid rgba(255,255,255,.25);display:none;";
    document.body.appendChild(bar);
    return bar;
  }
  function show(text, bg) {
    var b = ensureBar();
    clearTimeout(hideTimer);
    b.textContent = text;
    b.style.background = bg;
    b.style.display = "block";
  }
  function goOffline() {
    document.documentElement.classList.add("t29-offline");
    show("You're offline. Changes can't be saved until you're back online.", "#9a3b2e");
  }
  function goOnline() {
    document.documentElement.classList.remove("t29-offline");
    if (!bar || bar.style.display === "none") return;
    show("Back online.", "#2e7d4f");
    hideTimer = setTimeout(function () { bar.style.display = "none"; }, 2500);
  }
  function init() {
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    if (navigator.onLine === false) goOffline();
  }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})();
