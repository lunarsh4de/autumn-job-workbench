// Optional GitHub backup using the OAuth device flow and a private Gist.
(() => {
  const CLIENT_ID = 'Ov23limvdukQdjiSNFkT';
  const GIST_DESCRIPTION = 'Autumn Job Workbench private backup';
  const FILE_NAME = 'autumn-job-workbench-backup.json';
  const STORAGE_KEYS = [
    'profile', 'resume', 'resumeProfiles', 'activeProfileId', 'activeProfileLabel',
    'settings', 'experiences', 'applications', 'jobTrackerItems', 'jobSearchPreferences', 'resumeAutoPreferences'
  ];
  const dashboard = globalThis.JobTrackerDashboard;
  if (!dashboard) return;

  const storage = dashboard.storage;
  const status = document.querySelector('#github-backup-status');
  const signIn = document.querySelector('#github-sign-in');
  const save = document.querySelector('#github-save-backup');
  const restore = document.querySelector('#github-restore-backup');
  const signOut = document.querySelector('#github-sign-out');
  const extensionAvailable = Boolean(globalThis.chrome?.runtime?.id);
  let token = '';

  function updateProfileUi(login = '') {
    const label = document.querySelector('#profile-entry-label');
    const entryStatus = document.querySelector('#profile-entry-status');
    const centerName = document.querySelector('#profile-center-name');
    const centerStatus = document.querySelector('#profile-center-status');
    const avatar = document.querySelector('#profile-avatar');
    if (login) {
      if (label) label.textContent = `@${login}`;
      if (entryStatus) entryStatus.textContent = 'GitHub 已连接';
      if (centerName) centerName.textContent = `@${login}`;
      if (centerStatus) centerStatus.textContent = 'GitHub 已连接，数据仍按需备份';
      if (avatar) avatar.textContent = login.slice(0, 2).toUpperCase();
    } else {
      if (label) label.textContent = '个人中心';
      if (entryStatus) entryStatus.textContent = '本地模式';
      if (centerName) centerName.textContent = '本地求职者';
      if (centerStatus) centerStatus.textContent = '资料保存在当前浏览器';
      if (avatar) avatar.textContent = '我';
    }
  }

  function setStatus(message, error = false, localOnly = false) {
    status.textContent = message;
    status.dataset.error = String(error);
    status.dataset.local = String(localOnly);
  }

  function setConnectedUi(login = '', gistId = '') {
    const connected = Boolean(login && token);
    signIn.hidden = connected;
    save.disabled = !connected;
    signOut.hidden = !connected;
    if (restore) {
      restore.hidden = !connected || !gistId;
      restore.disabled = !connected || !gistId;
    }
    updateProfileUi(login);
  }

  async function github(path, options = {}) {
    await refreshTokenIfNeeded();
    const response = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: { Accept: 'application/vnd.github+json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `GitHub API ${response.status}`);
    return payload;
  }

  async function deviceLogin() {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: 'gist offline_access' })
    });
    const device = await response.json();
    if (!response.ok || !device.device_code) throw new Error(device.error_description || '无法启动 GitHub 授权。');
    setStatus(`请打开 ${device.verification_uri}，输入代码 ${device.user_code} 完成授权。`);
    window.open(device.verification_uri, '_blank', 'noopener,noreferrer');
    let interval = Math.max(5, Number(device.interval) || 5) * 1000;
    const deadline = Date.now() + Math.min(15 * 60 * 1000, Number(device.expires_in || 900) * 1000);
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, interval));
      const poll = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
      });
      const result = await poll.json();
      if (result.access_token) return { token: result.access_token, refreshToken: result.refresh_token || '', expiresAt: result.expires_in ? Date.now() + Number(result.expires_in) * 1000 : 0 };
      if (result.error === 'slow_down') interval += 5000;
      else if (!['authorization_pending'].includes(result.error)) throw new Error(result.error_description || 'GitHub 授权未完成。');
      setStatus(`等待 GitHub 授权确认…代码 ${device.user_code}`);
    }
    throw new Error('GitHub 授权已超时，请重新开始。');
  }

  async function refreshTokenIfNeeded() {
    if (!token) return;
    const stored = await storage.get(['githubGistRefreshToken', 'githubGistExpiresAt']);
    if (!stored.githubGistRefreshToken || !stored.githubGistExpiresAt || Number(stored.githubGistExpiresAt) - Date.now() > 60 * 1000) return;
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: stored.githubGistRefreshToken })
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error(result.error_description || 'GitHub 登录已过期，请重新授权。');
    token = result.access_token;
    await storage.set({ githubGistToken: token, githubGistRefreshToken: result.refresh_token || stored.githubGistRefreshToken, githubGistExpiresAt: result.expires_in ? Date.now() + Number(result.expires_in) * 1000 : 0 });
  }

  async function connect() {
    signIn.disabled = true;
    try {
      if (!globalThis.chrome?.runtime?.id) throw new Error('GitHub 授权需要从已安装的投简历助手工作台打开。');
      const stored = await storage.get(['githubGistToken', 'githubGistId']);
      const login = stored.githubGistToken ? { token: stored.githubGistToken, refreshToken: stored.githubGistRefreshToken || '', expiresAt: stored.githubGistExpiresAt || 0 } : await deviceLogin();
      token = login.token;
      const user = await github('/user');
      await storage.set({ githubGistToken: token, githubGistRefreshToken: login.refreshToken || null, githubGistExpiresAt: login.expiresAt || 0, githubUserLogin: user.login });
      setConnectedUi(user.login, stored.githubGistId || '');
      setStatus(stored.githubGistId ? `已连接 GitHub：${user.login}，已有私有备份可恢复。` : `已连接 GitHub：${user.login}。个人备份仍需点击“保存到 GitHub”。`);
    } catch (error) {
      token = '';
      setStatus(`GitHub 连接失败：${error.message}`, true);
    } finally { signIn.disabled = false; }
  }

  async function saveBackup() {
    if (!token) throw new Error('请先登录 GitHub。');
    save.disabled = true;
    try {
      const snapshot = await storage.get(STORAGE_KEYS);
      const content = JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), data: snapshot }, null, 2);
      if (content.length > 9 * 1024 * 1024) throw new Error('个人备份超过 GitHub Gist 的单文件限制，请先移除不需要的简历附件。');
      const stored = await storage.get(['githubGistId']);
      let gist;
      if (stored.githubGistId) {
        gist = await github(`/gists/${encodeURIComponent(stored.githubGistId)}`, { method: 'PATCH', body: JSON.stringify({ description: GIST_DESCRIPTION, files: { [FILE_NAME]: { content } } }) });
      } else {
        gist = await github('/gists', { method: 'POST', body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: { [FILE_NAME]: { content } } }) });
      }
      await storage.set({ githubGistId: gist.id, githubBackupAt: Date.now() });
      if (restore) { restore.hidden = false; restore.disabled = false; }
      setStatus(`已保存到 GitHub 私有 Gist：${new Date().toLocaleString('zh-CN')}`);
    } catch (error) {
      if (/401|Bad credentials|authentication/i.test(error.message)) {
        token = '';
        await storage.set({ githubGistToken: null, githubGistRefreshToken: null, githubGistExpiresAt: null, githubUserLogin: null });
        setConnectedUi('');
      }
      setStatus(`GitHub 保存失败：${error.message}`, true);
    } finally { save.disabled = !token; }
  }

  async function disconnect() {
    token = '';
    await storage.set({ githubGistToken: null, githubGistRefreshToken: null, githubGistExpiresAt: null, githubUserLogin: null, githubGistId: null, githubBackupAt: null });
    setConnectedUi('');
    setStatus('已退出 GitHub，本地数据未删除。');
  }

  async function readBackupFile() {
    const stored = await storage.get(['githubGistId']);
    if (!stored.githubGistId) throw new Error('尚未找到 GitHub 私有备份，请先保存一次。');
    const gist = await github(`/gists/${encodeURIComponent(stored.githubGistId)}`);
    const file = gist.files?.[FILE_NAME];
    if (!file) throw new Error('私有 Gist 中没有找到工作台备份文件。');
    let content = file.content || '';
    if (file.truncated && file.raw_url) {
      const response = await fetch(file.raw_url, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error(`读取备份文件失败（HTTP ${response.status}）。`);
      content = await response.text();
    }
    if (!content) throw new Error('GitHub 返回的备份文件为空。');
    return JSON.parse(content);
  }

  async function restoreBackup() {
    if (!token) throw new Error('请先登录 GitHub。');
    if (!globalThis.BackupSyncData?.prepare) throw new Error('恢复组件未加载，请刷新页面后重试。');
    restore.disabled = true;
    try {
      const payload = await readBackupFile();
      const patch = BackupSyncData.prepare(payload);
      const count = Array.isArray(patch.jobTrackerItems) ? patch.jobTrackerItems.length : 0;
      if (!confirm(`确认从 GitHub 恢复个人备份？这会覆盖当前浏览器中的简历、投递记录和${count}条看板记录。`)) return;
      await storage.set(patch);
      setStatus('恢复成功，页面即将刷新以载入完整资料。');
      window.setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      setStatus(`GitHub 恢复失败：${error.message}`, true);
    } finally {
      restore.disabled = false;
    }
  }

  signIn.addEventListener('click', () => connect());
  save.addEventListener('click', () => saveBackup());
  restore?.addEventListener('click', () => restoreBackup());
  signOut.addEventListener('click', () => disconnect());
  if (!extensionAvailable) {
    signIn.disabled = true;
    if (restore) restore.disabled = true;
    setStatus('网页版仅保存在本机；GitHub 私有备份请从投简历助手工作台打开。', false, true);
  }
  storage.get(['githubGistToken', 'githubUserLogin', 'githubGistRefreshToken', 'githubGistExpiresAt', 'githubGistId']).then(async stored => {
    if (!stored.githubGistToken) return;
    token = stored.githubGistToken;
    try {
      const user = await github('/user');
      setConnectedUi(user.login, stored.githubGistId || '');
      setStatus(stored.githubGistId ? `已连接 GitHub：${user.login}，已有私有备份可恢复。` : `已连接 GitHub：${user.login}。`);
    } catch { token = ''; await storage.set({ githubGistToken: null, githubGistRefreshToken: null, githubGistExpiresAt: null, githubUserLogin: null }); setConnectedUi(''); }
  }).then(() => {
    if (!token) updateProfileUi('');
  }).catch(() => {});
})();
