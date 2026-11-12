const test=require('node:test');const assert=require('node:assert/strict');
const {JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const {readFileSync}=require('node:fs');const {join}=require('node:path');
const {until}=require('./helpers.cjs');

test('published HTML loads the real bundled Supabase SDK and nonempty config before enabling GitHub login',async t=>{
  const root=join(__dirname,'..');const requested=[];
  class LocalAssets extends ResourceLoader {
    fetch(url){
      const pathname=new URL(url).pathname;const file=pathname.slice('/autumn-job-workbench/'.length);requested.push(file);
      if(file==='account-config.js') return Promise.resolve(Buffer.from('globalThis.WorkbenchAccountConfig=Object.freeze({supabaseUrl:"https://fixture.supabase.co",publishableKey:"sb_publishable_fixture",redirectUrl:"https://lunarsh4de.github.io/autumn-job-workbench/"});'));
      if(['vendor/supabase.min.js','account-data.js','account.js','dashboard-data.js'].includes(file))return Promise.resolve(readFileSync(join(root,file)));
      return Promise.resolve(Buffer.from(''));
    }
  }
  const errors=[];const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(readFileSync(join(root,'dashboard.html'),'utf8'),{url:'https://lunarsh4de.github.io/autumn-job-workbench/',resources:new LocalAssets(),runScripts:'dangerously',virtualConsole,beforeParse(w){
    for(const name of ['TextEncoder','TextDecoder','fetch','Headers','Request','Response','AbortController'])if(globalThis[name])w[name]=globalThis[name];
  }});t.after(()=>dom.window.close());
  await until(()=>dom.window.WorkbenchAccount);await dom.window.WorkbenchAccount.ready;
  assert.equal(typeof dom.window.WorkbenchSupabase.createClient,'function');
  assert.equal(dom.window.document.querySelector('#account-login').disabled,false);
  assert.match(dom.window.document.querySelector('#account-status').textContent,/访客模式/);
  for(const file of ['vendor/supabase.min.js','account-config.js','account-data.js','account.js'])assert.ok(requested.includes(file),file);
  assert.deepEqual(errors,[]);
});
