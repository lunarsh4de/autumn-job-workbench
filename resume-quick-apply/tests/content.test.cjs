const test = require('node:test');
const assert = require('node:assert/strict');
const { content, pdf } = require('./helpers.cjs');

test('own details fill while username, emergency contact and password remain untouched', async t => {
  const h = content(t, `<input id="own" autocomplete="section-applicant name">
    <input id="user" name="username"><input id="emergency" aria-label="紧急联系人姓名" autocomplete="name">
    <input id="phone" autocomplete="section-applicant tel"><input id="secret" type="password" autocomplete="name">`);
  const result = await h.send({ profile: { name: '测试用户', phone: '13800000000' } });
  assert.equal(result.filled, 2);
  for (const id of ['user', 'emergency', 'secret']) assert.equal(h.document.getElementById(id).value, '');
});
test('hidden ancestors, disabled fieldsets and existing values remain unchanged', async t => {
  const h = content(t, `<div style="display:none"><input name="email"></div>
    <fieldset disabled><input name="email"></fieldset><div aria-hidden="true"><input name="email"></div>
    <input id="existing" name="email" value="old@example.test"><input id="editable" name="email">`);
  const result = await h.send({ profile: { email: 'new@example.test' } });
  assert.equal(result.filled, 1);
  assert.equal(result.kept, 1);
  assert.equal(h.document.getElementById('existing').value, 'old@example.test');
  assert.equal(h.document.querySelector('fieldset input').value, '');
});
test('select only uses exact unambiguous enabled options', async t => {
  const h = content(t, `<select id="good" name="education"><option value="">请选择</option><option value="bs">本科</option></select>
    <select id="bad" name="education"><option value="">请选择</option><option>本科及以上</option></select>
    <select id="disabled-option" name="education"><option value="">请选择</option><option disabled>本科</option></select>`);
  const result = await h.send({ profile: { education: '本科' } });
  assert.equal(h.document.getElementById('good').value, 'bs');
  assert.equal(result.filled, 1);
  assert.equal(result.failed, 2);
});
test('framework-reverted input is reported as failure', async t => {
  const h = content(t, '<input name="email">');
  h.document.querySelector('input').addEventListener('input', event => { event.target.value = ''; });
  const result = await h.send({ profile: { email: 'test@example.test' } });
  assert.equal(result.filled, 0);
  assert.equal(result.failed, 1);
});
test('aria-labelledby and open shadow root work, events cross shadow boundary', async t => {
  const h = content(t, '<div id="host"></div>');
  const host = h.document.getElementById('host');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<span id="school-label">毕业院校</span><input aria-labelledby="school-label">';
  let bubbled = 0;
  host.addEventListener('input', () => bubbled++);
  const result = await h.send({ profile: { school: '测试大学' } });
  assert.equal(result.filled, 1);
  assert.equal(root.querySelector('input').value, '测试大学');
  assert.equal(bubbled, 1);
});
test('later form fields are scanned again on explicit fill', async t => {
  const h = content(t, '<input type="search">');
  h.document.body.insertAdjacentHTML('beforeend', '<textarea aria-label="自我介绍"></textarea>');
  const result = await h.send({ profile: { summary: '测试介绍' } });
  assert.equal(result.filled, 1);
});
test('two concurrent fill requests do not run twice', async t => {
  const h = content(t, '<input name="email">');
  const first = h.send({ profile: { email: 'test@example.test' } });
  const second = await h.send({ profile: { email: 'other@example.test' } });
  assert.match(second.error, /正在填充/);
  assert.equal((await first).filled, 1);
});

function mockFiles(h) {
  h.w.DataTransfer = class {
    constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
  };
  for (const input of h.document.querySelectorAll('[type=file]')) {
    Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [] });
  }
}
test('generic PDF and avatar inputs never receive a resume', async t => {
  const h = content(t, '<input type="file" accept=".pdf"><input type="file" name="avatar" accept="image/*">');
  mockFiles(h);
  const result = await h.send({ resume: pdf });
  assert.equal(result.attached, 0);
  assert.equal(result.uploadSkipped, true);
  for (const input of h.document.querySelectorAll('input')) assert.equal(input.files.length, 0);
});
test('ambiguous resume inputs are not arbitrarily chosen', async t => {
  const h = content(t, '<input type="file" name="resume"><input type="file" aria-label="简历">');
  mockFiles(h);
  assert.equal((await h.send({ resume: pdf })).attached, 0);
});
test('accept restriction is enforced even with explicit resume label', async t => {
  const h = content(t, '<input type="file" name="resume" accept=".docx">');
  mockFiles(h);
  assert.equal((await h.send({ resume: pdf })).attached, 0);
});
test('resume is selected once and existing attachment is preserved', async t => {
  const h = content(t, '<input type="file" name="resume" accept=".pdf">');
  mockFiles(h);
  assert.equal((await h.send({ resume: pdf })).attached, 1);
  const input = h.document.querySelector('input');
  const original = input.files[0];
  assert.equal((await h.send({ resume: { ...pdf, name: 'different.pdf' } })).attached, 0);
  assert.equal(input.files[0], original);
});
test('invalid attachment state returns an error before writing profile', async t => {
  const h = content(t, '<input name="email">');
  const result = await h.send({ profile: { email: 'test@example.test' }, resume: { ...pdf, dataUrl: 'https://example.test' } });
  assert.ok(result.error);
  assert.equal(h.document.querySelector('input').value, '');
});

test('school name must not receive applicant name', async t => {
  const h = content(t, '<label>School name<input></label>');
  const result = await h.send({ profile: { name: '测试用户', school: '测试大学' } });
  assert.equal(result.filled, 1);
  assert.equal(h.document.querySelector('input').value, '测试大学');
});
test('hidden upload panels do not receive files', async t => {
  const h = content(t, '<div hidden><input type="file" name="resume"></div>');
  mockFiles(h);
  assert.equal((await h.send({ resume: pdf })).attached, 0);
});
test('upload event that clears input cannot trigger a duplicate upload on next fill', async t => {
  const h = content(t, '<input type="file" name="resume">');
  mockFiles(h);
  let uploads = 0;
  h.document.querySelector('input').addEventListener('change', event => { uploads++; event.target.files = []; });
  assert.equal((await h.send({ resume: pdf })).attached, 1);
  assert.equal((await h.send({ resume: pdf })).attached, 0);
  assert.equal(uploads, 1);
});
test('website scripts cannot trigger floating fill or record actions', async t => {
  const h = content(t, '<input name="email"><input name="phone">', { profile: { email: 'test@example.test' } });
  const ui = h.document.getElementById('resume-quick-apply-root').shadowRoot;
  ui.querySelector('.rqa-fill').click();
  ui.querySelector('.rqa-mark').click();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(h.document.querySelector('[name=email]').value, '');
  assert.equal(h.writes.length, 0);
});
test('invalid autocomplete tokens cannot access prototype properties', async t => {
  const h = content(t, '<input name="email" autocomplete="constructor">');
  const result = await h.send({ profile: { email: 'test@example.test' } });
  assert.equal(result.filled, 1);
});
test('floating panel exposes visual controls and accessible expanded state', async t => {
  const h = content(t, '<input name="email"><input name="phone">');
  const ui = h.document.getElementById('resume-quick-apply-root').shadowRoot;
  const toggle = ui.querySelector('.rqa-toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(ui.querySelectorAll('img').length, 6);
  toggle.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(ui.querySelector('.rqa-panel').hidden, false);
});

test('explicit fill mounts result feedback even on a page with only one matched field', async t => {
  const h = content(t, '<input name="name">');
  assert.equal(h.document.getElementById('resume-quick-apply-root'), null);
  const result = await h.send({ profile: { name: '测试' } });
  assert.equal(result.filled, 1);
  const root = h.document.getElementById('resume-quick-apply-root').shadowRoot;
  assert.match(root.querySelector('.rqa-status').textContent, /已填 1 项/);
});

test('multiple structured experience groups are filled in DOM order', async t => {
  const h = content(t, `<section><h2>工作经历</h2>
    <div><label>公司<input></label><label>职位<input></label></div>
    <div><label>公司<input></label><label>职位<input></label></div></section>
    <section><h2>教育经历</h2><label>学校<input></label><label>专业<input></label></section>`);
  const result = await h.send({ experiences: {
    work: [{ company: '甲公司', role: '工程师' }, { company: '乙公司', role: '经理' }],
    education: [{ school: '测试大学', major: '计算机' }]
  } });
  assert.equal(result.filled, 6);
  assert.deepEqual([...h.document.querySelectorAll('input')].map(input => input.value),
    ['甲公司', '工程师', '乙公司', '经理', '测试大学', '计算机']);
});

test('single section textarea receives all entries while empty structured sections stay blank', async t => {
  const h = content(t, '<label>项目经历<textarea></textarea></label><section><h2>教育经历</h2><label>学校<input></label></section>');
  const result = await h.send({ profile: { school: '不应填入重复经历' }, experiences: {
    projects: [
      { name: '项目甲', role: '负责人', startDate: '2023.01', endDate: '2023.06', description: '描述甲' },
      { name: '项目乙', role: '成员', description: '描述乙' }
    ]
  } });
  assert.equal(result.filled, 1);
  assert.match(h.document.querySelector('textarea').value, /项目甲 \| 负责人[\s\S]*项目乙 \| 成员/);
  assert.equal(h.document.querySelector('input').value, '');
});

test('submission is recorded only after a visible success result appears', async t => {
  const h = content(t, '<main><h1>测试产品经理</h1><form><input name="email"><button type="submit">提交申请</button></form></main>', {
    activeProfileId: 'product',
    resumeProfiles: [{ id: 'product', label: '产品经理版', profile: {}, settings: {}, experiences: {} }]
  });
  h.document.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.writes.length, 0);
  const alert = h.document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.textContent = '申请成功，感谢您的投递';
  h.document.querySelector('main').append(alert);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.data.applications.length, 1);
  assert.equal(h.data.applications[0].title, '测试产品经理');
  assert.equal(h.data.applications[0].company, 'jobs.example.test');
  assert.equal(h.data.applications[0].status, 'submitted');
  assert.equal(h.data.applications[0].source, 'auto');
  assert.equal(h.data.applications[0].resumeProfileId, 'product');
  assert.equal(h.data.applications[0].resumeProfileLabel, '产品经理版');
});

test('company identity ignores generic Moka metadata and normalizes DJI career hosts', async t => {
  const h = content(t, '<head><meta property="og:site_name" content=" Moka "><meta name="application-name" content="   "></head><main><h1>产品设计师</h1><form><button type="submit">提交申请</button></form></main>', {}, 'https://apply.careers.dji.com/campus/apply');
  h.document.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  const alert = h.document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.textContent = '投递成功';
  h.document.querySelector('main').append(alert);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.data.applications[0].company, 'DJI');
  assert.equal(h.data.applications[0].title, '产品设计师');
});

test('company identity trims a real site name before storing', async t => {
  const h = content(t, '<head><meta property="og:site_name" content="  示例科技  "></head><main><h1>产品经理</h1><form><button type="submit">提交申请</button></form></main>');
  h.document.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  const alert = h.document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.textContent = '申请成功';
  h.document.querySelector('main').append(alert);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.data.applications[0].company, '示例科技');
});

test('random company hosts are recorded with a non-empty company identity', async t => {
  const cases = [
    ['https://jobs.alpha.example/apply', '<main><h1>岗位 A</h1>'],
    ['https://apply.careers.dji.com/campus/apply', '<head><meta property="og:site_name" content="Moka"></head><main><h1>岗位 B</h1>'],
    ['https://careers.acme.com/job/apply', '<main><h1>岗位 C</h1>'],
    ['https://jobs.example.test/apply', '<head><meta property="og:site_name" content="  星河科技  "></head><main><h1>岗位 D</h1>']
  ];
  for (const [url, prefix] of cases) {
    const h = content(t, `${prefix}<form><button type="submit">确认提交</button></form></main>`, {}, url);
    h.document.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
    const alert = h.document.createElement('div');
    alert.setAttribute('role', 'alert');
    alert.textContent = '提交成功';
    h.document.querySelector('main').append(alert);
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(h.data.applications.length, 1, url);
    assert.ok(h.data.applications[0].company, url);
  }
});

test('automatic record failure tells the user to use manual marking', async t => {
  const h = content(t, '<main><h1>测试岗位</h1><form><input name="email"><input name="phone"><button type="submit">提交申请</button></form></main>');
  h.w.chrome.storage.local.set = async () => { throw new Error('存储不可用'); };
  h.document.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  const alert = h.document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.textContent = '投递成功';
  h.document.querySelector('main').append(alert);
  await new Promise(resolve => setTimeout(resolve, 25));
  const status = h.document.getElementById('resume-quick-apply-root').shadowRoot.querySelector('.rqa-status');
  assert.match(status.textContent, /自动记录失败/);
  assert.match(status.textContent, /标记已投递/);
  assert.equal(h.data.applications, undefined);
});

test('validation errors and repeated success mutations do not create false or duplicate records', async t => {
  const h = content(t, '<main><form><input name="email"></form><div role="alert">提交失败，请补充必填项</div></main>');
  h.document.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true }));
  h.document.querySelector('[role=alert]').textContent = '字段校验失败';
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.data.applications, undefined);
  h.document.querySelector('[role=alert]').textContent = '提交成功';
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.data.applications.length, 1);
  h.document.querySelector('[role=alert]').textContent = '申请成功';
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.data.applications.length, 1);
});

test('pre-existing success text is not treated as a new submission result', async t => {
  const h = content(t, '<main><form><button type="submit">提交申请</button></form><div role="status">上次申请成功</div></main>');
  h.document.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.data.applications, undefined);
  h.document.querySelector('[role=status]').textContent = '本次提交成功';
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.data.applications.length, 1);
});

test('application history retains up to 500 records for export', async t => {
  const applications = Array.from({ length: 500 }, (_, index) => ({
    url: `https://jobs.example.test/job/${index}`, title: `岗位 ${index}`, company: '示例公司', createdAt: index + 1
  }));
  const h = content(t, '<main><form><button type="submit">提交申请</button></form></main>', { applications });
  h.document.querySelector('form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  const alert = h.document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.textContent = '投递成功';
  h.document.querySelector('main').append(alert);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(h.data.applications.length, 500);
  assert.equal(h.data.applications[0].status, 'submitted');
});
