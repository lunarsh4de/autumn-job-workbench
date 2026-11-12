// Explicit allowlist for account cloud data. Attachments, plugin profiles, and credentials stay local.
(() => {
  const text = (value, max = 3000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  function clean(value) {
    const source = record(value), basic = record(source.basic), preferences = record(source.preferences);
    const TD = globalThis.TrackerData || (typeof require === 'function' && require('./dashboard-data.js'));
    if (Array.isArray(source.items) && source.items.length > 1000) throw new Error('账号最多保存 1000 个申请岗位。');
    return {
      schemaVersion: 1,
      basic: Object.fromEntries(['name', 'school', 'degree', 'graduation', 'targetRole', 'email'].map(field => [field, text(basic[field], field === 'targetRole' ? 500 : 160)])),
      preferences: Object.fromEntries(['roles', 'skills', 'cities'].map(field => [field, text(preferences[field])])),
      items: TD.items(source.items || [])
    };
  }
  function namespace(userId, field) {
    if (!userId) return field; // Existing guest records remain on this device.
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(userId)) throw new Error('无效账号标识。');
    return `smart-job:user:${userId}:${field}`;
  }
  const api = { clean, namespace };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.AccountData = api;
})();
