// Validate and normalize the wrapped GitHub backup before local storage writes.
(() => {
  function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value, limit = 3000) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function preferences(value) {
    if (value == null) return { roles: '', skills: '', cities: '' };
    if (!record(value)) throw new Error('匹配偏好格式不正确。');
    return { roles: text(value.roles), skills: text(value.skills), cities: text(value.cities) };
  }

  function prepare(value) {
    const source = record(value?.data) ? value.data : value;
    if (!record(source) || !globalThis.ResumeData?.backup) throw new Error('备份格式不正确或解析组件未加载。');
    const normalized = ResumeData.backup(source);
    if (!globalThis.TrackerData?.items) throw new Error('工作台数据组件未加载。');
    const profiles = normalized.resumeProfiles || [];
    const activeProfile = profiles.find(item => item.id === normalized.activeProfileId) || profiles[0];
    return {
      ...normalized,
      resumeProfiles: profiles,
      activeProfileId: normalized.activeProfileId || activeProfile?.id || null,
      activeProfileLabel: text(source.activeProfileLabel, 80) || activeProfile?.label || null,
      jobTrackerItems: TrackerData.items(source.jobTrackerItems || []),
      jobSearchPreferences: preferences(source.jobSearchPreferences),
      resumeAutoPreferences: preferences(source.resumeAutoPreferences)
    };
  }

  const api = { prepare, preferences };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.BackupSyncData = api;
})();
