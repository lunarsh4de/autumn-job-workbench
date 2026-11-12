(() => {
  const WD = globalThis.WorkbenchData;
  const TD = globalThis.TrackerData;
  const channel = 'resume-workbench-v1';
  const internal = !!globalThis.chrome?.runtime?.id;
  const pendingRequests = new Map();
  let changed = () => {};
  if (!internal) window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== channel) return;
    if (event.data.direction === 'changed') return changed();
    if (event.data.direction !== 'response') return;
    const callback = pendingRequests.get(event.data.id);
    if (callback) callback(event.data.result);
  });
  async function request(action, operations) {
    if (internal) {
      const result = await chrome.runtime.sendMessage({ type: 'workbenchSync', action, operations });
      if (!result || result.error) throw new Error(result?.error || '插件未返回同步结果。');
      return result;
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(action === 'openBatch'
          ? '无法打开批量投递。请安装或更新投简历助手至 v0.19.1，在扩展管理页点击“重新加载”，再刷新网站。也可从插件弹窗直接点击“批量投递”。'
          : '未连接到新版插件。请在同一浏览器启用 v0.18.0 以上版本，然后刷新网站。'));
      }, 4000);
      pendingRequests.set(id, result => {
        clearTimeout(timer);
        pendingRequests.delete(id);
        if (!result || result.error) reject(new Error(result?.error || '同步响应不完整。'));
        else resolve(result);
      });
      window.postMessage({ channel, direction: 'request', id, action, operations }, location.origin);
    });
  }

  function create({ storage, onItems, onStatus }) {
    let baseline = [];
    let connected = false;
    let busy = false;
    let stopped = false;
    let timer;
    let queue = Promise.resolve();
    const serialize = task => {
      const next = queue.then(() => navigator.locks ? navigator.locks.request('resume-workbench-sync', task) : task());
      queue = next.catch(() => {});
      return next;
    };
    const status = (message, pending = 0, error = false) => onStatus({ connected, busy, message, pending, error });
    const display = items => { baseline = structuredClone(items); onItems(items); };
    const read = () => storage.get(['jobTrackerItems', 'workbenchOutbox', 'workbenchMigrated', 'workbenchLastSync']);

    async function synchronize(connect = false) {
      if (busy || stopped && !connect) return;
      busy = true;
      status('正在同步…');
      try {
        await serialize(async () => {
          const saved = await read();
          const availability = await request(connect ? 'connect' : 'status');
          connected = availability.connected;
          if (!connected) {
            status('连接插件后自动同步，现有记录保存在此浏览器。', (saved.workbenchOutbox || []).length);
            return;
          }
          let snapshot = await request('pull');
          let operations = saved.workbenchOutbox || [];
          if (!saved.workbenchMigrated) {
            // Keep the pre-connection snapshot for recovery, merge by URL and newer edit time.
            const merged = [...snapshot.items];
            for (const entry of TD.items(saved.jobTrackerItems)) {
              const index = merged.findIndex(item => item.id === entry.id || WD.key(item) === WD.key(entry));
              if (index < 0) merged.push(entry);
              else if (entry.updatedAt > merged[index].updatedAt) merged[index] = { ...entry, id: merged[index].id };
            }
            operations = WD.diff(snapshot.items, merged);
            for (const op of operations) if ((saved.workbenchOutbox || []).some(pending => pending.restore && WD.key(pending.item) === WD.key(op.item))) op.restore = true;
            await storage.set({ workbenchBeforeConnection: saved.jobTrackerItems || [], workbenchOutbox: operations });
          }
          if (operations.length) snapshot = await request('commit', operations);
          await storage.set({ jobTrackerItems: snapshot.items, workbenchOutbox: [], workbenchMigrated: true, workbenchLastSync: snapshot.syncedAt });
          display(snapshot.items);
          const conflicts = snapshot.conflicts?.length || 0;
          status(conflicts ? `已同步；${conflicts} 处并行修改已合并，请检查相关岗位（备注保留双方内容；其他字段保留后提交值；已删除岗位不恢复）。` : `已同步 ${snapshot.items.length} 个岗位 · ${new Date(snapshot.syncedAt).toLocaleTimeString('zh-CN', { hour12: false })}`);
        });
      } catch (error) {
        connected = false;
        const saved = await read().catch(() => ({}));
        status(`${error.message} 修改已保存在本机，会在重新连接后补同步。`, (saved.workbenchOutbox || []).length, true);
      } finally { busy = false; }
    }

    async function save(items, { restore = false } = {}) {
      const operations = WD.diff(baseline, items);
      for (const op of operations) if (op.type === 'put' && (restore || !op.before)) op.restore = true;
      if (!operations.length) return;
      await serialize(async () => {
        const saved = await read();
        const outbox = [...(saved.workbenchOutbox || []), ...operations];
        if (outbox.length > 2000) throw new Error('待同步修改已达上限，请先连接插件同步或导出备份。');
        const local = WD.apply({ items: saved.jobTrackerItems || [] }, operations).items;
        // Persist the retry log first: a quota error must never leave an unqueued edit.
        await storage.set({ workbenchOutbox: outbox, jobTrackerItems: local });
        display(local);
        status(`已在本机保存，${outbox.length} 项修改待同步。`, outbox.length);
      });
      schedule();
    }

    function schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { void synchronize(); }, 200);
    }
    async function start() {
      const saved = await read();
      display(TD.items(saved.jobTrackerItems));
      changed = schedule;
      if (internal) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.jobTrackerItems) schedule(); });
      else window.addEventListener('storage', event => { if (['jobTrackerItems', 'workbenchOutbox'].includes(event.key)) schedule(); });
      window.addEventListener('focus', schedule);
      window.addEventListener('online', schedule);
      setInterval(() => { if (!document.hidden) schedule(); }, 30000);
      await synchronize();
    }
    return {
      start, save,
      async connect() { stopped = false; return synchronize(true); },
      async disconnect() {
        await serialize(() => request('disconnect'));
        stopped = true;
        connected = false;
        status('已断开。现有记录仍保存在本机，重新连接后可继续同步。');
      },
      async openProfile() { return request('openProfile'); },
      async openBatch() { return request('openBatch'); },
      async openLocalWorkbench() { return request('openLocalWorkbench'); }
    };
  }
  globalThis.WorkbenchSync = { create };
})();
