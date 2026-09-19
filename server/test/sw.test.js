// Unit tests for client/public/sw.js. The worker is loaded into a vm sandbox with stubbed service-worker
// globals, so its push and notificationclick handlers run for real without a browser: npm run test:unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Objects built inside the vm have a different prototype; compare them through JSON.
const plain = x => JSON.parse(JSON.stringify(x));

const SW_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'public', 'sw.js'), 'utf8');

function loadWorker({ fetchImpl } = {}) {
  const handlers = {};
  const shown = [];
  const posted = [];
  const opened = [];
  const focused = [];
  const fetchCalls = [];
  let windows = [];
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: {
      matchAll: async () => windows,
      openWindow: async url => { opened.push(url); },
      claim: async () => {},
    },
    skipWaiting: () => {},
  };
  const sandbox = {
    self,
    fetch: async (url, init) => { fetchCalls.push({ url, init }); return fetchImpl ? fetchImpl(url, init) : { ok: true }; },
    JSON, Array, Promise, Object,
  };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox);
  return {
    shown, posted, opened, focused, fetchCalls,
    setWindows(n) {
      windows = Array.from({ length: n }, () => ({ postMessage: m => posted.push(m), focus: async () => { focused.push(true); } }));
    },
    // Fire an event and wait for whatever it passed to event.waitUntil().
    async fire(type, event) {
      let pending = Promise.resolve();
      await handlers[type]({ ...event, waitUntil: p => { pending = p; } });
      await pending;
    },
    push(payload) {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      return this.fire('push', { data: { json: () => JSON.parse(text), text: () => text } });
    },
    click({ action = '', data }) {
      const notification = { tag: 't', data, close: () => {} };
      return this.fire('notificationclick', { action, notification });
    },
  };
}

const dosePush = {
  title: '8:00 AM — 2 supplements due', body: '• 2 caps A\n• 1 caps B', tag: 'dose-batch-2026-09-15-0800',
  data: { url: '/', kind: 'dose', date: '2026-09-15', regimenIds: ['r1', 'r2'] },
};

test('a dose push shows the notification with Taken/Skip buttons and keeps the log targets', async () => {
  const w = loadWorker();
  await w.push(dosePush);
  assert.equal(w.shown.length, 1);
  const { title, options } = w.shown[0];
  assert.equal(title, dosePush.title);
  assert.equal(options.body, dosePush.body);
  assert.equal(options.tag, dosePush.tag);
  assert.deepEqual(plain(options.actions.map(a => a.action)), ['taken', 'skip']);
  assert.deepEqual(plain(options.data.regimenIds), ['r1', 'r2']);
  assert.equal(options.data.date, '2026-09-15');
});

test('a dose push with no loggable regimens has no action buttons', async () => {
  const w = loadWorker();
  await w.push({ ...dosePush, data: { ...dosePush.data, regimenIds: [] } });
  assert.equal(w.shown[0].options.actions, undefined);
});

test('low-stock and test pushes never get dose buttons', async () => {
  const w = loadWorker();
  await w.push({ title: 'Low stock', body: 'x', tag: 'low-stock-1', data: { kind: 'low-stock', url: '/' } });
  await w.push({ title: 'PillPipe Test', body: 'ok', tag: 'pillpipe-test', data: { kind: 'test', url: '/' } });
  await w.push({ title: 'Legacy', body: 'old shape', tag: 'x', url: '/legacy' });
  assert.ok(w.shown.every(s => s.options.actions === undefined));
  assert.equal(w.shown[2].options.data.url, '/legacy', 'old payloads with a top-level url still work');
});

test('a non-JSON push payload still shows something', async () => {
  const w = loadWorker();
  await w.fire('push', { data: { json: () => { throw new Error('bad json'); }, text: () => 'plain text' } });
  assert.equal(w.shown[0].title, 'PillPipe');
  assert.equal(w.shown[0].options.body, 'plain text');
});

test('Taken logs every listed regimen from the worker itself (works with the app closed)', async () => {
  const w = loadWorker();
  w.setWindows(0);
  await w.click({ action: 'taken', data: dosePush.data });
  assert.equal(w.fetchCalls.length, 2);
  for (const [i, id] of ['r1', 'r2'].entries()) {
    const { url, init } = w.fetchCalls[i];
    assert.equal(url, '/api/dose-log');
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.headers['X-Requested-With'], 'pillpipe', 'CSRF header');
    assert.deepEqual(JSON.parse(init.body), { regimen_id: id, date: '2026-09-15', status: 'taken' });
  }
  assert.equal(w.opened.length, 0, 'a one-tap log must not open the app');
  assert.equal(w.shown.length, 0, 'success is silent');
});

test('Skip logs status "skipped" and tells open panes to refresh', async () => {
  const w = loadWorker();
  w.setWindows(2);
  await w.click({ action: 'skip', data: dosePush.data });
  assert.equal(JSON.parse(w.fetchCalls[0].init.body).status, 'skipped');
  assert.equal(w.posted.length, 2);
  assert.deepEqual(plain(w.posted[0]), { type: 'DOSE_LOGGED', date: '2026-09-15', status: 'skipped' });
});

test('a failed log (signed out / server down) is reported instead of dropped', async () => {
  for (const fetchImpl of [async () => ({ ok: false, status: 401 }), async () => { throw new Error('offline'); }]) {
    const w = loadWorker({ fetchImpl });
    w.setWindows(1);
    await w.click({ action: 'taken', data: dosePush.data });
    assert.equal(w.shown.length, 1);
    assert.equal(w.shown[0].title, "Couldn't log your dose");
    assert.equal(w.shown[0].options.actions, undefined);
    assert.equal(w.posted.length, 0, 'no refresh message on failure');
  }
});

test('tapping the notification body focuses the open app, or opens it', async () => {
  const open = loadWorker();
  open.setWindows(1);
  await open.click({ data: dosePush.data });
  assert.equal(open.focused.length, 1);
  assert.equal(open.fetchCalls.length, 0, 'a body tap logs nothing');

  const closed = loadWorker();
  closed.setWindows(0);
  await closed.click({ data: { ...dosePush.data, url: '/' } });
  assert.deepEqual(closed.opened, ['/']);
});

test('an action tap on a non-dose notification just opens the app', async () => {
  const w = loadWorker();
  w.setWindows(0);
  await w.click({ action: 'taken', data: { kind: 'low-stock', url: '/', regimenIds: [] } });
  assert.equal(w.fetchCalls.length, 0);
  assert.deepEqual(w.opened, ['/']);
});
