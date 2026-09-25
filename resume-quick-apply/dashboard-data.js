// Shared validation and projections for the full-page job search dashboard.
(() => {
  const stages = [
    { id: 'watch', label: '关注', tone: 'slate' },
    { id: 'preparing', label: '准备中', tone: 'amber' },
    { id: 'applied', label: '已投递', tone: 'blue' },
    { id: 'assessment', label: '笔试', tone: 'violet' },
    { id: 'interview', label: '面试', tone: 'orange' },
    { id: 'offer', label: 'Offer', tone: 'green' },
    { id: 'closed', label: '已结束', tone: 'gray' }
  ];
  const stageIds = new Set(stages.map(stage => stage.id));
  const priorities = new Set(['high', 'medium', 'normal']);

  function text(value, max = 1000) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  function webUrl(value) {
    const candidate = text(value, 4000);
    if (!candidate) return '';
    try {
      const url = new URL(candidate);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function companyFor(application) {
    const saved = text(application?.company, 160);
    try {
      const hostname = new URL(application.url).hostname;
      const careerHost = /^(?:apply\.)?careers\.([^.]+)\./i.exec(hostname)?.[1];
      if (careerHost && (!saved || saved === hostname)) return careerHost.length <= 6 ? careerHost.toUpperCase() : careerHost;
      return saved || hostname;
    } catch { return saved || '未知公司'; }
  }

  function stableId(value) {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `job-${(hash >>> 0).toString(36)}`;
  }

  function item(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const url = webUrl(value.url);
    const createdAt = Number.isFinite(value.createdAt) ? value.createdAt : Date.now();
    const updatedAt = Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt;
    const id = text(value.id, 120) || stableId(`${url}|${createdAt}|${text(value.company)}|${text(value.title)}`);
    return {
      id,
      title: text(value.title, 240) || '未命名岗位',
      company: text(value.company, 160) || '未知公司',
      stage: stageIds.has(value.stage) ? value.stage : 'watch',
      priority: priorities.has(value.priority) ? value.priority : 'normal',
      location: text(value.location, 120),
      salary: text(value.salary, 120),
      url,
      deadline: text(value.deadline, 10),
      nextActionAt: text(value.nextActionAt, 30),
      interviewAt: text(value.interviewAt, 30),
      notes: text(value.notes, 10000),
      resumeProfileId: text(value.resumeProfileId, 80),
      resumeProfileLabel: text(value.resumeProfileLabel, 80),
      source: value.source === 'extension' ? 'extension' : 'manual',
      createdAt,
      updatedAt
    };
  }

  function items(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(item).filter(candidate => {
      if (!candidate || seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    }).slice(0, 1000);
  }

  function validApplications(value) {
    return (Array.isArray(value) ? value : []).filter(application => application && webUrl(application.url) && Number.isFinite(application.createdAt));
  }

  function mergeApplications(existing, applications) {
    const merged = items(existing);
    const urls = new Set(merged.map(entry => entry.url).filter(Boolean));
    let added = 0;
    for (const application of validApplications(applications)) {
      const url = webUrl(application.url);
      if (urls.has(url)) continue;
      const entry = item({
        id: stableId(`${url}|${application.createdAt}`),
        title: text(application.title, 240) || url,
        company: companyFor(application),
        stage: 'applied',
        url,
        resumeProfileId: text(application.resumeProfileId, 80),
        resumeProfileLabel: text(application.resumeProfileLabel, 80),
        source: 'extension',
        createdAt: application.createdAt,
        updatedAt: application.createdAt
      });
      if (entry) {
        merged.unshift(entry);
        urls.add(url);
        added++;
      }
    }
    return { items: merged.slice(0, 1000), added };
  }

  function summary(value, now = Date.now()) {
    const list = items(value);
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);
    const counts = Object.fromEntries(stages.map(stage => [stage.id, 0]));
    for (const entry of list) counts[entry.stage]++;
    const active = list.filter(entry => !['offer', 'closed'].includes(entry.stage)).length;
    const thisWeek = list.filter(entry => entry.createdAt >= weekStart.getTime()).length;
    const interviews = list.filter(entry => entry.stage === 'interview').length;
    const offers = counts.offer;
    const responseBase = counts.assessment + counts.interview + counts.offer;
    const responseRate = list.length ? Math.round(responseBase / list.length * 100) : 0;
    return { total: list.length, active, thisWeek, interviews, offers, responseRate, counts };
  }

  const api = { stages, item, items, companyFor, validApplications, mergeApplications, summary };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TrackerData = api;
})();
