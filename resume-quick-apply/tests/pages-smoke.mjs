import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const profile = resolve(process.env.RQA_PAGES_PROFILE || join('..', 'output', 'pages-smoke-profile'));
const targetUrl = process.env.RQA_PAGES_URL || 'http://127.0.0.1:4173/';
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!existsSync(edge)) throw new Error('Microsoft Edge was not found.');
if (existsSync(profile)) throw new Error(`Pages smoke profile already exists: ${profile}`);
mkdirSync(profile, { recursive: true });

const child = spawn(edge, [
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', targetUrl
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));

async function waitForFile(path, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`);
    await wait(100);
  }
}

async function waitForPage(port, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const page = targets.find(target => target.type === 'page' && target.url.startsWith(targetUrl));
      if (page) return page;
    } catch {}
    await wait(100);
  }
  throw new Error('Timed out waiting for Pages target.');
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const handlers = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handlers.reject(new Error(message.error.message)); else handlers.resolve(message.result);
  };
  return {
    ready: new Promise((resolveReady, reject) => { socket.onopen = resolveReady; socket.onerror = reject; }),
    send(method, params = {}) {
      return new Promise((resolveSend, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve: resolveSend, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); }
  };
}

let client;
try {
  const activePort = join(profile, 'DevToolsActivePort');
  await waitForFile(activePort);
  const port = Number(readFileSync(activePort, 'utf8').split(/\r?\n/)[0]);
  const page = await waitForPage(port);
  client = connect(page.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Runtime.enable');
  const deadline = Date.now() + 30000;
  let probe;
  const numericTotal = value => Number(String(value || '').replace(/,/g, ''));
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', {
      expression: `({total:document.querySelector('#catalog-total')?.textContent,status:document.querySelector('#public-sync-status')?.textContent,statusTitle:document.querySelector('#public-sync-status')?.title,rows:document.querySelectorAll('#catalog-table tr').length,error:document.querySelector('#toast')?.textContent,githubSignInDisabled:document.querySelector('#github-sign-in')?.disabled,githubStatus:document.querySelector('#github-backup-status')?.textContent})`,
      returnByValue: true
    });
    probe = result.result.value;
    if (numericTotal(probe?.total) > 3000 && probe?.rows > 1) break;
    await wait(200);
  }
  if (!(numericTotal(probe?.total) > 3000) || probe?.rows < 2) throw new Error(`Pages auto sync failed: ${JSON.stringify(probe)}`);
  if (!/来源 \d+\/\d+ 正常/.test(probe.status || '')) throw new Error(`Pages source health status failed: ${JSON.stringify(probe)}`);
  if (probe.githubSignInDisabled !== true || !/网页版仅保存在本机/.test(probe.githubStatus || '')) throw new Error(`Pages backup boundary failed: ${JSON.stringify(probe)}`);
  console.log(JSON.stringify({ url: targetUrl, ...probe }, null, 2));
  await client.send('Browser.close');
} finally {
  client?.close();
  await Promise.race([new Promise(done => child.once('exit', done)), wait(1500)]);
  if (!child.killed) child.kill();
}
