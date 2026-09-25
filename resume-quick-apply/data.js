// Shared validation and ordered writes; no network access.
(() => {
  const fields = ['name', 'phone', 'email', 'city', 'education', 'school', 'skills', 'website', 'summary'];
  const maxResumeBytes = 3 * 1024 * 1024;
  const maxImportBytes = 64 * 1024 * 1024;
  const maxResumeImportBytes = 10 * 1024 * 1024;
  const maxResumeProfiles = 12;
  const experienceSchemas = {
    work: ['company', 'role', 'location', 'startDate', 'endDate', 'description'],
    education: ['school', 'degree', 'major', 'startDate', 'endDate', 'description'],
    projects: ['name', 'role', 'startDate', 'endDate', 'description'],
    competitions: ['name', 'year', 'startDate', 'endDate', 'description'],
    awards: ['name', 'year', 'description'],
    campus: ['name', 'role', 'startDate', 'endDate', 'description'],
    languages: ['name', 'description'],
    publications: ['name', 'description', 'result']
  };
  const mimeTypes = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function profile(value) {
    if (!record(value)) throw new Error('个人资料必须是 JSON 对象。');
    return Object.fromEntries(fields.map(key => {
      const item = value[key] ?? '';
      if (typeof item !== 'string' || item.length > (key === 'summary' ? 10000 : 1000)) throw new Error(`资料字段 ${key} 类型不正确或内容过长。`);
      return [key, item];
    }));
  }
  function resume(value) {
    if (value == null) return null;
    if (!record(value) || typeof value.name !== 'string' || value.name.length > 255 || typeof value.dataUrl !== 'string') throw new Error('简历附件格式不正确。');
    const extension = value.name.split('.').pop().toLowerCase();
    if (!Object.hasOwn(mimeTypes, extension)) throw new Error('附件仅支持 PDF、DOC 或 DOCX。');
    if (value.dataUrl.length > maxResumeBytes * 4 / 3 + 256) throw new Error('简历附件超过 3 MB。');
    const match = /^data:([\w.+/-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value.dataUrl);
    if (!match || !match[2] || match[2].length % 4 !== 0) throw new Error('附件不是有效的 Base64 文件。');
    const bytes = atob(match[2]);
    if (bytes.length > maxResumeBytes) throw new Error('简历附件超过 3 MB。');
    const signatureOK = extension === 'pdf' ? bytes.startsWith('%PDF-') : extension === 'docx'
      ? bytes.startsWith('PK\x03\x04') : bytes.startsWith('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1');
    if (!signatureOK) throw new Error('文件内容与扩展名不符，请重新选择原始简历文件。');
    const type = mimeTypes[extension];
    return { name: value.name, type, dataUrl: `data:${type};base64,${match[2]}` };
  }
  function settings(value) {
    if (value == null) return { quickAttachment: false };
    if (!record(value)) throw new Error('设置必须是 JSON 对象。');
    const quickAttachment = value.quickAttachment ?? false;
    if (typeof quickAttachment !== 'boolean') throw new Error('快捷附件设置格式不正确。');
    return { quickAttachment };
  }
  function experiences(value) {
    if (value == null) value = {};
    if (!record(value)) throw new Error('经历资料必须是 JSON 对象。');
    return Object.fromEntries(Object.entries(experienceSchemas).map(([type, keys]) => {
      const items = value[type] ?? [];
      if (!Array.isArray(items) || items.length > 20) throw new Error(`${type} 经历格式不正确或超过 20 条。`);
      return [type, items.map((item, index) => {
        if (!record(item)) throw new Error(`${type} 第 ${index + 1} 条经历格式不正确。`);
        return Object.fromEntries(keys.map(key => {
          const field = item[key] ?? '';
          const limit = key === 'description' ? 10000 : 1000;
          if (typeof field !== 'string' || field.length > limit) throw new Error(`${type} 第 ${index + 1} 条的 ${key} 格式不正确或内容过长。`);
          return [key, field];
        }));
      })];
    }));
  }
  function resumeProfile(value) {
    if (!record(value)) throw new Error('简历档案必须是 JSON 对象。');
    if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)) throw new Error('简历档案 ID 不正确。');
    if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80) throw new Error('简历档案名称不正确或过长。');
    const createdAt = value.createdAt == null ? Date.now() : Number(value.createdAt);
    const updatedAt = value.updatedAt == null ? createdAt : Number(value.updatedAt);
    if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) throw new Error('简历档案时间格式不正确。');
    return {
      id: value.id,
      label: value.label.trim(),
      profile: profile(value.profile),
      resume: resume(value.resume),
      settings: settings(value.settings),
      experiences: experiences(value.experiences),
      createdAt,
      updatedAt
    };
  }
  function resumeProfiles(value) {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > maxResumeProfiles) throw new Error(`简历档案最多保存 ${maxResumeProfiles} 份。`);
    const seen = new Set();
    return value.map(item => {
      const normalized = resumeProfile(item);
      if (seen.has(normalized.id)) throw new Error('简历档案 ID 重复。');
      seen.add(normalized.id);
      return normalized;
    });
  }
  function applications(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new Error('投递记录必须是数组。');
    return value.slice(0, 500).map(item => {
      if (!record(item) || typeof item.url !== 'string' || !Number.isFinite(item.createdAt)) return null;
      try {
        const url = new URL(item.url);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
      } catch { return null; }
      const text = (input, max) => typeof input === 'string' ? input.trim().slice(0, max) : '';
      return {
        url: item.url,
        title: text(item.title, 240),
        company: text(item.company, 160),
        status: item.status === 'submitted' ? 'submitted' : 'recorded',
        source: item.source === 'auto' ? 'auto' : 'manual',
        resumeProfileId: text(item.resumeProfileId, 80),
        resumeProfileLabel: text(item.resumeProfileLabel, 80),
        createdAt: item.createdAt
      };
    }).filter(Boolean);
  }
  function backup(value) {
    if (!record(value) || !Object.hasOwn(value, 'profile')) throw new Error('不是有效的资料备份，缺少 profile 字段。');
    if (value.schemaVersion != null && ![1, 2, 3, 4].includes(value.schemaVersion)) throw new Error('不支持此备份版本。');
    const normalized = { profile: profile(value.profile), resume: resume(value.resume), settings: settings(value.settings), experiences: experiences(value.experiences), applications: applications(value.applications) };
    const profiles = resumeProfiles(value.resumeProfiles);
    if (!profiles.length) return normalized;
    const activeProfileId = typeof value.activeProfileId === 'string' && profiles.some(item => item.id === value.activeProfileId)
      ? value.activeProfileId : profiles[0].id;
    const active = profiles.find(item => item.id === activeProfileId);
    return { ...normalized, resumeProfiles: profiles, activeProfileId, profile: active.profile, resume: active.resume, settings: active.settings, experiences: active.experiences };
  }
  function createQueue() {
    let tail = Promise.resolve();
    return function enqueue(task) {
      const result = tail.then(task);
      tail = result.catch(() => {});
      return result;
    };
  }
  const api = { fields, experienceSchemas, maxResumeBytes, maxImportBytes, maxResumeImportBytes, maxResumeProfiles, profile, resume, settings, experiences, resumeProfile, resumeProfiles, applications, backup, createQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ResumeData = api;
})();
