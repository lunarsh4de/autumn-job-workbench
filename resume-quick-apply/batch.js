/* Extension-only batch console. Credentials are delivered once to the trusted worker. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = { queued:'待检查', ready:'已准备', inspected:'已检查', inspecting:'检查页面中', generating:'生成文案中', approved:'审核通过', generated:'待审核', draft:'待检查 / 审核', running:'执行中', submitting:'正在提交', confirmed:'已确认', submitted:'已投递', communicated:'已沟通', paused:'需人工处理', needs_user:'需人工处理', uncertain:'结果不确定，请核实', failed:'失败', complete:'本批已结束', completed:'本批已结束', stopping:'正在停止后续任务', stopped:'已停止', idle:'等待操作' };
  let run = null, jobs = [], configured = {}, busy = false;
  const selected = new Set();
  const editable = new Map();
  let consentSignature = '', consentRunId = '', providerSignature = '';
  function node(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
  function tell(message, error = false) { $('status').textContent = message; $('status').dataset.error = String(error); }
  async function command(action, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type:'batchCommand', action, payload });
    if (!response || response.error || response.ok === false) throw new Error(response?.error || '插件未响应，请重新加载插件后重试。');
    if (response.run !== undefined) run = response.run;
    if (response.configured) {
      const signature=JSON.stringify([response.configured.endpoint,response.configured.model,response.configured.hasKey]);
      if(signature!==providerSignature) $('ai-consent').checked=false;
      providerSignature=signature;configured = response.configured;
    }
    renderRun(); renderConfig();
    return response;
  }
  async function task(fn) {
    if (busy) return;
    busy = true; document.body.setAttribute('aria-busy','true'); controls();
    try { await fn(); } catch (error) { tell(error.message || '操作失败，请检查页面后重试。',true); }
    finally { busy = false; document.body.removeAttribute('aria-busy'); controls(); }
  }
  function controls() {
    for (const id of ['create-batch','inspect-all','generate-all','start-batch','refresh-jobs']) $(id).disabled = busy;
    $('start-batch').disabled ||= !$('execute-consent').checked || !run?.jobs?.some(job => job.state === 'approved');
    $('generate-all').disabled ||= !$('ai-consent').checked || !configured.hasKey || !run;
    $('inspect-all').disabled ||= !run;
    for (const button of $('review-list').querySelectorAll('button')) button.disabled = busy || button.dataset.blocked === 'true';
  }
  async function permission(urls) {
    const origins = [...new Set(urls.map(value => { const u = new URL(value); if (u.protocol !== 'https:') throw new Error('仅支持 HTTPS 岗位和 API 地址。'); return `${u.origin}/*`; }))];
    if (origins.length && !await chrome.permissions.request({ origins })) throw new Error('未授予所选站点权限。本次没有执行，请授权后重试。');
  }
  function renderConfig() {
    $('config-status').textContent = configured.hasKey ? `本次会话已配置：${configured.model}，请求发往 ${configured.endpoint}` : '尚未配置；关闭整个浏览器后需重新填写 Key。';
    if (configured.endpoint && document.activeElement !== $('endpoint')) $('endpoint').value = configured.endpoint;
    if (configured.model && document.activeElement !== $('model')) $('model').value = configured.model;
    controls();
  }
  async function loadJobs() {
    const saved = await chrome.storage.local.get(['jobTrackerItems']);
    jobs = (Array.isArray(saved.jobTrackerItems) ? saved.jobTrackerItems : []).filter(j => { try { return new URL(j.url).protocol === 'https:'; } catch { return false; } });
    for (const id of selected) if (!jobs.some(job => job.id === id)) selected.delete(id);
    renderJobs();
  }
  function renderJobs() {
    const list = $('job-list'); list.replaceChildren();
    const query = $('job-search').value.trim().toLowerCase();
    const filtered = jobs.filter(j => `${j.title} ${j.company}`.toLowerCase().includes(query));
    if (!filtered.length) list.append(node('p',jobs.length ? '没有匹配岗位。' : '还没有可用岗位。返回工作台，在岗位详情中加入申请看板。'));
    for (const job of filtered) {
      const label = node('label',null,'check job-option'), check = node('input'); check.type='checkbox'; check.checked=selected.has(job.id);
      check.addEventListener('change',() => { if(check.checked && selected.size >=20) { check.checked=false; tell('每批最多 20 项，请先处理当前批次。',true); return; } check.checked ? selected.add(job.id) : selected.delete(job.id); });
      const copy = node('span',`${job.title} · ${job.company}`); copy.append(node('small',job.url)); label.append(check,copy); list.append(label);
    }
  }
  function renderRun() {
    const signature=JSON.stringify([run?.id,(run?.jobs || []).filter(j=>j.state==='approved').map(j=>[j.id,j.approvalHash,j.greeting])]);
    if(signature!==consentSignature) $('execute-consent').checked=false;
    if(run?.id!==consentRunId) { $('ai-consent').checked=false;editable.clear(); }
    consentSignature=signature;consentRunId=run?.id;
    $('run-state').textContent = run ? `${labels[run.state] || run.state || '批次已创建'}${run.error ? `：${run.error}` : ''}` : '尚无批次';
    $('resume-summary').textContent = run?.resumeSummary || run?.profileSummary || '创建批次后显示。';
    const list=$('review-list'), focus=document.activeElement;
    const focusedId=focus?.dataset?.jobId, start=focus?.selectionStart,end=focus?.selectionEnd;
    list.replaceChildren();
    for (const job of run?.jobs || []) {
      const article=node('article',null,'review-job');
      article.append(node('h3',`${job.title} · ${job.company}`));
      const link=node('a','查看岗位页面'); link.href=job.url;link.target='_blank';link.rel='noopener noreferrer'; article.append(link);
      article.append(node('span',labels[job.confirmedStatus] || labels[job.state] || job.state,'badge'));
      if(job.error || job.reason) article.append(node('p',job.error || job.reason));
      if(job.evidence) article.append(node('p',`结果证据：${typeof job.evidence === 'string' ? job.evidence : JSON.stringify(job.evidence)}`));
      const details=node('details'),summary=node('summary','岗位描述与页面检查');details.append(summary,node('pre',job.inspection?.job?.description || job.inspection?.description || job.inspection?.reason || '点击检查后获取。'));article.append(details);
      const label=node('label','招呼 / 求职说明'),area=node('textarea');area.dataset.jobId=job.id; area.value=editable.get(job.id) ?? job.greeting ?? '';area.maxLength=3000;
      area.disabled=['submitting','confirmed','submitted','communicated','uncertain'].includes(job.state);
      area.addEventListener('input',() => { editable.set(job.id,area.value); $('execute-consent').checked=false; controls(); }); label.append(area);article.append(label);
      const actions=node('div',null,'actions');
      if(job.recordPending) {
        const retry=node('button','补记本机记录','secondary');retry.type='button';
        retry.addEventListener('click',()=>task(async()=>{await command('retryRecord',{jobId:job.id});tell('本机记录已更新，此操作不会重新发送。');}));actions.append(retry);
      }
      for(const [text,action] of [['检查页面','inspect'],['生成文案','generate'],['审核通过','approve']]) {
        const button=node('button',text,'secondary');button.type='button';button.dataset.blocked=String(area.disabled);button.disabled=busy || area.disabled;
        button.addEventListener('click',() => task(async() => {
          $('execute-consent').checked=false;
          if(action==='generate' && (!$('ai-consent').checked || !configured.hasKey)) throw new Error('请配置模型并确认资料发送范围。');
          if(action==='inspect') await permission([job.url]);
          if(action==='approve' && !area.value.trim()) throw new Error('请先生成或填写并核对文案。');
          await command(action,{jobId:job.id,...(action==='approve'?{greeting:area.value}:{} ),...(action==='generate'?{runId:run.id,aiConsent:{endpoint:configured.endpoint,model:configured.model}}:{})});
          if(action!=='inspect') editable.delete(job.id);
          renderRun();tell(action==='approve'?'已保存审核结果，确认整批后才会发送。':'操作已完成，请检查岗位状态。');
        }));actions.append(button);
      }
      article.append(actions); list.append(article);
    }
    if(focusedId) { const area=[...list.querySelectorAll('textarea')].find(e=>e.dataset.jobId===focusedId); if(area){area.focus();area.setSelectionRange(start,end);} }
    controls();
  }
  $('api-form').addEventListener('submit',event => { event.preventDefault();
    // Request permission synchronously from the user gesture, before worker calls.
    let grant;try { grant=permission([$('endpoint').value]); }catch(error){tell(error.message,true);return;}
    void task(async() => {await grant; $('ai-consent').checked=false;$('execute-consent').checked=false;await command('configure',{endpoint:$('endpoint').value.trim(),model:$('model').value.trim(),apiKey:$('api-key').value});$('api-key').value='';tell('会话配置已保存，请重新核对资料发送范围。');});
  });
  $('clear-config').addEventListener('click',()=>task(async()=>{await command('clearConfig');$('api-key').value='';tell('已清除会话 Key。');}));
  $('refresh-jobs').addEventListener('click',()=>task(loadJobs)); $('job-search').addEventListener('input',renderJobs);
  $('create-batch').addEventListener('click',()=>{
    const chosen=jobs.filter(j=>selected.has(j.id));if(!chosen.length){tell('请先选择岗位。',true);return;}
    const grant=permission(chosen.map(j=>j.url));
    void task(async()=>{await grant;editable.clear();$('ai-consent').checked=false;$('execute-consent').checked=false;await command('create',{jobIds:chosen.map(j=>j.id)});tell('批次已创建，正在逐项读取岗位页面…');for(const job of run.jobs) await command('inspect',{jobId:job.id});tell('检查已完成。请阅读状态，生成并审核文案。');});
  });
  $('inspect-all').addEventListener('click',()=>{if(!run)return;const grant=permission(run.jobs.map(j=>j.url));void task(async()=>{await grant;for(const job of run.jobs.filter(j=>!['confirmed','communicated','submitted','uncertain'].includes(j.state)))await command('inspect',{jobId:job.id});tell('检查已完成。');});});
  $('generate-all').addEventListener('click',()=>task(async()=>{
    if(!$('ai-consent').checked)throw new Error('请先确认发送资料给模型。');
    const runId=run.id,aiConsent={endpoint:configured.endpoint,model:configured.model};
    for(const job of run.jobs.filter(j=>['ready','inspected','generated','draft'].includes(j.state))) {
      if(!$('ai-consent').checked || run.id!==runId)throw new Error('批次或模型服务已改变，请重新确认资料发送范围。');
      await command('generate',{jobId:job.id,runId,aiConsent});
    }
    tell('文案已生成。逐项核对后点击审核通过。');
  }));
  $('start-batch').addEventListener('click',()=>{
    if(!$('execute-consent').checked || !run)return;
    // Edits after approval must be explicitly reapproved.
    if(run.jobs.some(j=>j.state==='approved' && editable.has(j.id) && editable.get(j.id)!==j.greeting)){tell('文案修改后请重新点击该项“审核通过”。',true);return;}
    const grant=permission(run.jobs.filter(j=>j.state==='approved').map(j=>j.url));
    const approved={runId:run.id,approved:run.jobs.filter(j=>j.state==='approved').map(j=>({id:j.id,approvalHash:j.approvalHash}))};
    void task(async()=>{await grant;await command('start',approved);$('execute-consent').checked=false;tell('执行状态已更新。请保留页面并查看每项结果。');});
  });
  $('stop-batch').addEventListener('click',()=>{void command('stop').then(()=>tell('已请求停止后续任务。')).catch(error=>tell(error.message,true));});
  $('ai-consent').addEventListener('change',controls);$('execute-consent').addEventListener('change',controls);
  if(!globalThis.chrome?.runtime?.id || location.protocol!=='chrome-extension:'){tell('批量投递需要在插件内打开。请安装插件，在插件工作台进入“批量投递”。',true);document.querySelectorAll('button,input').forEach(e=>e.disabled=true);return;}
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && changes.batchRun){run=changes.batchRun.newValue || null;renderRun();}if(area==='local' && changes.jobTrackerItems)void loadJobs();});
  void task(async()=>{await loadJobs();await command('status');tell('先配置模型，再选择本机岗位创建批次。');});
})();
