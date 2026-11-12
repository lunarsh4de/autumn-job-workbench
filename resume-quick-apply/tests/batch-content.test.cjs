const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { source } = require('./helpers.cjs');

const bossUrl = 'https://www.zhipin.com/job_detail/secure-job-123.html';
const mokaUrl = 'https://app.mokahr.com/campus-recruitment/acme/123#/apply/job-123';
const greeting = '您好，我希望了解工业设计实习岗位。';
const bossHTML = `<section class="job-banner"><h1>工业设计实习生</h1><span class="company-name">示例科技</span></section>
  <section class="job-detail-box"><div class="job-sec-text">负责产品设计和模型制作</div></section>
  <section class="chat-conversation"><div class="chat-job-info"><a href="${bossUrl}">岗位</a><span class="job-name">工业设计实习生</span><span class="company-name">示例科技</span></div>
  <div class="messages"></div><textarea id="chat-input"></textarea><button class="btn-send">发送</button></section>`;
const mokaHTML = `<header class="application-job"><h1>工业设计实习生</h1><span class="company-name">示例科技</span></header>
  <div class="job-description">负责产品设计和模型制作</div>
  <form class="application-form" data-job-id="job-123"><label>姓名<input name="name" required value="测试用户"></label><button type="submit">提交申请</button></form>`;

function harness(t, html = bossHTML, url = bossUrl) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  let listener, clicks = 0;
  w.chrome = { runtime: { id: 'self-extension', onMessage: { addListener(fn) { listener = fn; } } } };
  const timer = w.setTimeout.bind(w);
  // Speed only the adapter's 600 ms settling and 7 s observation timeouts.
  w.setTimeout = (fn, delay, ...args) => timer(fn, [7000, 5000].includes(delay) ? 65 : delay === 600 ? 10 : delay, ...args);
  w.document.querySelector('form')?.addEventListener('submit', event => event.preventDefault());
  w.document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => clicks++));
  w.eval(source('batch-content.js'));
  const job = { id: 'local-job-1', url, title: '工业设计实习生', company: '示例科技' };
  const sender = { id: 'self-extension' };
  const request = (message, from = sender) => new Promise(resolve => listener(message, from, resolve));
  const inspect = () => request({ type: 'batchInspect', job });
  const execute = (inspection, extra = {}) => request({ type: 'batchExecute', job, inspection, approved: true, attemptId: 'attempt-1', greeting, ...extra });
  const sent = (value = greeting, className = 'message-item is-self', confirmed = true) => {
    const node = w.document.createElement('div'); node.className = className;
    if (confirmed) node.dataset.status = 'sent';
    const body = w.document.createElement('span'); body.className = 'text'; body.textContent = value; node.append(body);
    w.document.querySelector('.messages').append(node); return node;
  };
  const success = (jobId = 'job-123') => {
    const node = w.document.createElement('section'); node.className = 'application-success'; node.dataset.jobId = jobId;
    node.innerHTML = '<h2>申请成功</h2>'; w.document.body.append(node); return node;
  };
  return { w, document: w.document, job, request, inspect, execute, sent, success, get clicks() { return clicks; } };
}

test('only the same extension runtime without tab/page sender can inspect or execute', async t => {
  const h = harness(t);
  for (const sender of [{}, { id: 'other-extension' }, { id: 'self-extension', tab: { id: 1 } }, { id: 'self-extension', url: 'https://www.zhipin.com/' }]) {
    assert.equal((await h.request({ type: 'batchInspect', job: h.job }, sender)).supported, false);
    assert.equal((await h.request({ type: 'batchExecute' }, sender)).status, 'paused');
  }
  assert.equal(h.clicks, 0);
});

test('unknown official site or non-independent BOSS page needs user', async t => {
  for (const url of ['https://careers.example.com/apply', 'https://www.zhipin.com/web/geek/job']) {
    const h = harness(t, bossHTML, url);
    assert.equal((await h.inspect()).supported, false);
    assert.equal(h.clicks, 0);
  }
});

test('BOSS exact identity, unique corresponding conversation and editor are required', async t => {
  for (const mutate of [
    h => { h.job.company = '另一公司'; },
    h => { h.document.querySelector('.chat-job-info a').href = 'https://www.zhipin.com/job_detail/other.html'; },
    h => { h.document.querySelector('.chat-job-info .company-name').textContent = '另一公司'; },
    h => { h.document.querySelector('.chat-conversation').append(h.document.querySelector('#chat-input').cloneNode()); },
    h => { h.document.querySelector('.chat-conversation').append(h.document.querySelector('.btn-send').cloneNode(true)); },
    h => { h.document.querySelector('#chat-input').value = '本人草稿'; },
  ]) {
    const h = harness(t); mutate(h);
    assert.equal((await h.inspect()).supported, false);
    assert.equal(h.clicks, 0);
  }
});

test('BOSS explicit continue-chat entry can open a same-page verified existing conversation before send', async t => {
  const openingHTML = bossHTML.replace(/<section class="chat-conversation">[\s\S]*<\/section>$/, '').replace('</h1>', '</h1><div class="op-btn"><button class="btn-startchat">继续沟通</button></div>');
  const h = harness(t, openingHTML);
  let sends = 0;
  h.document.querySelector('.btn-startchat').addEventListener('click', () => {
    const chat = bossHTML.slice(bossHTML.indexOf('<section class="chat-conversation">'));
    h.document.body.insertAdjacentHTML('beforeend', chat);
    h.document.querySelector('.btn-send').addEventListener('click', () => { sends++; h.sent(); });
  });
  const inspection = await h.inspect();
  assert.equal(inspection.supported, true); assert.equal(inspection.requiresConversation, true);
  assert.equal((await h.execute(inspection)).status, 'communicated');
  assert.equal(sends, 1);
});

test('BOSS opening an unverified conversation or no same-page chat pauses before any send', async t => {
  for (const mode of ['missing', 'wrong-job', 'duplicate']) {
    const openingHTML = bossHTML.replace(/<section class="chat-conversation">[\s\S]*<\/section>$/, '').replace('</h1>', '</h1><div class="op-btn"><button class="btn-startchat">继续沟通</button></div>');
    const h = harness(t, openingHTML); let sends = 0;
    h.document.querySelector('.btn-startchat').addEventListener('click', () => {
      if (mode === 'missing') return;
      let chat = bossHTML.slice(bossHTML.indexOf('<section class="chat-conversation">'));
      if (mode === 'wrong-job') chat = chat.replace('class="company-name">示例科技', 'class="company-name">错公司');
      h.document.body.insertAdjacentHTML('beforeend', mode === 'duplicate' ? chat + chat : chat);
      h.document.querySelectorAll('.btn-send').forEach(node => node.addEventListener('click', () => sends++));
    });
    assert.equal((await h.execute(await h.inspect())).status, 'paused', mode);
    assert.equal(sends, 0);
  }
});

test('BOSS does not scan generic communication buttons or follow external links', async t => {
  for (const entry of ['<button>立即沟通</button>', '<button class="btn-startchat">立即沟通</button>', '<a class="btn-startchat" href="https://elsewhere.example/chat">继续沟通</a>']) {
    const html = bossHTML.replace(/<section class="chat-conversation">[\s\S]*<\/section>$/, '').replace('</h1>', `</h1><div class="op-btn">${entry}</div>`);
    const h = harness(t, html);
    assert.equal((await h.inspect()).supported, false); assert.equal(h.clicks, 0);
  }
});

test('hidden fake BOSS buttons/editors are ignored', async t => {
  const h = harness(t);
  h.document.body.insertAdjacentHTML('beforeend', '<div hidden><textarea id="chat-input"></textarea><button class="btn-send">发送</button></div>');
  const inspection = await h.inspect();
  assert.equal(inspection.supported, true);
  assert.ok(inspection.inspectionId);
  assert.equal(inspection.job.description, '负责产品设计和模型制作');
  assert.equal(h.clicks, 0);
});

test('BOSS sends approved exact greeting once and only new own matching message confirms communication', async t => {
  const h = harness(t);
  h.document.querySelector('.btn-send').addEventListener('click', () => h.sent());
  const inspection = await h.inspect();
  const result = await h.execute(inspection);
  assert.equal(result.status, 'communicated');
  assert.equal(result.evidence.text, greeting);
  assert.equal(h.document.querySelector('#chat-input').value, greeting);
  assert.equal(h.clicks, 1);
  assert.equal((await h.execute(inspection)).status, 'paused');
  assert.equal(h.clicks, 1);
});

test('old own message, new incoming message or input clearing cannot prove send success', async t => {
  for (const mode of ['old', 'incoming', 'cleared', 'wrong-text', 'pending', 'optimistic']) {
    const h = harness(t);
    if (mode === 'old') h.sent();
    h.document.querySelector('.btn-send').addEventListener('click', () => {
      if (mode === 'incoming') h.sent(greeting, 'message-item');
      if (mode === 'wrong-text') h.sent('different');
      if (mode === 'pending') h.sent(greeting, 'message-item is-self pending');
      if (mode === 'optimistic') h.sent(greeting, 'message-item is-self', false);
      if (mode === 'cleared') h.document.querySelector('#chat-input').value = '';
    });
    assert.equal((await h.execute(await h.inspect())).status, 'uncertain', mode);
  }
});

test('BOSS failure message overrides a new own bubble including delayed failed state', async t => {
  const h = harness(t);
  h.document.querySelector('.btn-send').addEventListener('click', () => {
    const own = h.sent();
    h.w.setTimeout(() => own.insertAdjacentHTML('beforeend', '<span class="send-fail">发送失败</span>'), 2);
  });
  assert.equal((await h.execute(await h.inspect())).status, 'failed');
});

test('BOSS identity or DOM changing after inspect pauses without send', async t => {
  for (const mutate of [
    h => { h.document.querySelector('.job-banner h1').textContent = '产品经理'; },
    h => { h.document.querySelector('.btn-send').replaceWith(h.document.querySelector('.btn-send').cloneNode(true)); },
    h => { h.document.querySelector('.job-sec-text').textContent = 'JD已更新'; },
  ]) {
    const h = harness(t); const inspection = await h.inspect(); mutate(h);
    assert.equal((await h.execute(inspection)).status, 'paused'); assert.equal(h.clicks, 0);
  }
});

test('BOSS input handler changing conversation prevents send', async t => {
  const h = harness(t);
  h.document.querySelector('#chat-input').addEventListener('input', () => { h.document.querySelector('.chat-job-info .company-name').textContent = '错公司'; });
  assert.equal((await h.execute(await h.inspect())).status, 'paused');
  assert.equal(h.clicks, 0);
});

test('BOSS post-click conversation switching yields uncertain not communicated', async t => {
  const h = harness(t);
  h.document.querySelector('.btn-send').addEventListener('click', () => { h.document.querySelector('.chat-job-info .company-name').textContent = '错公司'; h.sent(); });
  assert.equal((await h.execute(await h.inspect())).status, 'uncertain');
});

test('approval, attemptId, inspection token and valid greeting are required', async t => {
  for (const extra of [{ approved: false }, { attemptId: '' }, { greeting: '' }, { greeting: 'x'.repeat(1501) }, { inspection: {} }]) {
    const h = harness(t);
    assert.equal((await h.execute(await h.inspect(), extra)).status, 'paused');
    assert.equal(h.clicks, 0);
  }
});

test('inspection expires, cannot cross documents, and page postMessage cannot execute', async t => {
  const first = harness(t); const inspection = await first.inspect();
  const second = harness(t);
  assert.equal((await second.execute(inspection)).status, 'paused');
  const originalNow = first.w.Date.now;
  first.w.Date.now = () => originalNow() + 120001;
  assert.equal((await first.execute(inspection)).status, 'paused');
  first.w.postMessage({ type: 'batchExecute', approved: true, inspection }, '*');
  await new Promise(done => setTimeout(done, 5));
  assert.equal(first.clicks, 0); assert.equal(second.clicks, 0);
});

test('send can become enabled by input but remains blocked if disabled', async t => {
  for (const enable of [true, false]) {
    const h = harness(t); const send = h.document.querySelector('.btn-send'); send.disabled = true;
    h.document.querySelector('#chat-input').addEventListener('input', () => { if (enable) send.disabled = false; });
    send.addEventListener('click', () => h.sent());
    const inspection = await h.inspect(); assert.equal(inspection.supported, true);
    assert.equal((await h.execute(inspection)).status, enable ? 'communicated' : 'paused');
    assert.equal(h.clicks, enable ? 1 : 0);
  }
});

test('a fresh inspection cannot replay an already executed attemptId', async t => {
  const h = harness(t);
  h.document.querySelector('.btn-send').addEventListener('click', () => { h.sent(); h.document.querySelector('#chat-input').value = ''; });
  assert.equal((await h.execute(await h.inspect())).status, 'communicated');
  assert.equal((await h.execute(await h.inspect())).status, 'paused');
  assert.equal(h.clicks, 1);
});

test('Moka recognized final form may inspect before filling but cannot submit empty required fields', async t => {
  const h = harness(t, mokaHTML, mokaUrl);
  h.document.querySelector('input').value = '';
  const inspection = await h.inspect();
  assert.equal(inspection.supported, true);
  assert.ok(inspection.blockers.some(item => item.code === 'required_empty'));
  assert.equal((await h.execute(inspection)).status, 'paused');
  assert.equal(h.clicks, 0);
});

test('Moka final submit requires new success bound to current job', async t => {
  const h = harness(t, mokaHTML, mokaUrl);
  h.document.querySelector('button').addEventListener('click', () => h.success());
  const inspection = await h.inspect();
  assert.equal(inspection.supported, true);
  assert.equal(inspection.blockers.length, 0);
  assert.equal((await h.execute(inspection)).status, 'submitted');
  assert.equal(h.clicks, 1);
});

test('Moka route job ID must match the form, even when title/company match', async t => {
  const h = harness(t, mokaHTML, mokaUrl);
  h.document.querySelector('form').dataset.jobId = 'different-job';
  assert.equal((await h.inspect()).supported, false);
  assert.equal(h.clicks, 0);
});

test('Moka old success, other job success, or unrelated body text do not imply submitted', async t => {
  for (const mode of ['old', 'other-job', 'body']) {
    const h = harness(t, mokaHTML, mokaUrl);
    if (mode === 'old') h.success();
    h.document.querySelector('button').addEventListener('click', () => {
      if (mode === 'other-job') h.success('other-job');
      if (mode === 'body') h.document.body.insertAdjacentHTML('beforeend', '<p>申请成功</p>');
    });
    assert.equal((await h.execute(await h.inspect())).status, 'uncertain', mode);
  }
});

test('Moka captcha login dialog multi-step custom question or ambiguous submit pauses', async t => {
  for (const html of [
    '<div data-captcha>验证码</div>', '<div class="login-modal">登录</div>', '<div role="dialog">声明</div>',
    '<div class="ant-steps">基本信息 / 下一步</div>', '<div data-required="true">自定义问题</div>',
    '<button type="submit">提交申请</button>'
  ]) {
    const h = harness(t, mokaHTML, mokaUrl);
    h.document.querySelector('form').insertAdjacentHTML('beforeend', html);
    const inspection = await h.inspect();
    assert.equal(inspection.supported, false, html);
    assert.equal((await h.execute(inspection)).status, 'paused'); assert.equal(h.clicks, 0);
  }
});

test('Moka never checks legal consent; invalid and pending attachments stop submission', async t => {
  for (const [html, code] of [
    ['<label>我同意隐私声明<input type="checkbox"></label>', 'legal_unchecked'],
    ['<label>邮箱<input type="email" value="invalid"></label>', 'invalid_field'],
    ['<label class="upload-field">简历<input type="file" name="resume" required></label>', 'attachment_pending'],
    ['<label class="upload-field">简历<input type="file" name="resume" required style="display:none"></label>', 'attachment_pending'],
    ['<label class="upload-field">简历<input type="file" name="resume"><span class="upload-success">完成</span><span data-upload-status="uploading">上传中</span></label>', 'attachment_pending'],
  ]) {
    const h = harness(t, mokaHTML, mokaUrl);
    h.document.querySelector('form').insertAdjacentHTML('beforeend', html);
    const inspection = await h.inspect();
    assert.ok(inspection.blockers.some(item => item.code === code), code);
    assert.equal((await h.execute(inspection)).status, 'paused'); assert.equal(h.clicks, 0);
    if (code === 'legal_unchecked') assert.equal(h.document.querySelector('[type="checkbox"]').checked, false);
  }
});

test('Moka upload completion and manually checked legal statement can be submitted', async t => {
  const h = harness(t, mokaHTML, mokaUrl);
  h.document.querySelector('form').insertAdjacentHTML('beforeend', '<label class="upload-field">简历<input type="file" name="resume" required><span data-upload-status="done">完成</span></label><label>同意隐私<input type="checkbox" required checked></label>');
  h.document.querySelector('button').addEventListener('click', () => h.success());
  const inspection = await h.inspect();
  assert.equal(inspection.requiresAttachment, true);
  assert.equal(inspection.blockers.length, 0);
  assert.equal((await h.execute(inspection)).status, 'submitted');
});

test('Moka changed form value after inspect invalidates token, and failed status wins', async t => {
  const h = harness(t, mokaHTML, mokaUrl);
  const inspection = await h.inspect();
  h.document.querySelector('input').value = '另一个用户';
  assert.equal((await h.execute(inspection)).status, 'paused'); assert.equal(h.clicks, 0);
  h.document.querySelector('button').addEventListener('click', () => { h.success(); h.document.body.insertAdjacentHTML('beforeend', '<div class="application-error">提交失败</div>'); });
  assert.equal((await h.execute(await h.inspect())).status, 'failed');
});
