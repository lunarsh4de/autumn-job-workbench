importScripts('data.js', 'dashboard-data.js', 'workbench-data.js', 'batch-worker.js');

const MENU_ID = 'resume-quick-apply-fill';
const badgeTimers = new Map();
const applicationQueue = ResumeData.createQueue();
const batchWorker = globalThis.BatchWorker?.create({
  chrome,
  recordApplication(application) {
    return applicationQueue(async () => {
      const saved = await chrome.storage.local.get(['applications', 'jobTrackerItems', 'workbenchDeleted']);
      const candidate = {...application, createdAt:Date.now(), updatedAt:Date.now()};
      const result = ResumeData.mergeApplication(saved.applications, candidate);
      const deleted = {...(saved.workbenchDeleted || {})};
      delete deleted[WorkbenchData.key(candidate)];
      const tracker = TrackerData.mergeApplications(saved.jobTrackerItems, result.applications).items;
      await chrome.storage.local.set({applications:WorkbenchData.projectApplications(result.applications,tracker),jobTrackerItems:tracker,workbenchDeleted:deleted});
    });
  }
});

// A single background writer prevents two tabs from overwriting each other's records.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'batchCommand') {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || (sender.frameId || 0) !== 0) return;
    if (!batchWorker) { respond({error:'批量任务组件未加载。'}); return; }
    batchWorker.handle(message.action,message.payload).then(respond).catch(error=>respond({error:error.message}));
    return true;
  }
  if (!['saveApplication', 'clearApplications', 'workbenchSync'].includes(message?.type)) return;
  if (sender.id !== chrome.runtime.id) return;
  const extensionPage = (sender.url || '').startsWith(chrome.runtime.getURL('')) && (sender.frameId || 0) === 0;
  if (message.type === 'workbenchSync') {
    const internal = extensionPage;
    if (!internal && (!sender.tab || !WorkbenchData.trustedSite(sender.url) || (sender.frameId || 0) !== 0)) return;
    applicationQueue(() => synchronizeWorkbench(message, internal)).then(respond).catch(error => respond({ error: error.message }));
    return true;
  }
  if (message.type === 'clearApplications' && sender.tab && !extensionPage) return;
  applicationQueue(async () => {
    if (message.type === 'clearApplications') {
      const saved = await chrome.storage.local.get(['applications', 'jobTrackerItems', 'workbenchDeleted']);
      const urls = new Set(ResumeData.applications(saved.applications).map(WorkbenchData.key));
      const deleted = { ...(saved.workbenchDeleted || {}) };
      for (const url of urls) deleted[url] = Date.now();
      const tracker = TrackerData.items(saved.jobTrackerItems).filter(item => !urls.has(WorkbenchData.key(item)));
      await chrome.storage.local.set({ applications: [], jobTrackerItems: tracker, workbenchDeleted: deleted });
      return { applications: [] };
    }
    const saved = await chrome.storage.local.get(['applications', 'activeProfileId', 'activeProfileLabel', 'jobTrackerItems', 'workbenchDeleted']);
    const candidate = { ...message.application, createdAt: Date.now(), updatedAt: Date.now() };
    if (sender.tab && !extensionPage) {
      const origin = new URL(sender.url || sender.tab.url).origin;
      if (new URL(candidate.url).origin !== origin) throw new Error('岗位链接必须属于当前网站。');
    }
    candidate.resumeProfileId ||= saved.activeProfileId || '';
    candidate.resumeProfileLabel ||= saved.activeProfileLabel || '默认简历';
    if (candidate.source === 'auto' && saved.workbenchDeleted?.[WorkbenchData.key(candidate)]) return { applications: ResumeData.applications(saved.applications), added: false };
    const result = ResumeData.mergeApplication(saved.applications, candidate);
    // An explicit new capture can restore a previously deleted URL. Stale website tabs cannot.
    const deleted = { ...(saved.workbenchDeleted || {}) };
    delete deleted[WorkbenchData.key(candidate)];
    const tracker = TrackerData.mergeApplications(saved.jobTrackerItems, result.applications).items;
    result.applications = WorkbenchData.projectApplications(result.applications, tracker);
    await chrome.storage.local.set({ applications: result.applications, jobTrackerItems: tracker, workbenchDeleted: deleted });
    return result;
  }).then(respond).catch(error => respond({ error: error.message }));
  return true;
});

async function synchronizeWorkbench(message, internal) {
  const saved = await chrome.storage.local.get(['applications', 'jobTrackerItems', 'workbenchConnected', 'workbenchDeleted', 'workbenchSeen']);
  const connected = internal || saved.workbenchConnected === true;
  if (message.action === 'status') return { connected, version: chrome.runtime.getManifest?.().version || '0.19.1' };
  if (message.action === 'disconnect') {
    await chrome.storage.local.set({ workbenchConnected: false });
    return { connected: false };
  }
  if (['openProfile', 'openLocalWorkbench', 'openBatch'].includes(message.action)) {
    const page = { openProfile: 'popup.html', openLocalWorkbench: 'dashboard.html', openBatch: 'batch.html' }[message.action];
    await chrome.tabs.create({ url: chrome.runtime.getURL(page) });
    return { connected, opened: page };
  }
  if (!connected && message.action !== 'connect') throw new Error('请先点击“连接插件”，在当前浏览器启用同步。');
  if (!['connect', 'pull', 'commit'].includes(message.action)) throw new Error('未知同步操作。');
  const deleted = saved.workbenchDeleted || {};
  const applications = ResumeData.applications(saved.applications).filter(item => !deleted[WorkbenchData.key(item)]);
  const merged = TrackerData.mergeApplications(saved.jobTrackerItems, applications).items;
  const result = WorkbenchData.apply({ items: merged, deleted, seen: saved.workbenchSeen }, message.action === 'commit' ? message.operations : []);
  const remaining = applications.filter(application => !result.deleted[WorkbenchData.key(application)]);
  const patch = {
    jobTrackerItems: result.items,
    applications: WorkbenchData.projectApplications(remaining, result.items),
    workbenchDeleted: result.deleted,
    workbenchSeen: result.seen
  };
  if (message.action === 'connect') patch.workbenchConnected = true;
  // Avoid storage-change / pull loops when a snapshot has not changed.
  const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(saved[key]) !== JSON.stringify(value)));
  if (Object.keys(changed).length) await chrome.storage.local.set(changed);
  return { connected: true, items: result.items, conflicts: result.conflicts, syncedAt: Date.now() };
}

function configureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    void chrome.runtime.lastError;
    chrome.contextMenus.create({
      id: MENU_ID,
      title: '用投简历助手快速填充',
      contexts: ['page', 'editable'],
      documentUrlPatterns: ['http://*/*', 'https://*/*']
    }, () => { void chrome.runtime.lastError; });
  });
}

function showBadge(tabId, text, color, title) {
  chrome.action.setBadgeBackgroundColor({ tabId, color });
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setTitle({ tabId, title: `投简历助手：${title}` });
  clearTimeout(badgeTimers.get(tabId));
  badgeTimers.set(tabId, setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.action.setTitle({ tabId, title: '投简历助手' });
    badgeTimers.delete(tabId);
  }, 5000));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToPage(tabId, state) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'fillResume', state });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['data.js', 'content.js'] });
    return chrome.tabs.sendMessage(tabId, { type: 'fillResume', state });
  }
}

async function quickFill(candidateTab) {
  const tab = candidateTab?.id ? candidateTab : await getActiveTab();
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) throw new Error('当前页面不支持填充。');
  const saved = await chrome.storage.local.get(['profile', 'resume', 'settings', 'experiences', 'activeProfileId', 'activeProfileLabel']);
  const profile = ResumeData.profile(saved.profile || {});
  const settings = ResumeData.settings(saved.settings);
  const experiences = ResumeData.experiences(saved.experiences);
  const resume = settings.quickAttachment ? ResumeData.resume(saved.resume) : null;
  const hasExperiences = Object.values(experiences).some(items => items.length);
  if (!Object.values(profile).some(value => value.trim()) && !resume && !hasExperiences) throw new Error('请先在插件中保存个人资料。');
  const result = await sendToPage(tab.id, { profile, resume, experiences, resumeProfileId: saved.activeProfileId || '', resumeProfileLabel: saved.activeProfileLabel || '默认简历' });
  if (!result || result.error) throw new Error(result?.error || '页面未返回填充结果。');
  showBadge(tab.id, String(Math.min(result.filled || 0, 99)), '#087f73', result.message);
  return result;
}

function runQuickFill(tab) {
  quickFill(tab).catch(error => {
    const tabId = tab?.id;
    if (tabId) showBadge(tabId, '!', '#a83a3a', error.message || '填充失败');
  });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  configureContextMenu();
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});
chrome.runtime.onStartup.addListener(configureContextMenu);
chrome.commands.onCommand.addListener(command => {
  if (command === 'quick-fill') getActiveTab().then(runQuickFill).catch(() => {});
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) runQuickFill(tab);
});
