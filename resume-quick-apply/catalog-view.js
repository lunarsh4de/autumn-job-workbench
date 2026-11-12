// Pure catalog view rules: filter first, then group. Company names never become HTML.
(() => {
  const key = value => String(value || '未注明公司').normalize('NFKC').trim().toLocaleLowerCase();
  function groups(items) {
    const map = new Map();
    for (const job of items) {
      const id = key(job.company);
      if (!map.has(id)) map.set(id, { id, company: job.company || '未注明公司', jobs: [], types: new Set(), locations: new Set() });
      const group = map.get(id);
      group.jobs.push(job); group.types.add(job.jobType); group.locations.add(job.city || job.location || '地点待确认');
    }
    return [...map.values()];
  }
  const api = { groups, key };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CatalogView = api;
})();
