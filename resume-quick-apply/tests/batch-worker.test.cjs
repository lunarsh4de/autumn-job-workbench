const test=require('node:test');
const assert=require('node:assert/strict');
const BW=require('../batch-worker.js');
const {until}=require('./helpers.cjs');
const job={id:'j1',url:'https://jobs.vendor.com/job_detail/one',title:'产品经理',company:'示例公司'};
function harness(options={}){
  const state={jobTrackerItems:[job],profile:{name:'私密姓名',phone:'13812345678',email:'private@example.org',skills:'Figma',summary:'用户研究，联系 private@example.org'},experiences:{work:[{role:'产品设计',description:'用户访谈'}]},resume:{dataUrl:'private-attachment'},activeProfileId:'p1',activeProfileLabel:'产品版',...options.initial};
  const session={};const calls={fetch:[],script:[],messages:[],access:[],records:[],writes:[],tabs:[]};let allowed=true;let index=0;const tabs=new Map();
  const storage=(data)=>({async get(keys){return Object.fromEntries(keys.map(key=>[key,structuredClone(data[key])]));},async set(patch){calls.writes.push(structuredClone(patch));Object.assign(data,structuredClone(patch));},async remove(key){delete data[key];}});
  const chrome={storage:{local:storage(state),session:{...storage(session),async setAccessLevel(value){calls.access.push(value);}}},permissions:{async contains(){return allowed;}},tabs:{async create(value){calls.tabs.push(value);const tab={...value,id:++index,status:'complete'};tabs.set(tab.id,tab);return tab;},async get(id){return tabs.get(id);},async sendMessage(id,message){
    calls.messages.push(structuredClone(message));
    if(options.contentRequest)return options.contentRequest(message);
    if(message.type==='fillResume')return {filled:2,failed:0,attached:0};
    if(message.type==='batchInspect')return {supported:true,adapter:options.adapter || 'boss',job:{...message.job,...(options.wrongIdentity?{title:'其他岗位'}:{}),description:options.changeDescription && calls.messages.filter(item=>item.type==='batchInspect').length>1?'岗位内容已变化':'需要产品设计与用户研究'},inspectionId:'inspection-'+id,blockers:options.blockers||[],requiresAttachment:Boolean(options.requiresAttachment)};
    if(message.type==='batchExecute'){
      assert.equal(state.batchRun.jobs[0].state,'submitting');assert.ok(state.batchRun.jobs[0].attemptId);
      if(options.executeWait)await options.executeWait;
      if(options.executeError)throw new Error('page closed');
      return options.result || {status:'communicated',evidence:{kind:'new_self_message_acknowledged',text:'当前会话新出现已发送消息',jobUrl:job.url}};
    }
  }},scripting:{async executeScript(value){calls.script.push(value);}}};
  const worker=BW.create({chrome,recordApplication:async value=>{if(options.recordError)throw new Error('storage failed');calls.records.push(value);},fetchImpl:async(url,settings)=>{calls.fetch.push({url,settings});return options.response || new Response(JSON.stringify({choices:[{message:{content:'您好，我有产品设计与用户研究经验，希望了解这个岗位。'}}]}),{status:200,headers:{'Content-Type':'application/json'}});}});
  return {state,session,calls,chrome,worker,setAllowed(value){allowed=value;}};
}
function generation(h){return {jobId:job.id,runId:h.state.batchRun.id,aiConsent:{endpoint:h.session.batchApiConfig.endpoint,model:h.session.batchApiConfig.model}};}
function approval(h){return {runId:h.state.batchRun.id,approved:h.state.batchRun.jobs.filter(item=>item.state==='approved').map(item=>({id:item.id,approvalHash:item.approvalHash}))};}
async function reviewed(h){
  await h.worker.handle('configure',{endpoint:'https://api.vendor.com/v1/chat/completions',model:'example-model',apiKey:'sensitive-session-key'});
  await h.worker.handle('create',{jobIds:[job.id]});
  await h.worker.handle('inspect',{jobId:job.id});
  await h.worker.handle('generate',generation(h));
  await h.worker.handle('approve',{jobId:job.id});
}
test('API configuration rejects insecure, private, credentialed and redirect-style URLs',()=>{
  for(const url of ['http://api.vendor.com/v1','https://localhost/v1','https://127.0.0.1/v1','https://10.1.2.3/v1','https://[::1]/v1','https://api.internal/v1','https://u:p@api.vendor.com/v1','https://api.vendor.com/v1?key=secret','https://api.vendor.com/v1#secret','https://api.vendor.com:8443/v1'])assert.throws(()=>BW.endpoint(url),/API/);
  assert.equal(BW.endpoint('https://api.vendor.com/v1/chat/completions'),'https://api.vendor.com/v1/chat/completions');
});
test('API key remains trusted-context session-only and status never returns it',async()=>{
  const h=harness();const status=await h.worker.handle('configure',{endpoint:'https://api.vendor.com/v1/chat/completions',model:'model',apiKey:'sensitive-session-key'});
  assert.equal(h.session.batchApiConfig.apiKey,'sensitive-session-key');assert.deepEqual(h.calls.access[0],{accessLevel:'TRUSTED_CONTEXTS'});
  assert.doesNotMatch(JSON.stringify(h.state),/sensitive-session-key/);assert.doesNotMatch(JSON.stringify(status),/sensitive-session-key/);
  await h.worker.handle('clearConfig');assert.equal(h.session.batchApiConfig,undefined);
});
test('missing optional origin permission prevents API configuration and page inspection',async()=>{
  const h=harness();h.setAllowed(false);
  await assert.rejects(h.worker.handle('configure',{endpoint:'https://api.vendor.com/v1',model:'m',apiKey:'k'}),/授权/);
  await h.worker.handle('create',{jobIds:[job.id]});const {run}=await h.worker.handle('inspect',{jobId:job.id});
  assert.equal(run.jobs[0].state,'paused');assert.match(run.jobs[0].error,/授权/);assert.equal(h.calls.messages.length,0);
});
test('generation sends only reviewed summary and public JD with bounded credential-free transport',async()=>{
  const h=harness();await reviewed(h);const {run}=await h.worker.handle('status');
  assert.match(run.resumeSummary,/Figma/);assert.doesNotMatch(run.resumeSummary,/私密姓名|13812345678|private@example.org|private-attachment/);
  const request=h.calls.fetch[0];assert.equal(request.settings.credentials,'omit');assert.equal(request.settings.redirect,'error');assert.ok(request.settings.signal);
  assert.doesNotMatch(request.settings.body,/sensitive-session-key|private-attachment|私密姓名|13812345678|private@example.org/);
  assert.doesNotMatch(JSON.stringify(h.calls.messages),/sensitive-session-key|private-attachment/);
});
test('start requires explicit approval, duplicate starts execute once, and proven communication records once',async()=>{
  const h=harness();await h.worker.handle('create',{jobIds:[job.id]});await assert.rejects(h.worker.handle('start',approval(h)),/已审核/);
  await reviewed(h);await Promise.all([h.worker.handle('start',approval(h)),h.worker.handle('start',approval(h))]);await until(()=>h.state.batchRun.state==='complete');
  assert.equal(h.calls.messages.filter(message=>message.type==='batchExecute').length,1);assert.equal(h.calls.records.length,1);assert.equal(h.calls.records[0].status,'communicated');
  assert.equal(h.calls.records[0].resumeProfileId,'p1');await assert.rejects(h.worker.handle('start',approval(h)),/已审核/);
});
test('profile changes invalidate approval before any page execution',async()=>{
  const h=harness();await reviewed(h);h.state.profile.skills='Changed';await assert.rejects(h.worker.handle('start',approval(h)),/简历档案已改变/);
  assert.equal(h.calls.messages.filter(message=>message.type==='batchExecute').length,0);
});
test('changed JD pauses an approved task without sending',async()=>{
  const h=harness({changeDescription:true});await reviewed(h);await h.worker.handle('start',approval(h));await until(()=>h.state.batchRun.state==='paused');
  assert.match(h.state.batchRun.jobs[0].error,/内容与审核时不同/);assert.equal(h.calls.messages.filter(message=>message.type==='batchExecute').length,0);
});
test('Moka execution fills local text only and never transmits a resume attachment',async()=>{
  const h=harness({adapter:'moka',result:{status:'submitted',evidence:{kind:'new_application_success',text:'新出现申请成功确认',jobUrl:job.url}}});await reviewed(h);await h.worker.handle('start',approval(h));await until(()=>h.state.batchRun.state==='complete');
  const fill=h.calls.messages.find(message=>message.type==='fillResume');assert.equal(fill.state.resume,null);assert.equal(fill.state.profile.skills,'Figma');
  assert.equal(h.calls.records[0].status,'submitted');assert.doesNotMatch(JSON.stringify(h.calls.messages),/private-attachment|sensitive-session-key/);
});
test('uncertain result is durable, blocks restart, and is not labeled as submitted',async()=>{
  const h=harness({executeError:true});await reviewed(h);await h.worker.handle('start',approval(h));await until(()=>h.state.batchRun.state==='paused');
  assert.equal(h.state.batchRun.jobs[0].state,'uncertain');assert.equal(h.calls.records.length,0);await assert.rejects(h.worker.handle('start',approval(h)),/已审核/);
});
test('a restarted worker marks an interrupted submitting item uncertain without retrying',async()=>{
  const h=harness({initial:{batchRun:{id:'old',state:'running',jobs:[{...job,state:'submitting',attemptId:'old-attempt'}]}}});
  const {run}=await h.worker.handle('status');assert.equal(run.state,'paused');assert.equal(run.jobs[0].state,'uncertain');assert.equal(h.calls.messages.length,0);
});
test('success without evidence is uncertain and never becomes a submitted record',async()=>{
  const h=harness({result:{status:'submitted'}});await reviewed(h);await h.worker.handle('start',approval(h));await until(()=>h.state.batchRun.state==='paused');
  assert.equal(h.state.batchRun.jobs[0].state,'uncertain');assert.equal(h.calls.records.length,0);
});
test('oversized model output is rejected before becoming an approved task',async()=>{
  const h=harness({response:new Response('{}',{status:200,headers:{'Content-Length':String(2*1024*1024)}})});
  await h.worker.handle('configure',{endpoint:'https://api.vendor.com/v1',model:'m',apiKey:'k'});await h.worker.handle('create',{jobIds:[job.id]});await h.worker.handle('inspect',{jobId:job.id});
  const {run}=await h.worker.handle('generate',generation(h));assert.equal(run.jobs[0].state,'inspected');assert.match(run.jobs[0].error,/1 MB/);
});


test('inspect and execution reuse the same reviewed tab and allow an already completed required attachment',async()=>{
  const h=harness({adapter:'moka',requiresAttachment:true,result:{status:'submitted',evidence:{kind:'new_application_success',text:'申请成功',jobUrl:job.url}}});
  await reviewed(h);await h.worker.handle('start',approval(h));await until(()=>h.state.batchRun.state==='complete');
  assert.equal(h.calls.tabs.length,1);assert.equal(h.calls.records[0].status,'submitted');
});
test('first inspection rejects a same-origin different job before generation or approval',async()=>{
  const h=harness({wrongIdentity:true});await h.worker.handle('create',{jobIds:[job.id]});const {run}=await h.worker.handle('inspect',{jobId:job.id});
  assert.equal(run.jobs[0].state,'paused');assert.match(run.jobs[0].error,/所选岗位不一致/);
  await assert.rejects(h.worker.handle('approve',{jobId:job.id}),/生成招呼/);
});
test('confirmed action with failed local recording remains non-repeatable and offers record-only recovery',async()=>{
  const options={recordError:true};const h=harness(options);await reviewed(h);await h.worker.handle('start',approval(h));await until(()=>h.state.batchRun.state==='paused');
  assert.equal(h.state.batchRun.jobs[0].state,'confirmed');assert.equal(h.state.batchRun.jobs[0].recordPending,true);
  await assert.rejects(h.worker.handle('inspect',{jobId:job.id}),/不能重新检查/);
  await assert.rejects(h.worker.handle('create',{jobIds:[job.id]}),/不会重复发送/);
  options.recordError=false;await h.worker.handle('retryRecord',{jobId:job.id});
  assert.equal(h.state.batchRun.jobs[0].state,'communicated');assert.equal(h.calls.records.length,1);assert.equal(h.calls.messages.filter(item=>item.type==='batchExecute').length,1);
});
test('persistent uncertain ledger blocks a newly created queue after the old queue was replaced',async()=>{
  const h=harness({initial:{batchAttempts:{[job.url]:{state:'uncertain',attemptId:'old'}}}});
  await assert.rejects(h.worker.handle('create',{jobIds:[job.id]}),/不会重复发送/);assert.equal(h.calls.messages.length,0);
});
test('existing submitted history and progressed tracked stages are not silently resent',async()=>{
  const h=harness({initial:{applications:[{...job,status:'submitted'}]}});await assert.rejects(h.worker.handle('create',{jobIds:[job.id]}),/不会重复发送/);
  const h2=harness({initial:{jobTrackerItems:[{...job,stage:'interview'}]}});await assert.rejects(h2.worker.handle('create',{jobIds:[job.id]}),/不会重复发送/);
});
test('evidence for a different job is rejected and never recorded',async()=>{
  const h=harness({result:{status:'communicated',evidence:{kind:'new_self_message_acknowledged',text:'sent',jobUrl:'https://jobs.vendor.com/job_detail/another'}}});await reviewed(h);await h.worker.handle('start',approval(h));await until(()=>h.state.batchRun.state==='paused');
  assert.equal(h.state.batchRun.jobs[0].state,'uncertain');assert.equal(h.calls.records.length,0);
});


test('interrupted inspections and generation recover to a recheckable paused state',async()=>{
  for(const state of ['inspecting','generating']) {
    const h=harness({initial:{batchRun:{id:'old',state:'draft',jobs:[{...job,state}]}}});
    const result=await h.worker.handle('status');assert.equal(result.run.jobs[0].state,'paused');assert.match(result.run.jobs[0].error,/中断/);
  }
});

test('worker command admission accepts only top-frame extension pages',async()=>{
  const {source}=require('./helpers.cjs');let listener;const commands=[];const event={addListener(){}};
  const chrome={runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener(fn){listener=fn;}},onInstalled:event,onStartup:event},commands:{onCommand:event},contextMenus:{onClicked:event}};
  Function('chrome','importScripts','ResumeData','TrackerData','WorkbenchData','globalThis',source('service-worker.js'))(chrome,()=>{},require('../data.js'),require('../dashboard-data.js'),require('../workbench-data.js'),{BatchWorker:{create(){return {async handle(action){commands.push(action);return {run:null};}};}}});
  for(const sender of [{id:'test',url:'https://www.zhipin.com/job_detail/one',frameId:0},{id:'test',url:'chrome-extension://test/batch.html',frameId:1},{id:'other',url:'chrome-extension://test/batch.html',frameId:0}])assert.equal(listener({type:'batchCommand',action:'status'},sender,()=>{}),undefined);
  assert.equal(commands.length,0);
  const response=await new Promise(resolve=>listener({type:'batchCommand',action:'status'},{id:'test',url:'chrome-extension://test/batch.html',frameId:0,tab:{id:1}},resolve));
  assert.deepEqual(response,{run:null});assert.deepEqual(commands,['status']);
});

test('real BOSS adapter evidence flows through the worker without schema loss or false submission',async t=>{
  const {JSDOM}=require('jsdom');const {source}=require('./helpers.cjs');
  const actual={...job,url:'https://www.zhipin.com/job_detail/worker-fixture.html'};
  const html=`<section class="job-banner"><h1>${actual.title}</h1><span class="company-name">${actual.company}</span></section><section class="job-detail-box"><div class="job-sec-text">产品设计与用户研究</div></section><section class="chat-conversation"><div class="chat-job-info"><a href="${actual.url}">岗位</a><span class="job-name">${actual.title}</span><span class="company-name">${actual.company}</span></div><div class="messages"></div><textarea id="chat-input"></textarea><button class="btn-send">发送</button></section>`;
  const dom=new JSDOM(html,{url:actual.url,runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());const w=dom.window;let listener;
  w.chrome={runtime:{id:'self-extension',onMessage:{addListener(fn){listener=fn;}}}};
  const schedule=w.setTimeout.bind(w);w.setTimeout=(fn,delay,...args)=>schedule(fn,delay===600?10:delay,...args);
  let clicks=0;w.document.querySelector('.btn-send').addEventListener('click',()=>{
    clicks++;const item=w.document.createElement('div');item.className='message-item is-self';item.dataset.status='sent';const text=w.document.createElement('span');text.className='text';text.textContent=w.document.querySelector('#chat-input').value;item.append(text);w.document.querySelector('.messages').append(item);
  });
  w.eval(source('batch-content.js'));
  const h=harness({initial:{jobTrackerItems:[actual]},contentRequest:message=>new Promise(resolve=>listener(message,{id:'self-extension'},resolve))});
  await reviewed(h);await h.worker.handle('start',approval(h));await until(()=>h.state.batchRun.state==='complete');
  assert.equal(clicks,1);assert.equal(h.state.batchRun.jobs[0].evidence.kind,'new_self_message_acknowledged');
  assert.equal(h.calls.records.length,1);assert.equal(h.calls.records[0].status,'communicated');assert.equal(h.calls.records[0].url,actual.url);
});


test('generation consent binds both queue identity and the reviewed API endpoint and model',async()=>{
  const h=harness();await reviewed(h);
  const old=generation(h);
  await h.worker.handle('configure',{endpoint:'https://other.vendor.com/v1',model:'other-model',apiKey:'another-key'});
  await assert.rejects(h.worker.handle('generate',old),/模型服务配置已改变/);
  await assert.rejects(h.worker.handle('generate',{...generation(h),runId:'old-queue'}),/队列已改变/);
  assert.equal(h.calls.fetch.length,1);
});

test('start rejects a stale queue or changed approval snapshot before any page action',async()=>{
  const h=harness();await reviewed(h);const old=approval(h);
  await assert.rejects(h.worker.handle('start',{...old,runId:'old-queue'}),/队列已改变/);
  await h.worker.handle('approve',{jobId:job.id,greeting:'修改后的本人审核招呼'});
  await assert.rejects(h.worker.handle('start',old),/审核清单已改变/);
  await assert.rejects(h.worker.handle('start',{runId:h.state.batchRun.id,approved:[]}),/审核清单已改变/);
  assert.equal(h.calls.messages.filter(item=>item.type==='batchExecute').length,0);
});
