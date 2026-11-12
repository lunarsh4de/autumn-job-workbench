// Supabase Auth uses the official SDK, bundled locally. No GitHub token or attachment enters cloud state.
(() => {
  const internal = Boolean(globalThis.chrome?.runtime?.id);
  const AD = globalThis.AccountData;
  const config = globalThis.WorkbenchAccountConfig || {};
  const node = id => document.getElementById(id);
  let user = null, client = null, revision = 0, epoch = 0, busy = false, timer, initialized = false, conflict = false;
  let dirty = false, transitioning = false, localRevision = 0, operation = '';
  const tabId = crypto.randomUUID();
  const guard = () => { if (transitioning) throw new Error('账号正在切换，请刷新后继续。'); };
  const recover = patch => { const draft = { at:Date.now(), tabId, ...snapshot(), patch }; localStorage.setItem(keyFor(`recovery:${tabId}`),JSON.stringify(draft)); };
  const lock = task => navigator.locks ? navigator.locks.request('smart-job-account-storage',task) : task();
  const rawGet = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const keyFor = key => AD.namespace(user?.id, key);
  const cloudFields = new Set(['accountBasic', 'jobSearchPreferences', 'jobTrackerItems']);
  const status = (message, error = false) => { if (node('account-status')) { node('account-status').textContent = message; node('account-status').dataset.error = String(error); } };
  const api = {
    get user() { return user; },
    get active() { return !!user && !internal; },
    storage: {
      async get(keys) { await api.ready; guard(); return Object.fromEntries(keys.map(key => [key, rawGet(keyFor(key))])); },
      async set(patch) {
        await api.ready; guard();
        const generation = epoch;
        return lock(async () => {
          guard(); if (generation !== epoch) throw new Error('账号已变化，请刷新。');
          if (user && Object.keys(patch).some(key => cloudFields.has(key))) {
            const current = Number(rawGet(keyFor('accountLocalRevision')) || 0);
            if (current !== localRevision || operation === 'pull') {
              recover(patch); conflict = true;
              throw new Error('其他标签页已修改此账号，未覆盖其数据。你的这次修改另存为恢复草稿；请导出账号备份，再重新读取云端。');
            }
            localRevision++; localStorage.setItem(keyFor('accountLocalRevision'),JSON.stringify(localRevision));
          }
          for (const [key,value] of Object.entries(patch)) localStorage.setItem(keyFor(key), JSON.stringify(value));
          if (user && Object.keys(patch).some(key => cloudFields.has(key))) {
            dirty = true; localStorage.setItem(keyFor('accountDirty'), 'true'); clearTimeout(timer);
            if (!conflict) timer = setTimeout(() => save().catch(error => status(error.message, true)), 1200);
          }
        });
      }
    }
  };
  globalThis.WorkbenchAccount = api;

  function validConfig() {
    try {
      const url = new URL(config.supabaseUrl);
      if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) return false;
      const key = config.publishableKey || '';
      if (key.startsWith('sb_publishable_')) return true;
      if (key.split('.').length !== 3) return false;
      return JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role === 'anon';
    } catch { return false; }
  }
  function snapshot() {
    return AD.clean({ basic: rawGet(keyFor('accountBasic')), preferences: rawGet(keyFor('jobSearchPreferences')), items: rawGet(keyFor('jobTrackerItems')) });
  }
  async function apply(payload, expectedLocalRevision = localRevision) {
    const clean = AD.clean(payload), generation = epoch;
    await lock(async () => {
      guard(); if(generation !== epoch) throw new Error('账号已变化，请刷新。');
      const current = Number(rawGet(keyFor('accountLocalRevision')) || 0);
      if(current !== expectedLocalRevision) {
        recover({incomingCloudPayload:clean}); conflict=true;
        throw new Error('读取期间其他标签页已修改资料，云副本未覆盖本机。请导出账号备份后重试。');
      }
      for (const [key,value] of Object.entries({accountBasic:clean.basic,jobSearchPreferences:clean.preferences,jobTrackerItems:clean.items})) localStorage.setItem(keyFor(key), JSON.stringify(value));
      localRevision=current+1;localStorage.setItem(keyFor('accountLocalRevision'),JSON.stringify(localRevision));
    });
  }
  function profile() {
    const values = rawGet(keyFor('accountBasic')) || {};
    for (const field of node('account-profile-form')?.elements || []) if (field.name) field.value = values[field.name] || '';
  }
  function updateUi() {
    for (const id of ['account-save','account-pull','account-import','account-logout']) if (node(id)) node(id).hidden = !user;
    if (node('account-login')) { node('account-login').hidden = !!user; node('account-login').disabled = !client; }
    if (user) {
      const login = user.user_metadata?.user_name || user.user_metadata?.preferred_username || 'GitHub 用户';
      if (node('profile-entry-label')) node('profile-entry-label').textContent = login;
      if (node('profile-entry-status')) node('profile-entry-status').textContent = '账号空间';
      if (node('profile-center-name')) node('profile-center-name').textContent = login;
      if (node('profile-center-status')) node('profile-center-status').textContent = '账号资料与访客资料分别保存';
      if (node('sync-label')) node('sync-label').textContent = '账号空间';
      if (node('connect-extension')) node('connect-extension').disabled = true;
      if (node('sync-status')) node('sync-status').textContent = '当前使用账号空间。插件记录需先退出账号，再从访客模式连接；不会自动上传插件资料。';
    }
    profile();
  }
  async function scoped(generation,uid) {
    guard();
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    if (generation !== epoch || data.session?.user?.id !== uid) throw new Error('登录会话已变化，请刷新后继续。');
    return WorkbenchSupabase.createClient(config.supabaseUrl,config.publishableKey,{accessToken:async()=>data.session.access_token,auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  }
  async function pull({ reload = false } = {}) {
    guard(); if (!user || !client || busy) return;
    busy=true; operation='pull';
    const generation = epoch, uid = user.id, expectedLocalRevision=localRevision;
    try {
    const bound = await scoped(generation,uid);
    const {data,error} = await bound.from('workbench_accounts').select('payload,revision,updated_at').eq('user_id',uid).maybeSingle();
    if (generation !== epoch || user?.id !== uid) return;
    if (error) throw new Error(`读取账号失败：${error.message}`);
    revision = data?.revision || 0;
    const wasDirty = rawGet(keyFor('accountDirty')) === true;
    if (wasDirty && !reload) {
      const cachedRevision = Number(rawGet(keyFor('accountRevision')) || 0);
      if (cachedRevision !== revision) { conflict = true; status('此设备有未保存修改，云端也已更新。请先导出备份，再重新读取云端；未覆盖任何版本。', true); }
      else { dirty = true; status('此设备有待保存修改，点击“保存到账号”重试。'); }
    } else {
      await apply(data?.payload || {},expectedLocalRevision); dirty = false; conflict = false;
      localStorage.setItem(keyFor('accountDirty'),'false'); localStorage.setItem(keyFor('accountRevision'),JSON.stringify(revision));
      status(data ? `已读取账号数据，更新于 ${new Date(data.updated_at).toLocaleString('zh-CN')}。` : '这是一个新的账号空间。可填写资料，或显式导入此浏览器的访客记录。');
    }
    updateUi();
    localRevision = Number(rawGet(keyFor('accountLocalRevision')) || 0);
    if (reload) { transitioning=true; epoch++; location.reload(); }
    } finally { busy=false; operation=''; }
  }
  async function save() {
    guard(); if (!user || !client || busy) return;
    if (Number(rawGet(keyFor('accountLocalRevision')) || 0) !== localRevision) { conflict=true; throw new Error('其他标签页已修改账号，本页停止云保存。请先导出账号备份。'); }
    if (conflict) throw new Error('云端版本有变化。请先导出本机备份，再重新读取云端。');
    busy = true; operation='save'; const generation = epoch, uid = user.id, payload = snapshot();
    const before = JSON.stringify(payload);
    status('正在保存账号数据…'); node('account-save').disabled = true;
    try {
      const bound = await scoped(generation,uid);
      const {data,error} = await bound.rpc('save_workbench_account',{expected_user_id:uid,expected_revision:revision,new_payload:payload});
      if (generation !== epoch || user?.id !== uid) return;
      if (error) { if (error.code === '40001') conflict = true; throw new Error(error.code === '40001' ? '另一台设备已修改云端。请先导出本机备份，再重新读取云端；本机修改已保留。' : `云保存失败：${error.message}。修改仍在本机，可稍后重试。`); }
      revision = Number(data); localStorage.setItem(keyFor('accountRevision'),JSON.stringify(revision));
      dirty = JSON.stringify(snapshot()) !== before; localStorage.setItem(keyFor('accountDirty'),JSON.stringify(dirty));
      status(dirty ? '已保存上一版本，正在保存后续修改…' : `已保存到账号 · ${new Date().toLocaleTimeString('zh-CN')}。`);
      if (dirty) timer = setTimeout(() => save().catch(error => status(error.message,true)), 600);
    } finally { busy = false; operation=''; if(node('account-save')) node('account-save').disabled = false; }
  }
  async function init() {
    if (!node('account-login')) return;
    if (internal) { status('插件内继续使用本机资料与下方手动备份。账号云保存请打开网页版。'); node('account-login').disabled = true; return; }
    if (!validConfig() || !globalThis.WorkbenchSupabase?.createClient) {
      status('账号云保存尚未启用：站点维护者需配置 Supabase 与 GitHub 登录。你仍可浏览岗位、在本机保存资料和管理申请。'); node('account-login').disabled = true; profile();
      return;
    }
    const sessionStorage = {
      getItem:key=>localStorage.getItem(key), removeItem:key=>localStorage.removeItem(key),
      setItem(key,value) { let stored=value; try { const session=JSON.parse(value); if(session && typeof session==='object') { delete session.provider_token; delete session.provider_refresh_token; stored=JSON.stringify(session); } } catch {} localStorage.setItem(key,stored); }
    };
    client = WorkbenchSupabase.createClient(config.supabaseUrl,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true,storageKey:'smart-job-auth',storage:sessionStorage}});
    let observed;
    client.auth.onAuthStateChange((event,session) => {
      observed = session?.user?.id || null;
      if (!initialized || observed === user?.id || !observed && !user) return;
      transitioning=true; epoch++; clearTimeout(timer);
      for (const field of node('account-profile-form')?.elements || []) field.disabled=true;
      status('账号已变化，正在切换独立账号空间…');
      location.reload();
    });
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    user = data.session?.user || null; initialized=true;
    if (observed !== undefined && observed !== (user?.id || null)) { transitioning=true; epoch++; location.reload(); return; }
    localRevision = Number(rawGet(keyFor('accountLocalRevision')) || 0);
    if (user) await pull(); else status('访客模式：资料仅保存在本机。登录 GitHub 后，使用独立账号空间保存。');
    updateUi();
  }
  api.ready = init().catch(error => { if(transitioning) return; status(`账号服务暂不可用：${error.message}。本机数据保留。`,true); updateUi(); });
  node('account-login')?.addEventListener('click',async () => {
    try {
      const redirect = new URL(config.redirectUrl);
      if (redirect.origin !== location.origin || !location.pathname.startsWith(redirect.pathname)) throw new Error('此预览地址未在登录回调白名单内，请打开正式站点登录。');
      const {error} = await client.auth.signInWithOAuth({provider:'github',options:{redirectTo:redirect.href}}); if (error) throw error;
    } catch(error) { status(`登录失败：${error.message}`,true); }
  });
  node('account-logout')?.addEventListener('click',async () => {
    transitioning=true; epoch++; clearTimeout(timer);
    const {error} = await client.auth.signOut({scope:'local'});
    if (error) { transitioning=false; status(`退出失败：${error.message}`,true); return; }
    user = null; location.reload();
  });
  node('account-save')?.addEventListener('click',() => save().catch(error => status(error.message,true)));
  node('account-pull')?.addEventListener('click',() => { if (!confirm('重新读取云端会替换当前账号空间的本机副本。请先导出需要保留的修改。继续？')) return; pull({reload:true}).catch(error => status(error.message,true)); });
  node('account-import')?.addEventListener('click',async () => {
    if (!user || busy) return;
    const guest = AD.clean({basic:rawGet('accountBasic'),preferences:rawGet('jobSearchPreferences'),items:rawGet('jobTrackerItems')});
    if (!confirm(`将此浏览器访客模式的基础资料、偏好和 ${guest.items.length} 个岗位导入当前账号。相同岗位保留账号现有记录；不会读取插件或简历附件。继续？`)) return;
    const current = snapshot(); const items = [...current.items];
    for (const job of guest.items) if (!items.some(item => item.id === job.id || job.url && item.url === job.url)) items.push(job);
    const merged = AD.clean({basic:{...guest.basic,...Object.fromEntries(Object.entries(current.basic).filter(([,v])=>v))},preferences:{...guest.preferences,...Object.fromEntries(Object.entries(current.preferences).filter(([,v])=>v))},items});
    try { await apply(merged); } catch(error) {status(error.message,true);return;} localStorage.setItem(keyFor('accountDirty'),'true'); dirty = true;
    try { await save(); if (!conflict) location.reload(); } catch(error) { status(error.message,true); }
  });
  node('account-export')?.addEventListener('click',() => {
    try { guard(); const prefix=keyFor('recovery:'); const drafts=[]; for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key?.startsWith(prefix)) drafts.push(rawGet(key));}
      const blob=new Blob([JSON.stringify({schema:'smart-job-account-backup',exportedAt:new Date().toISOString(),accountId:user?.id || 'guest',payload:snapshot(),recoveryDrafts:drafts},null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`智能求职工作台账号备份-${Date.now()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){status(error.message,true);}
  });
  window.addEventListener('storage',event => {
    if (user && event.key === keyFor('accountLocalRevision') && Number(event.newValue) !== localRevision) {
      clearTimeout(timer); conflict=true; status('同账号的其他标签页已修改资料。本页停止自动保存，先导出账号备份以保留各标签恢复草稿。',true);
    }
  });
  node('account-profile-form')?.addEventListener('submit',async event => {
    event.preventDefault(); try { const basic = AD.clean({basic:Object.fromEntries(new FormData(event.target))}).basic; if(internal) { status('请在插件“投递资料”页面编辑本机简历资料。'); return; } await api.storage.set({accountBasic:basic}); status(user ? '基础资料已保存在账号的本机副本，正在云保存…' : '基础资料已保存在此浏览器。'); } catch(error) {status(error.message,true);}
  });
})();
