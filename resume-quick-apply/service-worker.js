importScripts('data.js');

const MENU_ID = 'resume-quick-apply-fill';
const badgeTimers = new Map();

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
  const saved = await chrome.storage.local.get(['profile', 'resume', 'settings', 'experiences']);
  const profile = ResumeData.profile(saved.profile || {});
  const settings = ResumeData.settings(saved.settings);
  const experiences = ResumeData.experiences(saved.experiences);
  const resume = settings.quickAttachment ? ResumeData.resume(saved.resume) : null;
  const hasExperiences = Object.values(experiences).some(items => items.length);
  if (!Object.values(profile).some(value => value.trim()) && !resume && !hasExperiences) throw new Error('请先在插件中保存个人资料。');
  const result = await sendToPage(tab.id, { profile, resume, experiences });
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
