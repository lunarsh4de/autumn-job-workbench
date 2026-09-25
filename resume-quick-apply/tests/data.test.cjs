const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../data.js');
const { pdf } = require('./helpers.cjs');

test('legacy backup remains compatible and omitted fields become blank', () => {
  const result = D.backup({ profile: { name: '测试用户', unknown: 'ignored' }, resume: pdf });
  assert.equal(result.profile.email, '');
  assert.equal(result.profile.unknown, undefined);
  assert.equal(result.resume.type, 'application/pdf');
  assert.deepEqual(result.settings, { quickAttachment: false });
  assert.deepEqual(result.experiences, {
    work: [], education: [], projects: [], competitions: [], awards: [], campus: [], languages: [], publications: []
  });
  assert.deepEqual(result.applications, []);
});
test('reject malformed profile values and oversized fields before storing', () => {
  for (const value of [[], null, { name: {} }, { name: 42 }, { summary: 'x'.repeat(10001) }]) assert.throws(() => D.profile(value));
});
test('unrelated JSON cannot erase profile; future schema is rejected', () => {
  for (const value of [{}, [], { schemaVersion: 5, profile: {} }]) assert.throws(() => D.backup(value));
});
test('parallel resume profiles are validated and normalized', () => {
  const result = D.resumeProfiles([{ id: 'product', label: '产品经理版', profile: { name: '林晓' } }]);
  assert.equal(result[0].label, '产品经理版');
  assert.deepEqual(result[0].experiences.work, []);
  assert.throws(() => D.resumeProfiles([{ id: 'same', label: 'A', profile: {} }, { id: 'same', label: 'B', profile: {} }]));
  assert.throws(() => D.resumeProfiles(Array.from({ length: D.maxResumeProfiles + 1 }, (_, index) => ({ id: `p${index}`, label: `P${index}`, profile: {} }))));
  const backup = D.backup({ schemaVersion: 4, profile: {}, resumeProfiles: result, activeProfileId: 'product' });
  assert.equal(backup.activeProfileId, 'product');
  assert.equal(backup.resumeProfiles[0].label, '产品经理版');
});
test('backup keeps application to resume-profile association', () => {
  const profile = D.resumeProfile({ id: 'design', label: '设计版', profile: {} });
  const backup = D.backup({
    schemaVersion: 4, profile: {}, resumeProfiles: [profile], activeProfileId: 'design',
    applications: [{ url: 'https://jobs.example.test/1', title: '设计师', company: '示例', status: 'submitted', source: 'auto', resumeProfileId: 'design', resumeProfileLabel: '设计版', createdAt: 42 }]
  });
  assert.equal(backup.applications[0].resumeProfileId, 'design');
  assert.equal(backup.applications[0].resumeProfileLabel, '设计版');
});
test('experience collections are normalized and bounded', () => {
  const result = D.experiences({ work: [{ company: '星河科技', role: '产品经理', unknown: 'ignored' }] });
  assert.equal(result.work[0].company, '星河科技');
  assert.equal(result.work[0].description, '');
  assert.equal(result.work[0].unknown, undefined);
  assert.deepEqual(result.education, []);
  assert.throws(() => D.experiences({ work: Array.from({ length: 21 }, () => ({})) }));
  assert.throws(() => D.experiences({ projects: [{ description: 'x'.repeat(10001) }] }));
});
test('schema version 2 validates settings while ignoring unknown properties', () => {
  assert.deepEqual(D.backup({ schemaVersion: 2, profile: {}, settings: { quickAttachment: true, future: 'ignored' } }).settings,
    { quickAttachment: true });
  for (const settings of [[], 'yes', { quickAttachment: 'yes' }]) {
    assert.throws(() => D.backup({ schemaVersion: 2, profile: {}, settings }));
  }
});
test('validate Base64 and extension/content agreement', () => {
  for (const value of [
    { ...pdf, name: 'test.exe' },
    { ...pdf, dataUrl: 'https://example.test/private.pdf' },
    { ...pdf, dataUrl: 'data:application/pdf;base64,!!!!' },
    { ...pdf, dataUrl: 'data:application/pdf;base64,' },
    { ...pdf, name: 'test.docx' }
  ]) assert.throws(() => D.resume(value));
});
test('enforce decoded 3 MB bound (not an approximate data URL length)', () => {
  const payload = Buffer.alloc(D.maxResumeBytes + 1, 32);
  payload.write('%PDF-');
  const url = bytes => 'data:application/pdf;base64,' + bytes.toString('base64');
  assert.doesNotThrow(() => D.resume({ ...pdf, dataUrl: url(payload.subarray(0, -1)) }));
  assert.throws(() => D.resume({ ...pdf, dataUrl: url(payload) }), /3 MB/);
});
test('queued upload, profile update and removal cannot resurrect attachment', async () => {
  const enqueue = D.createQueue();
  const store = {};
  const tasks = [
    enqueue(async () => { await new Promise(resolve => setTimeout(resolve, 20)); store.resume = pdf; }),
    enqueue(() => { store.profile = { name: '最新姓名' }; }),
    enqueue(() => { store.resume = null; })
  ];
  await Promise.all(tasks);
  assert.equal(store.resume, null);
  assert.equal(store.profile.name, '最新姓名');
});
test('failed storage task does not block later saves', async () => {
  const enqueue = D.createQueue();
  await assert.rejects(enqueue(() => { throw new Error('quota'); }));
  assert.equal(await enqueue(() => 42), 42);
});
