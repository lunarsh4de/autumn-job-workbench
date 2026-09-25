(() => {
  const CD = globalThis.CatalogData;
  const DB = globalThis.CatalogDB;
  const dashboard = globalThis.JobTrackerDashboard;
  const state = {
    items: [],
    preferences: { roles: '', skills: '', cities: '' },
    query: '', companyQuery: '', province: 'all', city: 'all', jobType: 'all', platform: 'all', score: 'all', sort: 'match', visible: 200
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    const image = document.createElement('img');
    image.src = `icons/${name}.svg`;
    image.alt = '';
    return image;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(value);
  }

  function scoreLabel(score) {
    if (!Number.isFinite(score)) return '未设置偏好';
    if (score >= 70) return `${score} · 高匹配`;
    if (score >= 40) return `${score} · 可关注`;
    return `${score} · 一般`;
  }

  function filteredItems() {
    const query = state.query.toLowerCase();
    const list = state.items.filter(job => {
      if (query && !`${job.company} ${job.title} ${job.location} ${job.platform} ${job.jobType} ${job.tags.join(' ')}`.toLowerCase().includes(query)) return false;
      if (state.companyQuery && !job.company.toLowerCase().includes(state.companyQuery.toLowerCase())) return false;
      if (state.province !== 'all' && job.province !== state.province) return false;
      if (state.city !== 'all' && job.city !== state.city) return false;
      if (state.jobType !== 'all' && job.jobType !== state.jobType) return false;
      if (state.platform !== 'all' && job.platform !== state.platform) return false;
      if (state.score === 'high' && !(job.matchScore >= 70)) return false;
      if (state.score === 'medium' && !(job.matchScore >= 40 && job.matchScore < 70)) return false;
      if (state.score === 'low' && !(Number.isFinite(job.matchScore) && job.matchScore < 40)) return false;
      return true;
    });
    return list.sort((a, b) => state.sort === 'company'
      ? a.company.localeCompare(b.company, 'zh-CN')
      : state.sort === 'latest' ? b.importedAt - a.importedAt
        : (b.matchScore ?? -1) - (a.matchScore ?? -1) || b.importedAt - a.importedAt);
  }

  function setOptions(selector, values, label) {
    const select = document.querySelector(selector);
    const current = select.value;
    select.replaceChildren();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = `全部${label}`;
    select.append(all);
    for (const value of [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'))) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.append(option);
    }
    select.value = [...select.options].some(option => option.value === current) ? current : 'all';
    return select.value;
  }

  function render() {
    const summary = CD.summary(state.items);
    document.querySelector('#nav-catalog-count').textContent = formatNumber(summary.total);
    document.querySelector('#catalog-total').textContent = formatNumber(summary.total);
    document.querySelector('#catalog-companies').textContent = formatNumber(summary.companies);
    document.querySelector('#catalog-high-match').textContent = formatNumber(summary.highMatch);
    document.querySelector('#catalog-types').textContent = formatNumber(new Set(state.items.map(job => job.jobType)).size);
    state.province = setOptions('#catalog-province', state.items.map(job => job.province), '省份');
    state.city = setOptions('#catalog-city', state.items.filter(job => state.province === 'all' || job.province === state.province).map(job => job.city), '城市');
    state.jobType = setOptions('#catalog-type', state.items.map(job => job.jobType), '岗位类型');
    state.platform = setOptions('#catalog-platform', state.items.map(job => job.platform), '平台');
    renderMatchStrip();
    renderTable();
  }

  function renderMatchStrip() {
    const strip = document.querySelector('#match-strip');
    const list = state.items.filter(job => job.matchScore >= 70).sort((a, b) => b.matchScore - a.matchScore).slice(0, 10);
    strip.hidden = !list.length;
    document.querySelector('#match-strip-count').textContent = `${formatNumber(list.length)} 个优先岗位`;
    const root = document.querySelector('#match-strip-items');
    root.replaceChildren();
    for (const job of list) {
      const button = element('button', 'match-chip');
      button.type = 'button';
      button.dataset.catalogDetails = job.id;
      button.append(element('strong', '', String(job.matchScore)), element('span', '', `${job.company} · ${job.title}`));
      root.append(button);
    }
  }

  function renderTable() {
    const list = filteredItems();
    document.querySelector('#catalog-result-count').textContent = `${formatNumber(list.length)} 个岗位`;
    const root = document.querySelector('#catalog-table');
    root.replaceChildren();
    if (!list.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.append(element('div', 'empty-state', state.items.length ? '没有符合当前筛选的岗位' : '岗位库为空，先导入 CSV 或 JSON'));
      row.append(cell);
      root.append(row);
    }
    for (const job of list.slice(0, state.visible)) {
      const row = document.createElement('tr');
      const company = element('td', 'catalog-company-cell', job.company);
      const titleCell = document.createElement('td');
      const copy = element('div', 'catalog-job-copy');
      copy.append(element('strong', '', job.title));
      const tags = element('span', '', [job.jobType, ...job.tags.slice(0, 3)].filter(Boolean).join(' · '));
      copy.append(tags);
      titleCell.append(copy);
      const scoreCell = document.createElement('td');
      const score = element('span', 'match-score', scoreLabel(job.matchScore));
      score.dataset.level = !Number.isFinite(job.matchScore) ? 'none' : job.matchScore >= 70 ? 'high' : job.matchScore >= 40 ? 'medium' : 'low';
      scoreCell.append(score);
      const location = element('td', '', job.location ? `${CD.formatRegion(job)}${job.location.includes(job.city) ? '' : ` · ${job.location}`}` : CD.formatRegion(job));
      const platform = document.createElement('td');
      platform.append(element('span', 'source-pill', job.platform));
      const actionsCell = document.createElement('td');
      const actions = element('div', 'catalog-row-actions');
      if (job.url) {
        const link = document.createElement('a');
        link.className = 'icon-button';
        link.href = job.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = '打开岗位页面';
        link.setAttribute('aria-label', '打开岗位页面');
        link.append(icon('external-link'));
        actions.append(link);
      }
      const detail = element('button', 'button compact secondary', '岗位详情');
      detail.type = 'button';
      detail.dataset.catalogDetails = job.id;
      const track = element('button', 'button compact secondary', '加入看板');
      track.type = 'button';
      track.dataset.catalogTrack = job.id;
      actions.append(detail, track);
      actionsCell.append(actions);
      row.append(company, titleCell, scoreCell, location, platform, actionsCell);
      root.append(row);
    }
    const more = document.querySelector('#catalog-more');
    more.hidden = list.length <= state.visible;
    more.textContent = `再显示 ${Math.min(200, list.length - state.visible)} 条`;
  }

  function openDetails(job) {
    const dialog = document.querySelector('#catalog-detail-dialog');
    document.querySelector('#catalog-detail-title').textContent = job.title;
    document.querySelector('#catalog-detail-company').textContent = `${job.company}${job.location ? ` · ${job.location}` : ''}`;
    document.querySelector('#catalog-detail-score').textContent = scoreLabel(job.matchScore);
    document.querySelector('#catalog-detail-meta').textContent = [job.jobType, CD.formatRegion(job), job.platform, job.deadline ? `截止 ${job.deadline}` : ''].filter(Boolean).join(' · ');
    document.querySelector('#catalog-detail-tags').textContent = job.tags.join(' · ') || '暂无标签';
    document.querySelector('#catalog-detail-description').textContent = job.description || '暂无岗位描述，请打开原始岗位页面查看。';
    const link = document.querySelector('#catalog-detail-link');
    link.href = job.url || '#';
    link.hidden = !job.url;
    const track = document.querySelector('#catalog-detail-track');
    track.dataset.catalogTrack = job.id;
    dialog.showModal();
  }

  async function importJobs() {
    const file = document.querySelector('#catalog-file').files[0];
    const paste = document.querySelector('#catalog-paste').value.trim();
    const remote = document.querySelector('#catalog-url').value.trim();
    let content = paste;
    if (file) {
      if (file.size > 25 * 1024 * 1024) throw new Error('导入文件不能超过 25 MB。');
      content = await file.text();
    } else if (!content && remote) {
      const url = new URL(remote);
      if (url.protocol !== 'https:') throw new Error('公开数据地址必须使用 HTTPS。');
      const response = await fetch(url.href, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`获取数据失败（HTTP ${response.status}）。`);
      const length = Number(response.headers.get('content-length'));
      if (length > 25 * 1024 * 1024) throw new Error('远程数据超过 25 MB。');
      content = await response.text();
      if (content.length > 25 * 1024 * 1024) throw new Error('远程数据超过 25 MB。');
    }
    const parsed = CD.parseImport(content);
    const scored = CD.rescore(parsed, state.preferences);
    const merged = CD.merge(state.items, scored);
    if (merged.items.length > 50000) throw new Error('单个本地岗位库最多保留 50,000 条。');
    await DB.replaceAll(merged.items);
    state.items = merged.items;
    state.visible = 200;
    render();
    const result = document.querySelector('#import-result');
    result.textContent = `导入完成：新增 ${merged.added} 条，更新 ${merged.updated} 条，本地共 ${merged.items.length} 条。`;
    result.hidden = false;
    document.querySelector('#import-dialog').close();
    dashboard.flash(`岗位库已更新：新增 ${merged.added} 条。`);
  }

  async function savePreferences() {
    const form = document.querySelector('#preference-form');
    state.preferences = Object.fromEntries(new FormData(form));
    await dashboard.storage.set({ jobSearchPreferences: state.preferences });
    state.items = CD.rescore(state.items, state.preferences);
    await DB.replaceAll(state.items);
    render();
    dashboard.flash('匹配偏好已保存，岗位评分已更新。');
  }

  function showImport() {
    const dialog = document.querySelector('#import-dialog');
    document.querySelector('#import-result').hidden = true;
    dialog.showModal();
  }

  async function syncPublicFeed(force = false) {
    const status = document.querySelector('#public-sync-status');
    const saved = await dashboard.storage.get(['publicCatalogSync']);
    const previous = saved.publicCatalogSync;
    if (!force && previous?.at && Date.now() - previous.at < 6 * 60 * 60 * 1000) {
      status.textContent = `公共源已同步 ${previous.total || 0} 条（${new Date(previous.at).toLocaleString('zh-CN')}）`;
      return false;
    }
    status.textContent = '正在同步 GitHub Actions 公共岗位源...';
    try {
      const response = await fetch(`jobs.json?refresh=${Date.now()}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (response.status === 404) {
        status.textContent = '当前为插件/本地模式，可手动导入；Pages 发布后将自动同步';
        return false;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 25 * 1024 * 1024) throw new Error('公共岗位源超过 25 MB');
      const content = await response.text();
      if (content.length > 25 * 1024 * 1024) throw new Error('公共岗位源超过 25 MB');
      const parsed = CD.rescore(CD.parseImport(content), state.preferences);
      const merged = CD.merge(state.items, parsed);
      if (merged.items.length > 50000) throw new Error('合并后岗位超过 50,000 条');
      await DB.replaceAll(merged.items);
      state.items = merged.items;
      const document = JSON.parse(content);
      const generatedAt = document?.meta?.generatedAt || '';
      const sync = { at: Date.now(), total: parsed.length, generatedAt };
      await dashboard.storage.set({ publicCatalogSync: sync });
      status.textContent = `公共源 ${parsed.length} 条，更新于 ${generatedAt ? new Date(generatedAt).toLocaleString('zh-CN') : '刚刚'}`;
      render();
      if (force) dashboard.flash(`公共岗位已同步：新增 ${merged.added} 条，更新 ${merged.updated} 条。`);
      return true;
    } catch (error) {
      status.textContent = `公共源同步失败：${error.message}`;
      if (force) dashboard.flash(`公共岗位同步失败：${error.message}`, true);
      return false;
    }
  }

  function downloadTemplate() {
    const content = '\ufeff公司,岗位,地点,链接,平台,岗位类型,标签,岗位描述,发布时间,截止日期\r\n示例科技,产品经理,上海,https://example.com/job/1,公司官网,校招,"用户研究,数据分析",负责产品需求与分析,2026-09-22,2026-10-15';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '秋招岗位导入模板.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resetFilters() {
    state.query = '';
    state.companyQuery = '';
    state.province = state.city = state.jobType = state.platform = state.score = 'all';
    state.sort = 'match';
    state.visible = 200;
    document.querySelector('#catalog-search').value = '';
    document.querySelector('#catalog-company').value = '';
    document.querySelector('#catalog-province').value = 'all';
    document.querySelector('#catalog-city').value = 'all';
    document.querySelector('#catalog-type').value = 'all';
    document.querySelector('#catalog-platform').value = 'all';
    document.querySelector('#catalog-score').value = 'all';
    document.querySelector('#catalog-sort').value = 'match';
    renderTable();
  }

  function installEvents() {
    document.querySelector('#open-import').addEventListener('click', showImport);
    document.querySelectorAll('[data-open-import]').forEach(button => button.addEventListener('click', showImport));
    document.querySelector('#close-import').addEventListener('click', () => document.querySelector('#import-dialog').close());
    document.querySelector('#cancel-import').addEventListener('click', () => document.querySelector('#import-dialog').close());
    document.querySelector('#import-form').addEventListener('submit', event => {
      event.preventDefault();
      importJobs().catch(error => dashboard.flash(error.message || '导入失败。', true));
    });
    document.querySelector('#download-template').addEventListener('click', downloadTemplate);
    document.querySelector('#clear-catalog').addEventListener('click', async () => {
      if (!confirm('确认清空当前浏览器中的全部岗位库数据？申请看板不会被删除。')) return;
      await DB.clear();
      state.items = [];
      render();
      document.querySelector('#import-dialog').close();
      dashboard.flash('本地岗位库已清空。');
    });
    document.querySelector('#preference-form').addEventListener('submit', event => {
      event.preventDefault();
      savePreferences().catch(error => dashboard.flash(error.message, true));
    });
    document.querySelector('#rescore-catalog').addEventListener('click', () => savePreferences().catch(error => dashboard.flash(error.message, true)));
    document.querySelector('#sync-public-catalog').addEventListener('click', () => syncPublicFeed(true));
    document.querySelector('#catalog-search').addEventListener('input', event => { state.query = event.target.value.trim(); state.visible = 200; renderTable(); });
    document.querySelector('#catalog-company').addEventListener('input', event => { state.companyQuery = event.target.value.trim(); state.visible = 200; renderTable(); });
    for (const [selector, key] of [['#catalog-province', 'province'], ['#catalog-city', 'city'], ['#catalog-type', 'jobType'], ['#catalog-platform', 'platform'], ['#catalog-score', 'score'], ['#catalog-sort', 'sort']]) {
      document.querySelector(selector).addEventListener('change', event => {
        state[key] = event.target.value;
        if (key === 'province') state.city = 'all';
        state.visible = 200;
        render();
      });
    }
    document.querySelector('#reset-catalog-filters').addEventListener('click', resetFilters);
    document.querySelector('#catalog-more').addEventListener('click', () => { state.visible += 200; renderTable(); });
    document.querySelector('#global-search').addEventListener('input', event => {
      state.query = event.target.value.trim();
      document.querySelector('#catalog-search').value = state.query;
      state.visible = 200;
      renderTable();
    });
    document.querySelector('#catalog-detail-close').addEventListener('click', () => document.querySelector('#catalog-detail-dialog').close());
    document.body.addEventListener('click', event => {
      const details = event.target.closest('[data-catalog-details]');
      if (details) {
        const job = state.items.find(item => item.id === details.dataset.catalogDetails);
        if (job) openDetails(job);
        return;
      }
      const track = event.target.closest('[data-catalog-track]');
      if (track) {
        const job = state.items.find(item => item.id === track.dataset.catalogTrack);
        if (job) dashboard.addFromCatalog(job).then(() => document.querySelector('#catalog-detail-dialog').open && document.querySelector('#catalog-detail-dialog').close()).catch(error => dashboard.flash(error.message, true));
      }
    });
  }

  async function load() {
    const saved = await dashboard.storage.get(['jobSearchPreferences']);
    state.preferences = { ...state.preferences, ...(saved.jobSearchPreferences || {}) };
    const form = document.querySelector('#preference-form');
    for (const [key, value] of Object.entries(state.preferences)) form.elements.namedItem(key).value = value;
    const storedItems = await DB.getAll();
    state.items = storedItems.map(value => CD.item(value)).filter(Boolean);
    if (storedItems.length && state.items.length) await DB.replaceAll(state.items);
    if (!state.items.length) {
      const tracked = dashboard.getItems().map(job => ({ ...job, platform: job.source === 'extension' ? '投简历助手' : '手动记录', jobType: '校招', description: job.notes }));
      const merged = CD.merge([], tracked);
      state.items = CD.rescore(merged.items, state.preferences);
      if (state.items.length) await DB.putMany(state.items);
    }
    render();
    await syncPublicFeed(false);
  }

  installEvents();
  load().catch(error => dashboard.flash(`读取岗位库失败：${error.message}`, true));
})();
