const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { content, popup, source, until } = require('./helpers.cjs');

test('manifest uses temporary active-tab access without persistent host permission', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'contextMenus', 'scripting', 'storage'].sort());
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.commands['quick-fill'].suggested_key.default, 'Alt+Shift+F');
});

test('reinjecting content script is idempotent', t => {
  const h = content(t, '<input name="email"><input name="phone">');
  h.w.eval(source('content.js'));
  assert.equal(h.document.querySelectorAll('#resume-quick-apply-root').length, 1);
  assert.equal(h.listenerCount(), 1);
});

test('popup injects scripts on demand when an existing page has no listener', async t => {
  const h = await popup(t, { profile: { name: '测试' } });
  let injected = false;
  let calls = 0;
  let injection;
  h.w.chrome.tabs.sendMessage = async (id, request) => {
    calls++;
    if (!injected) throw new Error('Receiving end does not exist');
    return { message: '按需注入成功' };
  };
  h.w.chrome.scripting = { async executeScript(options) { injection = options; injected = true; } };
  h.document.querySelector('#fill-button').click();
  await until(() => !h.document.querySelector('#fill-button').disabled);
  assert.equal(calls, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(injection)), { target: { tabId: 1 }, files: ['data.js', 'content.js'] });
  assert.equal(h.document.querySelector('#message').textContent, '按需注入成功');
});

test('runtime files contain no remote network transports', () => {
  const runtime = ['data.js', 'resume-parser.js', 'popup.js', 'content.js', 'service-worker.js'].map(source).join('\n');
  assert.doesNotMatch(runtime, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

test('resume parsers are self-hosted with licenses and no remote script tags', () => {
  const path = require('node:path');
  const root = path.join(__dirname, '..', 'vendor');
  for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'mammoth.browser.min.js', 'PDFJS-LICENSE', 'MAMMOTH-LICENSE']) {
    assert.ok(readFileSync(path.join(root, file)).length > 1000, `${file} is missing or unexpectedly small`);
  }
  assert.doesNotMatch(source('popup.html'), /<script[^>]+src=["']https?:/i);
});

test('first-install onboarding opens only for install, not update', () => {
  const script = source('service-worker.js');
  let installed;
  const calls = [];
  const event = () => ({ addListener() {} });
  const chrome = {
    runtime: { lastError: null, getURL: path => `chrome-extension://test/${path}`, onInstalled: { addListener(fn) { installed = fn; } }, onStartup: event() },
    tabs: { create(input) { calls.push(input); } }, commands: { onCommand: event() },
    contextMenus: { removeAll(callback) { callback(); }, create(options, callback) { callback(); }, onClicked: event() }
  };
  Function('chrome', 'importScripts', 'ResumeData', script)(chrome, () => {}, require('../data.js'));
  installed({ reason: 'update' });
  assert.equal(calls.length, 0);
  installed({ reason: 'install' });
  assert.deepEqual(calls, [{ url: 'chrome-extension://test/onboarding.html' }]);
});

test('installer script is ASCII and supports validation-only mode', () => {
  const installer = readFileSync(require('node:path').join(__dirname, '..', 'install', 'Install-ResumeQuickApply.ps1'));
  assert.ok([...installer].every(byte => byte < 128));
  assert.match(installer.toString('ascii'), /ValidateOnly/);
  assert.match(installer.toString('ascii'), /Developer mode/);
  assert.match(installer.toString('ascii'), /vendorFiles/);
});
