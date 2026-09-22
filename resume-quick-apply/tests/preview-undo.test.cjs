const test = require('node:test');
const assert = require('node:assert/strict');
const { content, popup, setup, source, until, pdf } = require('./helpers.cjs');

test('preview reports fields and attachment without modifying DOM or firing events', async t => {
  const h = content(t, `<input name="name"><input name="email" value="existing@example.test">
    <input name="phone"><select name="education"><option value="">选择</option><option>硕士</option></select>
    <input name="resume" type="file" accept=".pdf">`);
  let events = 0;
  h.document.addEventListener('input', () => events++);
  h.document.addEventListener('change', () => events++);
  const result = await h.message('previewResume', { profile: { name: '测试', education: '本科' }, resume: pdf });
  assert.equal(result.total, 4);
  assert.equal(result.ready, 1);
  assert.deepEqual(Array.from(result.items, x => x.status), ['ready', 'kept', 'missing', 'unsupported']);
  assert.equal(result.attachment.status, 'ready');
  assert.equal(events, 0);
  assert.equal(h.document.querySelector('[name=name]').value, '');
  assert.equal(h.document.querySelector('[type=file]').files.length, 0);
});
test('fill rescans after preview and preserves newly edited fields', async t => {
  const h = content(t, '<input name="name">');
  const state = { profile: { name: '存储姓名' } };
  assert.equal((await h.message('previewResume', state)).ready, 1);
  h.document.querySelector('input').value = '手动输入';
  assert.equal((await h.send(state)).kept, 1);
  assert.equal(h.document.querySelector('input').value, '手动输入');
});
test('undo restores only last filled fields and keeps pre-existing values', async t => {
  const h = content(t, '<input name="name"><input name="email" value="old@example.test"><textarea name="summary"></textarea>');
  await h.send({ profile: { name: '测试', email: 'new@example.test', summary: '介绍' } });
  const result = await h.message('undoResume');
  assert.equal(result.restored, 2);
  assert.equal(h.document.querySelector('[name=name]').value, '');
  assert.equal(h.document.querySelector('textarea').value, '');
  assert.equal(h.document.querySelector('[name=email]').value, 'old@example.test');
  assert.equal((await h.message('undoResume')).restored, 0);
});
test('undo does not overwrite edits made after fill or replacement form nodes', async t => {
  const h = content(t, '<input name="name"><input name="phone"><input name="email">');
  await h.send({ profile: { name: '测试', phone: '13800000000', email: 'a@example.test' } });
  h.document.querySelector('[name=name]').value = '用户新改名';
  h.document.querySelector('[name=phone]').outerHTML = '<input name="phone" value="新控件">';
  const result = await h.message('undoResume');
  assert.equal(result.restored, 1);
  assert.equal(result.skipped, 2);
  assert.equal(h.document.querySelector('[name=name]').value, '用户新改名');
  assert.equal(h.document.querySelector('[name=phone]').value, '新控件');
});
test('undo restores disabled select placeholder and empty rich-text markup', async t => {
  const h = content(t, '<select name="education"><option value="" disabled selected>请选择</option><option>本科</option></select><div contenteditable="true" aria-label="自我介绍"><p><br></p></div>');
  await h.send({ profile: { education: '本科', summary: '介绍' } });
  const result = await h.message('undoResume');
  assert.equal(result.restored, 2);
  assert.equal(h.document.querySelector('select').selectedIndex, 0);
  assert.equal(h.document.querySelector('[contenteditable]').innerHTML, '<p><br></p>');
});
test('noop second fill does not discard previous undo batch', async t => {
  const h = content(t, '<input name="name">');
  await h.send({ profile: { name: '测试' } });
  await h.send({ profile: { name: '测试' } });
  assert.equal((await h.message('undoResume')).restored, 1);
});
test('new successful fill replaces undo batch rather than clearing earlier form sections', async t => {
  const h = content(t, '<input name="name"><input name="email">');
  await h.send({ profile: { name: '测试' } });
  await h.send({ profile: { email: 'test@example.test' } });
  assert.equal((await h.message('undoResume')).restored, 1);
  assert.equal(h.document.querySelector('[name=name]').value, '测试');
});
test('undo rejects changed page address', async t => {
  const h = content(t, '<input name="name">');
  await h.send({ profile: { name: '测试' } });
  h.w.history.pushState({}, '', '/different-job');
  assert.match((await h.message('undoResume')).error, /地址已变化/);
  assert.equal(h.document.querySelector('input').value, '测试');
});
test('undo handles framework rejection and blocks concurrent fill', async t => {
  const h = content(t, '<input name="name">');
  await h.send({ profile: { name: '测试' } });
  h.document.querySelector('input').addEventListener('change', event => { event.target.value = '测试'; });
  const pending = h.message('undoResume');
  assert.match((await h.send({ profile: { name: '其他' } })).error, /正在/);
  const result = await pending;
  assert.equal(result.restored, 0);
  assert.equal(result.failed, 1);
});
test('undo does not clear a selected file or change saved profile', async t => {
  const h = content(t, '<input name="name"><input name="resume" type="file">');
  const upload = h.document.querySelector('[type=file]');
  Object.defineProperty(upload, 'files', { configurable: true, value: [{ name: 'already.pdf' }] });
  await h.send({ profile: { name: '测试' }, resume: pdf });
  const result = await h.message('undoResume');
  assert.equal(result.restored, 1);
  assert.equal(upload.files[0].name, 'already.pdf');
  assert.equal(h.writes.length, 0);
});
test('popup preview renders page labels as text and invalidates on editing', async t => {
  const h = await popup(t, { profile: { name: '测试' } });
  const requests = [];
  h.w.chrome.tabs.sendMessage = async (id, request) => {
    requests.push(request.type);
    return { items: [{ title: '姓名', label: '<img src=x onerror=alert(1)>', status: 'ready', value: '测试' }], total: 1, ready: 1, attachment: { message: '无附件' }, message: '预览完成' };
  };
  h.document.querySelector('#preview-button').click();
  await until(() => !h.document.querySelector('#preview-button').disabled);
  assert.deepEqual(requests, ['previewResume']);
  assert.equal(h.document.querySelector('#preview').hidden, false);
  assert.equal(h.document.querySelector('#preview-list img'), null);
  const field = h.document.querySelector('[name=name]');
  field.value = '新值';
  field.dispatchEvent(new h.w.Event('input', { bubbles: true }));
  assert.equal(h.document.querySelector('#preview').hidden, true);
});
test('popup undo sends only undo operation, no stored resume or profile changes', async t => {
  const h = await popup(t, { profile: { name: '测试' }, resume: pdf });
  let message;
  h.w.chrome.tabs.sendMessage = async (id, request) => { message = request; return { message: '已撤销 1 项' }; };
  h.document.querySelector('#undo-button').click();
  await until(() => !h.document.querySelector('#undo-button').disabled);
  assert.equal(message.type, 'undoResume');
  assert.equal(message.state, undefined);
  assert.equal(h.writes.length, 0);
});
test('failed recovery import must not unlock empty profile after initial load error', async t => {
  const h = setup(t, source('popup.html'), { profile: { name: {} } });
  h.w.eval(source('popup.js'));
  await until(() => !h.document.querySelector('#import-button').disabled);
  const file = h.document.querySelector('#import-file');
  Object.defineProperty(file, 'files', { value: [{ size: 2, async text() { return '{}'; } }] });
  file.dispatchEvent(new h.w.Event('change'));
  await until(() => !h.document.querySelector('#import-button').disabled);
  assert.equal(h.document.querySelector('#save-button').disabled, true);
  assert.equal(h.document.querySelector('[name=name]').disabled, true);
  assert.equal(h.writes.length, 0);
});
test('undo keeps user formatting changes even when text is unchanged', async t => {
  const h = content(t, '<div contenteditable="true" aria-label="自我介绍"></div>');
  await h.send({ profile: { summary: '介绍' } });
  h.document.querySelector('[contenteditable]').innerHTML = '<b>介绍</b>';
  const result = await h.message('undoResume');
  assert.equal(result.skipped, 1);
  assert.equal(h.document.querySelector('[contenteditable]').innerHTML, '<b>介绍</b>');
});
test('successful recovery import unlocks profile only after data is saved', async t => {
  const h = setup(t, source('popup.html'), { profile: { name: {} } });
  h.w.eval(source('popup.js'));
  await until(() => !h.document.querySelector('#import-button').disabled);
  const file = h.document.querySelector('#import-file');
  Object.defineProperty(file, 'files', { value: [{ size: 100, async text() { return '{"profile":{"name":"恢复姓名"}}'; } }] });
  file.dispatchEvent(new h.w.Event('change'));
  await until(() => !h.document.querySelector('#save-button').disabled);
  assert.equal(h.data.profile.name, '恢复姓名');
  assert.equal(h.document.querySelector('[name=name]').value, '恢复姓名');
});
