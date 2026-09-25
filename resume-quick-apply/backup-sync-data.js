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
    const patch = { ...normalized };
    if (Object.hasOwn(source, 'activeProfileLabel')) patch.activeProfileLabel = text(source.activeProfileLabel, 80);
    if (Object.hasOwn(source, 'jobTrackerItems')) {
      if (!globalThis.TrackerData?.items) throw new Error('工作台数据组件未加载。');
      patch.jobTrackerItems = TrackerData.items(source.jobTrackerItems);
    }
    if (Object.hasOwn(source, 'jobSearchPreferences')) patch.jobSearchPreferences = preferences(source.jobSearchPreferences);
    if (Object.hasOwn(source, 'resumeAutoPreferences')) patch.resumeAutoPreferences = preferences(source.resumeAutoPreferences);
    return patch;
  }

  const api = { prepare, preferences };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.BackupSyncData = api;
})();
