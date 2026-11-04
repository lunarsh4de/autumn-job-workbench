const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source, until } = require('./helpers.cjs');
const RD = require('../data.js');
const TD = require('../dashboard-data.js');
const WD = require('../workbench-data.js');
const site = 'https://lunarsh4de.github.io/autumn-job-workbench/';
const item = (extra = {}) => TD.item({ id: 'one', url: 'https://www.zhipin.com/job_detail/abc.html', title: '产品经理', company: '示例公司', createdAt: 1000, updatedAt: 1000, ...extra });
let sequence = 0;
const diff = (before, after) => WD.diff(before, after, () => `op-${++sequence}`);

function worker(initial = {}) {
  const state = structuredClone(initial);
  const listeners = [];
  let handler;
  const event = { addListener() {} };
  const chrome = {
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, getManifest: () => ({ version: '0.18.0' }), onMessage: { addListener(fn) { handler = fn; } }, onInstalled: event, onStartup: event },
    storage: { onChanged: { addListener(fn) { listeners.push(fn); } }, local: {
      async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(state[key])])); },
      async set(patch) {
        const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: structuredClone(state[key]), newValue: structuredClone(value) }]));
        Object.assign(state, structuredClone(patch));
        listeners.forEach(fn => fn(changes, 'local'));
      }
    } },
    commands: { onCommand: event }, contextMenus: { onClicked: event }, tabs: { create() {} }
  };
  Function('chrome', 'importScripts', 'ResumeData', 'TrackerData', 'WorkbenchData', source('service-worker.js'))(chrome, () => {}, RD, TD, WD);
  const sender = { id: 'test', tab: { id: 2, url: site }, url: site, frameId: 0 };
  return { state, chrome, sender, send(message, from = sender) { return new Promise(resolve => { const active = handler(message, from, resolve); if (!active) resolve(undefined); }); } };
}

test('independent field edits merge, canonical URLs deduplicate, and retries are idempotent', () => {
  const base = item();
  const first = WD.apply({ items: [base] }, diff([base], [{ ...base, notes: '准备作品集' }]), 2000);
  const operations = diff([base], [{ ...base, stage: 'interview', interviewAt: '2026-11-10T10:00' }]);
  const next = WD.apply(first, operations, 3000);
  assert.equal(next.items[0].notes, '准备作品集');
  assert.equal(next.items[0].stage, 'interview');
  assert.equal(next.items[0].interviewAt, '2026-11-10T10:00');
  assert.deepEqual(WD.apply(next, operations, 4000).items, next.items);
  const duplicate = item({ id: 'other', url: base.url + '?utm_source=boss', notes: '另一版本' });
  assert.equal(WD.apply(next, diff([], [duplicate])).items.length, 1);
});

test('concurrent notes retain both versions and deleted records do not revive from stale tabs', () => {
  const base = item({ notes: '原备注' });
  const first = WD.apply({ items: [base] }, diff([base], [{ ...base, notes: '网站备注' }]));
  const second = WD.apply(first, diff([base], [{ ...base, notes: '离线备注' }]));
  assert.match(second.items[0].notes, /网站备注/);
  assert.match(second.items[0].notes, /离线备注/);
  assert.equal(second.conflicts.length, 1);
  const deleted = WD.apply(second, diff(second.items, []));
  const stale = WD.apply(deleted, diff([], [base]));
  assert.equal(stale.items.length, 0);
  assert.equal(stale.conflicts[0].field, 'deleted');
});

test('worker scopes messages to the companion top frame and requires a connection', async () => {
  const h = worker({ applications: [item()] });
  for (const url of ['https://evil.test/', 'https://lunarsh4de.github.io/another-project/', 'https://lunarsh4de.github.io/autumn-job-workbench.evil/']) {
    assert.equal(await h.send({ type: 'workbenchSync', action: 'connect' }, { ...h.sender, url }), undefined);
  }
  assert.equal(await h.send({ type: 'workbenchSync', action: 'connect' }, { ...h.sender, frameId: 2 }), undefined);
  assert.match((await h.send({ type: 'workbenchSync', action: 'pull' })).error, /连接插件/);
  const result = await h.send({ type: 'workbenchSync', action: 'connect' });
  assert.equal(result.items.length, 1);
  assert.equal(result.profile, undefined);
  assert.equal(result.resume, undefined);
  await h.send({ type: 'workbenchSync', action: 'disconnect' });
  assert.match((await h.send({ type: 'workbenchSync', action: 'pull' })).error, /连接插件/);
});

test('website updates project into plugin history and deletion removes both copies', async () => {
  const h = worker({ applications: [item({ status: 'submitted' })] });
  const first = await h.send({ type: 'workbenchSync', action: 'connect' });
  const updated = { ...first.items[0], stage: 'interview', notes: '周五带作品集' };
  const operations = diff(first.items, [updated]);
  operations[0].patch.profile = 'forbidden';
  const next = await h.send({ type: 'workbenchSync', action: 'commit', operations });
  assert.equal(h.state.applications[0].workflowStage, 'interview');
  assert.equal(h.state.applications[0].notes, '周五带作品集');
  assert.equal(h.state.profile, undefined);
  await h.send({ type: 'workbenchSync', action: 'commit', operations: diff(next.items, []) });
  assert.equal(h.state.applications.length, 0);
  assert.equal(h.state.jobTrackerItems.length, 0);
  await h.send({ type: 'workbenchSync', action: 'commit', operations: diff([], [updated]) });
  assert.equal(h.state.jobTrackerItems.length, 0);
});

function page(t, h, initial = {}) {
  const dom = new JSDOM('<!doctype html><title>工作台</title>', { url: site, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.structuredClone = structuredClone;
  w.setInterval = () => 0;
  w.postMessage = data => queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', { data: structuredClone(data), source: w, origin: w.location.origin })));
  w.eval(source('data.js')); w.eval(source('dashboard-data.js')); w.eval(source('workbench-data.js'));
  w.Function('chrome', source('workbench-bridge.js'))({ runtime: { sendMessage: msg => h.send(structuredClone(msg)) }, storage: h.chrome.storage });
  w.eval(source('workbench-sync.js'));
  const local = structuredClone(initial);
  let items = [], status;
  const storage = { async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(local[key])])); }, async set(patch) { Object.assign(local, structuredClone(patch)); } };
  const client = w.WorkbenchSync.create({ storage, onItems(value) { items = structuredClone(value); }, onStatus(value) { status = value; } });
  return { client, local, get items() { return items; }, get status() { return status; } };
}

test('real page client → isolated bridge → worker migrates old records and synchronizes both directions', async t => {
  const h = worker({ applications: [item({ status: 'submitted' })] });
  const p = page(t, h, { jobTrackerItems: [item({ id: 'local', url: 'https://jobs.test/local', notes: '网站旧记录' })] });
  await p.client.start();
  assert.equal(p.status.connected, false);
  assert.equal(p.items.length, 1);
  await p.client.connect();
  assert.equal(p.items.length, 2);
  assert.equal(p.local.workbenchBeforeConnection.length, 1);
  await p.client.save(p.items.map(entry => entry.id === 'local' ? { ...entry, stage: 'offer', notes: '拿到意向' } : entry));
  await until(() => h.state.applications.some(entry => entry.workflowStage === 'offer'), 3000);
  assert.equal(p.local.workbenchOutbox.length, 0);
  await h.send({ type: 'saveApplication', application: item({ url: 'https://jobs.test/new', status: 'submitted' }) }, { id: 'test' });
  await until(() => p.items.length === 3, 3000);
  assert.match(p.status.message, /已同步/);
});

test('outbox survives disconnect, concurrent plugin capture, and reconnect without losing edits', async t => {
  const h = worker({ applications: [item({ status: 'submitted' })] });
  const p = page(t, h);
  await p.client.start(); await p.client.connect();
  await p.client.disconnect();
  await p.client.save(p.items.map(entry => ({ ...entry, notes: '断开时的备注' })));
  assert.equal(p.local.workbenchOutbox.length, 1);
  await h.send({ type: 'saveApplication', application: item({ url: 'https://jobs.test/second', status: 'submitted' }) }, { id: 'test' });
  await p.client.connect();
  assert.equal(p.items.length, 2);
  assert.equal(p.items.find(entry => entry.id === 'one' || entry.url.includes('abc')).notes, '断开时的备注');
  assert.equal(p.local.workbenchOutbox.length, 0);
});

test('plugin manual edits update website-created records and automatic signals cannot restore deleted jobs', async () => {
  const original = item({ source: 'manual', stage: 'interview', notes: '网站备注' });
  const h = worker({ jobTrackerItems: [original], workbenchConnected: true });
  await h.send({ type: 'workbenchSync', action: 'pull' });
  const changed = await h.send({ type: 'saveApplication', application: { ...h.state.applications[0], source: 'manual', notes: '插件更新备注' } }, { id: 'test' });
  assert.equal(changed.applications[0].notes, '插件更新备注');
  assert.equal(h.state.jobTrackerItems[0].notes, '插件更新备注');
  assert.equal(h.state.jobTrackerItems[0].stage, 'interview');
  await h.send({ type: 'workbenchSync', action: 'commit', operations: diff(h.state.jobTrackerItems, []) });
  await h.send({ type: 'saveApplication', application: { ...original, source: 'auto' } }, { id: 'test' });
  assert.equal(h.state.jobTrackerItems.length, 0);
  const restore = diff([], [original]); restore[0].restore = true;
  await h.send({ type: 'workbenchSync', action: 'commit', operations: restore });
  assert.equal(h.state.jobTrackerItems.length, 1);
});

test('clear history also clears linked tracker jobs and does not resurrect on the next pull', async () => {
  const h = worker({ applications: [item()], workbenchConnected: true });
  await h.send({ type: 'workbenchSync', action: 'pull' });
  await h.send({ type: 'clearApplications' }, { id: 'test' });
  assert.equal((await h.send({ type: 'workbenchSync', action: 'pull' })).items.length, 0);
  assert.equal(h.state.applications.length, 0);
});

test('own extension dashboard and profile page work when opened as browser tabs', async () => {
  const h = worker();
  const internal = { id: 'test', url: 'chrome-extension://test/dashboard.html', tab: { id: 8, url: 'chrome-extension://test/dashboard.html' }, frameId: 0 };
  assert.equal((await h.send({ type: 'workbenchSync', action: 'pull' }, internal)).connected, true);
  assert.equal((await h.send({ type: 'saveApplication', application: item() }, internal)).applications.length, 1);
  await h.send({ type: 'clearApplications' }, internal);
  assert.equal(h.state.applications.length, 0);
});
