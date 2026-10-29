/* Service worker for The 29 World device alerts. It lets alerts show on
   phones (Android Chrome refuses page-created notifications; iOS only allows
   notifications from a Home Screen web app) and brings the site to the front
   when one is tapped. It caches nothing and intercepts no requests. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

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
