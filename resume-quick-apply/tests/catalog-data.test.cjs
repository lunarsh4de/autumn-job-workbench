const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../catalog-data.js');

test('catalog parses quoted CSV rows and normalizes Chinese headers', () => {
  const jobs = C.parseImport('公司,岗位,地点,链接,标签\r\n示例科技,"产品经理,增长方向",上海,https://example.com/jobs/1,"用户研究,SQL"');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].company, '示例科技');
  assert.equal(jobs[0].title, '产品经理,增长方向');
  assert.deepEqual(jobs[0].tags, ['用户研究', 'SQL']);
  assert.equal(jobs[0].url, 'https://example.com/jobs/1');
});

test('catalog deduplicates by URL and keeps an existing local score', () => {
  const existing = C.parseImport('[{"company":"甲","title":"产品经理","url":"https://example.com/1","matchScore":88}]');
  const incoming = C.parseImport('[{"company":"甲","title":"产品经理","url":"https://example.com/1","description":"更新后的描述"}]');
  const merged = C.merge(existing, incoming);
  assert.equal(merged.added, 0);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.items[0].matchScore, 88);
  assert.equal(merged.items[0].description, '更新后的描述');
});

test('catalog local scoring uses role, skill and city preferences without network access', () => {
  const job = C.item({ company: '示例', title: '产品经理', location: '上海', tags: ['SQL'], description: '用户研究和数据分析' });
  const score = C.score(job, { roles: '产品经理', skills: 'SQL,用户研究', cities: '上海' });
  assert.equal(score, 85);
  assert.equal(C.score(job, {}), null);
});

test('catalog summary counts companies, high matches and unscored rows', () => {
  const items = [
    C.item({ company: '甲', title: '岗位 1', matchScore: 75 }),
    C.item({ company: '甲', title: '岗位 2', matchScore: 32 }),
    C.item({ company: '乙', title: '岗位 3' })
  ];
  assert.deepEqual(C.summary(items), { total: 3, companies: 2, highMatch: 1, unscored: 1 });
});

test('catalog classifies imported roles and derives province-city fields', () => {
  const job = C.item({ company: '示例', title: '数据分析师', location: '浙江省杭州市余杭区' });
  assert.equal(job.jobType, '数据算法');
  assert.equal(job.province, '浙江');
  assert.equal(job.city, '杭州');
  assert.equal(C.formatRegion(job), '浙江 · 杭州');
});

test('catalog falls back to a bounded category for unknown new roles', () => {
  const job = C.item({ company: '示例', title: '校园招聘专员', location: '上海' });
  assert.equal(job.jobType, '职能管培');
  assert.equal(job.province, '上海');
  assert.equal(job.city, '上海');
});
