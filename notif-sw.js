/* Service worker for The 29 World.
   1. Device alerts: lets alerts show on phones (Android Chrome refuses page-created
      notifications; iOS only allows notifications from a Home Screen web app) and
      brings the site to the front when one is tapped.
   2. App shell caching: so pages open fast and still open on flaky school Wi-Fi.
      Only the app's own files and the pinned Firebase SDK files are cached. Firestore,
      Auth and every other network request pass straight through untouched, so no
      student or class data is ever stored by this worker.

   No file list to maintain: install reads the core pages' own <script>/<link> tags
   (so the ?v=hash names always match), and everything else is cached as it is used.
   To wipe every old cache, change CACHE below. */
const CACHE = "t29-cache-v3";
const OFFLINE_URL = "offline.html";
// Pages (and everything they load) saved at install. Other pages cache the first time they are opened.
const CORE_PAGES = ["index.html", "student.html", "teacher-home.html", "teacher.html", OFFLINE_URL,
  "bank.html", "market.html", "loan.html", "transport.html", "property.html", "store.html", "marketplace.html"];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener("install", e => {
  e.waitUntil(precache().catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", e => e.waitUntil((async () => {
  try {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith("t29-") && n !== CACHE).map(n => caches.delete(n)));
  } catch (err) { /* old caches are harmless */ }
  await self.clients.claim();
})()));

/* ---------------- Install-time precache (never fails the install) ---------------- */
function pageKey(u) {
  const url = new URL(u, self.registration.scope);
  let p = url.pathname;
  if (p.endsWith("/")) p += "index.html";
  return url.origin + p;
}
async function putOk(cache, key, res) {
  if (res && res.ok && (res.type === "basic" || res.type === "cors")) await cache.put(key, res.clone());
}
async function precache() {
  const cache = await caches.open(CACHE);
  const assets = new Set();
  const sdk = new Set();
  await Promise.all(CORE_PAGES.map(async page => {
    try {
      const res = await fetch(new Request(page, { cache: "reload" }));
      if (!res.ok) return;
      const html = await res.clone().text();
      await putOk(cache, pageKey(page), res);
      const re = /(?:src|href)\s*=\s*["']([^"'#]+)["']/gi;
      let m;
      while ((m = re.exec(html))) {
        const ref = m[1];
        if (/^(mailto:|tel:|data:|javascript:)/i.test(ref)) continue;
        let u;
        try { u = new URL(ref, new URL(page, self.registration.scope)); } catch (err) { continue; }
        if (u.origin !== self.location.origin) continue;
        if (/\.(js|css|json)$/i.test(u.pathname)) assets.add(u.href);
      }
    } catch (err) { /* offline during install: runtime caching still works later */ }
  }));
  // The Firebase SDK files that firebase-init.js imports (and the files those import).
  for (const a of Array.from(assets)) {
    if (!/\/firebase-init\.js$/.test(new URL(a).pathname)) continue;
    try {
      const txt = await (await fetch(a)).text();
      (txt.match(/https:\/\/www\.gstatic\.com\/firebasejs\/[^"'`\s]+\.js/g) || []).forEach(u => sdk.add(u));
    } catch (err) { /* ignore */ }
  }
  await Promise.all(Array.from(assets).map(async a => {
    try { await putOk(cache, a, await fetch(a)); } catch (err) { /* cached at runtime instead */ }
  }));
  const seen = new Set();
  async function crawl(urls, depth) {
    const next = new Set();
    await Promise.all(urls.map(async u => {
      if (seen.has(u)) return;
      seen.add(u);
      try {
        const res = await fetch(u, { mode: "cors" });
        if (!res.ok) return;
        await putOk(cache, u, res.clone());
        if (depth < 2) {
          const txt = await res.text();
          const re = /["'](\.{1,2}\/[^"']+\.js|https:\/\/www\.gstatic\.com\/firebasejs\/[^"']+\.js)["']/g;
          let m;
          while ((m = re.exec(txt))) { try { next.add(new URL(m[1], u).href); } catch (err) { /* skip */ } }
        }
      } catch (err) { /* cached at runtime instead */ }
    }));
    if (next.size) await crawl(Array.from(next), depth + 1);
  }
  await crawl(Array.from(sdk), 0);
}

/* ---------------- Fetch strategies ---------------- */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  try {
    if (res.ok && (res.type === "basic" || res.type === "cors")) {
      const url = new URL(req.url);
      // A new ?v=hash replaces the old copy of the same file so the cache doesn't pile up.
      if (url.origin === self.location.origin && url.search) {
        (await cache.keys()).forEach(k => {
          const ku = new URL(k.url);
          if (ku.origin === url.origin && ku.pathname === url.pathname && ku.search !== url.search) cache.delete(k);
        });
      }
      await cache.put(req, res.clone());
    }
  } catch (err) { /* serving still works */ }
  return res;
}
async function staleWhileRevalidate(e, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  const update = fetch(req).then(res => {
    if (res.ok && (res.type === "basic" || res.type === "cors")) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) { e.waitUntil(update.catch(() => {})); return hit; }
  return update;
}
async function pageFirstNetwork(req) {
  const cache = await caches.open(CACHE);
  const key = pageKey(req.url);
  const hit = await cache.match(key);
  const net = fetch(req).then(res => {
    if (res.ok && res.type === "basic") cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  if (!hit) {
    return net.catch(async () => (await cache.match(pageKey(OFFLINE_URL))) || Response.error());
  }
  // Have a saved copy: use the network if it answers quickly, otherwise the saved copy.
  return Promise.race([
    net.then(res => (res.status >= 500 ? hit : res)),
    new Promise(r => setTimeout(() => r(hit), NAV_TIMEOUT_MS))
  ]).catch(() => hit);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isSdk = url.origin === "https://www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!sameOrigin && !isSdk) return;                 // Firestore, Auth, App Check, etc: untouched
  if (sameOrigin && /\/notif-sw\.js$/.test(url.pathname)) return;
  if (req.mode === "navigate") { e.respondWith(pageFirstNetwork(req)); return; }
  if (isSdk || url.searchParams.has("v")) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(staleWhileRevalidate(e, req));
});

/* ---------------- Device alerts ---------------- */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = all[0];
    if (open) {
      await open.focus();
      if (url && "navigate" in open) { try { await open.navigate(url); } catch (err) { /* stay where they are */ } }
    } else {
      await self.clients.openWindow(url || self.registration.scope);
    }
  })());
});
