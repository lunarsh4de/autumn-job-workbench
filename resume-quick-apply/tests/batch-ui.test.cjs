const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source, until } = require('./helpers.cjs');

async function page(t, initialRun = null) {
  const dom = new JSDOM(source('batch.html'), {url:'https://extension.test/batch.html',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window, requests=[], grants=[];
  let run=initialRun, changed;
  const configured={hasKey:true,model:'fixture-model',endpoint:'https://provider.fixture.org/v1/chat/completions'};
  const jobs=[{id:'j1',url:'https://jobs.fixture.org/job/1',title:'设计师',company:'模拟公司'}];
  w.chrome={runtime:{id:'fixture',async sendMessage(message){
    requests.push(structuredClone(message));
    const {action,payload}=message;
    if(action==='create')run={id:'r1',state:'draft',resumeSummary:'模拟技能',jobs:[{...jobs[0],state:'draft',greeting:''}]};
    if(action==='inspect')run.jobs[0]={...run.jobs[0],state:'inspected',inspection:{supported:true,job:{description:'模拟JD'}}};
    if(action==='generate')run.jobs[0]={...run.jobs[0],state:'generated',greeting:'模拟招呼'};
    if(action==='approve')run.jobs[0]={...run.jobs[0],state:'approved',greeting:payload.greeting};
    if(action==='start')run.state='running';
    return {run:structuredClone(run),configured};
  }},permissions:{async request(value){grants.push(value);return true;}},storage:{local:{async get(){return {jobTrackerItems:jobs};}},onChanged:{addListener(fn){changed=fn;}}}};
  // jsdom cannot use chrome-extension: origins; replace only the environment gate for this UI harness.
  w.eval(source('batch.js').replace("location.protocol!=='chrome-extension:'",'false'));
  await until(()=>!w.document.body.hasAttribute('aria-busy'));
  return {w,document:w.document,requests,grants,get run(){return run;},update(value){run=value;changed({batchRun:{newValue:structuredClone(value)}},'local');}};
}

test('batch UI requires per-job approval and final consent; editing approved text prevents start',async t=>{
  const h=await page(t);const d=h.document;
  d.querySelector('#job-list input').click();d.querySelector('#create-batch').click();
  await until(()=>h.requests.some(r=>r.action==='inspect')&&!d.body.hasAttribute('aria-busy'));
  assert.equal(d.querySelector('#ai-consent').checked,false);
  assert.equal(d.querySelector('#start-batch').disabled,true);
  d.querySelector('#ai-consent').click();d.querySelector('#generate-all').click();
  await until(()=>h.run.jobs[0].state==='generated'&&!d.body.hasAttribute('aria-busy'));
  const approve=[...d.querySelectorAll('#review-list button')].find(b=>b.textContent==='审核通过');
  assert.equal(approve.disabled,false,'buttons must be reenabled after asynchronous render');
  approve.click();await until(()=>h.run.jobs[0].state==='approved'&&!d.body.hasAttribute('aria-busy'));
  const area=d.querySelector('#review-list textarea');area.value='修改后的模拟招呼';area.dispatchEvent(new h.w.Event('input'));
  d.querySelector('#execute-consent').click();d.querySelector('#start-batch').click();
  assert.equal(h.requests.filter(r=>r.action==='start').length,0);
  assert.match(d.querySelector('#status').textContent,/重新点击/);
  [...d.querySelectorAll('#review-list button')].find(b=>b.textContent==='审核通过').click();
  await until(()=>h.run.jobs[0].greeting==='修改后的模拟招呼'&&!d.body.hasAttribute('aria-busy'));
  d.querySelector('#execute-consent').click();d.querySelector('#start-batch').click();
  await until(()=>h.requests.some(r=>r.action==='start'));
  assert.deepEqual(Array.from(h.grants[0].origins),['https://jobs.fixture.org/*']);
});

test('changing model configuration clears consent and empties the trusted key input',async t=>{
  const h=await page(t);const d=h.document;
  d.querySelector('#ai-consent').click();d.querySelector('#api-key').value='fixture-key-only';
  d.querySelector('#api-form').dispatchEvent(new h.w.Event('submit',{cancelable:true}));
  await until(()=>h.requests.some(r=>r.action==='configure')&&!d.body.hasAttribute('aria-busy'));
  assert.equal(d.querySelector('#api-key').value,'');assert.equal(d.querySelector('#ai-consent').checked,false);
  assert.doesNotMatch(d.querySelector('#config-status').textContent,/fixture-key-only/);
});

test('confirmed record repair uses retryRecord only and never permits a second page action',async t=>{
  const h=await page(t,{id:'r1',state:'complete',jobs:[{id:'j1',url:'https://jobs.fixture.org/job/1',title:'设计师',company:'模拟',state:'confirmed',confirmedStatus:'communicated',recordPending:true,greeting:'已发模拟文本'}]});
  const d=h.document;
  assert.equal(d.querySelector('textarea').disabled,true);assert.match(d.querySelector('.badge').textContent,/已沟通/);
  [...d.querySelectorAll('#review-list button')].find(b=>b.textContent==='补记本机记录').click();
  await until(()=>h.requests.some(r=>r.action==='retryRecord'));
  assert.equal(h.requests.some(r=>r.action==='start'),false);
});

test('another tab changing batch or approval clears the final confirmation',async t=>{
  const initial={id:'r1',state:'draft',jobs:[{id:'j1',url:'https://jobs.fixture.org/job/1',title:'设计师',company:'模拟',state:'approved',approvalHash:'hash1',greeting:'招呼一'}]};
  const h=await page(t,initial), d=h.document;
  d.querySelector('#ai-consent').click();d.querySelector('#execute-consent').click();
  assert.equal(d.querySelector('#start-batch').disabled,false);
  h.update({...initial,jobs:[{...initial.jobs[0],approvalHash:'hash2',greeting:'招呼二'}]});
  assert.equal(d.querySelector('#execute-consent').checked,false);
  assert.equal(d.querySelector('#start-batch').disabled,true);
  d.querySelector('#execute-consent').click();
  h.update({...initial,id:'another-batch'});
  assert.equal(d.querySelector('#execute-consent').checked,false);
  assert.equal(d.querySelector('#ai-consent').checked,false);
});
