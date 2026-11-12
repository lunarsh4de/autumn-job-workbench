const test = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM,VirtualConsole} = require('jsdom');
const {source,until} = require('./helpers.cjs');
const AD = require('../account-data.js');
const uidA = '11111111-1111-1111-1111-111111111111';
const uidB = '22222222-2222-2222-2222-222222222222';

function page(t,{uid=uidA,readError=false,initial={},rpcWait,readWait}={}) {
  const dom=new JSDOM(source('dashboard.html'),{url:'https://lunarsh4de.github.io/autumn-job-workbench/',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  t.after(()=>dom.window.close()); const w=dom.window; let authChanged;
  let current={user:{id:uid,user_metadata:{user_name:uid===uidA?'Alice':'Bob'}},access_token:`token:${uid}`};
  const calls=[];const records=new Map();
  for(const [key,value] of Object.entries(initial))w.localStorage.setItem(key,JSON.stringify(value));
  w.confirm=()=>true;
  w.eval(source('dashboard-data.js'));w.eval(source('account-data.js'));
  w.WorkbenchAccountConfig={supabaseUrl:'https://test.supabase.co',publishableKey:'sb_publishable_test',redirectUrl:w.location.href};
  w.WorkbenchSupabase={createClient(url,key,options){
    return {auth:{onAuthStateChange(fn){authChanged=fn;},async getSession(){return {data:{session:current}};},async signOut(){current=null;authChanged('SIGNED_OUT',null);return {};},async signInWithOAuth(){return {};}},
      from(){return {select(){return {eq(field,value){return {async maybeSingle(){if(readWait)await readWait;if(readError)return {error:{message:'offline'}};return {data:records.get(value)||null};}};}};}};},
      async rpc(name,args){const token=await options.accessToken();calls.push({name,args:structuredClone(args),token});if(rpcWait)await rpcWait;return {data:args.expected_revision+1};}
    };
  }};
  w.eval(source('account.js'));
  return {w,calls,records,account:w.WorkbenchAccount,switchTo(uid){current={user:{id:uid},access_token:`token:${uid}`};authChanged('SIGNED_IN',current);}};
}

test('account payload drops attachments, credentials, unknown fields and namespaces users',()=>{
  const payload=AD.clean({basic:{name:'甲',token:'secret'},preferences:{roles:'设计',token:'no'},items:[],resume:'private',githubGistToken:'secret'});
  assert.equal(payload.basic.name,'甲');assert.equal(payload.resume,undefined);assert.equal(payload.basic.token,undefined);assert.equal(payload.preferences.token,undefined);
  assert.notEqual(AD.namespace(uidA,'jobTrackerItems'),AD.namespace(uidB,'jobTrackerItems'));
  assert.equal(AD.namespace(null,'jobTrackerItems'),'jobTrackerItems');
});

test('first account load never migrates guest records and preserves guest storage',async t=>{
  const h=page(t,{initial:{accountBasic:{name:'访客'},jobTrackerItems:[{title:'访客岗位',company:'访客公司'}]}});await h.account.ready;
  assert.equal((await h.account.storage.get(['accountBasic'])).accountBasic.name,'');
  assert.equal(JSON.parse(h.w.localStorage.getItem('accountBasic')).name,'访客');assert.equal(h.calls.length,0);
});

test('auth listener still freezes writes when initial cloud read fails then user changes',async t=>{
  const h=page(t,{readError:true});await h.account.ready;h.switchTo(uidB);
  await assert.rejects(h.account.storage.set({accountBasic:{name:'A stale draft'}}),/切换/);
  h.w.document.querySelector('#account-save').click();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.calls.length,0);assert.equal(h.account.user.id,uidA);
  assert.equal(h.w.localStorage.getItem(AD.namespace(uidB,'accountBasic')),null);
});

test('in-flight cloud writes bind the captured token and expected user, then discard switched result',async t=>{
  let finish;const wait=new Promise(resolve=>{finish=resolve;});const h=page(t,{rpcWait:wait});await h.account.ready;
  await h.account.storage.set({accountBasic:{name:'Alice'}});h.w.document.querySelector('#account-save').click();await until(()=>h.calls.length===1);
  h.switchTo(uidB);finish();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.calls[0].token,`token:${uidA}`);assert.equal(h.calls[0].args.expected_user_id,uidA);
  assert.equal(h.w.localStorage.getItem(AD.namespace(uidB,'accountRevision')),null);
  assert.doesNotMatch(h.w.document.querySelector('#account-status').textContent,/已保存到账号/);
});

test('same-account second-tab write cannot silently overwrite local data; proposed edit is recoverable',async t=>{
  const h=page(t);await h.account.ready;
  h.w.localStorage.setItem(AD.namespace(uidA,'accountLocalRevision'),'2');
  h.w.localStorage.setItem(AD.namespace(uidA,'accountBasic'),JSON.stringify({name:'Other tab'}));
  await assert.rejects(h.account.storage.set({accountBasic:{name:'This tab'}}),/恢复草稿/);
  assert.equal(JSON.parse(h.w.localStorage.getItem(AD.namespace(uidA,'accountBasic'))).name,'Other tab');
  const recoveryKey=Object.keys(h.w.localStorage).find(key=>key.includes(':recovery:'));
  assert.equal(JSON.parse(h.w.localStorage.getItem(recoveryKey)).patch.accountBasic.name,'This tab');assert.equal(h.calls.length,0);
});

test('missing configuration exposes an honest local mode with no fake authentication',async t=>{
  const dom=new JSDOM(source('dashboard.html'),{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
  w.eval(source('dashboard-data.js'));w.eval(source('account-data.js'));w.eval(source('account-config.js'));w.eval(source('account.js'));await w.WorkbenchAccount.ready;
  assert.equal(w.WorkbenchAccount.user,null);assert.equal(w.document.querySelector('#account-login').disabled,true);assert.match(w.document.querySelector('#account-status').textContent,/尚未启用/);
});


test('cloud pull does not overwrite edits made by another tab while the request is pending',async t=>{
  let finish;const readWait=new Promise(resolve=>{finish=resolve;});const h=page(t,{readWait});
  await until(()=>h.account.user?.id===uidA);
  h.w.localStorage.setItem(AD.namespace(uidA,'accountLocalRevision'),'1');
  h.w.localStorage.setItem(AD.namespace(uidA,'accountBasic'),JSON.stringify({name:'Edited while fetching'}));
  finish();await h.account.ready;
  assert.equal(JSON.parse(h.w.localStorage.getItem(AD.namespace(uidA,'accountBasic'))).name,'Edited while fetching');
  assert.match(h.w.document.querySelector('#account-status').textContent,/未覆盖本机/);
});


test('missing configuration script and missing SDK report different loading failures',async t=>{
  for (const kind of ['config','sdk']) {
    const dom=new JSDOM(source('dashboard.html'),{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;
    w.eval(source('dashboard-data.js'));w.eval(source('account-data.js'));
    if(kind==='sdk')w.WorkbenchAccountConfig={supabaseUrl:'https://fixture.supabase.co',publishableKey:'sb_publishable_fixture'};
    w.eval(source('account.js'));await w.WorkbenchAccount.ready;
    assert.match(w.document.querySelector('#account-status').textContent,kind==='config'?/配置脚本未能加载/:/登录组件未能加载/);
    assert.equal(w.document.querySelector('#account-login').disabled,true);
  }
});
