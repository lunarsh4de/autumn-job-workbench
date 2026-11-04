const test = require('node:test');
const assert = require('node:assert/strict');
const { popup, setup, source, until, pdf } = require('./helpers.cjs');
const TD = require('../dashboard-data.js');

function change(h, selector, value, event = 'input') {
  const field = h.document.querySelector(selector); field.value = value;
  field.dispatchEvent(new h.w.Event(event, { bubbles: true }));
}
const application = (id, status = 'recorded') => ({ url: `https://jobs.test/${id}`, company: `公司${id}`, title: `设计师${id}`, status, createdAt: 1000 + id });

test('history searches all stored records, filters states and shows further pages', async t => {
  const applications = Array.from({ length: 75 }, (_, i) => application(i, i === 70 ? 'submitted' : 'recorded'));
  applications[70].notes = '远程面试';
  const h = await popup(t, { applications });
  assert.equal(h.document.querySelectorAll('.application-item').length, 30);
  h.document.querySelector('#history-more').click();
  assert.equal(h.document.querySelectorAll('.application-item').length, 60);
  change(h, '#history-search', '远程面试');
  assert.equal(h.document.querySelectorAll('.application-item').length, 1);
  assert.match(h.document.querySelector('#application-list').textContent, /设计师70/);
  change(h, '#history-status', 'communicated', 'change');
  assert.equal(h.document.querySelectorAll('.application-item').length, 0);
  assert.match(h.document.querySelector('#application-list').textContent, /没有匹配/);
  h.document.querySelector('#reset-history-filters').click();
  assert.equal(h.document.querySelectorAll('.application-item').length, 30);
  assert.equal(h.data.applications.length, 75);
});

test('editing existing record preserves status and notes and survives a failed save', async t => {
  const h = await popup(t, { applications: [{ ...application(1, 'submitted'), notes: '初次备注', salary: '20K' }] });
  h.document.querySelector('.application-item button').click();
  await until(() => !h.document.querySelector('#job-capture-form').hidden);
  assert.equal(h.document.querySelector('#capture-notes').value, '初次备注');
  assert.equal(h.document.querySelector('#capture-status').value, 'submitted');
  change(h, '#capture-notes', '更新备注');
  await until(() => h.data.jobCaptureDraft?.notes === '更新备注');
  h.w.chrome.runtime.sendMessage = async () => ({ error: '存储失败' });
  h.document.querySelector('#job-capture-form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => h.document.querySelector('#message').dataset.error === 'true');
  assert.equal(h.data.applications[0].notes, '初次备注');
  assert.equal(h.document.querySelector('#capture-notes').value, '更新备注');
  assert.equal(h.data.jobCaptureDraft.notes, '更新备注');
});

test('capture restores the same-job draft and clears it only after successful save', async t => {
  const job = { ...application(2, 'communicated'), notes: '未完成草稿', savedAt: Date.now() };
  const h = await popup(t, { jobCaptureDraft: job });
  h.w.chrome.tabs.sendMessage = async () => ({ ...job, notes: '', status: 'recorded' });
  h.document.querySelector('#capture-job').click();
  await until(() => !h.document.querySelector('#job-capture-form').hidden);
  assert.equal(h.document.querySelector('#capture-notes').value, '未完成草稿');
  assert.equal(h.document.querySelector('#capture-status').value, 'communicated');
  h.document.querySelector('#job-capture-form').dispatchEvent(new h.w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => h.data.jobCaptureDraft === null);
  assert.equal(h.data.applications[0].notes, '未完成草稿');
});

test('first-run intake differs from returning and attachment-only users', async t => {
  const fresh = await popup(t, {});
  assert.equal(fresh.document.querySelector('.quick-intake').hidden, false);
  assert.equal(fresh.document.querySelector('#active-resume-strip').hidden, true);
  const returning = await popup(t, { profile: { name: '测试' } });
  assert.equal(returning.document.querySelector('.quick-intake').hidden, true);
  const attachment = await popup(t, { resume: pdf });
  assert.equal(attachment.document.querySelector('.quick-intake').hidden, true);
});

test('current-page record banner handles tracking URLs and displays saved status', async t => {
  const entry = { ...application(1, 'submitted'), url: 'https://jobs.example.test/apply?utm_source=one', company: '已有公司' };
  const h = await popup(t, { applications: [entry] });
  assert.equal(h.document.querySelector('#current-job-record').hidden, false);
  assert.match(h.document.querySelector('#current-job-record').textContent, /已投递.*已有公司/);
});

test('unsupported browser pages disable webpage actions while retaining local management', async t => {
  const h = setup(t, source('popup.html'), { profile: { name: '测试' } });
  h.w.chrome.tabs.query = async () => [{ id: 1, url: 'edge://extensions/' }];
  h.w.eval(source('resume-parser.js')); h.w.eval(source('popup.js'));
  await until(() => !h.document.querySelector('#save-button').disabled);
  assert.equal(h.document.querySelector('#fill-button').disabled, true);
  assert.equal(h.document.querySelector('#capture-job').disabled, true);
  assert.equal(h.document.querySelector('#export-history').disabled, false);
  assert.equal(h.document.querySelector('#tab-profile').disabled, false);
  assert.equal(h.document.querySelector('#page-capability').dataset.status, 'blocked');
});

test('invalid imported timestamps cannot break the complete history view', async t => {
  const h = await popup(t, { applications: [application(1), { ...application(2), createdAt: 1e100 }] });
  assert.equal(h.document.querySelectorAll('.application-item').length, 1);
  assert.equal(h.document.querySelector('#save-button').disabled, false);
});

test('attention excludes completed applications, past interviews and deadlines of submitted jobs', () => {
  const now = new Date('2026-11-04T10:00:00').getTime();
  const jobs = [
    { id: '1', company: '甲', title: '设计', stage: 'preparing', deadline: '2026-11-04', nextActionAt: '2026-11-03T12:00' },
    { id: '2', company: '乙', stage: 'interview', interviewAt: '2026-11-05T14:00' },
    { id: '3', stage: 'closed', nextActionAt: '2026-11-04T12:00' },
    { id: '4', stage: 'offer', interviewAt: '2026-11-04T12:00' },
    { id: '5', stage: 'applied', deadline: '2026-11-04' },
    { id: '6', stage: 'interview', interviewAt: '2026-11-03T12:00' },
    { id: '7', stage: 'watch', deadline: 'bad date' },
    { id: '8', stage: 'preparing', nextActionAt: '2026-12-01T12:00' }
  ];
  const result = TD.attention(jobs, now);
  assert.equal(result.length, 3);
  assert.equal(result[0].type, 'followup');
  assert.equal(result[0].overdue, true);
  assert.equal(result[1].type, 'deadline');
  assert.equal(result[1].overdue, false);
  assert.equal(result[2].jobId, '2');
});

test('attention view lists actionable jobs and opens their existing editor', async t => {
  const next = new Date(Date.now() + 3600000).toISOString();
  const h = setup(t, source('dashboard.html'), { jobTrackerItems: [{ id: 'one', company: '甲科技', title: '工业设计师', stage: 'interview', interviewAt: next }] });
  h.w.scrollTo = () => {};
  h.w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  h.w.HTMLDialogElement.prototype.close = function() { this.open = false; };
  h.w.eval(source('dashboard-data.js'));
  h.w.eval(source('dashboard.js'));
  await until(() => h.document.querySelector('#nav-attention-count').textContent === '1');
  h.document.querySelector('[data-view="attention"]').click();
  assert.equal(h.document.querySelector('#view-attention').hidden, false);
  assert.match(h.document.querySelector('#attention-list').textContent, /甲科技/);
  h.document.querySelector('#attention-list button').click();
  assert.equal(h.document.querySelector('#job-dialog').open, true);
  assert.equal(h.document.querySelector('#job-id').value, 'one');
  h.document.querySelector('#job-dialog').close();
  h.w.document.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  assert.equal(h.document.activeElement.id, 'global-search');
  h.document.querySelector('#mobile-menu').click();
  assert.equal(h.document.querySelector('#mobile-menu').getAttribute('aria-expanded'), 'true');
  h.document.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(h.document.querySelector('#sidebar').classList.contains('open'), false);
  change(h, '#global-search', '甲科技');
  h.document.querySelector('[data-view="catalog"]').click();
  assert.equal(h.document.querySelector('#global-search').value, '');
  h.document.querySelector('[data-view="attention"]').click();
  assert.equal(h.document.querySelector('#global-search').value, '甲科技');
});

test('shared text and action colors meet normal text contrast requirement', () => {
  const luminance = hex => {
    const channel = hex.match(/[a-f0-9]{2}/gi).map(part => Number.parseInt(part, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return channel[0] * .2126 + channel[1] * .7152 + channel[2] * .0722;
  };
  const css = source('design-system.css');
  const token = name => css.match(new RegExp(`--qa-${name}: (#[a-f0-9]{6})`))[1];
  for (const [fg, bg] of [[token('ink'), '#ffffff'], [token('muted'), '#ffffff'], ['#ffffff', token('accent')], [token('accent-dark'), token('accent-soft')]]) {
    const values = [luminance(fg), luminance(bg)].sort((a,b) => b-a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, `${fg} on ${bg}`);
  }
});
