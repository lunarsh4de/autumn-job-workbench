const test = require('node:test');
const assert = require('node:assert/strict');
const { source, pdf, until } = require('./helpers.cjs');
const ResumeData = require('../data.js');

function event() {
  let listener;
  return { addListener(fn) { listener = fn; }, fire(...args) { return listener(...args); } };
}

function worker(state = {}, failFirstMessage = false) {
  const events = { installed: event(), startup: event(), command: event(), clicked: event() };
  const messages = [];
  const injections = [];
  const badges = [];
  const menu = [];
  let attempts = 0;
  const chrome = {
    runtime: { lastError: null, getURL: path => `chrome-extension://test/${path}`, onInstalled: events.installed, onStartup: events.startup },
    storage: { local: { async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(state[key])])); } } },
    tabs: {
      async query() { return [{ id: 7, url: 'https://jobs.example.test/apply' }]; },
      async sendMessage(id, request) {
        attempts++;
        if (failFirstMessage && attempts === 1) throw new Error('no receiver');
        messages.push(structuredClone(request));
        return { filled: 2, attached: request.state.resume ? 1 : 0, message: '已填 2 项' };
      },
      create() {}
    },
    scripting: { async executeScript(options) { injections.push(structuredClone(options)); } },
    commands: { onCommand: events.command },
    contextMenus: {
      removeAll(callback) { callback(); },
      create(options, callback) { menu.push(structuredClone(options)); callback(); },
      onClicked: events.clicked
    },
    action: {
      setBadgeBackgroundColor(options) { badges.push(['color', structuredClone(options)]); },
      setBadgeText(options) { badges.push(['text', structuredClone(options)]); },
      setTitle(options) { badges.push(['title', structuredClone(options)]); }
    }
  };
  Function('chrome', 'importScripts', 'ResumeData', 'setTimeout', 'clearTimeout', source('service-worker.js'))(
    chrome, () => {}, ResumeData, () => 1, () => {});
  return { events, messages, injections, badges, menu };
}

test('install creates a scoped context menu', () => {
  const h = worker();
  h.events.installed.fire({ reason: 'update' });
  assert.equal(h.menu.length, 1);
  assert.deepEqual(h.menu[0].documentUrlPatterns, ['http://*/*', 'https://*/*']);
  assert.deepEqual(h.menu[0].contexts, ['page', 'editable']);
});

test('keyboard quick fill retries injection and excludes attachment by default', async () => {
  const h = worker({ profile: { name: '测试' }, resume: pdf }, true);
  h.events.command.fire('quick-fill');
  await until(() => h.messages.length === 1);
  assert.equal(h.messages[0].state.profile.name, '测试');
  assert.equal(h.messages[0].state.resume, null);
  assert.deepEqual(h.injections, [{ target: { tabId: 7 }, files: ['data.js', 'content.js'] }]);
  assert.ok(h.badges.some(([type, options]) => type === 'text' && options.text === '2'));
});

test('attachment is sent only after explicit opt-in and context menu uses clicked tab', async () => {
  const h = worker({ profile: {}, resume: pdf, settings: { quickAttachment: true } });
  h.events.clicked.fire({ menuItemId: 'resume-quick-apply-fill' }, { id: 9, url: 'https://career.example.test/job' });
  await until(() => h.messages.length === 1);
  assert.equal(h.messages[0].state.resume.name, pdf.name);
  assert.equal(h.messages[0].state.profile.name, '');
});

test('unrelated commands and context menu items do nothing', async () => {
  const h = worker({ profile: { name: '测试' } });
  h.events.command.fire('other-command');
  h.events.clicked.fire({ menuItemId: 'other-menu' }, { id: 9, url: 'https://career.example.test/job' });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.messages.length, 0);
});
