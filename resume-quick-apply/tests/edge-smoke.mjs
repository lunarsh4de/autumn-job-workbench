import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(process.env.RQA_EXTENSION_ROOT || resolve(here, '..'));
const profileRoot = process.env.RQA_EDGE_PROFILE ? resolve(process.env.RQA_EDGE_PROFILE) : resolve(here, '..', '..', 'output', 'edge-smoke-0.12.2');
const resumeFixture = process.env.RQA_RESUME_FIXTURE ? resolve(process.env.RQA_RESUME_FIXTURE) : null;
const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
];
const edge = edgeCandidates.find(existsSync);
if (!edge) throw new Error('Microsoft Edge executable was not found.');
if (existsSync(profileRoot)) throw new Error(`Smoke-test profile already exists: ${profileRoot}`);
mkdirSync(profileRoot, { recursive: true });

const child = spawn(edge, [
  `--user-data-dir=${profileRoot}`,
  `--disable-extensions-except=${extensionRoot}`,
  `--load-extension=${extensionRoot}`,
  '--remote-debugging-port=0', '--window-position=-32000,-32000', '--window-size=900,700', '--no-first-run', '--no-default-browser-check', '--enable-logging=stderr', '--v=1',
  'edge://extensions/'
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let edgeLog = '';
child.stderr.on('data', chunk => { edgeLog = (edgeLog + chunk.toString()).slice(-12000); });

const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
async function waitForFile(path, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    await wait(100);
  }
}
async function waitForTarget(port, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastTargets = [];
  while (Date.now() < deadline) {
    try {
      lastTargets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const match = lastTargets.find(predicate);
      if (match) return match;
    } catch {}
    await wait(150);
  }
  throw new Error(`Timed out waiting for Edge DevTools target. Last targets: ${JSON.stringify(lastTargets.map(item => ({ type: item.type, url: item.url })))}`);
}
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: done, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else done(message.result);
  };
  const ready = new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  return {
    ready,
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((done, reject) => {
        pending.set(id, { resolve: done, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); }
  };
}

async function waitForEvaluation(client, expression, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', { expression, returnByValue: true });
    value = result.result.value;
    if (value) return value;
    await wait(100);
  }
  throw new Error(`Timed out waiting for browser expression. Last value: ${JSON.stringify(value)}`);
}

let client;
try {
  const activePort = join(profileRoot, 'DevToolsActivePort');
  await waitForFile(activePort);
  const [portText] = readFileSync(activePort, 'utf8').split(/\r?\n/);
  const port = Number(portText);
  const extensionTarget = await waitForTarget(port, item => /^chrome-extension:\/\/[a-p]{32}\/(service-worker\.js|onboarding\.html)$/.test(item.url));
  const extensionId = new URL(extensionTarget.url).hostname;
  const target = await waitForTarget(port, item => item.type === 'page' && !item.url.startsWith('chrome-extension://'));
  client = connect(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/popup.html` });
  await wait(700);
  const probe = await client.send('Runtime.evaluate', {
    expression: `(() => { try { const m=chrome.runtime.getManifest(); return {id:chrome.runtime.id,name:m.name,version:m.version,title:document.title,shortcut:m.commands?.['quick-fill']?.suggested_key?.default}; } catch { return null; } })()`,
    returnByValue: true
  });
  const extension = probe.result.value;
  if (!extension || extension.name !== '投简历助手') throw new Error(`Edge extension target did not expose the expected manifest. Target: ${extensionTarget.url} Probe: ${JSON.stringify(extension)} Log: ${edgeLog.slice(-4000)}`);
  if (extension.version !== '0.12.2') throw new Error(`Unexpected Edge extension version: ${extension.version}`);
  if (extension.shortcut !== 'Alt+Shift+F') throw new Error(`Unexpected quick-fill shortcut: ${extension.shortcut}`);
  const popup = await client.send('Runtime.evaluate', {
    expression: `({ title: document.title, fill: !!document.querySelector('#fill-button'), profile: !!document.querySelector('#profile-form'), quickAttachment: !!document.querySelector('#quick-attachment'), tabs: document.querySelectorAll('[role="tab"]').length })`,
    returnByValue: true
  });
  const value = popup.result.value;
  if (value.title !== '投简历助手' || !value.fill || !value.profile || !value.quickAttachment || value.tabs !== 4) throw new Error(`Popup smoke test failed: ${JSON.stringify(value)}`);
  let resumeImport = null;
  if (resumeFixture) {
    if (!existsSync(resumeFixture)) throw new Error(`Resume fixture does not exist: ${resumeFixture}`);
    await client.send('DOM.enable');
    const documentNode = await client.send('DOM.getDocument');
    const input = await client.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#resume-import-file' });
    if (!input.nodeId) throw new Error('Resume import file input was not found.');
    await client.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [resumeFixture] });
    await client.send('Runtime.evaluate', { expression: `document.querySelector('#resume-import-file').dispatchEvent(new Event('change', {bubbles:true}))` });
    resumeImport = await waitForEvaluation(client, `(() => {
      const preview=document.querySelector('#resume-import-preview');
      const message=document.querySelector('#message');
      if (!preview.hidden) return {ok:true,summary:document.querySelector('#resume-import-summary').textContent};
      if (!message.hidden && message.dataset.error==='true') return {ok:false,error:message.textContent};
      return null;
    })()`);
    if (!resumeImport.ok) throw new Error(`Resume import failed: ${resumeImport.error}`);
    await client.send('Runtime.evaluate', { expression: `document.querySelector('#resume-import-apply').click()` });
    await waitForEvaluation(client, `(() => {
      const message=document.querySelector('#message');
      return document.querySelector('#resume-import-preview').hidden && /分类结果已导入/.test(message.textContent);
    })()`);
    const stored = await client.send('Runtime.evaluate', {
      expression: `(async()=>{const s=await chrome.storage.local.get(['profile','experiences','resume']);return {name:s.profile?.name||'',work:s.experiences?.work?.length||0,education:s.experiences?.education?.length||0,projects:s.experiences?.projects?.length||0,competitions:s.experiences?.competitions?.length||0,awards:s.experiences?.awards?.length||0,campus:s.experiences?.campus?.length||0,languages:s.experiences?.languages?.length||0,publications:s.experiences?.publications?.length||0,attachment:s.resume?.name||''};})()`,
      awaitPromise: true,
      returnByValue: true
    });
    resumeImport.applied = stored.result.value;
    if (!resumeImport.applied || resumeImport.applied.work + resumeImport.applied.education + resumeImport.applied.projects + resumeImport.applied.competitions + resumeImport.applied.awards + resumeImport.applied.campus + resumeImport.applied.languages + resumeImport.applied.publications === 0) {
      throw new Error(`Resume import did not persist structured experiences: ${JSON.stringify(resumeImport.applied)}`);
    }
  }
  console.log(JSON.stringify({ edge, extension, popup: value, resumeImport, profileRoot }, null, 2));
  await client.send('Browser.close');
} finally {
  client?.close();
  await Promise.race([new Promise(done => child.once('exit', done)), wait(2000)]);
  if (!child.killed) child.kill();
}
