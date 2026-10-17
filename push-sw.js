self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'SEDX', body: event.data?.text() || 'Você tem uma nova notificação.' }; }
  const title = String(data.title || 'SEDX');
  const options = {
    body: String(data.body || 'Você tem uma nova atualização.'),
    icon: '/sedx-logo-login-dashboard.png',
    badge: '/favicon-32.png',
    tag: String(data.tag || `sedx-${Date.now()}`),
    renotify: false,
    data: { url: String(data.url || '/') },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        await client.focus();
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
