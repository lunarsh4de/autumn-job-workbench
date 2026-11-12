const test=require('node:test');const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');const {source,until}=require('./helpers.cjs');
const CD=require('../catalog-data.js');const CV=require('../catalog-view.js');
const rows=[
  {company:'腾讯',title:'工业设计师',location:'上海',platform:'官网',url:'https://jobs.test/1'},
  {company:'腾讯',title:'产品经理',location:'北京',platform:'官网',url:'https://jobs.test/2'},
  {company:'腾讯',title:'软件工程师',location:'深圳',platform:'官网',url:'https://jobs.test/3'},
  {company:'腾讯音乐',title:'产品经理',location:'上海',platform:'聚合',url:'https://jobs.test/4'},
].map(row=>CD.item(row));
async function page(t){
  const dom=new JSDOM(source('dashboard.html'),{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;const saved={};const messages=[];
  w.setInterval=()=>0;w.fetch=async()=>({status:404});w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.eval(source('catalog-data.js'));w.eval(source('catalog-view.js'));
  w.CatalogDB={getAll:async()=>structuredClone(rows),replaceAll:async()=>{},putMany:async()=>{}};
  w.JobTrackerDashboard={storage:{get:async keys=>Object.fromEntries(keys.map(key=>[key,saved[key]])),set:async patch=>Object.assign(saved,patch)},getItems:()=>[],flash:message=>messages.push(message)};
  w.eval(source('catalog.js'));await until(()=>w.document.querySelectorAll('.company-disclosure').length===2);
  return {w,d:w.document,messages};
}
test('company grouping merges exact names and keeps substring companies distinct',()=>{
  const groups=CV.groups(rows);assert.equal(groups.length,2);assert.equal(groups[0].jobs.length,3);assert.equal(groups[1].jobs.length,1);
});
test('role choices use OR, cross-facet choices use AND, and keyboard focus survives rerender',async t=>{
  const {w,d}=await page(t);
  let button=d.querySelector('[data-role-type="设计体验"]');button.focus();button.click();
  assert.equal(d.activeElement.dataset.roleType,'设计体验');assert.match(d.querySelector('#catalog-result-count').textContent,/1 个岗位/);
  d.querySelector('[data-role-type="产品项目"]').click();assert.match(d.querySelector('#catalog-result-count').textContent,/3 个岗位/);
  const platform=[...d.querySelectorAll('[data-facet-key="platform"]')].find(input=>input.dataset.facetValue==='官网');platform.click();
  assert.match(d.querySelector('#catalog-result-count').textContent,/2 个岗位/);
  assert.equal(d.querySelectorAll('.company-disclosure').length,1);
  assert.equal(d.querySelectorAll('#catalog-active-filters button').length,3);
});
test('facet counts exclude their own group and incompatible city resets explicitly',async t=>{
  const {d,messages}=await page(t);
  [...d.querySelectorAll('[data-facet-key="city"]')].find(input=>input.dataset.facetValue==='上海').click();
  assert.ok([...d.querySelectorAll('[data-facet-key="city"]')].some(input=>input.dataset.facetValue==='北京'));
  [...d.querySelectorAll('[data-facet-key="province"]')].find(input=>input.dataset.facetValue==='北京')?.click();
  // Province counts intentionally respect city. Select through the compatibility control to reproduce external filter changes.
  const select=d.querySelector('#catalog-province');select.value='北京';select.dispatchEvent(new d.defaultView.Event('change',{bubbles:true}));
  assert.equal(d.querySelectorAll('[data-remove-facet="city"]').length,0);
  d.querySelector('#reset-catalog-filters').click();assert.match(d.querySelector('#catalog-result-count').textContent,/4 个岗位/);
  assert.equal(d.querySelector('#global-search').value,'');
});
test('removing a selected chip restores focus to its facet summary',async t=>{
  const {d}=await page(t);d.querySelector('[data-role-type="设计体验"]').click();const chip=d.querySelector('[data-remove-facet="jobType"]');chip.focus();chip.click();
  assert.equal(d.activeElement.parentElement.dataset.facet,'jobType');assert.match(d.querySelector('#catalog-result-count').textContent,/4 个岗位/);
});
test('public feed refresh deletes only successful-owned records, accepts zero results, and keeps manual same-platform rows',()=>{
  const old=[CD.item({title:'旧公开',sourceId:'ok',platform:'同平台'}),CD.item({title:'手动',platform:'同平台'}),CD.item({title:'失败源旧记录',sourceId:'failed',platform:'同平台'})];
  const next=CD.replacePublic(old,[],['ok']);assert.deepEqual(next.items.map(row=>row.title),['手动','失败源旧记录']);
  const stale=CD.item({title:'缓存',stale:true,lastSuccessfulAt:'2026-11-10T00:00:00Z'});assert.equal(stale.stale,true);assert.equal(stale.lastSuccessfulAt,'2026-11-10T00:00:00Z');
});
