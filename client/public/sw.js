// PillPipe Service Worker — handles Web Push notifications

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'PillPipe', {
      body: data.body || '',
      icon: '/pill-icon.png',
      badge: '/pill-icon.png',
      tag: data.tag || 'pillpipe',
      data: data.url || '/',
      actions: [
        { action: 'taken', title: '✓ Taken' },
        { action: 'skip',  title: '✗ Skip'  },
      ],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'taken' || event.action === 'skip') {
    // Post message to app if open; app handles logging
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        const payload = { type: 'DOSE_ACTION', action: event.action, tag: event.notification.tag };
        for (const client of clients) client.postMessage(payload);
        if (clients.length > 0) return clients[0].focus();
        return self.clients.openWindow(event.notification.data || '/');
      })
    );
  } else {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        if (clients.length > 0) return clients[0].focus();
        return self.clients.openWindow(event.notification.data || '/');
      })
    );
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
