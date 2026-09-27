/* Web push handlers (step 24), imported into the Workbox service worker. Payload: { title, body, url, tag, severity }. */
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "MaskinID", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "MaskinID", {
    body: d.body || "", tag: d.tag, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/" },
    requireInteraction: d.severity === "critical",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
