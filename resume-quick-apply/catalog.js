(() => {
  const CD = globalThis.CatalogData;
  const DB = globalThis.CatalogDB;
  const dashboard = globalThis.JobTrackerDashboard;
  const state = {
    items: [],
    manualPreferences: { roles: '', skills: '', cities: '' },
    autoPreferences: { roles: '', skills: '', cities: '' },
    preferences: { roles: '', skills: '', cities: '' },
    facets: { province: [], city: [], jobType: [], companyType: [], platform: [] }, layout: 'grouped', expanded: new Set(), groupVisible: 40,
    query: '', companyQuery: '', province: 'all', city: 'all', jobType: 'all', companyType: 'all', platform: 'all', score: 'all', sort: 'match', visible: 200
  };
  const employerGroups = [
    {
      label: '互联网 / 科技',
      employers: [
        ['华为', '华为|Huawei', 'https://career.huawei.com/reccampportal/portal5/index.html'],
        ['字节跳动', '字节跳动|ByteDance', 'https://jobs.bytedance.com/campus'],
        ['阿里巴巴', '阿里巴巴|Alibaba', 'https://talent.alibaba.com/campus/home'],
        ['腾讯', '腾讯|Tencent', 'https://join.qq.com/'],
        ['百度', '百度|Baidu', 'https://talent.baidu.com/jobs/list'],
        ['小米', '小米|Xiaomi', 'https://hr.xiaomi.com/campus'],
        ['美团', '美团|Meituan', 'https://zhaopin.meituan.com/web/position?hiringType=1_1'],
        ['京东', '京东|JD.com|JD.COM', 'https://campus.jd.com/'],
        ['网易', '网易|NetEase', 'https://campus.163.com/']
      ]
    },
    {
      label: '汽车 / 新能源',
      employers: [
        ['特斯拉', '特斯拉|Tesla', 'https://app.mokahr.com/campus-recruitment/tesla/41460?locale=zh-CN#/jobs'],
        ['蔚来', '蔚来|NIO', 'https://www.nio.com/careers'],
        ['比亚迪', '比亚迪|BYD', 'https://job.byd.com/portal/pc/#/school/schoolPositionList'],
        ['理想汽车', '理想汽车|Li Auto', 'https://www.lixiang.com/employ.html'],
        ['小鹏汽车', '小鹏|XPENG', 'https://www.xiaopeng.com/'],
        ['吉利汽车', '吉利|Geely', 'https://campus.geely.com/campus-recruitment/geely/78436/#/jobs'],
        ['极氪', '极氪|ZEEKR', 'https://app.mokahr.com/campus-recruitment/geely/98147#/jobs'],
        ['长城汽车', '长城汽车|GWM', 'https://zhaopin.gwm.cn/'],
        ['上汽集团', '上汽|SAIC', 'https://www.saicmotor.com/chinese/rlzy/rcxq/xyzp/index_xz2.shtml'],
        ['长安汽车', '长安汽车|Changan', 'https://changan.zhiye.com/'],
        ['中国一汽', '中国一汽|一汽|FAW', 'https://www.faw.com.cn/fawcn/373692/rlzy17/rczl/index.html'],
        ['东风汽车', '东风汽车|Dongfeng', 'https://www.dfmc.com.cn/zhaopin/xiaoyuanzhaopin.html'],
        ['宁德时代', '宁德时代|CATL', 'https://talent.catl.com/']
      ]
    }
  ];
  let resumeCandidate = null;
  let publicSyncing = false;
  let lastPublicCheck = 0;
  let importing = false;
  let catalogReady = false;
  let pendingResumeSync = false;
  let resumeSyncGeneration = 0;
  let detailTrigger = null;
  let importTrigger = null;

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

  function isTracked(job) {
    return dashboard.getItems().some(entry => (job.url && entry.url === job.url) || (entry.company === job.company && entry.title === job.title));
  }

  function renderEmployerDirectories() {
    const featuredRoot = document.querySelector('#featured-employer-groups');
    const sourceRoot = document.querySelector('#employer-source-groups');
    if (!featuredRoot || !sourceRoot) return;
    featuredRoot.replaceChildren();
    sourceRoot.replaceChildren();
    for (const group of employerGroups) {
      const featuredGroup = element('section', 'featured-employer-group');
      featuredGroup.append(element('h4', '', group.label));
      const featuredList = element('div', 'featured-employer-list');
      const sourceGroup = element('section', 'employer-source-group');
      sourceGroup.append(element('h4', '', group.label));
      const sourceList = element('div', 'employer-source-list');
      for (const [name, aliases, url] of group.employers) {
        const card = element('article', 'featured-employer');
        card.dataset.featuredCompany = aliases;
        const copy = document.createElement('div');
        const count = element('span', '', '本地岗位 0');
        count.dataset.featuredCount = '';
        copy.append(element('strong', '', name), count);
        const actions = element('div', 'featured-employer-actions');
        const filter = element('button', 'button compact secondary', '筛选');
        filter.type = 'button';
        filter.dataset.companyFilter = aliases;
        filter.setAttribute('aria-label', `筛选${name}岗位`);
        const link = document.createElement('a');
        link.className = 'icon-button';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = `打开${name}官方招聘`;
        link.setAttribute('aria-label', `打开${name}官方招聘`);
        link.append(icon('external-link'));
        actions.append(filter, link);
        card.append(copy, actions);
        featuredList.append(card);

        const sourceLink = document.createElement('a');
        sourceLink.className = 'employer-source-link';
        sourceLink.href = url;
        sourceLink.target = '_blank';
        sourceLink.rel = 'noopener noreferrer';
        sourceLink.append(element('span', '', name), icon('external-link'));
        sourceList.append(sourceLink);
      }
      featuredGroup.append(featuredList);
      sourceGroup.append(sourceList);
      featuredRoot.append(featuredGroup);
      sourceRoot.append(sourceGroup);
    }
  }

  const facetDefinitions = [['province', '省份', '#catalog-province'], ['city', '城市', '#catalog-city'], ['jobType', '岗位类型', '#catalog-type'], ['companyType', '企业类型', '#catalog-company-type'], ['platform', '来源平台', '#catalog-platform']];
  function matches(job, excluded) {
    const query = state.query.toLowerCase();
    if (query && !`${job.company} ${job.title} ${job.location} ${job.province} ${job.city} ${job.platform} ${job.companyType} ${job.jobType} ${job.tags.join(' ')}`.toLowerCase().includes(query)) return false;
    if (state.companyQuery && !CD.matchesCompany(job, state.companyQuery)) return false;
    for (const [key] of facetDefinitions) if (key !== excluded && state.facets[key].length && !state.facets[key].includes(job[key])) return false;
    if (state.score === 'high' && !(job.matchScore >= 70)) return false;
    if (state.score === 'medium' && !(job.matchScore >= 40 && job.matchScore < 70)) return false;
    if (state.score === 'low' && !(Number.isFinite(job.matchScore) && job.matchScore < 40)) return false;
    return true;
  }
  function filteredItems() {
    return state.items.filter(job => matches(job)).sort((a, b) => state.sort === 'company'
      ? a.company.localeCompare(b.company, 'zh-CN')
      : state.sort === 'latest' ? b.importedAt - a.importedAt
        : (b.matchScore ?? -1) - (a.matchScore ?? -1) || b.importedAt - a.importedAt);
  }
  function refreshFacets() {
    const root = document.querySelector('#catalog-facets');
    const open = new Set([...root.querySelectorAll('details[open]')].map(node => node.dataset.facet));
    const focused = document.activeElement?.dataset;
    const focusedKey = focused?.facetKey, focusedValue = focused?.facetValue;
    const focusRole=focused?.roleType, focusChip=focused?.removeFacet, focusClear=focused?.clearFacet;
    root.replaceChildren();
    for (const [key, label] of facetDefinitions) {
      const counts = new Map();
      for (const job of state.items) if (matches(job, key) && job[key]) counts.set(job[key], (counts.get(job[key]) || 0) + 1);
      const values = [...new Set([...counts.keys(), ...state.facets[key]])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const details = element('details', 'facet'); details.dataset.facet = key; details.open = open.has(key);
      const summary = element('summary'); summary.append(element('span', '', label), element('strong', '', state.facets[key].length ? `已选 ${state.facets[key].length}` : '不限'));
      const fieldset = element('fieldset', 'facet-options'); fieldset.append(element('legend', 'sr-only', label));
      if (!values.length) fieldset.append(element('p', 'facet-empty', '当前条件下没有可选项'));
      for (const value of values) {
        const option = element('label', 'facet-option'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = state.facets[key].includes(value); input.dataset.facetKey = key; input.dataset.facetValue = value;
        option.append(input, element('span', '', value), element('small', '', String(counts.get(value) || 0))); fieldset.append(option);
      }
      if (state.facets[key].length) { const clear = element('button', 'text-link', '清除此组'); clear.type = 'button'; clear.dataset.clearFacet = key; fieldset.append(clear); }
      details.append(summary, fieldset); root.append(details);
    }
    if (focusedKey) [...root.querySelectorAll('input')].find(input => input.dataset.facetKey === focusedKey && input.dataset.facetValue === focusedValue)?.focus();
    const tabs = document.querySelector('#catalog-role-tabs'); tabs.replaceChildren();
    const counts = new Map(); for (const job of state.items) if (matches(job, 'jobType')) counts.set(job.jobType, (counts.get(job.jobType) || 0) + 1);
    const all = element('button', 'role-tab', '全部方向'); all.type = 'button'; all.dataset.roleType = ''; all.setAttribute('aria-pressed', String(!state.facets.jobType.length)); tabs.append(all);
    for (const type of [...new Set(state.items.map(job => job.jobType))].sort((a,b) => (counts.get(b)||0)-(counts.get(a)||0))) { const button = element('button', 'role-tab'); button.type = 'button'; button.dataset.roleType = type; button.setAttribute('aria-pressed', String(state.facets.jobType.includes(type))); button.append(element('span', '', type), element('small', '', String(counts.get(type)||0))); tabs.append(button); }
    const chips = document.querySelector('#catalog-active-filters'); chips.replaceChildren();
    for (const [key, label] of facetDefinitions) for (const value of state.facets[key]) { const chip = element('button', 'filter-chip', `${label}：${value} ×`); chip.type = 'button'; chip.dataset.removeFacet = key; chip.dataset.facetValue = value; chip.setAttribute('aria-label', `移除${label}：${value}`); chips.append(chip); }
    for (const [key, label] of [['query','搜索'],['companyQuery','公司']]) if (state[key]) { const chip = element('button', 'filter-chip', `${label}：${state[key]} ×`); chip.type = 'button'; chip.dataset.clearQuery = key; chips.append(chip); }
    if(focusRole !== undefined) [...tabs.querySelectorAll('button')].find(button=>button.dataset.roleType===focusRole)?.focus();
    if(focusChip || focusClear) [...root.querySelectorAll('details')].find(details=>details.dataset.facet===(focusChip||focusClear))?.querySelector('summary')?.focus();
  }
  function toggleFacet(key, value, force) {
    const selected = state.facets[key];
    state.facets[key] = force === false || selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
    if (key === 'province' && state.facets.city.length) {
      const valid = new Set(state.items.filter(job => !state.facets.province.length || state.facets.province.includes(job.province)).map(job => job.city));
      const removed = state.facets.city.filter(city => !valid.has(city)); state.facets.city = state.facets.city.filter(city => valid.has(city));
      if (removed.length) dashboard.flash(`已清除不属于所选省份的城市：${removed.join('、')}。`);
    }
    for (const [name,,selector] of facetDefinitions) { state[name] = state.facets[name].length === 1 ? state.facets[name][0] : 'all'; document.querySelector(selector).value = state[name]; }
    state.visible = 200; state.groupVisible = 40; renderTable();
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
    document.querySelector('#catalog-companies').textContent = formatNumber(globalThis.CatalogView.groups(state.items).length);
    document.querySelector('#catalog-high-match').textContent = formatNumber(summary.highMatch);
    document.querySelector('#catalog-types').textContent = formatNumber(new Set(state.items.map(job => job.jobType)).size);
    state.province = setOptions('#catalog-province', state.items.map(job => job.province), '省份');
    state.city = setOptions('#catalog-city', state.items.filter(job => state.province === 'all' || job.province === state.province).map(job => job.city), '城市');
    state.jobType = setOptions('#catalog-type', state.items.map(job => job.jobType), '岗位类型');
    state.companyType = setOptions('#catalog-company-type', state.items.map(job => job.companyType), '企业类型');
    state.platform = setOptions('#catalog-platform', state.items.map(job => job.platform), '平台');
    const regionSummary = document.querySelector('#catalog-region-summary');
    if (regionSummary) regionSummary.textContent = state.province === 'all' ? '不限' : `${state.province}${state.city === 'all' ? '' : ` · ${state.city}`}`;
    const jobSummary = document.querySelector('#catalog-job-summary');
    if (jobSummary) jobSummary.textContent = state.jobType === 'all' ? '不限' : state.jobType;
    renderFeaturedEmployers();
    renderMatchStrip();
    renderTable();
  }

  function renderFeaturedEmployers() {
    document.querySelectorAll('[data-featured-company]').forEach(card => {
      const count = state.items.filter(job => CD.matchesCompany(job, card.dataset.featuredCompany)).length;
      const label = card.querySelector('[data-featured-count]');
      if (label) label.textContent = `本地岗位 ${formatNumber(count)}`;
      card.dataset.available = String(count > 0);
    });
  }

  function filterCompany(value) {
    state.companyQuery = value;
    state.visible = 200;
    document.querySelector('#catalog-company').value = value.split('|')[0];
    document.querySelector('#catalog-search').value = '';
    document.querySelector('#global-search').value = '';
    state.query = '';
    renderTable();
    document.querySelector('.catalog-browser').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      const empty = element('div', 'empty-state');
      empty.append(element('p', '', state.items.length ? '没有符合当前筛选的岗位' : '岗位库为空，先导入 CSV 或 JSON'));
      const hasFilter = Boolean(state.query || state.companyQuery || state.province !== 'all' || state.city !== 'all' || state.jobType !== 'all' || state.companyType !== 'all' || state.platform !== 'all' || state.score !== 'all');
      if (state.items.length && hasFilter) {
        const clear = element('button', 'button compact secondary', '清除筛选');
        clear.type = 'button';
        clear.dataset.resetCatalog = 'true';
        empty.append(clear);
      }
      cell.append(empty);
      row.append(cell);
      root.append(row);
    }
    function jobRow(job) {
      const row = document.createElement('tr');
      const company = element('td', 'catalog-company-cell', job.company);
      if (job.companyType.startsWith('外企（')) company.append(element('span', 'company-type-badge', job.companyType));
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
      if (job.stale) platform.append(element('small', 'stale-note', `来源缓存${job.lastSuccessfulAt ? ' · '+new Date(job.lastSuccessfulAt).toLocaleDateString('zh-CN') : ''}`));
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
      const tracked = isTracked(job);
      const track = element('button', 'button compact secondary', tracked ? '已在看板' : '加入看板');
      track.type = 'button';
      track.dataset.catalogTrack = job.id;
      track.disabled = tracked;
      track.setAttribute('aria-label', tracked ? '已在申请看板中' : '加入申请看板');
      actions.append(detail, track);
      actionsCell.append(actions);
      row.append(company, titleCell, scoreCell, location, platform, actionsCell);
      return row;
    }
    for (const job of list.slice(0, state.visible)) root.append(jobRow(job));
    renderGroups(list, jobRow);
    refreshFacets();
    const more = document.querySelector('#catalog-more');
    const groupCount = globalThis.CatalogView.groups(list).length;
    more.hidden = state.layout === 'grouped' ? groupCount <= state.groupVisible : list.length <= state.visible;
    more.textContent = state.layout === 'grouped' ? `再显示 ${Math.min(40, groupCount - state.groupVisible)} 家公司` : `再显示 ${Math.min(200, list.length - state.visible)} 条`;
  }

  function renderGroups(list, jobRow) {
    const groups = globalThis.CatalogView.groups(list);
    document.querySelector('#catalog-result-count').textContent = `${formatNumber(list.length)} 个岗位 / ${formatNumber(groups.length)} 家公司`;
    const root = document.querySelector('#catalog-groups'); root.replaceChildren(); root.hidden = state.layout !== 'grouped';
    document.querySelector('.catalog-table').hidden = state.layout === 'grouped';
    document.querySelector('#catalog-group-hint').textContent = state.layout === 'grouped' ? '先比较岗位方向，再展开公司查看职位' : '每行一个岗位，可切回公司汇总';
    document.querySelectorAll('[data-catalog-layout]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.catalogLayout === state.layout)));
    if (!groups.length) { const empty = element('div','empty-state',state.items.length ? '没有符合这些条件的岗位。试试移除筛选条件。' : '岗位库尚未载入。可立即同步，或导入自己的清单。'); root.append(empty); }
    for (const group of groups.slice(0, state.groupVisible)) {
      const details = element('details', 'company-disclosure'); details.dataset.companyGroup = group.company;
      const summary = element('summary'); const mark = element('span', 'company-monogram', group.company.slice(0,2)); const copy = element('span', 'company-group-copy');
      copy.append(element('strong', '', group.company), element('span', '', [...group.types].join(' / ')));
      const stats = element('span', 'company-group-stats'); stats.append(element('strong', '', `${group.jobs.length} 个岗位`), element('span', '', [...group.locations].slice(0,3).join('、') + (group.locations.size > 3 ? ` 等 ${group.locations.size} 地` : '')));
      summary.append(mark, copy, stats, element('span','company-chevron','⌄')); details.append(summary);
      let loaded = false; const body = element('div','company-jobs');
      const fill = () => { if (loaded) return; loaded = true; const table = document.createElement('table'); const head = document.createElement('thead'); const row = document.createElement('tr'); for (const title of ['公司','岗位','匹配度','工作地点','来源','操作']) row.append(element('th','',title)); head.append(row); const tbody = document.createElement('tbody'); for (const job of group.jobs.slice(0,50)) tbody.append(jobRow(job)); table.append(head,tbody); body.append(table); if (group.jobs.length > 50) { const more = element('button','button secondary',`再显示本公司 ${Math.min(50,group.jobs.length-50)} 个岗位`); more.type='button'; let visible=50; more.addEventListener('click',()=>{ for(const job of group.jobs.slice(visible,visible+50)) tbody.append(jobRow(job)); visible+=50; more.hidden=visible>=group.jobs.length; more.textContent=`再显示本公司 ${Math.min(50,group.jobs.length-visible)} 个岗位`; }); body.append(more); } };
      details.addEventListener('toggle', () => { if (details.open) {state.expanded.add(group.id); fill();} else state.expanded.delete(group.id); });
      if (state.expanded.has(group.id)) { details.open=true; fill(); } details.append(body); root.append(details);
    }
  }

  function openDetails(job) {
    const dialog = document.querySelector('#catalog-detail-dialog');
    document.querySelector('#catalog-detail-title').textContent = job.title;
    document.querySelector('#catalog-detail-company').textContent = `${job.company}${job.location ? ` · ${job.location}` : ''}`;
    document.querySelector('#catalog-detail-score').textContent = scoreLabel(job.matchScore);
    document.querySelector('#catalog-detail-meta').textContent = [job.stale ? `来源缓存，最后成功：${job.lastSuccessfulAt || '时间未知'}` : '', job.jobType, CD.formatRegion(job), job.platform, job.deadline ? `截止 ${job.deadline}` : ''].filter(Boolean).join(' · ');
    document.querySelector('#catalog-detail-tags').textContent = job.tags.join(' · ') || '暂无标签';
    document.querySelector('#catalog-detail-description').textContent = job.description || '暂无岗位描述，请打开原始岗位页面查看。';
    const link = document.querySelector('#catalog-detail-link');
    link.href = job.url || '#';
    link.hidden = !job.url;
    const track = document.querySelector('#catalog-detail-track');
    track.dataset.catalogTrack = job.id;
    const tracked = isTracked(job);
    track.textContent = tracked ? '已在看板' : '加入申请看板';
    track.disabled = tracked;
    track.setAttribute('aria-label', tracked ? '已在申请看板中' : '加入申请看板');
    dialog.showModal();
    document.querySelector('#catalog-detail-close')?.focus();
  }

  function scheduleDetailFocusRestore() {
    const trigger = detailTrigger;
    detailTrigger = null;
    if (!trigger) return;
    setTimeout(() => {
      if (trigger.isConnected && !document.querySelector('#view-catalog')?.hidden) trigger.focus();
    }, 0);
  }

  async function importJobs() {
    if (importing) return;
    importing = true;
    const submit = document.querySelector('#import-form button[type="submit"]');
    const result = document.querySelector('#import-result');
    if (submit) {
      submit.disabled = true;
      submit.setAttribute('aria-busy', 'true');
    }
    result.dataset.error = 'false';
    result.textContent = '正在解析并合并岗位…';
    result.hidden = false;
    try {
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
    result.textContent = `导入完成：新增 ${merged.added} 条，更新 ${merged.updated} 条，本地共 ${merged.items.length} 条。`;
    result.hidden = false;
    document.querySelector('#import-dialog').close();
    dashboard.flash(`岗位库已更新：新增 ${merged.added} 条。`);
    } catch (error) {
      result.dataset.error = 'true';
      result.textContent = `导入失败：${error.message || '请检查数据格式后重试。'}`;
      result.hidden = false;
      throw error;
    } finally {
      importing = false;
      if (submit) {
        submit.disabled = false;
        submit.setAttribute('aria-busy', 'false');
      }
    }
  }

  async function savePreferences() {
    const form = document.querySelector('#preference-form');
    state.manualPreferences = Object.fromEntries(new FormData(form));
    state.preferences = CD.mergePreferences(state.manualPreferences, state.autoPreferences);
    await dashboard.storage.set({ jobSearchPreferences: state.manualPreferences });
    state.items = CD.rescore(state.items, state.preferences);
    await DB.replaceAll(state.items);
    render();
    dashboard.flash('匹配偏好已保存，岗位评分已更新。');
  }

  function showImport(trigger = null) {
    importTrigger = trigger && typeof trigger.focus === 'function' ? trigger : null;
    const dialog = document.querySelector('#import-dialog');
    const result = document.querySelector('#import-result');
    result.hidden = true;
    result.dataset.error = 'false';
    dialog.showModal();
    document.querySelector('#catalog-paste')?.focus();
  }

  function scheduleImportFocusRestore() {
    const trigger = importTrigger;
    importTrigger = null;
    if (!trigger) return;
    setTimeout(() => {
      if (trigger.isConnected) trigger.focus();
    }, 0);
  }

  function setPublicStatus(text, state = '', detail = '') {
    const status = document.querySelector('#public-sync-status');
    if (!status) return;
    const detailNode = document.querySelector('#public-sync-detail');
    status.textContent = text;
    status.dataset.state = state;
    if (detail) status.title = detail;
    else status.removeAttribute('title');
    if (detailNode) {
      detailNode.textContent = detail;
      detailNode.hidden = !detail;
    }
  }

  function publicSyncError(error) {
    const detail = String(error?.message || '');
    if (/failed to fetch|network|load failed|fetch/i.test(detail)) return '公共源暂不可用，已保留本地岗位；可稍后重试。';
    return `公共源同步失败：${detail || '请稍后重试。'}`;
  }

  function sourceHealth(sources) {
    const enabled = (Array.isArray(sources) ? sources : []).filter(source => source?.status !== 'disabled');
    const ok = enabled.filter(source => source?.status === 'ok');
    const failed = enabled.filter(source => source?.status !== 'ok');
    return {
      enabled: enabled.length,
      ok: ok.length,
      cached: enabled.filter(source=>source.status==='stale').map(source=>`${source.name || source.id}（最后成功 ${source.lastSuccessfulAt ? new Date(source.lastSuccessfulAt).toLocaleString('zh-CN') : '时间未知'}）`),
      failed: failed.map(source => source?.name || source?.id || '未知来源').slice(0, 5),
      errors: failed.map(source => {
        const name = source?.name || source?.id || '未知来源';
        return source?.error ? `${name}：${String(source.error).slice(0, 180)}` : name;
      }).slice(0, 5)
    };
  }

  function sourceHealthLabel(health) {
    if (!health?.enabled) return '';
    return `来源 ${health.ok}/${health.enabled} 正常`;
  }

  function sourceHealthDetail(health) {
    if (!health?.failed?.length) return '';
    const failed = health.errors?.length ? health.errors : health.failed;
    return `${health.cached?.length ? `使用上次成功缓存：${health.cached.join('；')}。` : ''}未成功来源：${failed.join('；')}。已保留来源缓存或当前浏览器中的旧岗位，请在投递前核实。`;
  }

  async function syncPublicFeed(force = false) {
    if (!force && lastPublicCheck && Date.now()-lastPublicCheck < 30*60*1000) return false;
    lastPublicCheck = Date.now();
    if (publicSyncing) {
      if (force) dashboard.flash('公共源正在同步，请稍候。');
      return false;
    }
    publicSyncing = true;
    const trigger = document.querySelector('#sync-public-catalog');
    if (trigger) trigger.disabled = true;
    try {
      const saved = await dashboard.storage.get(['publicCatalogSync']);
      const previous = saved.publicCatalogSync;
      setPublicStatus('正在同步 GitHub Actions 公共岗位源...', 'loading');
      const response = await fetch(`jobs.json?refresh=${Date.now()}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (response.status === 404) {
        setPublicStatus('当前为插件/本地模式，可手动导入；Pages 发布后将自动同步', 'local');
        return false;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 25 * 1024 * 1024) throw new Error('公共岗位源超过 25 MB');
      const content = await response.text();
      if (content.length > 25 * 1024 * 1024) throw new Error('公共岗位源超过 25 MB');
      const document = JSON.parse(content);
      const parsed = CD.rescore(document.jobs?.length === 0 ? [] : CD.parseImport(content), state.preferences);
      const successfulSourceIds = (document?.meta?.sources || []).filter(source => source.status === 'ok').map(source => source.id);
      const merged = CD.replacePublic(state.items, parsed, successfulSourceIds);
      if (merged.items.length > 50000) throw new Error('合并后岗位超过 50,000 条');
      await DB.replaceAll(merged.items);
      state.items = merged.items;
      const generatedAt = document?.meta?.generatedAt || '';
      const health = sourceHealth(document?.meta?.sources);
      const sync = { at: Date.now(), total: parsed.length, generatedAt, sources: health };
      await dashboard.storage.set({ publicCatalogSync: sync });
      const healthLabel = sourceHealthLabel(health);
      setPublicStatus(`公共源 ${parsed.length} 条${healthLabel ? ` · ${healthLabel}` : ''}，数据生成于 ${generatedAt ? new Date(generatedAt).toLocaleString('zh-CN') : '刚刚'} · 本机检查 ${new Date().toLocaleTimeString('zh-CN')}`, 'ready', sourceHealthDetail(health));
      render();
      if (force) dashboard.flash(`公共岗位已同步：新增 ${merged.added} 条，更新 ${merged.updated} 条。`);
      return true;
    } catch (error) {
      const message = publicSyncError(error);
      const rawDetail = String(error?.message || '').trim();
      const usefulDetail = rawDetail && !/failed to fetch|network|load failed|fetch/i.test(rawDetail) && rawDetail !== message ? rawDetail : '';
      setPublicStatus(message, 'error', usefulDetail);
      if (force) dashboard.flash('公共岗位暂时无法同步，请稍后重试；本地岗位未受影响。', true);
      return false;
    } finally {
      publicSyncing = false;
      if (trigger) trigger.disabled = false;
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
    for (const [key] of facetDefinitions) state.facets[key] = [];
    state.groupVisible = 40;
    document.querySelector('#global-search').value = '';
    state.province = state.city = state.jobType = state.companyType = state.platform = state.score = 'all';
    state.sort = 'match';
    state.visible = 200;
    document.querySelector('#catalog-search').value = '';
    document.querySelector('#catalog-company').value = '';
    document.querySelector('#catalog-province').value = 'all';
    document.querySelector('#catalog-city').value = 'all';
    document.querySelector('#catalog-type').value = 'all';
    document.querySelector('#catalog-company-type').value = 'all';
    document.querySelector('#catalog-platform').value = 'all';
    document.querySelector('#catalog-score').value = 'all';
    document.querySelector('#catalog-sort').value = 'match';
    render();
  }

  function installEvents() {
    document.querySelector('#open-import').addEventListener('click', event => showImport(event.currentTarget));
    document.querySelectorAll('[data-open-import]').forEach(button => button.addEventListener('click', event => showImport(event.currentTarget)));
    document.querySelector('#close-import').addEventListener('click', () => {
      document.querySelector('#import-dialog').close();
      scheduleImportFocusRestore();
    });
    document.querySelector('#cancel-import').addEventListener('click', () => {
      document.querySelector('#import-dialog').close();
      scheduleImportFocusRestore();
    });
    document.querySelector('#import-dialog').addEventListener('close', scheduleImportFocusRestore);
    document.querySelector('#import-form').addEventListener('submit', event => {
      event.preventDefault();
      importJobs().catch(error => dashboard.flash(error.message || '导入失败。', true));
    });
    document.querySelector('#download-template').addEventListener('click', downloadTemplate);
    document.querySelector('#clear-catalog').addEventListener('click', async () => {
      if (!confirm('确认清空当前浏览器中的全部岗位库数据？申请看板不会被删除。')) return;
      await DB.clear();
      await dashboard.storage.set({ publicCatalogSync: null });
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
    for (const [selector, key] of [['#catalog-province', 'province'], ['#catalog-city', 'city'], ['#catalog-type', 'jobType'], ['#catalog-company-type', 'companyType'], ['#catalog-platform', 'platform'], ['#catalog-score', 'score'], ['#catalog-sort', 'sort']]) {
      document.querySelector(selector).addEventListener('change', event => {
        state[key] = event.target.value;
        if (state.facets[key]) { state.facets[key] = event.target.value === 'all' ? [] : [event.target.value]; if (key === 'province') { state.city = 'all'; state.facets.city = []; } }
        state.visible = 200;
        render();
      });
    }
    document.querySelector('#reset-catalog-filters').addEventListener('click', resetFilters);
    document.querySelector('#catalog-more').addEventListener('click', () => { state.visible += 200; state.groupVisible += 40; renderTable(); });
    document.querySelector('#global-search').addEventListener('input', event => {
      if (document.querySelector('#view-catalog').hidden) return;
      state.query = event.target.value.trim();
      document.querySelector('#catalog-search').value = state.query;
      state.visible = 200;
      renderTable();
    });
    document.querySelector('#catalog-detail-close').addEventListener('click', () => {
      document.querySelector('#catalog-detail-dialog').close();
      scheduleDetailFocusRestore();
    });
    document.body.addEventListener('change', event => { if (event.target.matches('[data-facet-key]')) toggleFacet(event.target.dataset.facetKey, event.target.dataset.facetValue); });
    document.body.addEventListener('click', event => {
      const layout = event.target.closest('[data-catalog-layout]'); if (layout) { state.layout = layout.dataset.catalogLayout; renderTable(); return; }
      const role = event.target.closest('[data-role-type]'); if (role) { if (!role.dataset.roleType) { state.facets.jobType = []; renderTable(); } else toggleFacet('jobType', role.dataset.roleType); return; }
      const chip = event.target.closest('[data-remove-facet]'); if (chip) { toggleFacet(chip.dataset.removeFacet, chip.dataset.facetValue, false); return; }
      const clear = event.target.closest('[data-clear-facet]'); if (clear) { state.facets[clear.dataset.clearFacet] = []; renderTable(); return; }
      const query = event.target.closest('[data-clear-query]'); if (query) { state[query.dataset.clearQuery] = ''; document.querySelector(query.dataset.clearQuery === 'query' ? '#catalog-search' : '#catalog-company').value = ''; if (query.dataset.clearQuery === 'query') document.querySelector('#global-search').value=''; renderTable(); return; }

      const reset = event.target.closest('[data-reset-catalog]');
      if (reset) {
        resetFilters();
        return;
      }
      const companyFilter = event.target.closest('[data-company-filter]');
      if (companyFilter) {
        filterCompany(companyFilter.dataset.companyFilter);
        return;
      }
      const details = event.target.closest('[data-catalog-details]');
      if (details) {
        const job = state.items.find(item => item.id === details.dataset.catalogDetails);
        if (job) {
          detailTrigger = details;
          openDetails(job);
        }
        return;
      }
      const track = event.target.closest('[data-catalog-track]');
      if (track) {
        const job = state.items.find(item => item.id === track.dataset.catalogTrack);
        if (job && !track.disabled) dashboard.addFromCatalog(job).then(() => { renderTable(); document.querySelector('#catalog-detail-dialog').open && document.querySelector('#catalog-detail-dialog').close(); }).catch(error => dashboard.flash(error.message, true));
      }
    });
    document.querySelector('#catalog-detail-dialog').addEventListener('close', () => {
      scheduleDetailFocusRestore();
    });
  }

  async function load() {
    await globalThis.WorkbenchAccount?.ready;
    const saved = await dashboard.storage.get(['jobSearchPreferences', 'resumeAutoPreferences', 'resumeProfiles', 'activeProfileId', 'activeProfileLabel', 'profile', 'experiences']);
    state.manualPreferences = { ...state.manualPreferences, ...(saved.jobSearchPreferences || {}) };
    const storedAutomatic = saved.resumeAutoPreferences && Object.values(saved.resumeAutoPreferences).some(Boolean)
      ? saved.resumeAutoPreferences : CD.deriveResumePreferences(saved);
    state.autoPreferences = { ...state.autoPreferences, ...storedAutomatic };
    state.preferences = CD.mergePreferences(state.manualPreferences, state.autoPreferences);
    const form = document.querySelector('#preference-form');
    for (const [key, value] of Object.entries(state.manualPreferences)) form.elements.namedItem(key).value = value;
    dashboard.setResumeSyncStatus?.(saved);
    const storedItems = await DB.getAll();
    state.items = storedItems.map(value => CD.item(value)).filter(Boolean);
    if (storedItems.length && state.items.length) await DB.replaceAll(state.items);
    if (!state.items.length) {
      const tracked = dashboard.getItems().map(job => ({ ...job, platform: job.source === 'extension' ? '投简历助手' : job.source === 'catalog' ? '岗位库' : '手动记录', jobType: '校招', description: job.notes }));
      const merged = CD.merge([], tracked);
      state.items = CD.rescore(merged.items, state.preferences);
      if (state.items.length) await DB.putMany(state.items);
    }
    render();
    await syncPublicFeed(false);
  }

  async function syncResumeProfile(saved, announce = true) {
    if (!catalogReady) {
      pendingResumeSync = true;
      return false;
    }
    const generation = ++resumeSyncGeneration;
    const automatic = CD.deriveResumePreferences(saved);
    state.autoPreferences = automatic;
    state.preferences = CD.mergePreferences(state.manualPreferences, automatic);
    await dashboard.storage.set({ resumeAutoPreferences: automatic });
    if (generation !== resumeSyncGeneration) return false;
    state.items = CD.rescore(state.items, state.preferences);
    await DB.replaceAll(state.items);
    dashboard.setResumeSyncStatus?.(saved);
    render();
    if (announce && (saved.activeProfileLabel || saved.profile || saved.experiences)) dashboard.flash(`已同步“${saved.activeProfileLabel || '当前'}”简历，岗位匹配分已更新。`);
  }

  async function readPdfText(file) {
    const pdfjs = await import('./vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    const pdf = await task.promise;
    try {
      if (pdf.numPages > 40) throw new Error('PDF 超过 40 页，请使用精简版简历。');
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim());
      }
      return pages.join('\n\n');
    } finally { await task.destroy(); }
  }

  async function readResumeText(file) {
    if (file.size > 10 * 1024 * 1024) throw new Error('待解析简历超过 10 MB。');
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'txt') return file.text();
    if (extension === 'pdf') return readPdfText(file);
    if (extension === 'docx') {
      if (!globalThis.mammoth?.extractRawText) throw new Error('DOCX 解析组件未加载，请刷新页面后重试。');
      return (await globalThis.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    }
    throw new Error('仅支持 PDF、DOCX 或 TXT 简历。');
  }

  function resumeSummary(parsed) {
    const counts = parsed.experiences;
    return `识别 ${parsed.meta.detectedFields} 项基础资料、${counts.work.length} 段工作、${counts.education.length} 段教育、${counts.projects.length} 段项目及 ${counts.competitions.length + counts.awards.length + counts.campus.length + counts.languages.length + counts.publications.length} 条其他经历。`;
  }

  async function applyDashboardResume() {
    if (!resumeCandidate) throw new Error('请先选择并解析简历。');
    const label = resumeCandidate.fileName.replace(/\.[^.]+$/, '').trim().slice(0, 80) || '网页导入简历';
    const saved = await dashboard.storage.get(['profile', 'experiences', 'resumeProfiles', 'activeProfileId', 'activeProfileLabel']);
    const profileValues = Object.fromEntries((globalThis.ResumeData ? ResumeData.fields : Object.keys(resumeCandidate.profile)).map(key => [key, resumeCandidate.profile[key] || saved.profile?.[key] || '']));
    const profile = globalThis.ResumeData ? ResumeData.profile(profileValues) : profileValues;
    const experiences = globalThis.ResumeData ? ResumeData.experiences(resumeCandidate.experiences) : resumeCandidate.experiences;
    const profiles = Array.isArray(saved.resumeProfiles) ? saved.resumeProfiles : [];
    const activeId = saved.activeProfileId || profiles[0]?.id || '';
    const active = profiles.find(item => item.id === activeId);
    const patch = { profile, experiences, activeProfileLabel: label };
    if (active) {
      patch.resumeProfiles = profiles.map(item => item.id === active.id ? { ...item, profile, experiences, label: item.label || label, updatedAt: Date.now() } : item);
      patch.activeProfileId = active.id;
      patch.activeProfileLabel = active.label || label;
    }
    await dashboard.storage.set(patch);
    await syncResumeProfile({ ...saved, ...patch }, false);
    document.querySelector('#dashboard-resume-status').textContent = `已应用“${patch.activeProfileLabel}”，岗位匹配分已更新。`;
    document.querySelector('#dashboard-resume-apply').disabled = true;
    resumeCandidate = null;
  }

  function installResumeUpload() {
    const input = document.querySelector('#dashboard-resume-file');
    const apply = document.querySelector('#dashboard-resume-apply');
    if (!input || !apply) return;
    input.addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      resumeCandidate = null;
      apply.disabled = true;
      const status = document.querySelector('#dashboard-resume-status');
      const preview = document.querySelector('#dashboard-resume-preview');
      preview.hidden = true;
      status.textContent = '正在本地读取并分类简历…';
      readResumeText(file).then(text => {
        if (!globalThis.ResumeParser?.parseResumeText) throw new Error('简历解析组件未加载。');
        const parsed = ResumeParser.parseResumeText(text);
        resumeCandidate = { ...parsed, fileName: file.name };
        preview.textContent = resumeSummary(parsed);
        preview.hidden = false;
        apply.disabled = false;
        status.textContent = '分类完成，请检查识别结果后应用。';
      }).catch(error => { status.textContent = `解析失败：${error.message}`; }).finally(() => { input.value = ''; });
    });
    apply.addEventListener('click', () => applyDashboardResume().catch(error => dashboard.flash(`简历应用失败：${error.message}`, true)));
  }

  renderEmployerDirectories();
  installEvents();
  installResumeUpload();
  load().then(async () => {
    catalogReady = true;
    if (!pendingResumeSync) return;
    pendingResumeSync = false;
    const saved = await dashboard.storage.get(['resumeProfiles', 'activeProfileId', 'activeProfileLabel', 'profile', 'experiences']);
    await syncResumeProfile(saved);
  }).catch(error => dashboard.flash(`读取岗位库失败：${error.message}`, true));

  if (globalThis.chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const resumeKeys = ['resumeProfiles', 'activeProfileId', 'activeProfileLabel', 'profile', 'experiences'];
      if (!resumeKeys.some(key => changes[key])) return;
      dashboard.storage.get(resumeKeys).then(saved => syncResumeProfile(saved)).catch(error => dashboard.flash(`简历同步失败：${error.message}`, true));
    });
  }
  window.addEventListener('online', () => catalogReady && syncPublicFeed(false));
  document.addEventListener('visibilitychange', () => !document.hidden && catalogReady && syncPublicFeed(false));
  setInterval(() => { if (!document.hidden && catalogReady) syncPublicFeed(false); }, 30*60*1000);
  window.addEventListener('resume-profile-updated', event => !globalThis.WorkbenchAccount?.active && syncResumeProfile(event.detail || {}).catch(error => dashboard.flash(`简历同步失败：${error.message}`, true)));
})();
