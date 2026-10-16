self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }
  const title = String(payload.title || 'SEDX Aluno');
  const options = {
    body: String(payload.body || 'Há uma nova atualização no SedX.'),
    icon: '/apple-touch-icon.png',
    badge: '/favicon-32.png',
    tag: String(payload.tag || 'sedx-notification'),
    renotify: false,
    data: payload.data && typeof payload.data === 'object' ? payload.data : { url: '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = String(event.notification.data?.url || '/');
  const target = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
    return undefined;
  })());
});
