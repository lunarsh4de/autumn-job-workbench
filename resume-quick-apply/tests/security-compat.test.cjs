const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { content, popup, source, until } = require('./helpers.cjs');

test('manifest keeps job-page access temporary and limits cloud backup hosts to GitHub', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.equal(manifest.version, '0.15.0');
  assert.equal(manifest.homepage_url, 'https://github.com/lunarsh4de');
  assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'contextMenus', 'scripting', 'storage', 'unlimitedStorage'].sort());
  assert.deepEqual(manifest.host_permissions.sort(), ['https://api.github.com/*', 'https://github.com/*'].sort());
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, ['http://*/*', 'https://*/*']);
  assert.equal(manifest.commands['quick-fill'].suggested_key.default, 'Alt+Shift+F');
});

test('release surfaces show the current version and author link', () => {
  assert.match(source('popup.html'), /v0\.15\.0/);
  assert.match(source('popup.js'), /0\.15\.0/);
  assert.match(source('onboarding.html'), /v0\.15\.0/);
  assert.match(source('install/install-guide.html'), /v0\.15\.0/);
  for (const file of ['popup.html', 'onboarding.html', 'dashboard.html', 'install/install-guide.html']) {
    assert.match(source(file), /https:\/\/github\.com\/lunarsh4de/);
    assert.match(source(file), /target="_blank" rel="noopener noreferrer"/);
  }
  assert.doesNotMatch(source('onboarding.html'), /<script/i);
});

test('Chinese install guide follows the three-step Edge flow without nested screenshots', () => {
  const guide = source('install/install-guide.html');
  assert.match(guide, /管理扩展/);
  assert.match(guide, /开发人员模式/);
  assert.match(guide, /加载解压缩的扩展/);
  assert.match(guide, /ResumeQuickApply/);
  assert.match(guide, /不要双击进入 Extension/);
  assert.doesNotMatch(guide, /01-install-helper\.png|04-extension-loaded\.png|capture-clean/);
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

test('core extension runtime contains no remote network transports', () => {
  const runtime = ['data.js', 'resume-parser.js', 'backup-sync-data.js', 'popup.js', 'dashboard-data.js', 'dashboard.js', 'catalog-data.js', 'catalog-db.js', 'content.js', 'service-worker.js'].map(source).join('\n');
  assert.doesNotMatch(runtime, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
});

test('catalog remote import is explicit, HTTPS-only and omits credentials', () => {
  const catalog = source('catalog.js');
  assert.match(catalog, /url\.protocol !== 'https:'/);
  assert.match(catalog, /credentials: 'omit'/);
  assert.doesNotMatch(catalog, /Authorization|Bearer|chrome\.identity/);
});

test('GitHub backup restore unwraps and validates local dashboard data', () => {
  globalThis.ResumeData = require('../data.js');
  globalThis.TrackerData = require('../dashboard-data.js');
  const BackupSyncData = require('../backup-sync-data.js');
  const patch = BackupSyncData.prepare({
    schemaVersion: 1,
    data: {
      profile: { name: '恢复候选人' },
      resumeProfiles: [{ id: 'product', label: '产品版', profile: { name: '恢复候选人' } }],
      activeProfileId: 'product',
      activeProfileLabel: '产品版',
      applications: [{ url: 'https://jobs.example.test/1', title: '产品经理', createdAt: 1000 }],
      jobTrackerItems: [{ id: 'tracked-1', company: '示例', title: '产品经理', stage: 'applied', source: 'catalog' }],
      jobSearchPreferences: { roles: '产品经理', skills: 'SQL', cities: '上海' }
    }
  });
  assert.equal(patch.profile.name, '恢复候选人');
  assert.equal(patch.activeProfileId, 'product');
  assert.equal(patch.activeProfileLabel, '产品版');
  assert.equal(patch.applications.length, 1);
  assert.equal(patch.jobTrackerItems[0].source, 'catalog');
  assert.deepEqual(patch.jobSearchPreferences, { roles: '产品经理', skills: 'SQL', cities: '上海' });
});

test('GitHub backup restore rejects malformed wrapped payloads before writes', () => {
  globalThis.ResumeData = require('../data.js');
  globalThis.TrackerData = require('../dashboard-data.js');
  const BackupSyncData = require('../backup-sync-data.js');
  assert.throws(() => BackupSyncData.prepare({ data: { profile: { name: {} } } }), /字段|格式/);
});

test('GitHub backup restore clears optional local state omitted by older backups', () => {
  globalThis.ResumeData = require('../data.js');
  globalThis.TrackerData = require('../dashboard-data.js');
  const BackupSyncData = require('../backup-sync-data.js');
  const patch = BackupSyncData.prepare({ profile: { name: '旧格式备份' } });
  assert.deepEqual(patch.resumeProfiles, []);
  assert.equal(patch.activeProfileId, null);
  assert.equal(patch.activeProfileLabel, null);
  assert.deepEqual(patch.jobTrackerItems, []);
  assert.deepEqual(patch.jobSearchPreferences, { roles: '', skills: '', cities: '' });
  assert.deepEqual(patch.resumeAutoPreferences, { roles: '', skills: '', cities: '' });
});

test('GitHub sync preserves refreshed token metadata and reports backup freshness', () => {
  const sync = source('github-sync.js');
  assert.match(sync, /githubGistRefreshToken', 'githubGistExpiresAt', 'githubGistId', 'githubBackupAt/);
  assert.match(sync, /const latest = await storage\.get\(\['githubGistRefreshToken', 'githubGistExpiresAt', 'githubGistId', 'githubBackupAt'\]\)/);
  assert.match(sync, /latest\.githubGistRefreshToken \|\| login\.refreshToken/);
  assert.match(sync, /'githubGistId', 'githubBackupAt'\]\)\.then\(async stored/);
  assert.match(sync, /备份已超过 24 小时未更新/);
  assert.match(sync, /最近备份：\$\{savedAt\}/);
  assert.match(sync, /status\.setAttribute\('aria-busy', String\(busy\)\)/);
  assert.match(sync, /正在保存 GitHub 私有备份/);
  assert.match(sync, /正在读取 GitHub 私有备份/);
  assert.match(sync, /等待 GitHub 授权确认/);
  assert.match(sync, /authCancelled = false/);
  assert.match(sync, /GitHub 授权已取消/);
  assert.match(sync, /当前设备与私有 Gist 的绑定已解除/);
  assert.match(source('dashboard.html'), /id="github-cancel"/);
});

test('dashboard exposes a disabled button affordance and keeps mobile toasts in flow', () => {
  const css = source('dashboard.css');
  const dashboard = source('dashboard.js');
  assert.match(css, /\.button:disabled \{[^}]*cursor: not-allowed/);
  assert.match(css, /\.toast \{ position: static; z-index: auto; max-width: none; margin: 8px 16px 0; \}/);
  assert.doesNotMatch(dashboard, /#view-profile:not\(\[hidden\]\)/);
});

test('catalog import exposes an in-dialog error state and prevents concurrent submissions', () => {
  const catalog = source('catalog.js');
  const css = source('dashboard.css');
  assert.match(catalog, /let importing = false/);
  assert.match(catalog, /if \(importing\) return/);
  assert.match(catalog, /button\[type="submit"\]/);
  assert.match(catalog, /导入失败：\$\{error\.message/);
  assert.match(css, /\.import-result\[data-error="true"\]/);
});

test('catalog empty results offer a direct filter reset action', () => {
  const catalog = source('catalog.js');
  assert.match(catalog, /data-reset-catalog/);
  assert.match(catalog, /没有符合当前筛选的岗位/);
  assert.match(catalog, /resetFilters\(\)/);
});

test('resume sync waits for catalog readiness and ignores stale scoring generations', () => {
  const catalog = source('catalog.js');
  assert.match(catalog, /let catalogReady = false/);
  assert.match(catalog, /if \(!catalogReady\) \{/);
  assert.match(catalog, /pendingResumeSync = true/);
  assert.match(catalog, /const generation = \+\+resumeSyncGeneration/);
  assert.match(catalog, /if \(generation !== resumeSyncGeneration\) return false/);
  assert.match(catalog, /catalogReady = true/);
});

test('catalog source health exposes partial failures in visible status markup', () => {
  const catalog = source('catalog.js');
  const dashboard = source('dashboard.html');
  const css = source('dashboard.css');
  assert.match(catalog, /errors: failed\.map/);
  assert.match(catalog, /已保留当前浏览器中的岗位/);
  assert.match(catalog, /#public-sync-detail/);
  assert.match(dashboard, /id="public-sync-detail"/);
  assert.match(css, /\.public-sync-detail/);
});

test('resume parsers are self-hosted with licenses and no remote script tags', () => {
  const path = require('node:path');
  const root = path.join(__dirname, '..', 'vendor');
  for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs', 'mammoth.browser.min.js', 'PDFJS-LICENSE', 'MAMMOTH-LICENSE']) {
    assert.ok(readFileSync(path.join(root, file)).length > 1000, `${file} is missing or unexpectedly small`);
  }
  assert.doesNotMatch(source('popup.html'), /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(source('dashboard.html'), /<script[^>]+src=["']https?:/i);
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

test('installer script uses Chinese guidance and supports validation-only mode', () => {
  const installer = readFileSync(require('node:path').join(__dirname, '..', 'install', 'Install-ResumeQuickApply.ps1'));
  const text = installer.toString('utf8');
  assert.match(text, /ValidateOnly/);
  assert.match(text, /开发人员模式/);
  assert.match(text, /Extension/);
  assert.match(text, /vendorFiles/);
});
