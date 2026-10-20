// The web app's service worker (contracts/native.md "Web Push"): it shows a web push
// while no opendesk window is focused (a focused one shows its own toast) and opens the
// notification's link on click. Notifications are tagged with their id, so the one the
// open page shows and the pushed one replace each other instead of stacking. Browsers
// expect every push to show a notification, so with a window focused it is shown and
// closed at once.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let alert;
  try {
    alert = event.data.json();
  } catch {
    return;
  }
  if (!alert || typeof alert.title !== "string") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      await self.registration.showNotification(alert.title, {
        body: alert.body || undefined,
        tag: alert.id,
        icon: "/icon-192.png",
        data: { url: alert.url },
      });
      if (!windows.some((w) => w.focused)) return;
      const shown = await self.registration.getNotifications({ tag: alert.id });
      shown.forEach((n) => n.close());
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = url.origin === self.location.origin ? windows[0] : undefined;
      if (open) {
        try {
          await open.focus();
          await open.navigate(url.href);
          return;
        } catch {
          // An uncontrolled window cannot be navigated from here: open a new one.
        }
      }
      await self.clients.openWindow(url.href);
    }),
  );
});
