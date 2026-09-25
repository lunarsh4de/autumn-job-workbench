const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../dashboard-data.js');

test('dashboard imports valid extension applications once and preserves managed stages', () => {
  const application = {
    url: 'https://apply.careers.dji.com/job/42', title: '产品设计师', company: 'apply.careers.dji.com',
    status: 'submitted', source: 'auto', resumeProfileId: 'design', resumeProfileLabel: '工业设计版', createdAt: 1000
  };
  const first = D.mergeApplications([], [application]);
  assert.equal(first.added, 1);
  assert.equal(first.items[0].company, 'DJI');
  assert.equal(first.items[0].stage, 'applied');
  assert.equal(first.items[0].resumeProfileLabel, '工业设计版');
  first.items[0].stage = 'interview';
  const second = D.mergeApplications(first.items, [application]);
  assert.equal(second.added, 0);
  assert.equal(second.items[0].stage, 'interview');
});

test('dashboard rejects unsafe links and normalizes malformed fields', () => {
  const item = D.item({
    id: 'x', company: ' 示例公司 ', title: ' 产品经理 ', url: 'javascript:alert(1)',
    stage: 'unknown', priority: 'urgent', createdAt: 12, updatedAt: 13
  });
  assert.equal(item.company, '示例公司');
  assert.equal(item.title, '产品经理');
  assert.equal(item.url, '');
  assert.equal(item.stage, 'watch');
  assert.equal(item.priority, 'normal');
});

test('dashboard preserves catalog classification metadata when tracking a job', () => {
  const item = D.item({
    company: 'Google', title: '产品经理', companyType: '外企（中国大陆）', jobType: '产品项目', source: 'catalog',
    platform: '公司官网', location: '上海'
  });
  assert.equal(item.companyType, '外企（中国大陆）');
  assert.equal(item.jobType, '产品项目');
  assert.equal(item.platform, '公司官网');
  assert.equal(item.source, 'catalog');
});

test('dashboard summary reports active stages, responses and current-week additions', () => {
  const now = new Date('2026-09-22T12:00:00+08:00').getTime();
  const items = [
    { id: '1', company: '甲', title: '岗位 1', stage: 'applied', createdAt: now, updatedAt: now },
    { id: '2', company: '乙', title: '岗位 2', stage: 'interview', createdAt: now - 86400000, updatedAt: now },
    { id: '3', company: '丙', title: '岗位 3', stage: 'offer', createdAt: now - 20 * 86400000, updatedAt: now },
    { id: '4', company: '丁', title: '岗位 4', stage: 'closed', createdAt: now - 30 * 86400000, updatedAt: now }
  ];
  const summary = D.summary(items, now);
  assert.equal(summary.total, 4);
  assert.equal(summary.active, 2);
  assert.equal(summary.thisWeek, 2);
  assert.equal(summary.interviews, 1);
  assert.equal(summary.offers, 1);
  assert.equal(summary.responseRate, 50);
});
