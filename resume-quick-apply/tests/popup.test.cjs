const test = require('node:test');
const assert = require('node:assert/strict');
const { popup, until, pdf } = require('./helpers.cjs');
function input(h, name, value) {
  const field = h.document.querySelector(`[name="${name}"]`);
  field.value = value;
  field.dispatchEvent(new h.w.Event('input', { bubbles: true }));
}
function importFile(h, data, size = 100) {
  const field = h.document.querySelector('#import-file');
  Object.defineProperty(field, 'files', { configurable: true, value: [{ size, async text() { return JSON.stringify(data); } }] });
  field.dispatchEvent(new h.w.Event('change', { bubbles: true }));
}
test('rapid profile updates never rewrite attachment and last input wins', async t => {
  const h = await popup(t, { resume: pdf });
  input(h, 'name', '旧值');
  input(h, 'name', '最新值');
  await until(() => h.document.querySelector('#save-state').textContent === '已保存');
  assert.equal(h.data.profile.name, '最新值');
  assert.deepEqual(h.data.resume, pdf);
  assert.ok(h.writes.every(write => !Object.hasOwn(write, 'resume')));
});
test('remove attachment while profile save is pending does not resurrect old file', async t => {
  const h = await popup(t, { resume: pdf });
  input(h, 'name', '测试用户');
  h.document.querySelector('#clear-resume').click();
  await until(() => !h.document.querySelector('#clear-resume').disabled);
  assert.equal(h.data.resume, null);
  assert.equal(h.data.profile.name, '测试用户');
});
test('import waits for pending saves and clears omitted old fields', async t => {
  const h = await popup(t, { profile: { email: 'old@example.test' }, resume: pdf });
  input(h, 'name', '待保存旧值');
  importFile(h, { profile: { name: '导入新值' } });
  await until(() => !h.document.querySelector('#import-button').disabled);
  assert.equal(h.data.profile.name, '导入新值');
  assert.equal(h.data.profile.email, '');
  assert.equal(h.document.querySelector('[name=email]').value, '');
  assert.equal(h.data.resume, null);
});
test('invalid backup leaves both saved and edited data intact', async t => {
  const h = await popup(t, { profile: { name: '保留' }, resume: pdf });
  importFile(h, { profile: { name: {} } });
  await until(() => !h.document.querySelector('#import-button').disabled);
  assert.equal(h.data.profile.name, '保留');
  assert.deepEqual(h.data.resume, pdf);
  assert.equal(h.document.querySelector('[name=name]').value, '保留');
});
test('oversized JSON is rejected before reading it', async t => {
  const h = await popup(t, { profile: { name: '保留' } });
  importFile(h, { profile: { name: '不应导入' } }, 6 * 1024 * 1024);
  await until(() => !h.document.querySelector('#import-button').disabled);
  assert.equal(h.data.profile.name, '保留');
  assert.match(h.document.querySelector('#message').textContent, /5 MB/);
});
test('export includes most recent edit even when autosave has not completed', async t => {
  const h = await popup(t, { resume: pdf });
  let exported;
  h.w.Blob = Blob;
  h.w.URL.createObjectURL = blob => { exported = blob; return 'blob:local-test'; };
  h.w.URL.revokeObjectURL = () => {};
  h.document.addEventListener('click', event => { if (event.target.tagName === 'A') event.preventDefault(); });
  input(h, 'name', '导出最新值');
  h.document.querySelector('#export-button').click();
  await until(() => exported);
  const result = JSON.parse(await exported.text());
  assert.equal(result.profile.name, '导出最新值');
  assert.deepEqual(result.resume, pdf);
  assert.deepEqual(result.settings, { quickAttachment: false });
  assert.deepEqual(result.experiences, {
    work: [], education: [], projects: [], competitions: [], awards: [], campus: [], languages: [], publications: []
  });
  assert.equal(result.schemaVersion, 3);
});
test('experience cards add, edit and remove structured entries', async t => {
  const h = await popup(t, {});
  h.document.querySelector('[data-add-experience="work"]').click();
  await until(() => h.data.experiences?.work?.length === 1);
  const company = h.document.querySelector('[data-experience-type="work"][data-experience-key="company"]');
  company.value = '星河科技';
  company.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  await until(() => h.data.experiences.work[0].company === '星河科技');
  h.document.querySelector('[data-remove-experience="work"]').click();
  await until(() => h.data.experiences.work.length === 0);
  assert.match(h.document.querySelector('.experience-empty').textContent, /工作经历/);
});

test('text resume import previews classification before applying it', async t => {
  const h = await popup(t, { profile: { city: '上海' } });
  const field = h.document.querySelector('#resume-import-file');
  const text = `林晓\nlin@example.com\n工作经历\n星河科技 | 产品经理\n2022.06 - 至今\n负责数据产品\n项目经历\n招聘助手 | 负责人\n2024.01 - 2024.06\n浏览器扩展`;
  Object.defineProperty(field, 'files', { configurable: true, value: [{ name: 'resume.txt', size: text.length, async text() { return text; } }] });
  field.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  await until(() => !h.document.querySelector('#resume-import-preview').hidden);
  assert.equal(h.data.experiences, undefined);
  assert.match(h.document.querySelector('#resume-import-summary').textContent, /1 段工作/);
  h.document.querySelector('#resume-import-apply').click();
  await until(() => h.data.experiences?.work?.length === 1);
  assert.equal(h.data.profile.name, '林晓');
  assert.equal(h.data.profile.city, '上海');
  assert.equal(h.data.experiences.projects[0].name, '招聘助手');
});
test('failed second resume selection clears the previous import candidate', async t => {
  const h = await popup(t, { profile: { name: '保留姓名' } });
  const field = h.document.querySelector('#resume-import-file');
  const choose = text => {
    Object.defineProperty(field, 'files', { configurable: true, value: [{ name: 'resume.txt', size: text.length, async text() { return text; } }] });
    field.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  };
  choose('新姓名\nnew@example.com\n工作经历\n甲公司 | 工程师\n2022.01 - 至今\n工作内容');
  await until(() => !h.document.querySelector('#resume-import-preview').hidden);
  choose('损坏');
  await until(() => h.document.querySelector('#message').dataset.error === 'true');
  assert.equal(h.document.querySelector('#resume-import-preview').hidden, true);
  h.document.querySelector('#resume-import-apply').click();
  await until(() => /请先选择并解析/.test(h.document.querySelector('#message').textContent));
  assert.equal(h.data.profile.name, '保留姓名');
  assert.equal(h.data.experiences, undefined);
});

test('rapid double add and edit-then-remove do not duplicate or resurrect experience', async t => {
  const h = await popup(t, {});
  const add = h.document.querySelector('[data-add-experience="work"]');
  add.click();
  add.click();
  await until(() => h.data.experiences?.work?.length === 1);
  const company = h.document.querySelector('[data-experience-type="work"][data-experience-key="company"]');
  company.value = '不应复活';
  company.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  h.document.querySelector('[data-remove-experience="work"]').click();
  await until(() => h.data.experiences.work.length === 0 && h.document.querySelector('#experience-save-state').textContent === '已保存');
  assert.equal(h.document.querySelectorAll('.experience-card').length, 0);
});
test('a slower earlier resume read cannot replace a newer selection', async t => {
  const h = await popup(t, {});
  const field = h.document.querySelector('#resume-import-file');
  let finishSlow;
  const slowText = new Promise(resolve => { finishSlow = () => resolve('旧姓名\nold@example.com\n工作经历\n旧公司 | 旧职位\n2020.01 - 2021.01\n旧内容'); });
  Object.defineProperty(field, 'files', { configurable: true, value: [{ name: 'slow.txt', size: 100, text: () => slowText }] });
  field.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 5));
  const latest = '新姓名\nnew@example.com\n工作经历\n新公司 | 新职位\n2022.01 - 至今\n新内容';
  Object.defineProperty(field, 'files', { configurable: true, value: [{ name: 'latest.txt', size: 100, async text() { return latest; } }] });
  field.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  await until(() => !h.document.querySelector('#resume-import-preview').hidden);
  finishSlow();
  await new Promise(resolve => setTimeout(resolve, 15));
  h.document.querySelector('#resume-import-apply').click();
  await until(() => h.data.experiences?.work?.length === 1);
  assert.equal(h.data.profile.name, '新姓名');
  assert.equal(h.data.experiences.work[0].company, '新公司');
});
test('quick attachment is opt-in, persisted and restored through import', async t => {
  const h = await popup(t, {});
  const toggle = h.document.querySelector('#quick-attachment');
  assert.equal(toggle.checked, false);
  toggle.checked = true;
  toggle.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  await until(() => !toggle.disabled);
  assert.deepEqual(h.data.settings, { quickAttachment: true });
  importFile(h, { schemaVersion: 2, profile: {}, settings: { quickAttachment: false } });
  await until(() => !h.document.querySelector('#import-button').disabled);
  assert.equal(toggle.checked, false);
  assert.deepEqual(h.data.settings, { quickAttachment: false });
});
test('history tolerates damaged entries and only creates web links', async t => {
  const h = await popup(t, { applications: [null, { url: 'javascript:alert(1)', createdAt: 1 },
    { url: 'https://jobs.example.test/job', title: '测试岗位', createdAt: Date.now() }] });
  assert.equal(h.document.querySelectorAll('#application-list a').length, 1);
  assert.equal(h.document.querySelector('#application-list a').textContent, '测试岗位');
});
test('application history exports a BOM-prefixed CSV with status and source', async t => {
  const h = await popup(t, { applications: [{
    url: 'https://jobs.example.test/job/1', title: '产品经理', company: '示例科技',
    status: 'submitted', source: 'auto', createdAt: Date.now()
  }] });
  let exported;
  h.w.Blob = Blob;
  h.w.URL.createObjectURL = blob => { exported = blob; return 'blob:history'; };
  h.w.URL.revokeObjectURL = () => {};
  h.document.addEventListener('click', event => { if (event.target.tagName === 'A') event.preventDefault(); });
  h.document.querySelector('#export-history').click();
  await until(() => exported);
  const csv = await exported.text();
  assert.deepEqual([...new Uint8Array(await exported.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(csv, /产品经理/);
  assert.match(csv, /示例科技/);
  assert.match(csv, /已投递/);
  assert.match(csv, /自动确认/);
  assert.match(csv, /https:\/\/jobs\.example\.test\/job\/1/);
});
test('history groups applications by company and exports a company summary', async t => {
  const now = Date.now();
  const h = await popup(t, { applications: [
    { url: 'https://jobs.example.test/job/1', title: '产品经理', company: '示例科技', status: 'submitted', source: 'auto', createdAt: now },
    { url: 'https://jobs.example.test/job/2', title: '用户研究员', company: '示例科技', status: 'recorded', source: 'manual', createdAt: now - 1000 },
    { url: 'https://other.example.test/job/3', title: '设计师', company: '', status: 'submitted', source: 'auto', createdAt: now - 2000 },
    { url: 'https://apply.careers.dji.com/job/4', title: '产品设计师', company: 'apply.careers.dji.com', status: 'submitted', source: 'auto', createdAt: now - 3000 }
  ] });
  const companies = [...h.document.querySelectorAll('#company-list .company-item')];
  assert.equal(companies.length, 3);
  assert.match(companies[0].textContent, /示例科技/);
  assert.match(companies[0].textContent, /2 个岗位/);
  let exported;
  h.w.Blob = Blob;
  h.w.URL.createObjectURL = blob => { exported = blob; return 'blob:companies'; };
  h.w.URL.revokeObjectURL = () => {};
  h.document.addEventListener('click', event => { if (event.target.tagName === 'A') event.preventDefault(); });
  h.document.querySelector('#export-companies').click();
  await until(() => exported);
  const csv = await exported.text();
  assert.deepEqual([...new Uint8Array(await exported.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(csv, /公司/);
  assert.match(csv, /示例科技/);
  assert.match(csv, /2/);
  assert.match(csv, /产品经理/);
  assert.match(csv, /other\.example\.test/);
  assert.match(csv, /DJI/);
});
test('clearing application history requires explicit confirmation', async t => {
  const application = { url: 'https://jobs.example.test/job/1', title: '产品经理', createdAt: Date.now() };
  const h = await popup(t, { applications: [application] });
  h.w.confirm = () => false;
  h.document.querySelector('#clear-history').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.data.applications.length, 1);
  h.w.confirm = () => true;
  h.document.querySelector('#clear-history').click();
  await until(() => h.data.applications.length === 0);
  assert.match(h.document.querySelector('#application-list').textContent, /还没有投递记录/);
  assert.match(h.document.querySelector('#company-list').textContent, /还没有公司记录/);
});
test('storage errors are visible and do not permanently block later saves', async t => {
  const h = await popup(t, {});
  const original = h.w.chrome.storage.local.set;
  h.w.chrome.storage.local.set = async () => { throw new Error('存储已满'); };
  input(h, 'name', '测试');
  await until(() => h.document.querySelector('#save-state').textContent === '保存失败');
  h.w.chrome.storage.local.set = original;
  h.document.querySelector('#save-button').click();
  await until(() => !h.document.querySelector('#save-button').disabled);
  assert.equal(h.data.profile.name, '测试');
});
