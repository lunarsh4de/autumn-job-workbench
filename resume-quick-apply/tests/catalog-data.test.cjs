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

test('catalog derives expanded mainland city mappings', () => {
  assert.deepEqual(C.regionParts({ location: '江苏-泰州-海陵区' }), { province: '江苏', city: '泰州' });
  assert.deepEqual(C.regionParts({ location: '新余-新余-渝水区' }), { province: '江西', city: '新余' });
});

test('catalog falls back to a bounded category for unknown new roles', () => {
  const job = C.item({ company: '示例', title: '校园招聘专员', location: '上海' });
  assert.equal(job.jobType, '职能管培');
  assert.equal(job.province, '上海');
  assert.equal(job.city, '上海');
});

test('catalog classifies common bilingual job titles into bounded categories', () => {
  assert.equal(C.classifyJobType({ title: 'Product Operations Intern' }), '产品项目');
  assert.equal(C.classifyJobType({ title: 'Management Trainee' }), '职能管培');
  assert.equal(C.classifyJobType({ title: 'User Growth Intern' }), '运营市场');
  assert.equal(C.classifyJobType({ title: '软件实施工程师' }), '技术研发');
  assert.equal(C.classifyJobType({ title: '系统策划' }), '产品项目');
  assert.equal(C.classifyJobType({ title: '文员实习生' }), '职能管培');
  assert.equal(C.classifyJobType({ title: '集控巡检' }), '供应链制造');
  assert.equal(C.classifyJobType({ title: '茶原料开发' }), '供应链制造');
});

test('catalog normalizes mainland foreign-company labels and derives resume preferences', () => {
  const job = C.item({ company: 'Airbnb', title: '产品经理', location: '上海', companyType: '外企' });
  assert.equal(job.companyType, '外企（中国大陆）');
  const automatic = C.deriveResumePreferences({
    profile: { city: '深圳', skills: 'SQL, Python' },
    experiences: { work: [{ role: '产品经理', location: '上海' }], projects: [{ role: '用户研究', location: '' }] }
  });
  assert.deepEqual(automatic, { roles: '产品经理, 用户研究', skills: 'SQL, Python', cities: '上海, 深圳' });
  assert.deepEqual(C.mergePreferences({ roles: '数据分析', skills: '', cities: '北京' }, automatic), {
    roles: '数据分析, 产品经理, 用户研究', skills: 'SQL, Python', cities: '北京, 上海, 深圳'
  });
});

test('catalog scores structured province-city fields when location text is empty', () => {
  const job = C.item({ company: '示例', title: '产品经理', province: '江苏', city: '南京', location: '' });
  assert.equal(C.score(job, { cities: '南京' }), 20);
});

test('catalog infers known foreign employers only for mainland locations', () => {
  assert.equal(C.item({ company: 'Google', title: '软件工程师', location: '上海' }).companyType, '外企（中国大陆）');
  assert.equal(C.item({ company: 'IBM', title: '软件工程师', province: '广东', city: '深圳', location: '' }).companyType, '外企（中国大陆）');
  assert.equal(C.item({ company: 'Google', title: '软件工程师', location: '新加坡' }).companyType, '外企（其他地区）');
});

test('catalog classifies explicit and known state-owned employers', () => {
  assert.equal(C.item({ company: '国家电网有限公司', title: '技术研发', location: '北京' }).companyType, '国企/央企');
  assert.equal(C.item({ company: '某单位', title: '管培生', location: '上海', companyType: '央企' }).companyType, '国企/央企');
});
