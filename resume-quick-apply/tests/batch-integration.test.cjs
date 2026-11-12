// Cross-layer fixtures: real UI -> real worker -> real content adapters -> local ledger.
// Chrome transport, site DOM and model HTTP are simulated; no real job application.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const BW = require('../batch-worker.js');
const RD = require('../data.js');
const { source, until } = require('./helpers.cjs');

const jobFor = adapter => ({ id: 'integration-' + adapter, title: '工业设计实习生', company: '集成测试公司', stage: 'watch', url: adapter === 'boss' ? 'https://www.zhipin.com/job_detail/integration-job.html' : 'https://app.mokahr.com/campus-recruitment/test/123#/apply/integration-job' });
const fixture = job => job.url.includes('zhipin') ? `
  <section class="job-banner"><h1>${job.title}</h1><span class="company-name">${job.company}</span></section>
  <section class="job-detail-box"><div class="job-sec-text">负责产品设计和原型制作</div></section>
  <section class="chat-conversation"><div class="chat-job-info"><a href="${job.url}">岗位</a><span class="job-name">${job.title}</span><span class="company-name">${job.company}</span></div>
    <div class="messages"></div><textarea id="chat-input"></textarea><button class="btn-send">发送</button></section>` : `
  <header class="application-job"><h1>${job.title}</h1><span class="company-name">${job.company}</span></header>
  <div class="job-description">负责产品设计和原型制作</div>
  <form class="application-form" data-job-id="integration-job"><label>姓名<input name="name" required></label><label>邮箱<input name="email" type="email" required></label><button type="submit">提交申请</button></form>`;

async function integrated(t, adapter, options = {}) {
  const job = jobFor(adapter), state = { jobTrackerItems: [job], profile: { name: '模拟姓名', email: 'private@example.org', phone: '13812345678', skills: 'Figma 与实体原型', summary: '产品设计' }, experiences: {}, activeProfileId: 'p-test', activeProfileLabel: '集成测试简历', resume: { dataUrl: 'private-resume-file' } };
  const session = {}, changed = [], pages = new Map(), calls = { pageMessages: [], modelRequests: [], records: [], actions: [], sends: 0, submits: 0 };
  const storage = (data, area) => ({
    async get(keys) { return Object.fromEntries(keys.map(key => [key, structuredClone(data[key])])); },
    async set(patch) {
      const changes = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { oldValue: structuredClone(data[key]), newValue: structuredClone(value) }]));
      Object.assign(data, structuredClone(patch));
      for (const listener of changed) listener(changes, area);
    },
    async remove(key) { delete data[key]; }
  });
  let nextTab = 0, worker;
  const chrome = {
    storage: { local: storage(state, 'local'), session: { ...storage(session, 'session'), async setAccessLevel(value) { assert.equal(value.accessLevel, 'TRUSTED_CONTEXTS'); } }, onChanged: { addListener(fn) { changed.push(fn); } } },
    permissions: { async contains() { return true; }, async request() { return true; } },
    tabs: {
      async create({ url }) {
        const id = ++nextTab;
        const dom = new JSDOM(fixture(job), { url, runScripts: 'outside-only', pretendToBeVisual: true });
        t.after(() => dom.window.close());
        const w = dom.window, listeners = [];
        w.CSS = { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) };
        const originalTimer = w.setTimeout.bind(w);
        w.setTimeout = (fn, delay, ...args) => originalTimer(fn, [7000, 5000].includes(delay) ? 90 : delay === 600 ? 10 : delay, ...args);
        w.chrome = { storage: chrome.storage, runtime: { id: 'integration-extension', getURL: path => `chrome-extension://integration-extension/${path}`, onMessage: { addListener(fn) { listeners.push(fn); } }, async sendMessage(message) { throw new Error('Unexpected content outbound command: ' + message.type); } } };
        if (adapter === 'boss') w.document.querySelector('.btn-send').addEventListener('click', () => {
          calls.sends++;
          const item = w.document.createElement('div'); item.className = 'message-item is-self';
          if (!options.optimistic) item.dataset.status = 'sent';
          const body = w.document.createElement('span'); body.className = 'text'; body.textContent = w.document.querySelector('#chat-input').value;
          item.append(body); w.document.querySelector('.messages').append(item);
        });
        else {
          w.document.querySelector('form').addEventListener('submit', event => event.preventDefault());
          w.document.querySelector('button').addEventListener('click', () => {
            calls.submits++;
            const success = w.document.createElement('div'); success.className = 'application-success'; success.dataset.jobId = options.wrongSuccessJob ? 'other-job' : 'integration-job';
            success.innerHTML = '<h2>申请成功</h2>'; w.document.body.append(success);
          });
        }
        pages.set(id, { id, url, status: 'complete', dom, listeners });
        return { id, url, status: 'complete' };
      },
      async get(id) { const p = pages.get(id); return p && { id, url: p.url, status: 'complete' }; },
      async sendMessage(id, message) {
        calls.pageMessages.push(structuredClone(message));
        assert.doesNotMatch(JSON.stringify(message), /session-secret-key|private-resume-file/);
        const page = pages.get(id);
        return new Promise((resolve, reject) => {
          let handled = false;
          for (const listener of page.listeners) {
            try {
              const result = listener(message, { id: 'integration-extension' }, response => { handled = true; resolve(response); });
              if (result === true) handled = true;
            } catch (error) { reject(error); }
          }
          if (!handled) reject(new Error('No actual content listener handled ' + message.type));
        });
      }
    },
    scripting: { async executeScript({ target, files }) { for (const file of files) pages.get(target.tabId).dom.window.eval(source(file)); } },
    runtime: { id: 'integration-extension', async sendMessage(message) { calls.actions.push(message.action); return worker.handle(message.action, message.payload); } }
  };
  worker = BW.create({ chrome, async recordApplication(application) {
    calls.records.push(structuredClone(application));
    const result = RD.mergeApplication(state.applications || [], { ...application, createdAt: Date.now(), updatedAt: Date.now() });
    await chrome.storage.local.set({ applications: result.applications });
  }, async fetchImpl(url, settings) {
    calls.modelRequests.push({ url, body: settings.body });
    assert.doesNotMatch(settings.body, /session-secret-key|private-resume-file|private@example.org|13812345678|模拟姓名/);
    return new Response(JSON.stringify({ choices: [{ message: { content: '您好，我有产品设计与原型经验，希望了解此岗位。' } }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  const ui = new JSDOM(source('batch.html'), { url: 'https://extension-ui.test/batch.html', runScripts: 'outside-only' });
  t.after(() => ui.window.close()); ui.window.chrome = chrome;
  // Only jsdom's inability to create chrome-extension: origins is replaced.
  ui.window.eval(source('batch.js').replace("location.protocol!=='chrome-extension:'", 'false'));
  await until(() => !ui.window.document.body.hasAttribute('aria-busy'));
  return { state, session, calls, worker, pages, ui: ui.window, document: ui.window.document, job };
}

async function reviewAndStart(h) {
  const d = h.document;
  d.querySelector('#endpoint').value = 'https://api.vendor.com/v1/chat/completions';
  d.querySelector('#model').value = 'fixture-model'; d.querySelector('#api-key').value = 'session-secret-key';
  d.querySelector('#api-form').dispatchEvent(new h.ui.Event('submit', { cancelable: true }));
  await until(() => h.session.batchApiConfig && !d.body.hasAttribute('aria-busy'));
  d.querySelector('#job-list input').click(); d.querySelector('#create-batch').click();
  await until(() => h.state.batchRun?.jobs[0]?.state === 'inspected' && !d.body.hasAttribute('aria-busy'));
  assert.equal(h.calls.sends + h.calls.submits, 0);
  d.querySelector('#ai-consent').click(); d.querySelector('#generate-all').click();
  await until(() => h.state.batchRun.jobs[0].state === 'generated' && !d.body.hasAttribute('aria-busy'));
  const approve = [...d.querySelectorAll('#review-list button')].find(button => button.textContent === '审核通过');
  approve.click();
  await until(() => h.state.batchRun.jobs[0].state === 'approved' && !d.body.hasAttribute('aria-busy'));
  assert.equal(h.calls.sends + h.calls.submits, 0);
  d.querySelector('#execute-consent').click(); d.querySelector('#start-batch').click();
  await until(() => ['complete', 'paused'].includes(h.state.batchRun.state) && !d.body.hasAttribute('aria-busy'));
}

for (const adapter of ['boss', 'moka']) test(`real UI + worker + ${adapter} content integrate reviewed action, evidence, history and durable ledger`, async t => {
  const h = await integrated(t, adapter); await reviewAndStart(h);
  const expected = adapter === 'boss' ? 'communicated' : 'submitted';
  assert.equal(h.state.batchRun.jobs[0].state, expected, JSON.stringify(h.state.batchRun.jobs[0]));
  assert.equal(h.calls.records.length, 1);
  assert.equal(h.calls.records[0].status, expected);
  assert.equal(h.calls.records[0].resumeProfileId, 'p-test');
  assert.equal(h.state.applications[0].status, expected);
  assert.equal(h.state.batchAttempts[h.job.url].state, 'confirmed');
  assert.equal(h.state.batchAttempts[h.job.url].status, expected);
  assert.equal(h.calls.pageMessages.filter(message => message.type === 'batchExecute').length, 1);
  assert.equal(h.calls.modelRequests.length, 1);
  assert.equal(h.state.batchRun.jobs[0].evidence.kind, adapter === 'boss' ? 'new_self_message_acknowledged' : 'new_application_success');
  assert.doesNotMatch(JSON.stringify(h.state), /session-secret-key/);
  if (adapter === 'moka') {
    assert.equal([...h.pages.values()][0].dom.window.document.querySelector('input[name="name"]').value, '模拟姓名');
    assert.equal(h.calls.pageMessages.find(message => message.type === 'fillResume').state.resume, null);
  }
  await assert.rejects(h.worker.handle('create', { jobIds: [h.job.id] }), /不会重复发送/);
});

test('real BOSS optimistic DOM without sent acknowledgement stays uncertain across all layers', async t => {
  const h = await integrated(t, 'boss', { optimistic: true }); await reviewAndStart(h);
  assert.equal(h.state.batchRun.jobs[0].state, 'uncertain');
  assert.equal(h.calls.sends, 1); assert.equal(h.calls.records.length, 0);
  assert.equal(h.state.batchAttempts[h.job.url].state, 'uncertain');
});

test('real Moka success for a different job cannot be recorded by worker', async t => {
  const h = await integrated(t, 'moka', { wrongSuccessJob: true }); await reviewAndStart(h);
  assert.equal(h.state.batchRun.jobs[0].state, 'uncertain');
  assert.equal(h.calls.submits, 1); assert.equal(h.calls.records.length, 0);
  assert.equal(h.state.batchAttempts[h.job.url].state, 'uncertain');
});
