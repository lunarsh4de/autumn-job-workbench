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
  const numericTotal = value => Number((String(value || '').match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''));
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', {
      expression: `({total:document.querySelector('#catalog-total')?.textContent,status:document.querySelector('#public-sync-status')?.textContent,statusTitle:document.querySelector('#public-sync-status')?.title,rows:document.querySelectorAll('#catalog-table tr').length,platforms:[...document.querySelectorAll('#catalog-platform option')].map(option=>option.value),featured:[...document.querySelectorAll('[data-featured-company]')].map(card=>({company:card.dataset.featuredCompany,count:card.querySelector('[data-featured-count]')?.textContent})),error:document.querySelector('#toast')?.textContent,githubSignInDisabled:document.querySelector('#github-sign-in')?.disabled,githubRestoreHidden:document.querySelector('#github-restore-backup')?.hidden,githubStatus:document.querySelector('#github-backup-status')?.textContent})`,
      returnByValue: true
    });
    probe = result.result.value;
    if (numericTotal(probe?.total) > 3000 && probe?.rows > 1) break;
    await wait(200);
  }
  if (!(numericTotal(probe?.total) > 3000) || probe?.rows < 2) throw new Error(`Pages auto sync failed: ${JSON.stringify(probe)}`);
  if (!/来源 \d+\/\d+ 正常/.test(probe.status || '')) throw new Error(`Pages source health status failed: ${JSON.stringify(probe)}`);
  const officialPlatforms = ['腾讯校园招聘官网', '美团校园招聘官网', '特斯拉校园招聘官网', '比亚迪校园招聘官网', '吉利汽车校园招聘官网'];
  if (!officialPlatforms.every(platform => probe?.platforms?.includes(platform))) throw new Error(`Official platforms missing: ${JSON.stringify(probe?.platforms)}`);
  if (probe?.featured?.length !== 22 || !probe.featured.some(item => item.company.includes('特斯拉') && numericTotal(item.count) > 0) || !probe.featured.some(item => item.company.includes('比亚迪') && numericTotal(item.count) > 0) || !probe.featured.some(item => item.company.includes('吉利') && numericTotal(item.count) > 0)) throw new Error(`Featured employers failed: ${JSON.stringify(probe?.featured)}`);
  if (probe.githubSignInDisabled !== true || probe.githubRestoreHidden !== true || !/网页版仅保存在本机/.test(probe.githubStatus || '')) throw new Error(`Pages backup boundary failed: ${JSON.stringify(probe)}`);
  await client.send('Runtime.evaluate', { expression: `const select=document.querySelector('#catalog-platform');select.value='腾讯校园招聘官网';select.dispatchEvent(new Event('change',{bubbles:true}))` });
  await wait(100);
  const officialFilter = await client.send('Runtime.evaluate', {
    expression: `({count:document.querySelector('#catalog-result-count')?.textContent,platforms:[...document.querySelectorAll('#catalog-table .source-pill')].map(cell=>cell.textContent)})`,
    returnByValue: true
  });
  const official = officialFilter.result.value;
  if (numericTotal(official?.count) < 1 || official.platforms.some(platform => platform !== '腾讯校园招聘官网')) throw new Error(`Official platform filter failed: ${JSON.stringify(official)}`);
  await client.send('Runtime.evaluate', { expression: `document.querySelector('#reset-catalog-filters')?.click()` });
  await wait(100);
  await client.send('Runtime.evaluate', { expression: `document.querySelector('[data-company-filter="特斯拉|Tesla"]')?.click()` });
  await wait(100);
  const featuredFilter = await client.send('Runtime.evaluate', {
    expression: `({count:document.querySelector('#catalog-result-count')?.textContent,companies:[...document.querySelectorAll('#catalog-table .catalog-company-cell')].map(cell=>cell.firstChild?.textContent || cell.textContent)})`,
    returnByValue: true
  });
  const filtered = featuredFilter.result.value;
  if (numericTotal(filtered?.count) < 1 || filtered.companies.some(company => !company.includes('特斯拉') && company !== 'Tesla')) throw new Error(`Featured company filter failed: ${JSON.stringify(filtered)}`);
  console.log(JSON.stringify({ url: targetUrl, ...probe }, null, 2));
  await client.send('Browser.close');
} finally {
  client?.close();
  await Promise.race([new Promise(done => child.once('exit', done)), wait(1500)]);
  if (!child.killed) child.kill();
}
