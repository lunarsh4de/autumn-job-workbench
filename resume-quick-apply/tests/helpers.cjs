const { JSDOM } = require('jsdom');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const source = file => readFileSync(path.join(__dirname, '..', file), 'utf8');
const pdf = { name: 'test.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nTest fixture').toString('base64') };
async function until(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for expected UI state');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function setup(t, html, state = {}, url = 'https://jobs.example.test/apply') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  const data = structuredClone(state);
  const writes = [];
  let listener;
  let listenerCount = 0;
  w.chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])])); },
      async set(patch) {
        writes.push(structuredClone(patch));
        await new Promise(resolve => setTimeout(resolve, 3));
        Object.assign(data, structuredClone(patch));
      }
    } },
    runtime: { getURL(path) { return `chrome-extension://test/${path}`; }, onMessage: { addListener(fn) { listener = fn; listenerCount++; } } },
    tabs: { async query() { return [{ id: 1, url: 'https://jobs.example.test/apply' }]; } }
  };
  // jsdom lacks these platform features. Tests simulate them; not a browser load test.
  w.CSS = { escape: value => value.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
  Object.defineProperty(w.HTMLElement.prototype, 'isContentEditable', { get() { return this.getAttribute('contenteditable') === 'true'; } });
  w.eval(source('data.js'));
  return { w, data, writes, document: w.document, listenerCount() { return listenerCount; },
    send(state) { return new Promise(resolve => listener({ type: 'fillResume', state }, {}, resolve)); },
    message(type, state) { return new Promise(resolve => listener({ type, state }, {}, resolve)); }
  };
}
function content(t, html, state, url) {
  const harness = setup(t, html, state, url);
  harness.w.eval(source('content.js'));
  return harness;
}
async function popup(t, state) {
  const h = setup(t, source('popup.html'), state);
  h.w.eval(source('resume-parser.js'));
  h.w.eval(source('popup.js'));
  await until(() => !h.document.querySelector('#save-button').disabled);
  return h;
}
module.exports = { source, pdf, until, setup, content, popup };
