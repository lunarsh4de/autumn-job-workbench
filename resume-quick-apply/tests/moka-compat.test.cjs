const test = require('node:test');
const assert = require('node:assert/strict');
const { content, pdf } = require('./helpers.cjs');

function wrap(section, label, field) {
  return `<section><h2>${section}</h2><div class="entry"><div class="field"><div class="label">${label}</div><div><div><div>${field}</div></div></div></div></div></section>`;
}

test('Moka-style deeply nested labels map education, internship and project fields', async t => {
  const h = content(t, [
    wrap('教育背景', '学校名称', '<input placeholder="请输入就读学校">'),
    wrap('教育背景', '学历', '<input placeholder="请选择">'),
    wrap('教育背景', '专业名称', '<input placeholder="请输入专业名称">'),
    wrap('实习经历', '公司名称', '<input placeholder="公司名称">'),
    wrap('实习经历', '职位名称', '<input placeholder="职位名称">'),
    wrap('实习经历', '工作职责', '<textarea placeholder="内容"></textarea>'),
    wrap('项目经验', '项目名称', '<input placeholder="项目名称">'),
    wrap('项目经验', '项目描述', '<textarea placeholder="内容"></textarea>')
  ].join(''));
  const result = await h.send({ experiences: {
    education: [{ school: '香港大学', degree: '硕士', major: '创新设计与技术' }],
    work: [{ company: '示例公司', role: '工业设计师', description: '负责产品设计' }],
    projects: [{ name: '智能机器人', description: '完成原型验证' }]
  } });
  assert.equal(result.filled, 8);
  assert.deepEqual([...h.document.querySelectorAll('input,textarea')].map(field => field.value),
    ['香港大学', '硕士', '创新设计与技术', '示例公司', '工业设计师', '负责产品设计', '智能机器人', '完成原型验证']);
});

test('Moka resume upload is selected while portrait and portfolio upload stay untouched', async t => {
  const h = content(t, `<div><h3>上传简历</h3><button>上传简历</button><input type="file" name="resumeKey"></div>
    <div><h3>上传照片</h3><input type="file" name="上传照片" accept="image/png"></div>
    <section><h2>作品附件</h2><input type="file" multiple></section>`);
  h.w.DataTransfer = class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } };
  for (const input of h.document.querySelectorAll('[type=file]')) Object.defineProperty(input, 'files', { configurable: true, writable: true, value: [] });
  const result = await h.send({ resume: pdf });
  assert.equal(result.attached, 1);
  assert.equal(h.document.querySelector('[name=resumeKey]').files[0].name, 'test.pdf');
  assert.equal(h.document.querySelector('[name="上传照片"]').files.length, 0);
  assert.equal(h.document.querySelector('section input').files.length, 0);
});

test('Moka personal fields use nearby visual labels when placeholder is generic', async t => {
  const h = content(t, `<section><h2>个人信息</h2>
    <div><div>姓名</div><div><div><div><input placeholder="请输入"></div></div></div></div>
    <div><div>最高学历</div><div><div><div><input placeholder="请选择"></div></div></div></div>
    <div><div>性别</div><div><div><div><input placeholder="请选择"></div></div></div></div>
  </section>`);
  const result = await h.send({ profile: { name: '测试用户', education: '硕士' } });
  assert.equal(result.filled, 2);
  assert.deepEqual([...h.document.querySelectorAll('input')].map(field => field.value), ['测试用户', '硕士', '']);
});

test('Moka-style competition, award, language and publication fields are filled by visual labels', async t => {
  const h = content(t, [
    wrap('赛事经历', '赛事名称', '<input placeholder="请输入">'),
    wrap('赛事经历', '比赛年份', '<input placeholder="如：2024年">'),
    wrap('赛事经历', '赛事描述', '<textarea placeholder="内容"></textarea>'),
    wrap('获奖经历', '描述', '<textarea placeholder="内容"></textarea>'),
    wrap('语言能力', '语言证书及成绩', '<textarea placeholder="内容"></textarea>'),
    wrap('论文/期刊', '名称', '<input placeholder="请输入">'),
    wrap('论文/期刊', '描述', '<textarea placeholder="内容"></textarea>'),
    wrap('论文/期刊', '成果', '<textarea placeholder="内容"></textarea>')
  ].join(''));
  const result = await h.send({ experiences: {
    competitions: [{ name: '全国创新设计大赛', year: '2024年', description: '一等奖' }],
    awards: [{ name: '红点概念奖', description: '团队成员' }],
    languages: [{ name: '大学英语六级', description: '580 分' }],
    publications: [{ name: '交互设计研究', description: '示例期刊', result: '第一作者' }]
  } });
  assert.equal(result.filled, 8);
  assert.deepEqual([...h.document.querySelectorAll('input,textarea')].map(field => field.value), [
    '全国创新设计大赛', '2024年', '一等奖', '团队成员', '大学英语六级\n580 分', '交互设计研究', '示例期刊', '第一作者'
  ]);
});

test('Moka-style campus fields and award year are filled', async t => {
  const h = content(t, [
    wrap('校园经历', '组织名称', '<input placeholder="请输入">'),
    wrap('校园经历', '担任职务', '<input placeholder="请输入">'),
    wrap('校园经历', '开始时间', '<input placeholder="请选择">'),
    wrap('校园经历', '结束时间', '<input placeholder="请选择">'),
    wrap('校园经历', '活动内容', '<textarea placeholder="内容"></textarea>'),
    wrap('获奖经历', '获奖名称', '<input placeholder="请输入">'),
    wrap('获奖经历', '获奖年份', '<input placeholder="如：2024年">')
  ].join(''));
  const result = await h.send({ experiences: {
    campus: [{ name: '学生会', role: '部长', startDate: '2021.09', endDate: '2023.06', description: '组织活动' }],
    awards: [{ name: '工业设计大赛一等奖', year: '2024年', description: '' }]
  } });
  assert.equal(result.filled, 7);
  assert.deepEqual([...h.document.querySelectorAll('input,textarea')].map(field => field.value), [
    '学生会', '部长', '2021.09', '2023.06', '组织活动', '工业设计大赛一等奖', '2024年'
  ]);
});
