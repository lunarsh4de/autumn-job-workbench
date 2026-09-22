const test = require('node:test');
const assert = require('node:assert/strict');
const { popup, until, pdf } = require('./helpers.cjs');

test('dashboard shows profile completion, resume readiness and page capability', async t => {
  const h = await popup(t, { profile: { name: '测试', phone: '13800000000', email: 'test@example.test' }, resume: pdf });
  assert.equal(h.document.querySelector('#profile-score').textContent, '33%');
  assert.equal(h.document.querySelector('#profile-progress').style.width, '33%');
  assert.equal(h.document.querySelector('#profile-count').textContent, '3 / 9');
  assert.equal(h.document.querySelector('#resume-status').textContent, '已就绪');
  await until(() => h.document.querySelector('#page-capability').dataset.status === 'ready');
  assert.equal(h.document.querySelector('#page-host').textContent, 'jobs.example.test');
});

test('tabs switch panels and support arrow-key navigation', async t => {
  const h = await popup(t, {});
  const profileTab = h.document.querySelector('#tab-profile');
  profileTab.click();
  assert.equal(h.document.querySelector('#panel-profile').hidden, false);
  assert.equal(h.document.querySelector('#panel-quick').hidden, true);
  assert.equal(profileTab.getAttribute('aria-selected'), 'true');
  profileTab.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(h.document.querySelector('#panel-history').hidden, false);
  assert.equal(h.document.querySelector('#tab-history').tabIndex, 0);
});

test('readiness cards open profile tab and live edits update score', async t => {
  const h = await popup(t, {});
  h.document.querySelector('.readiness-item').click();
  assert.equal(h.document.querySelector('#panel-profile').hidden, false);
  const field = h.document.querySelector('[name=name]');
  field.value = '测试';
  field.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  assert.equal(h.document.querySelector('#profile-score').textContent, '11%');
});

test('fill command submits profile form and toast becomes visible', async t => {
  const h = await popup(t, { profile: { name: '测试' } });
  h.w.chrome.tabs.sendMessage = async (id, request) => {
    assert.equal(request.type, 'fillResume');
    return { message: '已填 1 项，请核对。' };
  };
  h.document.querySelector('#fill-button').click();
  await until(() => !h.document.querySelector('#fill-button').disabled);
  assert.equal(h.document.querySelector('#message').hidden, false);
  assert.equal(h.document.querySelector('#message').textContent, '已填 1 项，请核对。');
});

test('structured experiences alone are enough to run page fill', async t => {
  const h = await popup(t, { experiences: { projects: [{ name: '测试项目' }] } });
  let request;
  h.w.chrome.tabs.sendMessage = async (id, value) => { request = value; return { message: '已填 1 项。' }; };
  h.document.querySelector('#fill-button').click();
  await until(() => !h.document.querySelector('#fill-button').disabled);
  assert.equal(request.state.experiences.projects[0].name, '测试项目');
  assert.match(h.document.querySelector('#message').textContent, /已填 1 项/);
});

test('error toast exposes state without inline style mutation', async t => {
  const h = await popup(t, {});
  h.w.chrome.tabs.sendMessage = async () => { throw new Error('offline'); };
  h.document.querySelector('#preview-button').click();
  await until(() => !h.document.querySelector('#preview-button').disabled);
  assert.equal(h.document.querySelector('#message').dataset.error, 'true');
  assert.equal(h.document.querySelector('#message').style.color, '');
});

test('completion meter remains responsive while an overlong value is being edited', async t => {
  const h = await popup(t, {});
  const field = h.document.querySelector('[name=name]');
  field.value = 'x'.repeat(1001);
  field.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  assert.equal(h.document.querySelector('#profile-score').textContent, '11%');
  await until(() => h.document.querySelector('#message').dataset.error === 'true');
});

test('first run keeps resume import first while returning users keep dashboard', async t => {
  const fresh = await popup(t, {});
  assert.equal(fresh.document.querySelector('#panel-quick').hidden, false);
  assert.equal(fresh.document.querySelector('#setup-hint').hidden, false);
  assert.match(fresh.document.querySelector('#message').textContent, /先上传简历/);
  const returning = await popup(t, { profile: { name: '测试', phone: '13800000000', email: 'test@example.test' } });
  assert.equal(returning.document.querySelector('#panel-quick').hidden, false);
  assert.equal(returning.document.querySelector('#setup-hint').hidden, true);
});

test('first-screen resume import opens the classified review before saving', async t => {
  const h = await popup(t, {});
  let pickerClicks = 0;
  h.document.querySelector('#resume-import-file').addEventListener('click', () => pickerClicks++);
  h.document.querySelector('#quick-import-button').click();
  assert.equal(pickerClicks, 1);
  const field = h.document.querySelector('#resume-import-file');
  const text = '测试用户\ntest@example.com\n项目经历\n测试项目 | 负责人\n2024.01 - 2024.06\n项目说明';
  Object.defineProperty(field, 'files', { configurable: true, value: [{ name: 'resume.txt', size: text.length, async text() { return text; } }] });
  field.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  await until(() => !h.document.querySelector('#resume-import-preview').hidden);
  assert.equal(h.document.querySelector('#panel-experiences').hidden, false);
  assert.equal(h.data.profile, undefined);
});
