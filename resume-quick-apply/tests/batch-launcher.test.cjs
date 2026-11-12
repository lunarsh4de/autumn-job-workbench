const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, popup, source, until } = require('./helpers.cjs');

test('batch launcher lives in the side navigation with only one navigation entry', async t => {
  const h = setup(t, source('dashboard.html'));
  const opened=[];h.w.chrome.runtime.id='test';h.w.chrome.tabs.create=async options=>opened.push(options);
  h.w.scrollTo=()=>{};h.w.setInterval=()=>0;
  h.w.eval(source('dashboard-data.js'));h.w.eval(source('dashboard.js'));
  await until(()=>h.document.querySelector('#kanban').children.length>0);
  const button=h.document.querySelector('#open-batch');
  assert.ok(button.closest('nav.side-nav'));
  assert.equal(h.document.querySelectorAll('#open-batch').length,1);
});

test('website batch button uses direct launcher in account mode and reports rejection visibly', async t => {
  const h=setup(t,source('dashboard.html'));const w=h.w;
  w.scrollTo=()=>{};w.setInterval=()=>0;delete w.chrome.runtime.id;
  w.eval(source('dashboard-data.js'));
  let launches=0;
  w.WorkbenchAccount={active:true,ready:Promise.resolve()};
  w.WorkbenchSync={create(){return {async openBatch(){launches++;throw new Error('请重新加载插件');}};}};
  w.eval(source('dashboard.js'));
  await until(()=>h.document.querySelector('#kanban').children.length>0);
  h.document.querySelector('#open-batch').click();
  await until(()=>launches===1&&!h.document.querySelector('#open-batch').disabled);
  assert.match(h.document.querySelector('#toast').textContent,/重新加载插件/);
});

test('popup offers a direct batch entry without website bridge',async t=>{
  const h=await popup(t);const opened=[];
  h.w.chrome.tabs.create=async options=>opened.push(options);
  h.document.querySelector('#open-batch').click();
  await until(()=>opened.length===1);
  assert.equal(opened[0].url,'chrome-extension://test/batch.html');
});
