// Isolated content script, available only on the companion website.
(() => {
  if (window !== window.top) return;
  const channel = 'resume-workbench-v1';
  window.addEventListener('message', async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || request.direction !== 'request') return;
    if (typeof request.id !== 'string' || request.id.length > 120 || !['status', 'connect', 'pull', 'commit', 'disconnect', 'openProfile', 'openLocalWorkbench', 'openBatch'].includes(request.action)) return;
    let result;
    try {
      if (JSON.stringify(request).length > 20000000) throw new Error('同步数据过大，请分批整理。');
      result = await chrome.runtime.sendMessage({ type: 'workbenchSync', action: request.action, operations: request.operations });
    } catch (error) { result = { error: error.message || '插件连接已失效，请刷新页面。' }; }
    window.postMessage({ channel, direction: 'response', id: request.id, result }, location.origin);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.jobTrackerItems || changes.workbenchConnected)) window.postMessage({ channel, direction: 'changed' }, location.origin);
  });
})();
