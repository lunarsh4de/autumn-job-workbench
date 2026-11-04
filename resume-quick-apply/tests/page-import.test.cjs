const test = require('node:test');
const assert = require('node:assert/strict');
const { content, popup, until } = require('./helpers.cjs');
const D = require('../data.js');
const TD = require('../dashboard-data.js');

test('BOSS details prefer active job over recommendations and retain stable job link', async t => {
  const h = content(t, `<h1>热门职位</h1><div class="job-banner"><div class="name"><h1>工业设计师</h1></div><span class="salary">15-25K</span><span class="job-area">深圳</span></div><div class="sider-company"><div class="company-info"><a>星河科技</a></div></div>`, {}, 'https://www.zhipin.com/job_detail/abc.html?ka=search&lid=one');
  const job = await h.message('readPageJob');
  assert.equal(job.title, '工业设计师');
  assert.equal(job.company, '星河科技');
  assert.equal(job.salary, '15-25K');
  assert.equal(job.location, '深圳');
  assert.equal(job.url, 'https://www.zhipin.com/job_detail/abc.html');
});

test('BOSS list cannot silently select an unrelated job card', async t => {
  const h = content(t, '<h1>BOSS直聘</h1><div class="job-card"><span class="job-name">推荐职位</span><span class="company-name">推荐公司</span></div>', {}, 'https://www.zhipin.com/web/geek/chat');
  const job = await h.message('readPageJob');
  assert.equal(job.title, '');
  assert.equal(job.company, '');
});

test('page import reads visible readonly fields and select labels, excluding masks and credentials', async t => {
  const h = content(t, `<label>姓名<input name="name" value="林晓" readonly></label><label>邮箱<input type="email" value="lin@example.test"></label>
    <label>学历<select name="degree"><option value="master">硕士</option></select></label>
    <input type="password" name="name" value="secret"><input type="hidden" name="phone" value="13800000000">
    <label>手机号<input value="138****1234"></label><div hidden><input name="city" value="隐藏城市"></div>`);
  const result = await h.message('readPageProfile');
  assert.equal(result.profile.name, '林晓');
  assert.equal(result.profile.email, 'lin@example.test');
  assert.equal(result.profile.education, '硕士');
  assert.equal(result.profile.phone, '');
  assert.equal(result.profile.city, '');
  assert.equal(h.writes.length, 0);
});

test('BOSS resume imports separate experience cards without page navigation pollution', async t => {
  const h = content(t, `<nav>推荐职位 招聘联系人</nav><div class="resume-online">
    <div class="resume-userinfo"><span class="name">林晓</span><span class="phone">138****1234</span><span class="email">lin@example.test</span></div>
    <div id="resume-summary"><div class="text">擅长工业设计</div></div>
    <div id="resume-work"><div class="resume-item"><div class="item-primary"><span class="company-name">甲公司</span><span class="job-name">设计师</span><span class="period">2023.01 - 2024.06</span><p class="text">产品建模</p></div></div><div class="resume-item"><span class="company-name">乙公司</span><span class="job-name">实习生</span><span class="period">2022.01 - 2022.06</span></div></div>
    <div id="resume-education"><div class="resume-item"><span class="school-name">香港大学</span><span class="degree">硕士</span><span class="major">工业设计</span><span class="period">2026.09 - 至今</span></div></div>
    <div id="resume-project"><div class="resume-item"><span class="project-name">宠物项圈</span><span class="role">设计负责人</span><p class="text">原型开发</p></div></div></div>`, {}, 'https://www.zhipin.com/web/geek/resume');
  const result = await h.message('readPageProfile');
  assert.equal(result.profile.name, '林晓');
  assert.equal(result.profile.phone, '');
  assert.equal(result.profile.school, '香港大学');
  assert.equal(result.experiences.work.length, 2);
  assert.equal(result.experiences.work[0].company, '甲公司');
  assert.equal(result.experiences.work[0].endDate, '2024.06');
  assert.equal(result.experiences.projects[0].name, '宠物项圈');
  assert.equal(h.writes.length, 0);
});

test('page import is reviewable and default merge preserves existing profile and resume', async t => {
  const h = await popup(t, { profile: { name: '原姓名', city: '上海' } });
  h.w.chrome.tabs.sendMessage = async () => ({ profile: { name: '网页姓名', email: 'web@example.test' }, experiences: {}, source: 'BOSS 在线简历', warnings: [] });
  h.document.querySelector('#import-page-profile').click();
  await until(() => !h.document.querySelector('#resume-import-preview').hidden);
  assert.equal(h.data.profile.name, '原姓名');
  assert.match(h.document.querySelector('#resume-import-details').textContent, /网页姓名/);
  h.document.querySelector('#resume-import-apply').click();
  await until(() => h.data.profile.email === 'web@example.test');
  assert.equal(h.data.profile.name, '原姓名');
  assert.equal(h.data.profile.city, '上海');
});

test('failed page read clears previous import candidate', async t => {
  const h = await popup(t, { profile: { name: '原姓名' } });
  h.w.chrome.tabs.sendMessage = async () => ({ profile: { name: '网页姓名' }, experiences: {} });
  h.document.querySelector('#import-page-profile').click();
  await until(() => !h.document.querySelector('#resume-import-preview').hidden);
  h.w.chrome.tabs.sendMessage = async () => ({ error: '页面失效' });
  h.document.querySelector('#import-page-profile').click();
  await until(() => !h.document.querySelector('#import-page-profile').disabled);
  assert.equal(h.document.querySelector('#resume-import-preview').hidden, true);
  h.document.querySelector('#resume-import-apply').click();
  await until(() => /请先选择并解析/.test(h.document.querySelector('#message').textContent));
  assert.equal(h.data.profile.name, '原姓名');
});

test('capture lets user correct metadata and records communication separately', async t => {
  const h = await popup(t, { profile: { name: '测试' } });
  h.w.chrome.tabs.sendMessage = async () => ({ title: '原职位', company: '甲公司', url: 'https://www.zhipin.com/job_detail/abc.html?ka=one', salary: '15K' });
  h.document.querySelector('#capture-job').click();
  await until(() => !h.document.querySelector('#job-capture-form').hidden);
  assert.equal(h.data.applications, undefined);
  h.document.querySelector('#capture-title').value = '设计师';
  h.document.querySelector('#capture-status').value = 'communicated';
  h.document.querySelector('#capture-notes').value = '等回复';
  h.document.querySelector('#job-capture-form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => h.data.applications?.length === 1);
  await until(() => /已沟通/.test(h.document.querySelector('#application-list').textContent));
  assert.equal(h.data.applications[0].title, '设计师');
  assert.equal(h.data.applications[0].status, 'communicated');
  assert.equal(h.data.applications[0].notes, '等回复');
  assert.match(h.document.querySelector('#application-list').textContent, /已沟通/);
});

test('deduplication upgrades status, preserves attribution and ignores tracking query parameters', () => {
  const first = { url: 'https://www.zhipin.com/job_detail/abc.html?ka=first', title: '设计师', company: '甲公司', status: 'communicated', createdAt: 100, resumeProfileLabel: '设计版', source: 'manual', notes: '等回复' };
  const result = D.mergeApplication([first], { ...first, url: 'https://www.zhipin.com/job_detail/abc.html?ka=second', title: '自动标题', status: 'submitted', source: 'auto', resumeProfileLabel: '产品版', createdAt: 200 });
  assert.equal(result.applications.length, 1);
  assert.equal(result.applications[0].status, 'submitted');
  assert.equal(result.applications[0].title, '设计师');
  assert.equal(result.applications[0].resumeProfileLabel, '设计版');
  assert.equal(result.applications[0].createdAt, 100);
  assert.equal(D.applicationUrl('https://jobs.test/#/jobs/1'), 'https://jobs.test/#/jobs/1');
  assert.notEqual(D.applicationUrl('https://jobs.test/?id=1'), D.applicationUrl('https://jobs.test/?id=2'));
});

test('dashboard distinguishes saved and communicated records and upgrades existing jobs', () => {
  const a = { url: 'https://jobs.test/1', title: '设计师', company: '甲', status: 'recorded', createdAt: 100 };
  const initial = TD.mergeApplications([], [a]);
  assert.equal(initial.items[0].stage, 'preparing');
  const next = TD.mergeApplications(initial.items, [{ ...a, status: 'communicated', updatedAt: 200, salary: '20K' }]);
  assert.equal(next.updated, 1);
  assert.equal(next.items[0].stage, 'communicating');
  assert.equal(next.items[0].salary, '20K');
  next.items[0].stage = 'interview';
  const last = TD.mergeApplications(next.items, [{ ...a, status: 'submitted', updatedAt: 300 }]);
  assert.equal(last.items[0].stage, 'interview');
});
