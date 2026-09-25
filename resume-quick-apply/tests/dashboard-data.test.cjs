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
  assert.equal(first.items[0].recordMode, 'auto');
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

test('dashboard advances a catalog card when the extension records the same URL', () => {
  const existing = D.item({
    id: 'catalog-1', company: '示例科技', title: '数据分析师', url: 'https://jobs.example.test/1',
    stage: 'watch', priority: 'high', notes: '保留备注', nextActionAt: '2026-09-30T10:00',
    source: 'catalog', createdAt: 900, updatedAt: 1000
  });
  const result = D.mergeApplications([existing], [{
    url: 'https://jobs.example.test/1', title: '数据分析师', company: '示例科技', createdAt: 2000,
    resumeProfileId: 'data', resumeProfileLabel: '数据版'
  }]);
  assert.equal(result.added, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'catalog-1');
  assert.equal(result.items[0].stage, 'applied');
  assert.equal(result.items[0].source, 'extension');
  assert.equal(result.items[0].recordMode, '');
  assert.equal(result.items[0].resumeProfileLabel, '数据版');
  assert.equal(result.items[0].notes, '保留备注');
  assert.equal(result.items[0].priority, 'high');
  assert.equal(result.items[0].nextActionAt, '2026-09-30T10:00');
});

test('dashboard does not regress progressed stages or duplicate repeated applications', () => {
  const existing = D.item({ id: 'interview-1', company: '示例', title: '岗位', url: 'https://jobs.example.test/2', stage: 'interview', source: 'catalog', updatedAt: 1000 });
  const application = { url: 'https://jobs.example.test/2', title: '岗位', company: '示例', createdAt: 2000 };
  const result = D.mergeApplications([existing], [application, application]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].stage, 'interview');
  assert.equal(result.updated, 1);
  assert.equal(result.added, 0);
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
