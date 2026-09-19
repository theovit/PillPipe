// PillPipe Service Worker — handles Web Push notifications
//
// Dose reminders arrive as ONE batched notification per time slot:
//   { title, body, tag, data: { kind: 'dose', date, regimenIds, url } }
// `regimenIds` lists only regimens that have a single dose today, because a Taken/Skip tap logs the
// whole day for a regimen. Other pushes (low stock, test) carry a different `kind` and get no buttons.

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'PillPipe', body: event.data.text() }; }
  const info = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const data = {
    url: info.url || payload.url || '/',
    kind: info.kind || 'other',
    date: info.date || null,
    regimenIds: Array.isArray(info.regimenIds) ? info.regimenIds : [],
  };
  const options = {
    body: payload.body || '',
    icon: '/pill-icon.png',
    badge: '/pill-icon.png',
    tag: payload.tag || 'pillpipe',
    data,
  };
  if (data.kind === 'dose' && data.regimenIds.length > 0) {
    options.actions = [
      { action: 'taken', title: '✓ Taken' },
      { action: 'skip', title: '✗ Skip' },
    ];
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'PillPipe', options));
});

async function logDoses(data, status) {
  const results = await Promise.all(data.regimenIds.map((id) =>
    fetch('/api/dose-log', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'pillpipe' },
      body: JSON.stringify({ regimen_id: id, date: data.date, status }),
    }).then((res) => res.ok).catch(() => false)
  ));
  if (results.every(Boolean)) {
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.postMessage({ type: 'DOSE_LOGGED', date: data.date, status });
    return;
  }
  // Signed out, offline, or the server is down: tell the user instead of failing silently.
  await self.registration.showNotification("Couldn't log your dose", {
    body: 'Open PillPipe to sign in and log it.',
    tag: 'dose-log-failed',
    data: { kind: 'other', url: data.url || '/', regimenIds: [] },
  });
}

function openApp(url) {
  return self.clients.matchAll({ type: 'window' }).then((clients) => {
    if (clients.length > 0) return clients[0].focus();
    return self.clients.openWindow(url || '/');
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if ((event.action === 'taken' || event.action === 'skip') && data.kind === 'dose' && data.regimenIds && data.regimenIds.length) {
    // Log in the background; don't drag the user into the app for a one-tap action.
    event.waitUntil(logDoses(data, event.action === 'taken' ? 'taken' : 'skipped'));
  } else {
    event.waitUntil(openApp(data.url));
  }
});

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
