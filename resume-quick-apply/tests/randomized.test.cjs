const test = require('node:test');
const assert = require('node:assert/strict');
const { parseResumeText } = require('../resume-parser.js');
const ResumeData = require('../data.js');
const { content, popup, until } = require('./helpers.cjs');

function random(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => ((state = Math.imul(state ^ state >>> 15, 1 | state), state ^= state + Math.imul(state ^ state >>> 7, 61 | state), ((state ^ state >>> 14) >>> 0) / 4294967296));
}

function pick(rng, values) { return values[Math.floor(rng() * values.length)]; }

test('200 seeded resume-layout variants preserve classified identity and sections', () => {
  const rng = random();
  const prefixes = ['', '一、', '1. ', '• ', '  '];
  const suffixes = ['', '：', ' / WORK EXPERIENCE', '｜WORK EXPERIENCE'];
  const separators = [' | ', '｜', ' · '];
  const dateSeparators = [' - ', '—', ' 至 ', '~'];
  const dateStyles = [
    ['2022.01', '2023.06'], ['2022/01', '2023/06'], ['2022-01', '2023-06'], ['2022年1月', '2023年6月']
  ];
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const prefix = pick(rng, prefixes);
    const [start, end] = pick(rng, dateStyles);
    const date = `${start}${pick(rng, dateSeparators)}${end}`;
    const workParts = rng() < .5 ? ['星河科技有限公司', '产品经理'] : ['产品经理', '星河科技有限公司'];
    const projectParts = rng() < .5 ? ['招聘助手', '项目负责人'] : ['项目负责人', '招聘助手'];
    const blank = '\n'.repeat(1 + Math.floor(rng() * 3));
    const text = [
      'LI Ming 李明', '138-0013-8000 | li@example.com',
      `${prefix}教育经历${rng() < .5 ? '' : ' / EDUCATION'}`,
      `示例大学${pick(rng, separators)}计算机科学${pick(rng, separators)}硕士`, date,
      `${prefix}工作经历${pick(rng, suffixes)}`,
      workParts.join(pick(rng, separators)), date, '负责产品规划',
      `${prefix}项目经历${rng() < .5 ? '' : ' / PROJECTS'}`,
      projectParts.join(pick(rng, separators)), date, '完成浏览器扩展',
      `${prefix}专业技能：SQL、Python`
    ].join(blank);
    const result = parseResumeText(text);
    assert.equal(result.profile.name, '李明', `seeded iteration ${iteration}`);
    assert.equal(result.profile.phone, '13800138000', `seeded iteration ${iteration}`);
    assert.equal(result.experiences.education[0].school, '示例大学', `seeded iteration ${iteration}`);
    assert.equal(result.experiences.work[0].company, '星河科技有限公司', `seeded iteration ${iteration}`);
    assert.equal(result.experiences.work[0].role, '产品经理', `seeded iteration ${iteration}`);
    assert.equal(result.experiences.projects[0].name, '招聘助手', `seeded iteration ${iteration}`);
    assert.equal(result.experiences.projects[0].role, '项目负责人', `seeded iteration ${iteration}`);
    assert.match(result.profile.skills, /SQL/, `seeded iteration ${iteration}`);
  }
});

test('random field ordering maps repeated experience properties without cross-entry swaps', async t => {
  const rng = random(0x12345678);
  const properties = [
    ['公司', 'company'], ['职位', 'role'], ['开始时间', 'startDate'], ['结束时间', 'endDate']
  ];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const order = [...properties].sort(() => rng() - .5);
    const html = `<section><h2>工作经历</h2>${[0, 1, 2].map(index =>
      `<div data-entry="${index}">${order.map(([label, key]) => `<label>${label}<input data-key="${key}"></label>`).join('')}</div>`).join('')}</section>`;
    const experiences = { work: [0, 1, 2].map(index => ({
      company: `公司${index}`, role: `职位${index}`, startDate: `202${index}.01`, endDate: `202${index}.12`
    })) };
    const h = content(t, html);
    const result = await h.send({ experiences });
    assert.equal(result.filled, 12);
    for (const input of h.document.querySelectorAll('input')) {
      const index = Number(input.closest('[data-entry]').dataset.entry);
      assert.equal(input.value, experiences.work[index][input.dataset.key], `iteration ${iteration}`);
    }
  }
});

test('40 seeded add-edit-remove operations leave UI and storage in the same state', async t => {
  const h = await popup(t, {});
  const rng = random(0xabcddcba);
  const expected = [];
  for (let step = 0; step < 40; step += 1) {
    const operation = !expected.length ? 'add' : expected.length >= 6 ? pick(rng, ['edit', 'remove']) : pick(rng, ['add', 'edit', 'remove']);
    if (operation === 'add') {
      h.document.querySelector('[data-add-experience="work"]').click();
      expected.push('');
      await until(() => h.data.experiences?.work?.length === expected.length);
    } else if (operation === 'remove') {
      const index = Math.floor(rng() * expected.length);
      h.document.querySelectorAll('[data-remove-experience="work"]')[index].click();
      expected.splice(index, 1);
      await until(() => h.data.experiences.work.length === expected.length);
    } else {
      const index = Math.floor(rng() * expected.length);
      const value = `公司-${step}-${Math.floor(rng() * 10000)}`;
      const field = h.document.querySelectorAll('[data-experience-type="work"][data-experience-key="company"]')[index];
      field.value = value;
      field.dispatchEvent(new h.w.Event('input', { bubbles: true }));
      expected[index] = value;
      await until(() => h.data.experiences.work[index].company === value);
    }
  }
  assert.deepEqual(h.data.experiences.work.map(item => item.company), expected);
  assert.deepEqual([...h.document.querySelectorAll('[data-experience-type="work"][data-experience-key="company"]')].map(field => field.value), expected);
  assert.equal(h.document.querySelectorAll('[data-remove-experience="work"]').length, expected.length);
});

test('1000 seeded malformed text inputs either reject cleanly or return bounded valid data', () => {
  const rng = random(0xf00dcafe);
  const fragments = ['\0', '\n', '\t', '工作经历', '教育背景', '项目经验', '专业技能', '专利与奖项',
    '2022.01-2023.06', '至今', '• ', '一、', 'A', '测试', '@', '|', '：', '😀'];
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const count = Math.floor(rng() * 80);
    const text = Array.from({ length: count }, () => pick(rng, fragments)).join(rng() < .5 ? '' : ' ');
    try {
      const result = parseResumeText(text);
      assert.deepEqual(ResumeData.profile(result.profile), result.profile, `profile ${iteration}`);
      assert.deepEqual(ResumeData.experiences(result.experiences), result.experiences, `experiences ${iteration}`);
      assert.ok(result.meta.textLength <= 200000);
      for (const items of Object.values(result.experiences)) assert.ok(items.length <= 20);
    } catch (error) {
      assert.ok(error instanceof Error, `iteration ${iteration} threw a non-Error value`);
    }
  }
});
