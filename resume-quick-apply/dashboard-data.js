// Shared validation and projections for the full-page job search dashboard.
(() => {
  const stages = [
    { id: 'watch', label: '关注', tone: 'slate' },
    { id: 'preparing', label: '准备中', tone: 'amber' },
    { id: 'communicating', label: '已沟通', tone: 'blue' },
    { id: 'applied', label: '已投递', tone: 'blue' },
    { id: 'assessment', label: '笔试', tone: 'violet' },
    { id: 'interview', label: '面试', tone: 'orange' },
    { id: 'offer', label: 'Offer', tone: 'green' },
    { id: 'closed', label: '已结束', tone: 'gray' }
  ];
  const stageIds = new Set(stages.map(stage => stage.id));
  const priorities = new Set(['high', 'medium', 'normal']);
  const recordModes = new Set(['auto', 'manual']);

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
      companyType: text(value.companyType, 80),
      jobType: text(value.jobType, 80),
      platform: text(value.platform, 100),
      salary: text(value.salary, 120),
      url,
      deadline: text(value.deadline, 10),
      nextActionAt: text(value.nextActionAt, 30),
      interviewAt: text(value.interviewAt, 30),
      notes: text(value.notes, 10000),
      resumeProfileId: text(value.resumeProfileId, 80),
      resumeProfileLabel: text(value.resumeProfileLabel, 80),
      source: value.source === 'extension' || value.source === 'catalog' ? value.source : 'manual',
      recordMode: recordModes.has(value.recordMode) ? value.recordMode : '',
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
    const canonical = url => globalThis.ResumeData?.applicationUrl(url) || webUrl(url);
    const urls = new Map(merged.filter(entry => entry.url).map(entry => [canonical(entry.url), entry]));
    let added = 0;
    let updated = 0;
    for (const application of validApplications(applications)) {
      const url = canonical(application.url);
      const stage = application.status === 'communicated' ? 'communicating' : application.status === 'recorded' ? 'preparing' : 'applied';
      const timestamp = application.updatedAt || application.createdAt;
      if (urls.has(url)) {
        const previous = urls.get(url);
        if (timestamp <= previous.updatedAt) continue;
        const ranks = { watch: 0, preparing: 1, communicating: 2, applied: 3 };
        if (ranks[previous.stage] != null && ranks[stage] > ranks[previous.stage]) previous.stage = stage;
        if (previous.source === 'extension' || application.source === 'manual') {
          for (const key of ['title', 'company', 'location', 'salary', 'notes']) if (application[key]) previous[key] = text(application[key], key === 'notes' ? 10000 : 240);
        }
        previous.source = 'extension';
        previous.recordMode = recordModes.has(application.source) ? application.source : previous.recordMode;
        previous.resumeProfileId ||= text(application.resumeProfileId, 80);
        previous.resumeProfileLabel ||= text(application.resumeProfileLabel, 80);
        previous.updatedAt = timestamp;
        updated++;
        continue;
      }
      const entry = item({
        id: stableId(`${url}|${application.createdAt}`),
        title: text(application.title, 240) || url,
        company: companyFor(application),
        stage,
        location: application.location,
        salary: application.salary,
        notes: application.notes,
        url,
        resumeProfileId: text(application.resumeProfileId, 80),
        resumeProfileLabel: text(application.resumeProfileLabel, 80),
        source: 'extension',
        recordMode: application.source === 'auto' || application.source === 'manual' ? application.source : '',
        createdAt: application.createdAt,
        updatedAt: timestamp
      });
      if (entry) {
        merged.unshift(entry);
        urls.set(url, entry);
        added++;
      }
    }
    return { items: merged.slice(0, 1000), added, updated };
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

  function attention(value, now = Date.now()) {
    const result = [];
    const soon = now + 7 * 86400000;
    for (const entry of items(value)) {
      if (['closed', 'offer'].includes(entry.stage)) continue;
      const events = [
        ['deadline', '申请截止', entry.deadline ? `${entry.deadline}T23:59:59` : '', ['watch', 'preparing'].includes(entry.stage)],
        ['interview', '面试安排', entry.interviewAt, true],
        ['followup', '主动跟进', entry.nextActionAt, true]
      ];
      for (const [type, label, date, allowed] of events) {
        if (!allowed || !date) continue;
        const at = new Date(date).getTime();
        if (!Number.isFinite(at) || at > soon) continue;
        // Past interviews remain in the timeline; only missed next actions and deadlines stay actionable.
        if (type === 'interview' && at < now) continue;
        result.push({ id: `${entry.id}-${type}`, jobId: entry.id, company: entry.company, title: entry.title, type, label, at, overdue: at < now });
      }
    }
    return result.sort((a, b) => a.at - b.at || a.company.localeCompare(b.company));
  }
  const api = { stages, item, items, companyFor, validApplications, mergeApplications, summary, attention };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TrackerData = api;
})();
