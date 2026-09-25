import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(process.env.RQA_EXTENSION_ROOT || resolve(here, '..'));
const profileRoot = process.env.RQA_EDGE_PROFILE ? resolve(process.env.RQA_EDGE_PROFILE) : resolve(here, '..', '..', 'output', 'edge-smoke-0.15.0');
const screenshotRoot = resolve(here, '..', '..', 'output');
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
  if (extension.version !== '0.15.0') throw new Error(`Unexpected Edge extension version: ${extension.version}`);
  if (extension.shortcut !== 'Alt+Shift+F') throw new Error(`Unexpected quick-fill shortcut: ${extension.shortcut}`);
  const popup = await client.send('Runtime.evaluate', {
    expression: `({ title: document.title, fill: !!document.querySelector('#fill-button'), profile: !!document.querySelector('#profile-form'), quickAttachment: !!document.querySelector('#quick-attachment'), profileSelect: !!document.querySelector('#resume-profile-select'), tabs: document.querySelectorAll('[role="tab"]').length })`,
    returnByValue: true
  });
  const value = popup.result.value;
  if (value.title !== '投简历助手' || !value.fill || !value.profile || !value.quickAttachment || !value.profileSelect || value.tabs !== 4) throw new Error(`Popup smoke test failed: ${JSON.stringify(value)}`);
  await client.send('Runtime.evaluate', {
    expression: `(async()=>chrome.storage.local.set({profile:{},experiences:{},resumeProfiles:[{id:'empty',label:'默认简历',profile:{},resume:null,settings:{},experiences:{}}],activeProfileId:'empty',activeProfileLabel:'默认简历',jobTrackerItems:[
      {id:'demo-1',company:'字节跳动',title:'产品经理',stage:'interview',priority:'high',location:'北京',salary:'25-40K',url:'https://jobs.example.test/1',nextActionAt:'2026-09-24T14:00',interviewAt:'2026-09-24T14:00',notes:'准备产品案例',source:'manual',createdAt:Date.now()-86400000,updatedAt:Date.now()},
      {id:'demo-2',company:'腾讯',title:'用户研究员',stage:'assessment',priority:'medium',location:'深圳',url:'https://jobs.example.test/2',nextActionAt:'2026-09-23T20:00',notes:'完成测评',source:'extension',createdAt:Date.now()-172800000,updatedAt:Date.now()-3600000},
      {id:'demo-3',company:'小米',title:'产品运营',stage:'applied',priority:'normal',location:'上海',url:'https://jobs.example.test/3',deadline:'2026-10-10',notes:'',source:'extension',createdAt:Date.now()-259200000,updatedAt:Date.now()-7200000},
      {id:'demo-4',company:'美团',title:'商业分析师',stage:'offer',priority:'high',location:'北京',salary:'24-38K',url:'https://jobs.example.test/4',notes:'比较薪酬方案',source:'manual',createdAt:Date.now()-345600000,updatedAt:Date.now()-10800000}
    ]}))()`,
    awaitPromise: true
  });
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/dashboard.html` });
  await waitForEvaluation(client, `document.querySelectorAll('#view-catalog .metric-card').length===4 && document.querySelector('#catalog-total').textContent!=='0'`);
  const editorFocus = await client.send('Runtime.evaluate', {
    expression: `(async()=>{const trigger=document.querySelector('#new-job');trigger?.click();const opened=document.querySelector('#job-dialog')?.open && document.activeElement?.name==='company';document.querySelector('#cancel-dialog')?.click();await new Promise(resolve=>setTimeout(resolve,50));return {opened,restored:document.activeElement===trigger};})()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (!editorFocus.result.value.opened || !editorFocus.result.value.restored) throw new Error(`Job editor focus smoke test failed: ${JSON.stringify(editorFocus.result.value)}`);
  await client.send('Runtime.evaluate', { expression: `globalThis.JobTrackerDashboard.showView('overview')` });
  const recentKeyboard = await client.send('Runtime.evaluate', {
    expression: `(async()=>{const trigger=document.querySelector('.recent-item');trigger?.focus();trigger?.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));const opened=document.querySelector('#job-dialog')?.open && document.activeElement?.name==='company';document.querySelector('#cancel-dialog')?.click();await new Promise(resolve=>setTimeout(resolve,50));return {opened,focusable:trigger?.tabIndex===0,role:trigger?.getAttribute('role')};})()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (!recentKeyboard.result.value.opened || !recentKeyboard.result.value.focusable || recentKeyboard.result.value.role !== 'button') throw new Error(`Recent job keyboard smoke test failed: ${JSON.stringify(recentKeyboard.result.value)}`);
  await client.send('Runtime.evaluate', { expression: `globalThis.JobTrackerDashboard.showView('catalog')` });
  const publicStatus = await waitForEvaluation(client, `(() => { const node=document.querySelector('#public-sync-status'); const detail=document.querySelector('#public-sync-detail'); const button=document.querySelector('#sync-public-catalog'); return node && node.dataset.state !== 'loading' ? {state:node.dataset.state,text:node.textContent,detail:detail?.textContent||'',title:node.title,syncButtonEnabled:!button.disabled} : null; })()`);
  if (!publicStatus || /Failed to fetch|NetworkError|Load failed/i.test(`${publicStatus.text} ${publicStatus.title}`)) throw new Error(`Public source status smoke test failed: ${JSON.stringify(publicStatus)}`);
  if (publicStatus.state === 'error' && publicStatus.detail === publicStatus.text) throw new Error(`Public source status repeated its error message: ${JSON.stringify(publicStatus)}`);
  if (!publicStatus.syncButtonEnabled || (publicStatus.state === 'ready' && !/来源 \d+\/\d+ 正常/.test(publicStatus.text))) throw new Error(`Public source health status failed: ${JSON.stringify(publicStatus)}`);
  const emptyResumeStatus = await waitForEvaluation(client, `(() => { const node=document.querySelector('#resume-sync-status'); return node?.dataset.state === 'empty' ? node.textContent : null; })()`);
  if (emptyResumeStatus !== '尚未检测到插件简历') throw new Error(`Empty resume status smoke test failed: ${JSON.stringify(emptyResumeStatus)}`);
  await client.send('Runtime.evaluate', { expression: `chrome.storage.local.set({profile:{name:'测试候选人',city:'上海',skills:'SQL'},experiences:{work:[{role:'产品经理',location:'上海'}]},activeProfileLabel:'产品版'})`, awaitPromise: true });
  const syncedResumeStatus = await waitForEvaluation(client, `(() => { const node=document.querySelector('#resume-sync-status'); return node?.dataset.state === 'ready' && /产品版/.test(node.textContent) ? node.textContent : null; })()`);
  const importFocus = await client.send('Runtime.evaluate', {
    expression: `(async()=>{const trigger=document.querySelector('#open-import');trigger?.click();const opened=document.querySelector('#import-dialog')?.open && document.activeElement?.id==='catalog-paste';document.querySelector('#cancel-import')?.click();await new Promise(resolve=>setTimeout(resolve,50));return {opened,restored:document.activeElement===trigger};})()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (!importFocus.result.value.opened || !importFocus.result.value.restored) throw new Error(`Catalog import focus smoke test failed: ${JSON.stringify(importFocus.result.value)}`);
  await client.send('Runtime.evaluate', {
      expression: `(()=>{document.querySelector('#open-import').click();const input=document.querySelector('#catalog-paste');input.value='公司,岗位,地点,链接,平台,标签,企业类型,岗位类型\\n示例科技,数据分析师,上海,https://jobs.example.test/imported,公开清单,"SQL,Python",外企（中国大陆）,数据算法';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#import-form').requestSubmit();})()`
  });
  await waitForEvaluation(client, `document.querySelector('#catalog-total').textContent==='5' && /导入完成/.test(document.querySelector('#import-result').textContent)`);
  const catalogFilters = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const province=document.querySelector('#catalog-province');
      const city=document.querySelector('#catalog-city');
      const company=document.querySelector('#catalog-company');
      const hasAllCompanySelect=!!document.querySelector('#catalog-company option');
      province.value='上海';
      province.dispatchEvent(new Event('change',{bubbles:true}));
      const cityOptions=[...city.options].map(option=>option.textContent);
      company.value='示例';
      company.dispatchEvent(new Event('input',{bubbles:true}));
      const search=document.querySelector('#catalog-search');
      search.value='外企（中国大陆）';
      search.dispatchEvent(new Event('input',{bubbles:true}));
      const searchResult=document.querySelector('#catalog-result-count').textContent;
      search.value='__no_such_job__';
      search.dispatchEvent(new Event('input',{bubbles:true}));
      const noMatch={result:document.querySelector('#catalog-result-count').textContent,reset:!!document.querySelector('#catalog-table [data-reset-catalog]')};
      document.querySelector('#catalog-table [data-reset-catalog]')?.click();
      search.value='';
      search.dispatchEvent(new Event('input',{bubbles:true}));
      return {companyInput:company.type==='search',hasAllCompanySelect,cityOptions,result:document.querySelector('#catalog-result-count').textContent,searchResult,noMatch,afterClear:document.querySelector('#catalog-result-count').textContent};
    })()`,
    returnByValue: true
  });
  const filterValue = catalogFilters.result.value;
  if (!filterValue.companyInput || filterValue.hasAllCompanySelect || !filterValue.cityOptions.includes('上海') || filterValue.result !== '5 个岗位' || filterValue.searchResult !== '1 个岗位' || filterValue.noMatch.result !== '0 个岗位' || !filterValue.noMatch.reset || filterValue.afterClear !== '5 个岗位') {
    throw new Error(`Catalog filter smoke test failed: ${JSON.stringify(filterValue)}`);
  }
  await client.send('Runtime.evaluate', {
    expression: `(()=>{const company=document.querySelector('#catalog-company');company.value='示例';company.dispatchEvent(new Event('input',{bubbles:true}));const search=document.querySelector('#catalog-search');search.value='外企（中国大陆）';search.dispatchEvent(new Event('input',{bubbles:true}));})()`
  });
  await waitForEvaluation(client, `document.querySelector('#catalog-result-count')?.textContent === '1 个岗位'`);
  const detailFocus = await client.send('Runtime.evaluate', {
    expression: `(async()=>{const trigger=document.querySelector('#catalog-table [data-catalog-details]');trigger?.click();const opened=document.querySelector('#catalog-detail-dialog')?.open && document.activeElement?.id==='catalog-detail-close';document.querySelector('#catalog-detail-close')?.click();await new Promise(resolve=>setTimeout(resolve,50));return {opened,restored:document.activeElement===trigger};})()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (!detailFocus.result.value.opened || !detailFocus.result.value.restored) throw new Error(`Catalog detail focus smoke test failed: ${JSON.stringify(detailFocus.result.value)}`);
  await client.send('Runtime.evaluate', {
    expression: `(()=>{document.querySelector('#open-import').click();const input=document.querySelector('#catalog-paste');input.value='这不是有效岗位数据';document.querySelector('#import-form').requestSubmit();})()`
  });
  const importError = await waitForEvaluation(client, `(() => { const result=document.querySelector('#import-result'); const submit=document.querySelector('#import-form button[type="submit"]'); const dialog=document.querySelector('#import-dialog'); return result?.dataset.error === 'true' && /导入失败/.test(result.textContent) && dialog?.open && !submit?.disabled ? {message:result.textContent} : null; })()`);
  if (!importError) throw new Error('Catalog import error-state smoke test failed.');
  await client.send('Runtime.evaluate', { expression: `document.querySelector('#cancel-import').click()` });
  await client.send('Runtime.evaluate', { expression: `document.querySelector('#catalog-table [data-catalog-track]')?.click()` });
  const trackedMetadata = await waitForEvaluation(client, `(() => { const card=document.querySelector('#kanban .job-card'); return !document.querySelector('#view-board').hidden && card ? {text:card.textContent, companyType:card.textContent.includes('外企（中国大陆）'), jobType:card.textContent.includes('数据算法'), platform:card.textContent.includes('公开清单'), source:card.textContent.includes('岗位库')} : null; })()`);
  if (!trackedMetadata.companyType || !trackedMetadata.jobType || !trackedMetadata.platform || !trackedMetadata.source) throw new Error(`Catalog tracking metadata smoke test failed: ${JSON.stringify(trackedMetadata)}`);
  const autoSyncSeed = await client.send('Runtime.evaluate', {
    expression: `(async()=>{const job={id:'auto-sync-fixture',url:'https://jobs.example.test/auto-sync',title:'自动同步测试岗位',company:'自动同步科技',location:'上海',companyType:'外企（中国大陆）',jobType:'用户研究',platform:'公开清单',importedAt:Date.now(),tags:[]};await globalThis.CatalogDB.putMany([job]);window.__autoSyncExpected={title:job.title,jobType:job.jobType,platform:job.platform};await chrome.storage.local.set({applications:[{url:job.url,title:job.title,company:job.company,createdAt:Date.now(),status:'submitted',source:'auto'}]});return {skipped:false,title:job.title};})()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (autoSyncSeed.result.value?.skipped) throw new Error('Automatic application sync smoke test could not find an untracked catalog item.');
  const autoSyncCard = await waitForEvaluation(client, `(()=>{const expected=window.__autoSyncExpected;const card=[...document.querySelectorAll('#kanban .job-card')].find(item=>expected&&item.textContent.includes(expected.title)&&item.textContent.includes('插件同步'));return card?{text:card.textContent,jobType:!expected.jobType||card.textContent.includes(expected.jobType),platform:!expected.platform||card.textContent.includes(expected.platform)}:null;})()`);
  if (!autoSyncCard.jobType || !autoSyncCard.platform) throw new Error(`Automatic application catalog enrichment failed: ${JSON.stringify(autoSyncCard)}`);
  const stageControl = await client.send('Runtime.evaluate', {
    expression: `(()=>{const card=document.querySelector('#kanban .job-card');const control=card?.querySelector('[data-stage-for]');if(!control)return null;control.value='preparing';control.dispatchEvent(new Event('change',{bubbles:true}));return {options:control.options.length,label:control.getAttribute('aria-label')};})()`,
    returnByValue: true
  });
  if (!stageControl.result.value || stageControl.result.value.options < 5 || !/移至阶段/.test(stageControl.result.value.label || '')) throw new Error(`Kanban stage control smoke test failed: ${JSON.stringify(stageControl.result.value)}`);
  await waitForEvaluation(client, `document.querySelector('#kanban .job-card')?.closest('.kanban-column')?.dataset.stage === 'preparing'`);
  await client.send('Runtime.evaluate', { expression: `globalThis.JobTrackerDashboard.showView('board'); chrome.storage.local.set({applications:[{url:'https://jobs.example.test/imported',title:'数据分析师',company:'示例科技',createdAt:Date.now(),resumeProfileId:'data',resumeProfileLabel:'数据版'}]})`, awaitPromise: true });
  await waitForEvaluation(client, `(() => { const card=[...document.querySelectorAll('#kanban .job-card')].find(item => item.textContent.includes('数据分析师') && item.textContent.includes('示例科技')); return card ? true : null; })()`);
  await wait(400);
  const applicationSyncResult = await client.send('Runtime.evaluate', { expression: `(() => { const card=[...document.querySelectorAll('#kanban .job-card')].find(item => item.textContent.includes('数据分析师') && item.textContent.includes('示例科技')); return card ? {text:card.textContent,stage:card.closest('.kanban-column')?.dataset.stage === 'applied',resume:card.textContent.includes('数据版')} : null; })()`, returnByValue: true });
  const applicationSync = applicationSyncResult.result.value;
  if (!applicationSync.stage || !applicationSync.resume) throw new Error(`Catalog application sync smoke test failed: ${JSON.stringify(applicationSync)}`);
  await client.send('Runtime.evaluate', { expression: `globalThis.JobTrackerDashboard.showView('catalog')` });
  const trackedControl = await client.send('Runtime.evaluate', {
    expression: `(()=>{const button=document.querySelector('#catalog-table [data-catalog-track]');return button?{text:button.textContent,disabled:button.disabled}:null;})()`,
    returnByValue: true
  });
  if (!trackedControl.result.value || trackedControl.result.value.text !== '已在看板' || !trackedControl.result.value.disabled) throw new Error(`Catalog tracked-control smoke test failed: ${JSON.stringify(trackedControl.result.value)}`);
  const resetCheck = await client.send('Runtime.evaluate', {
    expression: `(()=>{document.querySelector('#reset-catalog-filters').click();return {cityOptions:[...document.querySelector('#catalog-city').options].map(option=>option.textContent),result:document.querySelector('#catalog-result-count').textContent};})()`,
    returnByValue: true
  });
  const resetValue = resetCheck.result.value;
  if (!resetValue.cityOptions.includes('北京') || resetValue.result !== '5 个岗位') throw new Error(`Catalog reset smoke test failed: ${JSON.stringify(resetValue)}`);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(250);
  const dashboard = await client.send('Runtime.evaluate', {
    expression: `({title:document.title,metrics:document.querySelectorAll('#view-catalog .metric-card').length,catalog:document.querySelector('#catalog-total').textContent,recent:document.querySelectorAll('.recent-item').length,nav:document.querySelectorAll('.nav-item').length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth})`,
    returnByValue: true
  });
  if (dashboard.result.value.title !== '秋招工作台' || dashboard.result.value.metrics !== 4 || dashboard.result.value.recent < 1 || dashboard.result.value.overflow) {
    throw new Error(`Dashboard desktop smoke test failed: ${JSON.stringify(dashboard.result.value)}`);
  }
  const desktopNavFocus = await client.send('Runtime.evaluate', {
    expression: `(()=>{const nav=document.querySelector('[data-view="overview"]');nav.focus();nav.click();return {focused:document.activeElement===nav,view:document.querySelector('#view-overview').hidden===false};})()`,
    returnByValue: true
  });
  if (!desktopNavFocus.result.value.focused || !desktopNavFocus.result.value.view) throw new Error(`Desktop navigation focus smoke test failed: ${JSON.stringify(desktopNavFocus.result.value)}`);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(250);
  const tablet = await client.send('Runtime.evaluate', {
    expression: `(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,iconOnly:getComputedStyle(document.querySelector('.nav-item span')).display==='none',labels:[...document.querySelectorAll('.nav-item')].every(item=>item.getAttribute('aria-label')&&item.title)}))()`,
    returnByValue: true
  });
  if (tablet.result.value.overflow || !tablet.result.value.iconOnly || !tablet.result.value.labels) throw new Error(`Dashboard tablet smoke test failed: ${JSON.stringify(tablet.result.value)}`);
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(150);
  const desktopShot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const desktopPath = join(screenshotRoot, 'dashboard-desktop.png');
  writeFileSync(desktopPath, Buffer.from(desktopShot.data, 'base64'));
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await wait(250);
  await client.send('Runtime.evaluate', { expression: `document.querySelector('[data-view="catalog"]').click()` });
  const catalogMobileShot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const catalogMobilePath = join(screenshotRoot, 'dashboard-catalog-mobile.png');
  writeFileSync(catalogMobilePath, Buffer.from(catalogMobileShot.data, 'base64'));
  const mobile = await client.send('Runtime.evaluate', {
    expression: `(()=>{
      const menu=document.querySelector('#mobile-menu');
      const sidebar=document.querySelector('#sidebar');
      const backdrop=document.querySelector('#sidebar-backdrop');
      window.dispatchEvent(new Event('resize'));
      const before={expanded:menu.getAttribute('aria-expanded'),label:menu.getAttribute('aria-label'),ariaHidden:sidebar.getAttribute('aria-hidden'),inert:sidebar.hasAttribute('inert')};
      menu.click();
      const opened={expanded:menu.getAttribute('aria-expanded'),label:menu.getAttribute('aria-label'),open:sidebar.classList.contains('open'),backdropVisible:!backdrop.hidden,ariaHidden:sidebar.getAttribute('aria-hidden'),inert:sidebar.hasAttribute('inert')};
      document.querySelector('[data-view="profile"]').click();
      const navigated={expanded:menu.getAttribute('aria-expanded'),open:sidebar.classList.contains('open'),backdropVisible:!backdrop.hidden,ariaHidden:sidebar.getAttribute('aria-hidden'),inert:sidebar.hasAttribute('inert'),focus:document.activeElement===menu,viewVisible:document.querySelector('#view-profile').hidden===false};
      menu.click();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      const escaped={expanded:menu.getAttribute('aria-expanded'),label:menu.getAttribute('aria-label'),open:sidebar.classList.contains('open'),backdropVisible:!backdrop.hidden};
      menu.click();
      backdrop.click();
      return {overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,menu:getComputedStyle(menu).display,sidebar:getComputedStyle(sidebar).transform,toastPosition:getComputedStyle(document.querySelector('#toast')).position,before,opened,navigated,escaped,closed:{expanded:menu.getAttribute('aria-expanded'),label:menu.getAttribute('aria-label'),open:sidebar.classList.contains('open'),backdropVisible:!backdrop.hidden,ariaHidden:sidebar.getAttribute('aria-hidden'),inert:sidebar.hasAttribute('inert')},focus:document.activeElement===menu};
    })()`,
    returnByValue: true
  });
  if (mobile.result.value.overflow || mobile.result.value.menu === 'none' || mobile.result.value.toastPosition !== 'static' || mobile.result.value.before.expanded !== 'false' || mobile.result.value.before.ariaHidden !== 'true' || !mobile.result.value.before.inert || !mobile.result.value.opened.open || !mobile.result.value.opened.backdropVisible || mobile.result.value.opened.expanded !== 'true' || mobile.result.value.opened.ariaHidden !== 'false' || mobile.result.value.opened.inert || mobile.result.value.escaped.open || mobile.result.value.escaped.backdropVisible || mobile.result.value.closed.open || mobile.result.value.closed.expanded !== 'false' || mobile.result.value.closed.backdropVisible || mobile.result.value.closed.ariaHidden !== 'true' || !mobile.result.value.closed.inert || !mobile.result.value.focus || !mobile.result.value.navigated.viewVisible || mobile.result.value.navigated.open || mobile.result.value.navigated.backdropVisible || mobile.result.value.navigated.ariaHidden !== 'true' || !mobile.result.value.navigated.inert || !mobile.result.value.navigated.focus) throw new Error(`Dashboard mobile smoke test failed: ${JSON.stringify(mobile.result.value)}`);
  const mobileShot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const mobilePath = join(screenshotRoot, 'dashboard-mobile.png');
  writeFileSync(mobilePath, Buffer.from(mobileShot.data, 'base64'));
  let resumeImport = null;
  if (resumeFixture) {
    if (!existsSync(resumeFixture)) throw new Error(`Resume fixture does not exist: ${resumeFixture}`);
    await client.send('DOM.enable');
    await client.send('Runtime.evaluate', { expression: `document.querySelector('[data-view="sources"]').click()` });
    await waitForEvaluation(client, `!!document.querySelector('#dashboard-resume-file')`);
    const documentNode = await client.send('DOM.getDocument');
    const input = await client.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#dashboard-resume-file' });
    if (!input.nodeId) throw new Error('Resume import file input was not found.');
    await client.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [resumeFixture] });
    await client.send('Runtime.evaluate', { expression: `document.querySelector('#dashboard-resume-file').dispatchEvent(new Event('change', {bubbles:true}))` });
    resumeImport = await waitForEvaluation(client, `(() => {
      const preview=document.querySelector('#dashboard-resume-preview');
      const status=document.querySelector('#dashboard-resume-status');
      if (!preview.hidden) return {ok:true,summary:preview.textContent};
      if (/解析失败/.test(status.textContent)) return {ok:false,error:status.textContent};
      return null;
    })()`);
    if (!resumeImport.ok) throw new Error(`Resume import failed: ${resumeImport.error}`);
    await client.send('Runtime.evaluate', { expression: `document.querySelector('#dashboard-resume-apply').click()` });
    await waitForEvaluation(client, `(() => {
      return /已应用/.test(document.querySelector('#dashboard-resume-status').textContent);
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
  await client.send('Runtime.evaluate', {
    expression: `chrome.storage.local.set({publicCatalogSync:{at:Date.now(),total:3298,sources:{enabled:3,ok:3,failed:[]}}})`,
    awaitPromise: true
  });
  await client.send('Runtime.evaluate', { expression: `window.confirm=()=>true; document.querySelector('#open-import').click(); document.querySelector('#clear-catalog').click();` });
  const clearCatalog = await waitForEvaluation(client, `document.querySelector('#catalog-total')?.textContent === '0' ? {total:document.querySelector('#catalog-total').textContent} : null`);
  const clearStorage = await client.send('Runtime.evaluate', {
    expression: `(async()=>{const s=await chrome.storage.local.get(['publicCatalogSync']);return {sync:s.publicCatalogSync ?? null,total:document.querySelector('#catalog-total')?.textContent};})()`,
    awaitPromise: true,
    returnByValue: true
  });
  const clearValue = clearStorage.result.value;
  if (!clearCatalog || clearValue.total !== '0' || clearValue.sync !== null) throw new Error(`Catalog clear smoke test failed: ${JSON.stringify({ clearCatalog, clearValue })}`);
  console.log(JSON.stringify({ edge, extension, popup: value, dashboard: dashboard.result.value, publicStatus, emptyResumeStatus, syncedResumeStatus, catalogFilters: filterValue, trackedMetadata, applicationSync, resetValue, mobile: mobile.result.value, screenshots: [desktopPath, catalogMobilePath, mobilePath], resumeImport, clearCatalog: clearValue, profileRoot }, null, 2));
  await client.send('Browser.close');
} finally {
  client?.close();
  await Promise.race([new Promise(done => child.once('exit', done)), wait(2000)]);
  if (!child.killed) child.kill();
}
