const form = document.querySelector('#profile-form');
const message = document.querySelector('#message');
const saveState = document.querySelector('#save-state');
const resumeFile = document.querySelector('#resume-file');
const resumeName = document.querySelector('#resume-name');
const quickAttachment = document.querySelector('#quick-attachment');
const enqueue = ResumeData.createQueue();
let revision = 0;
let loaded = false;
let experiencesRevision = 0;
let currentExperiences = ResumeData.experiences();
let importCandidate = null;
let importRequest = 0;
let currentResume = null;
let resumeProfiles = [];
let activeProfileId = '';

const manifestVersion = globalThis.chrome?.runtime?.getManifest?.().version || '0.15.0';
const versionBadge = document.querySelector('#version-badge');
if (versionBadge) versionBadge.textContent = `v${manifestVersion}`;

document.querySelector('#open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
});

const experienceMeta = {
  work: {
    title: '工作经历', empty: '尚未添加工作经历',
    fields: { company: '公司', role: '职位', location: '地点', startDate: '开始时间', endDate: '结束时间', description: '工作内容' }
  },
  education: {
    title: '教育经历', empty: '尚未添加教育经历',
    fields: { school: '学校', degree: '学历 / 学位', major: '专业', startDate: '开始时间', endDate: '结束时间', description: '补充说明' }
  },
  projects: {
    title: '项目经历', empty: '尚未添加项目经历',
    fields: { name: '项目名称', role: '担任角色', startDate: '开始时间', endDate: '结束时间', description: '项目内容' }
  },
  competitions: {
    title: '赛事经历', empty: '尚未添加赛事经历',
    fields: { name: '赛事名称', year: '比赛年份', startDate: '开始时间', endDate: '结束时间', description: '赛事描述' }
  },
  awards: {
    title: '获奖经历', empty: '尚未添加获奖经历',
    fields: { name: '奖项名称', year: '获奖年份', description: '奖项说明' }
  },
  campus: {
    title: '校园经历', empty: '尚未添加校园经历',
    fields: { name: '组织 / 活动', role: '担任职务', startDate: '开始时间', endDate: '结束时间', description: '经历内容' }
  },
  languages: {
    title: '语言能力', empty: '尚未添加语言能力',
    fields: { name: '语言 / 证书', description: '成绩及说明' }
  },
  publications: {
    title: '论文 / 期刊', empty: '尚未添加论文或期刊',
    fields: { name: '名称', description: '描述', result: '成果' }
  }
};

function clearPreview() { document.querySelector('#preview').hidden = true; }

function flash(text, error = false) {
  message.textContent = text;
  message.dataset.error = String(error);
  message.hidden = !text;
}
function updateCompleteness() {
  const completed = ResumeData.fields.filter(key => form.elements.namedItem(key).value.trim()).length;
  const percentage = Math.round(completed / ResumeData.fields.length * 100);
  document.querySelector('#profile-count').textContent = `${completed} / ${ResumeData.fields.length}`;
  document.querySelector('#profile-score').textContent = `${percentage}%`;
  document.querySelector('#profile-progress').style.width = `${percentage}%`;
  document.querySelector('#setup-hint').hidden = completed >= 3;
}
function profileFromForm() {
  return ResumeData.profile(Object.fromEntries(ResumeData.fields.map(key => [key, form.elements.namedItem(key).value])));
}
function putProfile(profile) {
  for (const key of ResumeData.fields) form.elements.namedItem(key).value = profile[key] || '';
  updateCompleteness();
}
function showResume(resume) {
  currentResume = resume ? ResumeData.resume(resume) : null;
  resumeName.textContent = resume?.name || '尚未选择';
  const status = document.querySelector('#resume-status');
  status.textContent = resume?.name ? '已就绪' : '未上传';
  status.title = resume?.name || '';
  document.querySelector('#quick-import-status').textContent = resume?.name
    ? `已保存：${resume.name}`
    : '本地解析 PDF、DOCX 或 TXT，确认后再保存';
}
function putSettings(value) {
  quickAttachment.checked = ResumeData.settings(value).quickAttachment;
}

function profileId() {
  return `resume-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function profileLabelFromFile(name) {
  return (name || '').replace(/\.[^.]+$/, '').trim().slice(0, 80) || `简历档案 ${resumeProfiles.length + 1}`;
}
function emptyExperiences() {
  return ResumeData.experiences({});
}
function createResumeProfile(label, values = {}) {
  const now = Date.now();
  return ResumeData.resumeProfile({
    id: profileId(), label: label.trim() || `简历档案 ${resumeProfiles.length + 1}`,
    profile: values.profile || ResumeData.profile({}),
    resume: values.resume || null,
    settings: values.settings || ResumeData.settings({}),
    experiences: values.experiences || emptyExperiences(),
    createdAt: now, updatedAt: now
  });
}
function activeResumeProfile() {
  return resumeProfiles.find(item => item.id === activeProfileId) || resumeProfiles[0] || null;
}
function renderResumeProfiles() {
  const select = document.querySelector('#resume-profile-select');
  if (!select) return;
  select.replaceChildren();
  for (const item of resumeProfiles) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label;
    option.selected = item.id === activeProfileId;
    select.append(option);
  }
  const status = document.querySelector('#resume-profile-status');
  if (status) status.textContent = `${resumeProfiles.length} 份档案`;
}
function variantPayload(variant) {
  return {
    profile: ResumeData.profile(variant.profile),
    resume: ResumeData.resume(variant.resume),
    settings: ResumeData.settings(variant.settings),
    experiences: ResumeData.experiences(variant.experiences)
  };
}
async function saveResumeProfileSet(nextProfiles, nextActiveId, options = {}) {
  const profiles = ResumeData.resumeProfiles(nextProfiles);
  if (!profiles.length) throw new Error('至少保留一份简历档案。');
  const active = profiles.find(item => item.id === nextActiveId) || profiles[0];
  const activeState = variantPayload(active);
  resumeProfiles = profiles;
  activeProfileId = active.id;
  const storagePatch = { profile: activeState.profile, settings: activeState.settings, experiences: activeState.experiences, resumeProfiles: profiles, activeProfileId: active.id, activeProfileLabel: active.label };
  if (options.includeResume !== false) storagePatch.resume = activeState.resume;
  await chrome.storage.local.set(storagePatch);
  putProfile(active.profile);
  showResume(active.resume);
  putSettings(active.settings);
  currentExperiences = active.experiences;
  renderExperiences();
  renderResumeProfiles();
  return active;
}
function persistActive(patch) {
  return enqueue(() => {
    const current = activeResumeProfile();
    if (!current) throw new Error('当前没有可用的简历档案。');
    const next = ResumeData.resumeProfile({ ...current, ...patch, id: current.id, label: current.label, createdAt: current.createdAt, updatedAt: Date.now() });
    const nextProfiles = resumeProfiles.map(item => item.id === next.id ? next : item);
    return saveResumeProfileSet(nextProfiles, next.id, { includeResume: Object.hasOwn(patch, 'resume') });
  });
}
async function activateResumeProfile(id) {
  await enqueue(() => Promise.resolve());
  const profile = resumeProfiles.find(item => item.id === id);
  if (!profile) throw new Error('找不到要切换的简历档案。');
  await saveResumeProfileSet(resumeProfiles, profile.id);
  clearPreview();
  revision++;
  experiencesRevision++;
  document.querySelector('#resume-profile-status').textContent = `当前：${profile.label}`;
}
function lock(locked) {
  document.querySelectorAll('input, textarea, button').forEach(element => { element.disabled = locked || !loaded; });
  if (!locked && !loaded) {
    document.querySelector('#import-button').disabled = false;
    document.querySelector('#import-file').disabled = false;
  }
}

function createExperienceInput(type, index, key, value) {
  const label = document.createElement('label');
  if (key === 'description') label.className = 'wide';
  label.append(experienceMeta[type].fields[key]);
  const field = key === 'description' ? document.createElement('textarea') : document.createElement('input');
  if (key === 'description') field.rows = 3;
  field.value = value;
  field.dataset.experienceType = type;
  field.dataset.experienceIndex = String(index);
  field.dataset.experienceKey = key;
  field.placeholder = ['startDate', 'endDate'].includes(key) ? '如：2022.06 / 至今' : '';
  label.append(field);
  return label;
}

function renderExperiences() {
  const root = document.querySelector('#experience-sections');
  root.replaceChildren();
  for (const [type, meta] of Object.entries(experienceMeta)) {
    const section = document.createElement('section');
    section.className = 'experience-section';
    const head = document.createElement('div');
    head.className = 'experience-section-head';
    const title = document.createElement('h3');
    title.append(meta.title, ' ');
    const count = document.createElement('span');
    count.textContent = `${currentExperiences[type].length} 条`;
    title.append(count);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'experience-add';
    add.dataset.addExperience = type;
    add.textContent = '+ 添加';
    head.append(title, add);
    section.append(head);
    if (!currentExperiences[type].length) {
      const empty = document.createElement('div');
      empty.className = 'experience-empty';
      empty.textContent = meta.empty;
      section.append(empty);
    }
    currentExperiences[type].forEach((item, index) => {
      const card = document.createElement('article');
      card.className = 'experience-card';
      const cardHead = document.createElement('div');
      cardHead.className = 'experience-card-head';
      const cardTitle = document.createElement('strong');
      cardTitle.textContent = `${meta.title} ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button';
      remove.dataset.removeExperience = type;
      remove.dataset.experienceIndex = String(index);
      remove.title = `删除第 ${index + 1} 条${meta.title}`;
      remove.setAttribute('aria-label', remove.title);
      remove.textContent = '×';
      cardHead.append(cardTitle, remove);
      const fields = document.createElement('div');
      fields.className = 'experience-fields';
      for (const key of ResumeData.experienceSchemas[type]) fields.append(createExperienceInput(type, index, key, item[key]));
      card.append(cardHead, fields);
      section.append(card);
    });
    root.append(section);
  }
}

function saveExperiences() {
  const experiences = ResumeData.experiences(currentExperiences);
  const currentRevision = ++experiencesRevision;
  document.querySelector('#experience-save-state').textContent = '正在保存…';
  return persistActive({ experiences }).then(() => {
    if (experiencesRevision === currentRevision) document.querySelector('#experience-save-state').textContent = '已保存';
    return experiences;
  }).catch(error => {
    if (experiencesRevision === currentRevision) document.querySelector('#experience-save-state').textContent = '保存失败';
    throw error;
  });
}
function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取附件，请重新选择。'));
    reader.onabort = () => reject(new Error('附件读取已取消。'));
    reader.readAsDataURL(file);
  });
}

async function readPdfText(file) {
  const pdfjs = await import(chrome.runtime.getURL('vendor/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdf.worker.min.mjs');
  const documentTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const pdf = await documentTask.promise;
  try {
    if (pdf.numPages > 40) throw new Error('PDF 超过 40 页，请使用精简版简历。');
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim());
    }
    return pages.join('\n\n');
  } finally { await documentTask.destroy(); }
}

async function readResumeText(file) {
  if (file.size > ResumeData.maxResumeImportBytes) throw new Error('待解析简历超过 10 MB。');
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'txt') return file.text();
  if (extension === 'pdf') return readPdfText(file);
  if (extension === 'docx') {
    if (!globalThis.mammoth?.extractRawText) throw new Error('DOCX 解析组件未加载，请重新打开插件。');
    const result = await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (extension === 'doc') throw new Error('旧版 DOC 无法安全解析，请先另存为 DOCX 或 PDF。');
  throw new Error('仅支持从 PDF、DOCX 或 TXT 导入。');
}

function appendUnique(existing, imported) {
  const seen = new Set(existing.map(item => JSON.stringify(item)));
  return [...existing, ...imported.filter(item => !seen.has(JSON.stringify(item)))].slice(0, 20);
}
function saveProfile() {
  const profile = profileFromForm();
  const currentRevision = ++revision;
  saveState.textContent = '正在保存…';
  return persistActive({ profile }).then(() => {
    if (revision === currentRevision) saveState.textContent = '已保存';
    return profile;
  }).catch(error => {
    if (revision === currentRevision) saveState.textContent = '保存失败';
    throw error;
  });
}
async function action(work) {
  lock(true);
  try { await work(); } catch (error) { flash(error.message || '操作失败，请重试。', true); }
  finally { lock(false); }
}
form.addEventListener('input', event => {
  if (!ResumeData.fields.includes(event.target.name)) return;
  clearPreview();
  updateCompleteness();
  try { saveProfile().catch(error => flash(error.message, true)); }
  catch (error) { flash(error.message, true); }
});
document.querySelector('#save-button').addEventListener('click', () => action(async () => {
  await saveProfile();
  flash('资料已保存。');
}));
resumeFile.addEventListener('change', () => {
  const file = resumeFile.files[0];
  if (!file) return;
  clearPreview();
  action(async () => {
    try {
      await enqueue(async () => {
        if (file.size > ResumeData.maxResumeBytes) throw new Error('简历文件超过 3 MB。');
        const resume = ResumeData.resume({ name: file.name, dataUrl: await readFile(file) });
        await persistActive({ resume });
        showResume(resume);
      });
      flash('附件已保存。填表时仅选择明确标注的简历上传框。');
    } finally { resumeFile.value = ''; }
  });
});
document.querySelector('#clear-resume').addEventListener('click', () => action(async () => {
  clearPreview();
  await persistActive({ resume: null });
  resumeFile.value = '';
  showResume(null);
  flash('已移除保存的简历附件。');
}));
document.querySelector('#experience-sections').addEventListener('input', event => {
  const { experienceType: type, experienceIndex: indexText, experienceKey: key } = event.target.dataset;
  if (!type || !key) return;
  const index = Number(indexText);
  if (!currentExperiences[type]?.[index] || !ResumeData.experienceSchemas[type].includes(key)) return;
  currentExperiences[type][index][key] = event.target.value;
  try { saveExperiences().catch(error => flash(error.message, true)); }
  catch (error) { flash(error.message, true); }
});
document.querySelector('#experience-sections').addEventListener('click', event => {
  const add = event.target.closest('[data-add-experience]');
  const remove = event.target.closest('[data-remove-experience]');
  if (!add && !remove) return;
  action(async () => {
    if (add) {
      const type = add.dataset.addExperience;
      if (currentExperiences[type].length >= 20) throw new Error('每类经历最多保存 20 条。');
      currentExperiences[type].push(Object.fromEntries(ResumeData.experienceSchemas[type].map(key => [key, ''])));
    } else {
      const type = remove.dataset.removeExperience;
      currentExperiences[type].splice(Number(remove.dataset.experienceIndex), 1);
    }
    renderExperiences();
    await saveExperiences();
  });
});

document.querySelector('#resume-import-button').addEventListener('click', () => document.querySelector('#resume-import-file').click());
document.querySelector('#quick-import-button').addEventListener('click', () => document.querySelector('#resume-import-file').click());
document.querySelector('#resume-import-file').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  const request = ++importRequest;
  importCandidate = null;
  document.querySelector('#resume-import-preview').hidden = true;
  action(async () => {
    try {
      flash('正在本地读取并分类简历…');
      const parsed = ResumeParser.parseResumeText(await readResumeText(file));
      let attachment = null;
      if (file.size <= ResumeData.maxResumeBytes && /\.(pdf|docx)$/i.test(file.name)) {
        attachment = ResumeData.resume({ name: file.name, dataUrl: await readFile(file) });
      }
      if (request !== importRequest) return;
      importCandidate = { ...parsed, attachment, fileName: file.name };
      const counts = parsed.experiences;
      document.querySelector('#resume-import-summary').textContent =
        `识别 ${parsed.meta.detectedFields} 项基础资料、${counts.work.length} 段工作、${counts.education.length} 段教育、${counts.projects.length} 段项目、${counts.competitions.length} 段赛事、${counts.awards.length} 条获奖、${counts.campus.length} 段校园经历及 ${counts.languages.length + counts.publications.length} 条其他经历。应用前请核对分类结果。`;
      document.querySelector('#resume-import-attachment-row').hidden = !attachment;
      document.querySelector('#resume-import-save-attachment').checked = Boolean(attachment);
      document.querySelector('#resume-import-preview').hidden = false;
      selectTab('experiences');
      flash('简历已在本地完成分类，等待确认。');
    } finally { if (request === importRequest) event.target.value = ''; }
  });
});
document.querySelector('#resume-import-cancel').addEventListener('click', () => {
  importRequest++;
  importCandidate = null;
  document.querySelector('#resume-import-preview').hidden = true;
  flash('已取消本次分类导入。');
});
document.querySelector('#resume-import-new-profile').addEventListener('change', event => {
  document.querySelector('#resume-import-profile-name-row').hidden = !event.target.checked;
  if (event.target.checked && !document.querySelector('#resume-import-profile-name').value.trim() && importCandidate) {
    document.querySelector('#resume-import-profile-name').value = profileLabelFromFile(importCandidate.fileName);
  }
});
document.querySelector('#resume-import-apply').addEventListener('click', () => action(async () => {
  if (!importCandidate) throw new Error('请先选择并解析简历。');
  const newProfile = document.querySelector('#resume-import-new-profile').checked;
  if (newProfile) {
    const label = document.querySelector('#resume-import-profile-name').value.trim() || profileLabelFromFile(importCandidate.fileName);
    if (resumeProfiles.length >= ResumeData.maxResumeProfiles) throw new Error(`最多保存 ${ResumeData.maxResumeProfiles} 份简历档案。`);
    const attachment = importCandidate.attachment && document.querySelector('#resume-import-save-attachment').checked ? importCandidate.attachment : null;
    const profile = createResumeProfile(label, {
      profile: importCandidate.profile,
      resume: attachment,
      settings: ResumeData.settings({}),
      experiences: importCandidate.experiences
    });
    await saveResumeProfileSet([...resumeProfiles, profile], profile.id);
    document.querySelector('#resume-import-preview').hidden = true;
    document.querySelector('#resume-import-replace').checked = false;
    document.querySelector('#resume-import-new-profile').checked = false;
    document.querySelector('#resume-import-profile-name-row').hidden = true;
    document.querySelector('#resume-import-profile-name').value = '';
    importCandidate = null;
    document.querySelector('#experience-save-state').textContent = '已保存';
    saveState.textContent = '已保存';
    flash(`已新建“${profile.label}”并切换到该简历档案，当前档案未被覆盖。`);
    return;
  }
  const replace = document.querySelector('#resume-import-replace').checked;
  const existingProfile = profileFromForm();
  const profile = ResumeData.profile(Object.fromEntries(ResumeData.fields.map(key => [
    key, importCandidate.profile[key] && (replace || !existingProfile[key].trim()) ? importCandidate.profile[key] : existingProfile[key]
  ])));
  const experiences = ResumeData.experiences(Object.fromEntries(Object.keys(experienceMeta).map(type => [
    type, replace ? importCandidate.experiences[type] : appendUnique(currentExperiences[type], importCandidate.experiences[type])
  ])));
  const patch = { profile, experiences };
  if (importCandidate.attachment && document.querySelector('#resume-import-save-attachment').checked) patch.resume = importCandidate.attachment;
  await persistActive(patch);
  revision++;
  experiencesRevision++;
  putProfile(profile);
  currentExperiences = experiences;
  renderExperiences();
  if (patch.resume) showResume(patch.resume);
  document.querySelector('#resume-import-preview').hidden = true;
  document.querySelector('#resume-import-replace').checked = false;
  document.querySelector('#resume-import-new-profile').checked = false;
  document.querySelector('#resume-import-profile-name-row').hidden = true;
  document.querySelector('#resume-import-profile-name').value = '';
  importCandidate = null;
  document.querySelector('#experience-save-state').textContent = '已保存';
  saveState.textContent = '已保存';
  flash('分类结果已导入，请逐项检查后再用于投递。');
}));
quickAttachment.addEventListener('change', () => action(async () => {
  const settings = ResumeData.settings({ quickAttachment: quickAttachment.checked });
  await persistActive({ settings });
  flash(settings.quickAttachment
    ? '快捷键和右键填充将同时选择简历附件，请留意网站上传状态。'
    : '快捷键和右键填充只填写资料字段。');
}));

document.querySelector('#resume-profile-select').addEventListener('change', event => action(async () => {
  await activateResumeProfile(event.target.value);
  flash(`已切换到“${activeResumeProfile().label}”，填充将使用这份简历。`);
}));
document.querySelector('#new-resume-profile').addEventListener('click', () => action(async () => {
  if (resumeProfiles.length >= ResumeData.maxResumeProfiles) throw new Error(`最多保存 ${ResumeData.maxResumeProfiles} 份简历档案。`);
  const label = window.prompt('请输入新简历档案名称', `简历档案 ${resumeProfiles.length + 1}`);
  if (label == null) return;
  const profile = createResumeProfile(label);
  await saveResumeProfileSet([...resumeProfiles, profile], profile.id);
  flash(`已新建“${profile.label}”，当前资料与旧简历相互独立。`);
}));
document.querySelector('#rename-resume-profile').addEventListener('click', () => action(async () => {
  const current = activeResumeProfile();
  if (!current) throw new Error('当前没有可重命名的简历档案。');
  const label = window.prompt('请输入新的简历档案名称', current.label);
  if (label == null || !label.trim()) return;
  const next = ResumeData.resumeProfile({ ...current, label: label.trim(), updatedAt: Date.now() });
  await saveResumeProfileSet(resumeProfiles.map(item => item.id === current.id ? next : item), current.id);
  flash(`已将当前档案重命名为“${next.label}”。`);
}));
document.querySelector('#delete-resume-profile').addEventListener('click', () => {
  const current = activeResumeProfile();
  if (!current || resumeProfiles.length <= 1) { flash('至少保留一份简历档案。', true); return; }
  if (!window.confirm(`确认删除“${current.label}”？该档案的资料、经历和附件都会删除。`)) return;
  action(async () => {
    const remaining = resumeProfiles.filter(item => item.id !== current.id);
    await saveResumeProfileSet(remaining, remaining[0].id);
    flash(`已删除“${current.label}”。`);
  });
});

async function sendToPage(type, state) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('找不到当前页面。');
  if (!/^https?:\/\//i.test(tab.url || '')) throw new Error('请打开普通招聘网页；浏览器设置、扩展商店和本地文件可能无法填充。');
  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type, state });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['data.js', 'content.js'] });
      result = await chrome.tabs.sendMessage(tab.id, { type, state });
    } catch {
      throw new Error('无法连接页面。该网页可能禁止扩展运行；浏览器内置页和扩展商店不支持填充。');
    }
  }
  if (!result || result.error) throw new Error(result?.error || '页面未返回结果，请刷新网页后重试。');
  return result;
}

document.querySelector('#preview-button').addEventListener('click', () => action(async () => {
  clearPreview();
  await saveProfile();
  const state = { ...await enqueue(() => chrome.storage.local.get(['profile', 'resume', 'experiences'])), resumeProfileId: activeProfileId, resumeProfileLabel: activeResumeProfile()?.label || '' };
  const result = await sendToPage('previewResume', state);
  const list = document.querySelector('#preview-list');
  list.replaceChildren();
  const statusLabels = { ready: '将填写', kept: '保留现有', missing: '资料未填写', unsupported: '选项不匹配' };
  for (const item of result.items) {
    const row = document.createElement('li');
    row.className = 'preview-item';
    row.dataset.status = item.status;
    row.textContent = `${item.title} · ${statusLabels[item.status]} — ${item.label}`;
    if (item.status === 'ready') {
      const value = document.createElement('span');
      value.className = 'preview-value';
      value.textContent = item.value.length > 120 ? item.value.slice(0, 120) + '…' : item.value;
      row.append(value);
    }
    list.append(row);
  }
  document.querySelector('#preview-summary').textContent = `识别 ${result.total} 项，可填 ${result.ready} 项${result.total > result.items.length ? '（仅展示前 80 项）' : ''}。`;
  document.querySelector('#preview-attachment').textContent = result.attachment.message;
  document.querySelector('#preview').hidden = false;
  flash(result.message);
}));
document.querySelector('#undo-button').addEventListener('click', () => action(async () => {
  clearPreview();
  const result = await sendToPage('undoResume');
  flash(result.message);
}));
document.querySelector('#fill-button').addEventListener('click', () => form.requestSubmit());
form.addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    clearPreview();
    await saveProfile();
    const state = { ...await enqueue(() => chrome.storage.local.get(['profile', 'resume', 'experiences'])), resumeProfileId: activeProfileId, resumeProfileLabel: activeResumeProfile()?.label || '' };
    const hasExperiences = Object.values(ResumeData.experiences(state.experiences)).some(items => items.length);
    if (!Object.values(state.profile).some(value => value.trim()) && !state.resume && !hasExperiences) throw new Error('请先填写资料、经历或选择简历。');
    const result = await sendToPage('fillResume', state);
    flash(result.message);
  });
});
document.querySelector('#export-button').addEventListener('click', () => action(async () => {
  await saveProfile();
  const state = await enqueue(() => chrome.storage.local.get(['profile', 'resume', 'settings', 'experiences', 'resumeProfiles', 'activeProfileId', 'applications']));
  const profiles = ResumeData.resumeProfiles(state.resumeProfiles || resumeProfiles);
  const active = profiles.find(item => item.id === (state.activeProfileId || activeProfileId)) || profiles[0];
  const blob = new Blob([JSON.stringify({
    schemaVersion: 4,
    profile: active.profile,
    resume: active.resume,
    settings: active.settings,
    experiences: active.experiences,
    resumeProfiles: profiles,
    activeProfileId: active.id,
    applications: ResumeData.applications(state.applications)
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = '投简历助手-资料.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash(`已导出 ${profiles.length} 份简历档案、附件及 ${ResumeData.applications(state.applications).length} 条关联投递记录。备份包含个人信息，请妥善保管。`);
}));
document.querySelector('#import-button').addEventListener('click', () => document.querySelector('#import-file').click());
document.querySelector('#import-file').addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  action(async () => {
    try {
      if (file.size > ResumeData.maxImportBytes) throw new Error('备份超过 64 MB，无法导入。');
      const imported = ResumeData.backup(JSON.parse(await file.text()));
      const sourceProfiles = imported.resumeProfiles?.length ? imported.resumeProfiles : [createResumeProfile(profileLabelFromFile(file.name), imported)];
      const importedProfiles = sourceProfiles.map((item, index) => ResumeData.resumeProfile({
        ...item,
        id: profileId(),
        label: `${item.label || profileLabelFromFile(file.name)}（导入${sourceProfiles.length > 1 ? ` ${index + 1}` : ''}）`.trim(),
        createdAt: Date.now(), updatedAt: Date.now()
      }));
      if (resumeProfiles.length + importedProfiles.length > ResumeData.maxResumeProfiles) throw new Error(`导入后最多保留 ${ResumeData.maxResumeProfiles} 份简历档案。`);
      const importedActiveId = importedProfiles[Math.max(0, sourceProfiles.findIndex(item => item.id === imported.activeProfileId))]?.id || importedProfiles[0].id;
      await saveResumeProfileSet([...resumeProfiles, ...importedProfiles], importedActiveId);
      const profileMap = new Map(sourceProfiles.map((item, index) => [item.id, importedProfiles[index]]));
      const importedApplications = ResumeData.applications(imported.applications).map(item => {
        const mapped = profileMap.get(item.resumeProfileId);
        return mapped ? { ...item, resumeProfileId: mapped.id, resumeProfileLabel: mapped.label } : item;
      });
      if (importedApplications.length) {
        const saved = await chrome.storage.local.get(['applications']);
        const existing = ResumeData.applications(saved.applications);
        const seen = new Set(existing.map(item => `${item.url}|${item.createdAt}`));
        const applications = [...existing, ...importedApplications.filter(item => !seen.has(`${item.url}|${item.createdAt}`))]
          .sort((a, b) => b.createdAt - a.createdAt).slice(0, 500);
        await chrome.storage.local.set({ applications });
        renderHistory(applications);
        renderCompanies(applications);
      }
      revision++;
      clearPreview();
      importCandidate = null;
      document.querySelector('#resume-import-preview').hidden = true;
      resumeFile.value = '';
      saveState.textContent = '已保存';
      loaded = true;
      flash(`已并行导入 ${importedProfiles.length} 份简历档案及 ${importedApplications.length} 条关联投递记录，当前档案未被覆盖。`);
    } finally { event.target.value = ''; }
  });
});
document.querySelector('#clear-history').addEventListener('click', () => {
  if (!window.confirm('确认清空全部投递记录？此操作无法撤销。')) return;
  action(async () => {
    await enqueue(() => chrome.storage.local.set({ applications: [] }));
    renderHistory([]);
    renderCompanies([]);
    flash('投递记录已清空。');
  });
});
function validApplications(applications) {
  return (Array.isArray(applications) ? applications : []).filter(item =>
    item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url) && Number.isFinite(item.createdAt));
}
function applicationCompany(application) {
  try {
    const hostname = new URL(application.url).hostname;
    const saved = typeof application.company === 'string' ? application.company.trim() : '';
    const careerHost = /^(?:apply\.)?careers\.([^.]+)\./i.exec(hostname)?.[1];
    if (careerHost && (!saved || saved === hostname)) return careerHost.length <= 6 ? careerHost.toUpperCase() : careerHost;
    return saved || hostname;
  } catch {
    return typeof application.company === 'string' && application.company.trim() ? application.company.trim() : '未知公司';
  }
}
function applicationProfile(application) {
  return typeof application.resumeProfileLabel === 'string' && application.resumeProfileLabel.trim()
    ? application.resumeProfileLabel.trim() : '未标记档案';
}
function companySummary(applications) {
  const groups = new Map();
  for (const application of validApplications(applications)) {
    const company = applicationCompany(application);
    const group = groups.get(company) || { company, count: 0, submitted: 0, latest: 0, titles: [], profiles: [] };
    group.count++;
    if (application.status === 'submitted') group.submitted++;
    group.latest = Math.max(group.latest, application.createdAt);
    const title = typeof application.title === 'string' ? application.title.trim() : '';
    if (title && !group.titles.includes(title)) group.titles.push(title);
    const profile = applicationProfile(application);
    if (!group.profiles.includes(profile)) group.profiles.push(profile);
    groups.set(company, group);
  }
  return [...groups.values()].sort((a, b) => b.latest - a.latest || a.company.localeCompare(b.company));
}
function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}
document.querySelector('#export-history').addEventListener('click', () => action(async () => {
  const state = await enqueue(() => chrome.storage.local.get(['applications']));
  const applications = validApplications(state.applications);
  if (!applications.length) throw new Error('还没有可导出的投递记录。');
  const rows = [['投递时间', '岗位', '公司或站点', '使用简历档案', '状态', '记录方式', '链接'], ...applications.map(item => [
    new Date(item.createdAt).toLocaleString('zh-CN'),
    typeof item.title === 'string' ? item.title : '',
    typeof item.company === 'string' ? item.company : '',
    applicationProfile(item),
    item.status === 'submitted' ? '已投递' : '已记录',
    item.source === 'auto' ? '自动确认' : '手动标记',
    item.url
  ])];
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `投简历助手-投递记录-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash(`已导出 ${applications.length} 条投递记录。`);
}));
document.querySelector('#export-companies').addEventListener('click', () => action(async () => {
  const state = await enqueue(() => chrome.storage.local.get(['applications']));
  const companies = companySummary(state.applications);
  if (!companies.length) throw new Error('还没有可导出的公司记录。');
  const rows = [['公司', '投递岗位数', '已确认投递数', '最近投递时间', '使用简历档案', '岗位列表'], ...companies.map(item => [
    item.company, item.count, item.submitted, new Date(item.latest).toLocaleString('zh-CN'), item.profiles.join('；'), item.titles.join('；')
  ])];
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `投简历助手-已投公司-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash(`已导出 ${companies.length} 家公司的投递汇总。`);
}));
function renderHistory(applications) {
  const list = document.querySelector('#application-list');
  list.replaceChildren();
  const valid = validApplications(applications);
  for (const application of valid.slice(0, 30)) {
    const item = document.createElement('li');
    item.className = 'application-item';
    const copy = document.createElement('div');
    copy.className = 'application-copy';
    const title = document.createElement('a');
    title.className = 'application-title';
    title.href = application.url;
    title.target = '_blank';
    title.rel = 'noopener noreferrer';
    title.textContent = typeof application.title === 'string' ? application.title : application.url;
    title.title = title.textContent;
    const detail = document.createElement('span');
    detail.className = 'application-detail';
    const company = applicationCompany(application);
    detail.textContent = `${application.status === 'submitted' ? '已投递' : '已记录'} · ${company} · 简历：${applicationProfile(application)}`;
    copy.append(title, detail);
    const date = document.createElement('span');
    date.className = 'application-meta';
    date.textContent = new Date(application.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    item.append(copy, date);
    list.append(item);
  }
  if (!list.children.length) {
    const item = document.createElement('li');
    item.className = 'empty-state';
    item.textContent = '还没有投递记录';
    list.append(item);
  }
}
function renderCompanies(applications) {
  const list = document.querySelector('#company-list');
  list.replaceChildren();
  for (const company of companySummary(applications)) {
    const item = document.createElement('li');
    item.className = 'company-item';
    const copy = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'company-name';
    name.textContent = company.company;
    name.title = company.company;
    const detail = document.createElement('div');
    detail.className = 'company-detail';
    detail.textContent = `${company.count} 个岗位 · 已确认 ${company.submitted} 个${company.profiles.length ? ` · 简历：${company.profiles.slice(0, 2).join('、')}${company.profiles.length > 2 ? '等' : ''}` : ''}${company.titles.length ? ` · ${company.titles.slice(0, 2).join('、')}${company.titles.length > 2 ? '等' : ''}` : ''}`;
    copy.append(name, detail);
    const meta = document.createElement('span');
    meta.className = 'company-meta';
    meta.textContent = new Date(company.latest).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit' });
    item.append(copy, meta);
    list.append(item);
  }
  if (!list.children.length) {
    const item = document.createElement('li');
    item.className = 'empty-state';
    item.textContent = '还没有公司记录';
    list.append(item);
  }
}

function selectTab(name, focus = false) {
  const target = document.querySelector(`[data-tab="${name}"]`);
  if (!target) return;
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const active = tab === target;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.querySelector(`#panel-${tab.dataset.tab}`).hidden = !active;
    document.querySelector(`#panel-${tab.dataset.tab}`).classList.toggle('active', active);
  }
  document.querySelector('.app-shell').scrollTop = 0;
  if (focus) target.focus();
}
for (const tab of document.querySelectorAll('[role="tab"]')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    selectTab(tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length].dataset.tab, true);
  });
}
for (const button of document.querySelectorAll('[data-open-tab]')) {
  button.addEventListener('click', () => selectTab(button.dataset.openTab, true));
}

async function loadPageContext() {
  const title = document.querySelector('#page-title');
  const host = document.querySelector('#page-host');
  const badge = document.querySelector('#page-capability');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url || '');
    const supported = ['http:', 'https:'].includes(url.protocol);
    title.textContent = tab?.title || (supported ? '招聘页面' : '浏览器页面');
    host.textContent = supported ? url.hostname : url.protocol.replace(':', '') || '未知页面';
    badge.textContent = supported ? '可检查' : '不可填充';
    badge.dataset.status = supported ? 'ready' : 'blocked';
  } catch {
    title.textContent = '无法读取当前页面';
    host.textContent = '';
    badge.textContent = '不可用';
    badge.dataset.status = 'blocked';
  }
}
lock(true);
loadPageContext();
chrome.storage.local.get(['profile', 'resume', 'applications', 'settings', 'experiences', 'resumeProfiles', 'activeProfileId']).then(async state => {
  resumeProfiles = ResumeData.resumeProfiles(state.resumeProfiles);
  if (!resumeProfiles.length) {
    const legacy = createResumeProfile('默认简历', {
      profile: ResumeData.profile(state.profile || {}),
      resume: ResumeData.resume(state.resume),
      settings: ResumeData.settings(state.settings),
      experiences: ResumeData.experiences(state.experiences)
    });
    resumeProfiles = [legacy];
    activeProfileId = legacy.id;
  } else {
    activeProfileId = resumeProfiles.some(item => item.id === state.activeProfileId) ? state.activeProfileId : resumeProfiles[0].id;
  }
  const active = activeResumeProfile();
  const profile = active.profile;
  putProfile(profile);
  showResume(active.resume);
  putSettings(active.settings);
  currentExperiences = active.experiences;
  renderResumeProfiles();
  renderExperiences();
  renderHistory(state.applications);
  renderCompanies(state.applications);
  loaded = true;
  lock(false);
  if (!Object.values(profile).some(value => value.trim()) && !active.resume) {
    selectTab('quick');
    flash('首次使用：先上传简历自动整理资料，也可以在“资料”页手动填写。');
  }
}).catch(error => {
  flash('读取资料失败：' + error.message + '。请关闭后重开插件。', true);
  // Keep recovery available without replacing unreadable saved data with blank fields.
  lock(false);
});
