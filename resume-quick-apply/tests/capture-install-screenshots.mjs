import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(process.env.RQA_EXTENSION_ROOT || resolve(here, '..'));
const outputRoot = resolve(process.env.RQA_SCREENSHOT_DIR || join(here, '..', '..', 'output', 'edge-install-screenshots-0.15.0'));
const profileRoot = resolve(process.env.RQA_SCREENSHOT_PROFILE || join(here, '..', '..', 'output', 'edge-install-screenshots-0.15.0-profile'));
const edgeCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
];
const edge = edgeCandidates.find(existsSync);
if (!edge) throw new Error('Microsoft Edge executable was not found.');
if (existsSync(profileRoot)) throw new Error(`Screenshot profile already exists: ${profileRoot}`);
mkdirSync(profileRoot, { recursive: true });
mkdirSync(outputRoot, { recursive: true });

const child = spawn(edge, [
  `--user-data-dir=${profileRoot}`, `--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`,
  '--remote-debugging-port=0', '--window-position=0,0', '--window-size=1000,800', '--no-first-run', '--no-default-browser-check',
  'edge://extensions/'
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
async function waitForFile(path, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path)) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${path}`); await wait(100); }
}
async function waitForTarget(port, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const match = targets.find(predicate);
      if (match) return match;
    } catch {}
    await wait(150);
  }
  throw new Error('Timed out waiting for Edge target.');
}
function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
  };
  const ready = new Promise((resolveReady, rejectReady) => { socket.onopen = resolveReady; socket.onerror = rejectReady; });
  return { ready, send(method, params = {}) { const id = ++sequence; return new Promise((resolveSend, rejectSend) => { pending.set(id, { resolve: resolveSend, reject: rejectSend }); socket.send(JSON.stringify({ id, method, params })); }); }, close() { socket.close(); } };
}
async function capture(client, file) {
  const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
  writeFileSync(file, Buffer.from(result.data, 'base64'));
}

let client;
try {
  const activePort = join(profileRoot, 'DevToolsActivePort');
  await waitForFile(activePort);
  const [portText] = readFileSync(activePort, 'utf8').split(/\r?\n/);
  const port = Number(portText);
  const extensionTarget = await waitForTarget(port, item => /^chrome-extension:\/\/[a-p]{32}\/(?:service-worker\.js|onboarding\.html)$/.test(item.url));
  const extensionId = new URL(extensionTarget.url).hostname;
  const target = await waitForTarget(port, item => item.type === 'page' && !item.url.startsWith('chrome-extension://'));
  client = connect(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  await wait(900);
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/popup.html` });
  await wait(700);
  await capture(client, join(outputRoot, 'edge-popup-live.png'));
  console.log(JSON.stringify({ edge, extensionId, outputRoot, files: ['edge-popup-live.png'] }, null, 2));
  await client.send('Browser.close');
} finally {
  client?.close();
  await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), wait(2000)]);
  if (!child.killed) child.kill();
}
