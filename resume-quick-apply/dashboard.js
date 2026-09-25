(() => {
  const TD = globalThis.TrackerData;
  const storage = createStorage();
  const state = { items: [], query: '', view: 'catalog', boardPriority: 'all', jobsStage: 'all', jobsSort: 'updated' };
  const stageById = Object.fromEntries(TD.stages.map(stage => [stage.id, stage]));
  const stageColors = { watch: '#75838b', preparing: '#ad741b', applied: '#3970cf', assessment: '#7459b7', interview: '#bd6b19', offer: '#24805d', closed: '#8b9499' };
  const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' });
  const dateTimeFormat = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const weekdayFormat = new Intl.DateTimeFormat('zh-CN', { weekday: 'long' });

  function createStorage() {
    if (globalThis.chrome?.storage?.local) return chrome.storage.local;
    return {
      async get(keys) {
        return Object.fromEntries(keys.map(key => {
          try { return [key, JSON.parse(localStorage.getItem(key))]; }
          catch { return [key, undefined]; }
        }));
      },
      async set(patch) {
        for (const [key, value] of Object.entries(patch)) localStorage.setItem(key, JSON.stringify(value));
      }
    };
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name, alt = '') {
    const image = document.createElement('img');
    image.src = `icons/${name}.svg`;
    image.alt = alt;
    return image;
  }

  function flash(message, error = false) {
    const toast = document.querySelector('#toast');
    toast.textContent = message;
    toast.dataset.error = String(error);
    toast.hidden = false;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function setResumeSyncStatus(saved = {}) {
    const node = document.querySelector('#resume-sync-status');
    const label = typeof saved.activeProfileLabel === 'string' ? saved.activeProfileLabel.trim() : '';
    const profiles = Array.isArray(saved.resumeProfiles) ? saved.resumeProfiles : [];
    const active = profiles.find(item => item?.id === saved.activeProfileId) || profiles.find(item => item?.label === label);
    const hasValue = value => {
      if (typeof value === 'string') return Boolean(value.trim());
      if (Array.isArray(value)) return value.some(hasValue);
      if (value && typeof value === 'object') return Object.values(value).some(hasValue);
      return false;
    };
    const hasResumeData = hasValue(saved.profile) || hasValue(saved.resume) || hasValue(saved.experiences)
      || hasValue(active?.profile) || hasValue(active?.resume) || hasValue(active?.experiences);
    const profileStatus = document.querySelector('#profile-resume-status');
    const profileEntryStatus = document.querySelector('#profile-entry-status');
    if (profileStatus) profileStatus.textContent = hasResumeData ? '已同步' : '未同步';
    if (profileEntryStatus && !document.querySelector('#profile-center-name')?.textContent?.startsWith('@')) {
      profileEntryStatus.textContent = hasResumeData ? '简历已同步' : '本地模式';
    }
    if (!node) return;
    if (!hasResumeData) {
      node.textContent = '尚未检测到插件简历';
      node.dataset.state = 'empty';
      return;
    }
    const updatedAt = Number(active?.updatedAt);
    const stamp = Number.isFinite(updatedAt) ? ` · 最近同步 ${dateTimeFormat.format(new Date(updatedAt))}` : '';
    node.textContent = `插件简历已同步：${label || active?.label || '当前档案'}${stamp}`;
    node.dataset.state = 'ready';
  }

  function renderProfileCenter() {
    const summary = TD.summary(state.items);
    const total = document.querySelector('#profile-job-count');
    const active = document.querySelector('#profile-active-count');
    if (total) total.textContent = String(summary.total);
    if (active) active.textContent = String(summary.active);
    const avatar = document.querySelector('#profile-avatar');
    const name = document.querySelector('#profile-center-name')?.textContent || '本地求职者';
    if (avatar) avatar.textContent = name.startsWith('@') ? name.slice(1, 3).toUpperCase() : '我';
  }

  function initials(company) {
    const value = company.replace(/(?:有限公司|集团|科技|网络|公司)$/g, '').trim();
    return (value.match(/[\p{Script=Han}A-Za-z0-9]/gu) || ['?']).slice(0, 2).join('').toUpperCase();
  }

  function formatDate(value, withTime = false) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '未安排';
    return (withTime ? dateTimeFormat : dateFormat).format(date);
  }

  function dateTimeValue(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function relativeTime(value) {
    if (!value) return '未安排下一步';
    const target = new Date(value);
    if (!Number.isFinite(target.getTime())) return '未安排下一步';
    const diff = target.getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return `已逾期 ${Math.abs(days)} 天`;
    if (days === 0) return `今天 ${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;
    if (days === 1) return '明天';
    if (days <= 7) return `${days} 天后`;
    return formatDate(target);
  }

  function itemMatches(entry) {
    if (!state.query) return true;
    const haystack = [entry.title, entry.company, entry.location, entry.companyType, entry.jobType, entry.platform, entry.notes, stageById[entry.stage]?.label].join(' ').toLowerCase();
    return haystack.includes(state.query);
  }

  function filteredItems() {
    return state.items.filter(itemMatches);
  }

  function stageBadge(stageId) {
    const badge = element('span', 'stage-badge', stageById[stageId]?.label || '关注');
    badge.dataset.stage = stageId;
    return badge;
  }

  async function persist(message) {
    await storage.set({ jobTrackerItems: state.items });
    if (message) flash(message);
  }

  function renderAll() {
    const summary = TD.summary(state.items);
    document.querySelector('#nav-active-count').textContent = String(summary.active);
    renderOverview();
    renderBoard();
    renderJobs();
    renderCompanies();
    renderCalendar();
    renderProfileCenter();
  }

  function renderOverview() {
    const list = filteredItems();
    const summary = TD.summary(list);
    document.querySelector('#metric-total').textContent = summary.total;
    document.querySelector('#metric-week').textContent = `本周新增 ${summary.thisWeek}`;
    document.querySelector('#metric-active').textContent = summary.active;
    document.querySelector('#metric-interview').textContent = summary.interviews;
    document.querySelector('#metric-offer').textContent = summary.offers;
    document.querySelector('#metric-rate').textContent = `整体回应率 ${summary.responseRate}%`;
    document.querySelector('#overview-caption').textContent = summary.total
      ? `当前管理 ${summary.total} 个岗位，${summary.active} 个仍在推进。`
      : '从新增岗位开始，或使用插件投递后自动同步。';
    const nextInterview = list.map(entry => entry.interviewAt).filter(Boolean).map(value => new Date(value)).filter(date => date >= new Date()).sort((a, b) => a - b)[0];
    document.querySelector('#metric-upcoming').textContent = nextInterview ? `最近 ${formatDate(nextInterview, true)}` : '暂无近期面试';
    renderTrend(list);
    renderFunnel(summary);
    renderRecent(list);
    renderSchedule('#schedule-list', scheduleEvents(list).slice(0, 5), true);
  }

  function renderTrend(items) {
    const root = document.querySelector('#trend-chart');
    root.replaceChildren();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - index));
      const end = date.getTime() + 86400000;
      return { date, count: items.filter(entry => entry.createdAt >= date.getTime() && entry.createdAt < end).length };
    });
    const max = Math.max(1, ...days.map(day => day.count));
    for (const day of days) {
      const column = element('div', 'trend-day');
      const wrap = element('div', 'trend-bar-wrap');
      const bar = element('div', 'trend-bar');
      bar.style.height = `${Math.max(day.count ? 12 : 4, day.count / max * 100)}%`;
      bar.title = `${formatDate(day.date)}：${day.count} 个岗位`;
      if (day.count) bar.append(element('span', '', String(day.count)));
      wrap.append(bar);
      column.append(wrap, element('small', '', `${day.date.getMonth() + 1}/${day.date.getDate()}`));
      root.append(column);
    }
    document.querySelector('#trend-total').textContent = `${days.reduce((sum, day) => sum + day.count, 0)} 次`;
  }

  function renderFunnel(summary) {
    const root = document.querySelector('#funnel-list');
    root.replaceChildren();
    const funnel = [
      ['applied', '已投递'], ['assessment', '笔试'], ['interview', '面试'], ['offer', 'Offer']
    ];
    const max = Math.max(1, ...funnel.map(([stage]) => summary.counts[stage]));
    for (const [stage, label] of funnel) {
      const row = element('div', 'funnel-row');
      row.append(element('span', '', label));
      const track = element('div', 'funnel-track');
      const bar = element('span');
      bar.style.width = `${summary.counts[stage] / max * 100}%`;
      bar.style.setProperty('--bar-color', stageColors[stage]);
      track.append(bar);
      row.append(track, element('b', '', String(summary.counts[stage])));
      root.append(row);
    }
  }

  function renderRecent(items) {
    const root = document.querySelector('#recent-list');
    root.replaceChildren();
    const recent = [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
    if (!recent.length) return root.append(empty('还没有岗位记录'));
    for (const entry of recent) {
      const row = element('div', 'recent-item');
      row.append(element('span', 'company-avatar', initials(entry.company)));
      const copy = element('div', 'item-copy');
      copy.append(element('strong', '', entry.title), element('small', '', `${entry.company}${entry.location ? ` · ${entry.location}` : ''}`));
      row.append(copy, stageBadge(entry.stage));
      row.dataset.editId = entry.id;
      row.title = '点击编辑岗位';
      root.append(row);
    }
  }

  function scheduleEvents(items) {
    const events = [];
    for (const entry of items) {
      if (entry.interviewAt) events.push({ entry, at: entry.interviewAt, type: '面试' });
      if (entry.nextActionAt && entry.nextActionAt !== entry.interviewAt) events.push({ entry, at: entry.nextActionAt, type: entry.stage === 'assessment' ? '笔试 / 测评' : '主动跟进' });
      if (entry.deadline) events.push({ entry, at: `${entry.deadline}T23:59`, type: '申请截止' });
    }
    return events.filter(event => Number.isFinite(new Date(event.at).getTime())).sort((a, b) => new Date(a.at) - new Date(b.at));
  }

  function renderSchedule(selector, events, compact = false) {
    const root = document.querySelector(selector);
    root.replaceChildren();
    if (!events.length) return root.append(empty('还没有安排，给重点岗位设置下一步时间'));
    for (const event of events) {
      const row = element('div', compact ? 'schedule-item' : 'timeline-item');
      if (compact) {
        row.append(element('span', 'company-avatar', String(new Date(event.at).getDate()).padStart(2, '0')));
        const copy = element('div', 'item-copy');
        copy.append(element('strong', '', `${event.type} · ${event.entry.title}`), element('small', '', `${event.entry.company} · ${formatDate(event.at, true)}`));
        row.append(copy, stageBadge(event.entry.stage));
      } else {
        const when = element('div', 'timeline-time');
        when.append(element('strong', '', formatDate(event.at)), document.createTextNode(new Date(event.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })));
        const copy = element('div', 'timeline-copy');
        copy.append(element('strong', '', `${event.type} · ${event.entry.title}`), element('span', '', `${event.entry.company}${event.entry.location ? ` · ${event.entry.location}` : ''}`));
        row.append(when, element('span', 'timeline-marker'), copy);
      }
      row.dataset.editId = event.entry.id;
      row.title = '点击编辑岗位';
      root.append(row);
    }
  }

  function empty(message) {
    return element('div', 'empty-state', message);
  }

  function renderBoard() {
    const root = document.querySelector('#kanban');
    root.replaceChildren();
    const candidates = filteredItems().filter(entry => state.boardPriority === 'all' || entry.priority === state.boardPriority);
    for (const stage of TD.stages) {
      const column = element('section', 'kanban-column');
      column.dataset.stage = stage.id;
      const head = element('div', 'column-head');
      const title = element('div', 'column-title');
      const dot = element('span', 'column-dot');
      dot.style.setProperty('--column-color', stageColors[stage.id]);
      const stageItems = candidates.filter(entry => entry.stage === stage.id).sort((a, b) => b.updatedAt - a.updatedAt);
      title.append(dot, element('strong', '', stage.label));
      head.append(title, element('span', 'column-count', String(stageItems.length)));
      const body = element('div', 'column-body');
      body.dataset.stage = stage.id;
      for (const entry of stageItems) body.append(jobCard(entry));
      column.append(head, body);
      root.append(column);
    }
  }

  function jobCard(entry) {
    const card = element('article', `job-card priority-${entry.priority}`);
    card.draggable = true;
    card.dataset.id = entry.id;
    const head = element('div', 'job-card-head');
    const title = element('div');
    title.append(element('h3', '', entry.title), element('span', 'job-company', entry.company));
    const edit = element('button', 'icon-button job-card-menu');
    edit.type = 'button';
    edit.title = '编辑岗位';
    edit.setAttribute('aria-label', `编辑 ${entry.title}`);
    edit.dataset.editId = entry.id;
    edit.append(icon('more-horizontal'));
    head.append(title, edit);
    card.append(head);
    const meta = element('div', 'job-meta');
    if (entry.location) {
      const location = element('span');
      location.append(icon('building-2'), document.createTextNode(entry.location));
      meta.append(location);
    }
    if (entry.salary) meta.append(element('span', '', entry.salary));
    if (entry.companyType) meta.append(element('span', '', entry.companyType));
    if (entry.jobType) meta.append(element('span', '', entry.jobType));
    if (entry.platform) meta.append(element('span', '', entry.platform));
    meta.append(element('span', '', entry.source === 'extension' ? '插件同步' : entry.source === 'catalog' ? '岗位库' : '手动添加'));
    if (entry.resumeProfileLabel) meta.append(element('span', '', `简历：${entry.resumeProfileLabel}`));
    card.append(meta);
    const next = element('div', 'job-next');
    const nextValue = entry.interviewAt || entry.nextActionAt || entry.deadline;
    if (nextValue && new Date(nextValue).getTime() < Date.now()) next.classList.add('overdue');
    next.append(element('span', '', relativeTime(nextValue)), element('span', '', formatDate(entry.updatedAt)));
    card.append(next);
    return card;
  }

  function renderJobs() {
    let list = filteredItems().filter(entry => state.jobsStage === 'all' || entry.stage === state.jobsStage);
    list = [...list].sort((a, b) => state.jobsSort === 'company'
      ? a.company.localeCompare(b.company, 'zh-CN')
      : state.jobsSort === 'created' ? b.createdAt - a.createdAt : b.updatedAt - a.updatedAt);
    document.querySelector('#jobs-count').textContent = `共 ${list.length} 个岗位`;
    const root = document.querySelector('#jobs-table');
    root.replaceChildren();
    if (!list.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.append(empty('没有符合当前条件的岗位'));
      row.append(cell);
      return root.append(row);
    }
    for (const entry of list) {
      const row = document.createElement('tr');
      const identity = document.createElement('td');
      const copy = element('div', 'table-job');
      const labels = [entry.company, entry.companyType, entry.jobType, entry.resumeProfileLabel ? `简历：${entry.resumeProfileLabel}` : ''].filter(Boolean);
      copy.append(element('strong', '', entry.title), element('span', '', labels.join(' · ')));
      identity.append(copy);
      const stage = document.createElement('td');
      stage.append(stageBadge(entry.stage));
      const location = element('td', '', entry.location || '—');
      const next = element('td', '', relativeTime(entry.interviewAt || entry.nextActionAt || entry.deadline));
      const updated = element('td', '', formatDate(entry.updatedAt));
      const actionsCell = document.createElement('td');
      const actions = element('div', 'row-actions');
      if (entry.url) {
        const link = document.createElement('a');
        link.className = 'icon-button';
        link.href = entry.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = '打开投递页面';
        link.append(icon('arrow-up-right'));
        actions.append(link);
      }
      const edit = element('button', 'icon-button');
      edit.type = 'button';
      edit.title = '编辑岗位';
      edit.dataset.editId = entry.id;
      edit.append(icon('pencil'));
      actions.append(edit);
      actionsCell.append(actions);
      row.append(identity, stage, location, next, updated, actionsCell);
      root.append(row);
    }
  }

  function renderCompanies() {
    const groups = new Map();
    for (const entry of filteredItems()) {
      const group = groups.get(entry.company) || { company: entry.company, items: [], latest: 0 };
      group.items.push(entry);
      group.latest = Math.max(group.latest, entry.updatedAt);
      groups.set(entry.company, group);
    }
    const companies = [...groups.values()].sort((a, b) => b.latest - a.latest);
    document.querySelector('#companies-count').textContent = `共 ${companies.length} 家公司`;
    const root = document.querySelector('#company-grid');
    root.replaceChildren();
    if (!companies.length) return root.append(empty('还没有公司记录'));
    for (const company of companies) {
      const card = element('article', 'company-card');
      const head = element('div', 'company-card-head');
      head.append(element('span', 'company-avatar', initials(company.company)));
      const copy = element('div', 'company-card-copy');
      copy.append(element('strong', '', company.company), element('span', '', `${company.items.length} 个岗位 · 最近更新 ${formatDate(company.latest)}`));
      head.append(copy);
      const stageList = element('div', 'company-stage-list');
      for (const stage of TD.stages) {
        const count = company.items.filter(entry => entry.stage === stage.id).length;
        if (count) stageList.append(element('span', '', `${stage.label} ${count}`));
      }
      card.append(head, stageList);
      root.append(card);
    }
  }

  function renderCalendar() {
    const today = new Date();
    document.querySelector('#today-month').textContent = `${today.getFullYear()} / ${String(today.getMonth() + 1).padStart(2, '0')}`;
    document.querySelector('#today-day').textContent = String(today.getDate()).padStart(2, '0');
    document.querySelector('#today-weekday').textContent = weekdayFormat.format(today);
    renderSchedule('#timeline', scheduleEvents(filteredItems()), false);
  }

  function setSidebarOpen(open) {
    const sidebar = document.querySelector('#sidebar');
    const toggle = document.querySelector('#mobile-menu');
    const backdrop = document.querySelector('#sidebar-backdrop');
    if (!sidebar) return;
    const isOpen = Boolean(open);
    const isMobile = Boolean(window.matchMedia?.('(max-width: 760px)').matches);
    sidebar.classList.toggle('open', isOpen);
    sidebar.toggleAttribute('inert', isMobile && !isOpen);
    sidebar.setAttribute('aria-hidden', String(isMobile && !isOpen));
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? '关闭导航' : '打开导航');
      toggle.title = isOpen ? '关闭导航' : '打开导航';
    }
    if (backdrop) {
      backdrop.hidden = !isOpen;
      backdrop.setAttribute('aria-hidden', String(!isOpen));
    }
  }

  function showView(name) {
    const view = document.querySelector(`#view-${name}`);
    if (!view) return;
    const sidebar = document.querySelector('#sidebar');
    const wasSidebarOpen = sidebar?.classList.contains('open');
    state.view = name;
    for (const candidate of document.querySelectorAll('.view')) candidate.hidden = candidate !== view;
    for (const item of document.querySelectorAll('[data-view]')) item.classList.toggle('active', item.dataset.view === name);
    document.querySelector('#view-title').textContent = view.dataset.title;
    setSidebarOpen(false);
    if (wasSidebarOpen) document.querySelector('#mobile-menu')?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openEditor(entry) {
    const form = document.querySelector('#job-form');
    form.reset();
    form.elements.namedItem('priority').value = 'normal';
    document.querySelector('#job-id').value = entry?.id || '';
    document.querySelector('#dialog-title').textContent = entry ? '编辑岗位' : '新增岗位';
    document.querySelector('#delete-job').hidden = !entry;
    if (entry) {
      for (const key of ['company', 'title', 'stage', 'priority', 'location', 'salary', 'url', 'deadline', 'notes']) {
        form.elements.namedItem(key).value = entry[key] || '';
      }
      form.elements.namedItem('nextActionAt').value = dateTimeValue(entry.nextActionAt);
      form.elements.namedItem('interviewAt').value = dateTimeValue(entry.interviewAt);
    }
    document.querySelector('#job-dialog').showModal();
    form.elements.namedItem('company').focus();
  }

  function closeEditor() {
    document.querySelector('#job-dialog').close();
  }

  async function saveForm() {
    const form = document.querySelector('#job-form');
    const values = Object.fromEntries(new FormData(form));
    const existing = state.items.find(entry => entry.id === values.id);
    const now = Date.now();
    const candidate = TD.item({
      ...existing,
      ...values,
      id: existing?.id || `job-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      source: existing?.source || 'manual',
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    if (!candidate) throw new Error('岗位数据格式不正确。');
    if (existing) state.items = state.items.map(entry => entry.id === candidate.id ? candidate : entry);
    else state.items.unshift(candidate);
    await persist(existing ? '岗位已更新。' : '岗位已添加。');
    closeEditor();
    renderAll();
  }

  async function deleteCurrent() {
    const id = document.querySelector('#job-id').value;
    const entry = state.items.find(item => item.id === id);
    if (!entry || !confirm(`确认删除“${entry.company} · ${entry.title}”？`)) return;
    state.items = state.items.filter(item => item.id !== id);
    await persist('岗位已删除。');
    closeEditor();
    renderAll();
  }

  async function moveJob(id, stage) {
    if (!stageById[stage]) return;
    const target = state.items.find(entry => entry.id === id);
    if (!target || target.stage === stage) return;
    target.stage = stage;
    target.updatedAt = Date.now();
    state.items = TD.items(state.items);
    await persist(`已移至“${stageById[stage].label}”。`);
    renderAll();
  }

  async function addFromCatalog(job) {
    const duplicate = state.items.find(entry => (job.url && entry.url === job.url) || (entry.company === job.company && entry.title === job.title));
    if (duplicate) {
      flash('这个岗位已经在申请看板中。');
      showView('board');
      return false;
    }
    const now = Date.now();
    const entry = TD.item({
      id: `tracked-${job.id}`,
      company: job.company,
      title: job.title,
      location: job.location,
      url: job.url,
      deadline: job.deadline,
      notes: job.description,
      companyType: job.companyType,
      jobType: job.jobType,
      platform: job.platform,
      stage: 'watch',
      priority: Number.isFinite(job.matchScore) && job.matchScore >= 70 ? 'high' : 'normal',
      source: 'catalog',
      createdAt: now,
      updatedAt: now
    });
    state.items.unshift(entry);
    await persist('已加入申请看板。');
    renderAll();
    showView('board');
    return true;
  }

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function exportJobs() {
    const rows = [['公司', '岗位', '企业类型', '岗位分类', '来源平台', '阶段', '优先级', '地点', '薪资', '截止日期', '下一步时间', '面试时间', '使用简历档案', '链接', '备注'], ...state.items.map(entry => [
      entry.company, entry.title, entry.companyType, entry.jobType, entry.platform, stageById[entry.stage]?.label || '', entry.priority, entry.location, entry.salary, entry.deadline,
      entry.nextActionAt, entry.interviewAt, entry.resumeProfileLabel, entry.url, entry.notes
    ])];
    if (rows.length === 1) return flash('还没有可导出的岗位。', true);
    const blob = new Blob(['\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `秋招工作台-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash(`已导出 ${state.items.length} 个岗位。`);
  }

  function installEvents() {
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
    document.querySelectorAll('[data-go-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.goView)));
    const mobileMenu = document.querySelector('#mobile-menu');
    const sidebar = document.querySelector('#sidebar');
    mobileMenu.addEventListener('click', () => setSidebarOpen(!sidebar.classList.contains('open')));
    document.querySelector('#sidebar-backdrop')?.addEventListener('click', () => {
      setSidebarOpen(false);
      mobileMenu.focus();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !sidebar.classList.contains('open')) return;
      setSidebarOpen(false);
      mobileMenu.focus();
    });
    document.querySelector('#new-job').addEventListener('click', () => openEditor());
    document.querySelector('#close-dialog').addEventListener('click', closeEditor);
    document.querySelector('#cancel-dialog').addEventListener('click', closeEditor);
    document.querySelector('#delete-job').addEventListener('click', () => deleteCurrent().catch(error => flash(error.message, true)));
    document.querySelector('#job-form').addEventListener('submit', event => {
      event.preventDefault();
      saveForm().catch(error => flash(error.message || '保存失败。', true));
    });
    document.querySelector('#global-search').addEventListener('input', event => {
      state.query = event.target.value.trim().toLowerCase();
      renderAll();
    });
    document.querySelector('#board-priority').addEventListener('change', event => { state.boardPriority = event.target.value; renderBoard(); });
    document.querySelector('#jobs-stage').addEventListener('change', event => { state.jobsStage = event.target.value; renderJobs(); });
    document.querySelector('#jobs-sort').addEventListener('change', event => { state.jobsSort = event.target.value; renderJobs(); });
    document.querySelector('#export-jobs').addEventListener('click', exportJobs);
    document.body.addEventListener('click', event => {
      const target = event.target.closest('[data-edit-id]');
      if (!target) return;
      const entry = state.items.find(item => item.id === target.dataset.editId);
      if (entry) openEditor(entry);
    });
    document.querySelector('#kanban').addEventListener('dragstart', event => {
      const card = event.target.closest('.job-card');
      if (!card || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.dataset.id);
    });
    document.querySelector('#kanban').addEventListener('dragover', event => {
      const column = event.target.closest('.kanban-column');
      if (!column) return;
      event.preventDefault();
      document.querySelectorAll('.kanban-column').forEach(item => item.classList.toggle('drag-over', item === column));
    });
    document.querySelector('#kanban').addEventListener('dragleave', event => {
      const column = event.target.closest('.kanban-column');
      if (column && !column.contains(event.relatedTarget)) column.classList.remove('drag-over');
    });
    document.querySelector('#kanban').addEventListener('drop', event => {
      const column = event.target.closest('.kanban-column');
      document.querySelectorAll('.kanban-column').forEach(item => item.classList.remove('drag-over'));
      if (!column || !event.dataTransfer) return;
      event.preventDefault();
      moveJob(event.dataTransfer.getData('text/plain'), column.dataset.stage).catch(error => flash(error.message, true));
    });
    document.querySelector('#open-popup').addEventListener('click', () => {
      if (globalThis.chrome?.runtime?.id && globalThis.chrome?.tabs?.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      } else showView('sources');
    });
    document.querySelector('#profile-open-popup').addEventListener('click', () => {
      if (globalThis.chrome?.runtime?.id && globalThis.chrome?.tabs?.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
      } else showView('sources');
    });
    setSidebarOpen(false);
    window.addEventListener('resize', () => {
      if (!sidebar.classList.contains('open')) setSidebarOpen(false);
    });
  }

  function populateStages() {
    const formStage = document.querySelector('#form-stage');
    const jobsStage = document.querySelector('#jobs-stage');
    for (const stage of TD.stages) {
      const option = document.createElement('option');
      option.value = stage.id;
      option.textContent = stage.label;
      formStage.append(option);
      jobsStage.append(option.cloneNode(true));
    }
  }

  async function load() {
    const saved = await storage.get(['jobTrackerItems', 'applications', 'resumeProfiles', 'activeProfileId', 'activeProfileLabel', 'profile', 'experiences']);
    setResumeSyncStatus(saved);
    const merged = TD.mergeApplications(saved.jobTrackerItems, saved.applications);
    state.items = merged.items;
    if (merged.added || !Array.isArray(saved.jobTrackerItems)) await storage.set({ jobTrackerItems: state.items });
    renderAll();
    if (merged.added) flash(`已从插件同步 ${merged.added} 个新岗位。`);
  }

  populateStages();
  installEvents();
  globalThis.JobTrackerDashboard = {
    addFromCatalog,
    showView,
    flash,
    getItems: () => [...state.items],
    storage,
    setResumeSyncStatus
  };
  load().catch(error => flash(`读取工作台失败：${error.message}`, true));

  if (globalThis.chrome?.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const resumeKeys = ['resumeProfiles', 'activeProfileId', 'activeProfileLabel', 'profile', 'experiences'];
      if (resumeKeys.some(key => changes[key])) storage.get(resumeKeys).then(setResumeSyncStatus).catch(() => {});
      if (!changes.applications) return;
      const merged = TD.mergeApplications(state.items, changes.applications.newValue);
      if (!merged.added) return;
      state.items = merged.items;
      persist(`已同步 ${merged.added} 个新岗位。`).then(renderAll).catch(error => flash(error.message, true));
    });
  }
})();
