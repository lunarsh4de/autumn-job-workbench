// Shared, transport-independent synchronization rules. The extension is the single writer.
(() => {
  const TD = globalThis.TrackerData || (typeof require === 'function' ? require('./dashboard-data.js') : null);
  const RD = globalThis.ResumeData || (typeof require === 'function' ? require('./data.js') : null);
  const fields = ['title', 'company', 'stage', 'priority', 'location', 'salary', 'url', 'deadline', 'nextActionAt', 'interviewAt', 'notes', 'resumeProfileId', 'resumeProfileLabel', 'companyType', 'jobType', 'platform', 'source', 'recordMode'];
  const key = entry => entry.url ? RD.applicationUrl(entry.url) : `id:${entry.id}`;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const find = (items, entry) => items.find(item => item.id === entry.id) || items.find(item => key(item) === key(entry));

  function diff(previous, next, makeId = () => crypto.randomUUID()) {
    const operations = [];
    for (const entry of TD.items(next)) {
      const before = find(previous, entry);
      const patch = Object.fromEntries(fields.filter(field => !before || !same(before[field], entry[field])).map(field => [field, entry[field]]));
      if (!before || Object.keys(patch).length) operations.push({ opId: makeId(), type: 'put', item: entry, patch, before: before || null });
    }
    for (const entry of previous) if (!find(next, entry)) operations.push({ opId: makeId(), type: 'delete', item: entry });
    return operations;
  }

  function apply(value, operations, now = Date.now()) {
    let items = TD.items(value.items);
    const deleted = { ...(value.deleted || {}) };
    const seen = [...(value.seen || [])];
    const conflicts = [];
    if (!Array.isArray(operations) || operations.length > 2000) throw new Error('一次最多同步 2000 次修改。请先导出备份。');
    for (const op of operations) {
      if (!op || !['put', 'delete'].includes(op.type) || typeof op.opId !== 'string' || op.opId.length > 120) throw new Error('同步操作格式不正确。');
      if (seen.includes(op.opId)) continue;
      const candidate = TD.item(op.item);
      if (!candidate) throw new Error('同步岗位格式不正确。');
      const previous = find(items, candidate);
      const timestamp = Math.max(now, (previous?.updatedAt || 0) + 1);
      if (op.type === 'put' && op.restore === true) {
        delete deleted[key(candidate)];
        delete deleted[`id:${candidate.id}`];
      }
      if (op.type === 'delete') {
        items = items.filter(item => item !== previous);
        deleted[key(candidate)] = timestamp;
        deleted[`id:${candidate.id}`] = timestamp;
      } else if (!previous && (deleted[key(candidate)] || deleted[`id:${candidate.id}`])) {
        // An old/offline tab cannot recreate a record deleted elsewhere.
        conflicts.push({ title: candidate.title, field: 'deleted' });
      } else {
        if (!previous && items.length >= 1000) throw new Error('工作台已达 1000 个岗位上限，请导出备份并整理后重试。');
        const patch = {};
        for (const field of fields) {
          if (!op.patch || !Object.hasOwn(op.patch, field)) continue;
          patch[field] = candidate[field];
          if (previous && op.before && !same(previous[field], op.before[field]) && !same(previous[field], patch[field])) {
            conflicts.push({ title: candidate.title, field });
            // Preserve both versions of concurrent notes instead of discarding either.
            if (field === 'notes' && previous.notes && patch.notes) patch.notes = `${previous.notes.slice(0, 4900)}\n\n[另一处修改]\n${patch.notes.slice(0, 4900)}`;
          }
        }
        const entry = TD.item(previous ? { ...previous, ...patch, updatedAt: timestamp } : { ...candidate, updatedAt: timestamp });
        items = previous ? items.map(item => item === previous ? entry : item) : [entry, ...items];
      }
      seen.push(op.opId);
    }
    return { items, deleted, seen: seen.slice(-4000), conflicts };
  }

  function projectApplications(existing, items) {
    const applications = RD.applications(existing);
    for (const item of items) {
      if (!item.url) continue;
      const index = applications.findIndex(application => key(application) === key(item));
      const previous = applications[index];
      const status = item.stage === 'communicating' ? 'communicated' : ['watch', 'preparing'].includes(item.stage) ? 'recorded' : item.stage === 'closed' ? previous?.status || 'recorded' : 'submitted';
      const entry = RD.applications([{ ...previous, ...item, status, workflowStage: item.stage, source: previous?.source || 'manual' }])[0];
      if (index >= 0) applications[index] = entry;
      else applications.unshift(entry);
    }
    return applications.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500);
  }

  function trustedSite(value) {
    try {
      const url = new URL(value);
      return url.origin === 'https://lunarsh4de.github.io' && url.pathname.startsWith('/autumn-job-workbench/');
    } catch { return false; }
  }
  const api = { fields, key, diff, apply, projectApplications, trustedSite };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.WorkbenchData = api;
})();
