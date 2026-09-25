(() => {
  if (globalThis.__resumeQuickApplyLoaded) return;
  globalThis.__resumeQuickApplyLoaded = true;
  const ROOT_ID = 'resume-quick-apply-root';
  let uiRoot = null;
  let lastResumeProfile = null;
  const fieldPatterns = {
    name: /姓名|名字|full.?name|candidate.?name|real.?name|legal.?name|(^|\s)name(\s|$)/i,
    phone: /手机|电话|联系方式|mobile|phone|telephone|(^|\s)tel(\s|$)/i,
    email: /邮箱|电子邮件|email|e-mail/i,
    city: /城市|所在地|期望工作地|location|city/i,
    education: /学历|学位|education|degree/i,
    school: /学校|院校|大学|college|university|school/i,
    skills: /技能|专业技能|关键词|skill|keyword/i,
    website: /个人主页|作品集|github|portfolio|website|linkedin/i,
    summary: /自我介绍|个人简介|个人总结|summary|about.?me|profile/i
  };
  const fieldExclusions = {
    name: /用户名|账号|昵称|公司名称|企业名称|学校名称|院校名称|联系人|紧急|推荐人|user.?name|login|company.?name|school.?name|university.?name|contact.?name|referr/i,
    phone: /公司|企业|联系人|紧急|推荐人|company|contact|emergency|referr/i,
    email: /公司|企业|联系人|紧急|推荐人|company|contact|emergency|referr/i
  };
  const autocompleteKeys = {
    name: 'name',
    tel: 'phone',
    email: 'email',
    'address-level2': 'city',
    url: 'website'
  };
  const experienceSectionPatterns = {
    work: /工作经历|工作经验|职业经历|实习经历|employment|work.?experience|professional.?experience/i,
    education: /教育经历|教育背景|学历经历|education|academic.?background/i,
    projects: /项目经历|项目经验|代表项目|projects?|project.?experience/i,
    competitions: /赛事经历|竞赛经历|比赛经历|competitions?|contest.?experience/i,
    awards: /获奖经历|荣誉奖项|专利与奖项|awards?|honors?/i,
    campus: /校园经历|校园实践|学生工作|学生干部经历|社会实践|社团经历|社团活动|课外活动|campus.?experience|student.?activities|extracurricular.?activities/i,
    languages: /语言能力|语言证书|外语能力|languages?|language.?skills?/i,
    publications: /论文.?期刊|论文|期刊|出版物|publications?|papers?/i
  };
  const experiencePropertyPatterns = {
    work: {
      startDate: /开始时间|入职时间|start.?date|date.?from|from.?date/i,
      endDate: /结束时间|离职时间|end.?date|date.?to|to.?date/i,
      company: /公司|单位|雇主|company|employer|organization/i,
      role: /职位|岗位|职务|角色|title|position|role/i,
      location: /地点|城市|location|city/i,
      description: /工作内容|工作职责|主要职责|工作业绩|描述|description|responsibil|achievement/i
    },
    education: {
      startDate: /开始时间|入学时间|start.?date|date.?from|from.?date/i,
      endDate: /结束时间|毕业时间|end.?date|date.?to|to.?date/i,
      school: /学校|院校|大学|college|university|school/i,
      degree: /学历|学位|degree|education.?level/i,
      major: /专业|major|discipline/i,
      description: /在校经历|教育描述|补充说明|description|achievement/i
    },
    projects: {
      startDate: /开始时间|start.?date|date.?from|from.?date/i,
      endDate: /结束时间|end.?date|date.?to|to.?date/i,
      name: /项目名称|项目名|project.?name/i,
      role: /担任角色|项目角色|职责|role|position/i,
      description: /项目内容|项目描述|项目成果|description|achievement/i
    },
    competitions: {
      year: /比赛年份|赛事年份|竞赛年份|年份|year|date/i,
      startDate: /开始时间|start.?date|date.?from|from.?date/i,
      endDate: /结束时间|end.?date|date.?to|to.?date/i,
      name: /赛事名称|比赛名称|竞赛名称|competition.?name|contest.?name/i,
      description: /赛事描述|比赛描述|竞赛描述|description/i
    },
    awards: {
      name: /奖项名称|获奖名称|名称|award.?name/i,
      year: /获奖年份|获奖时间|年份|year|date/i,
      description: /描述|获奖描述|奖项说明|description/i
    },
    campus: {
      startDate: /开始时间|任职时间|start.?date|date.?from|from.?date/i,
      endDate: /结束时间|离任时间|end.?date|date.?to|to.?date/i,
      name: /组织名称|社团名称|校园经历|活动名称|student.?organization|activity.?name/i,
      role: /职位|职务|担任角色|角色|role|position/i,
      description: /工作内容|活动内容|实践内容|描述|description|responsibil|achievement/i
    },
    languages: {
      name: /语言证书|语言名称|证书名称|language|certificate/i,
      description: /成绩|补充说明|描述|score|description/i
    },
    publications: {
      name: /名称|论文名称|期刊名称|title|name/i,
      description: /描述|论文描述|description/i,
      result: /成果|结果|result|achievement/i
    }
  };
  const experienceCombinedPatterns = {
    languages: /语言证书及成绩|语言证书与成绩|language.?certificate.*(?:score|result)/i
  };
  const experienceTitles = { work: '工作经历', education: '教育经历', projects: '项目经历', competitions: '赛事经历', awards: '获奖经历', campus: '校园经历', languages: '语言能力', publications: '论文 / 期刊' };

  function queryAllDeep(selector) {
    const matches = [];
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      matches.push(...root.querySelectorAll(selector));
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }
    return [...new Set(matches)];
  }

  function textForField(field) {
    const chunks = [
      field.name,
      field.id,
      field.placeholder,
      field.getAttribute('aria-label'),
      field.getAttribute('autocomplete'),
      field.getAttribute('data-testid'),
      field.getAttribute('data-field')
    ];
    const scope = field.getRootNode();
    for (const id of (field.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) {
      const label = scope.getElementById?.(id);
      if (label) chunks.push(label.textContent);
    }
    if (field.id) {
      const root = field.getRootNode();
      const label = root.querySelector?.(`label[for="${CSS.escape(field.id)}"]`);
      if (label) chunks.push(label.textContent);
    }
    const parentLabel = field.closest('label');
    if (parentLabel) chunks.push(parentLabel.textContent);
    return chunks.filter(Boolean).join(' ');
  }

  function keyForField(field) {
    const contexts = contextTexts(field);
    const localContext = contexts.find(text => text.length <= 180) || '';
    const text = `${textForField(field)} ${localContext}`.trim();
    // Explicit other-person context must override even a standard autocomplete token.
    if (/紧急|推荐人|联系人|emergency|referr|contact.?name|first.?name|last.?name|given.?name|family.?name/i.test(text)) return undefined;
    const autocomplete = (field.getAttribute('autocomplete') || '').toLowerCase().trim().split(/\s+/).pop();
    const autoKey = Object.hasOwn(autocompleteKeys, autocomplete) ? autocompleteKeys[autocomplete] : undefined;
    if (autoKey && !fieldExclusions[autoKey]?.test(text)) return autoKey;
    const matches = Object.entries(fieldPatterns).filter(([key, pattern]) => {
      const exclusion = fieldExclusions[key];
      return pattern.test(text) && (!exclusion || !exclusion.test(text));
    });
    return matches.length === 1 ? matches[0][0] : undefined;
  }

  function contextTexts(field) {
    const texts = [];
    for (let node = field.parentElement, depth = 0; node && depth < 10 && !['BODY', 'HTML'].includes(node.tagName); node = node.parentElement, depth++) {
      const text = node.textContent?.trim().replace(/\s+/g, ' ') || '';
      if (text && text.length <= 1800 && !texts.includes(text)) texts.push(text);
    }
    return texts;
  }

  function experienceInfo(field) {
    const ownText = textForField(field);
    const contexts = [ownText, ...contextTexts(field)];
    let categories = [];
    for (const text of contexts) {
      categories = Object.entries(experienceSectionPatterns).filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
      if (categories.length === 1) break;
    }
    if (categories.length !== 1) return null;
    const type = categories[0];
    if (['TEXTAREA', 'DIV'].includes(field.tagName) && experienceCombinedPatterns[type]) {
      const combined = contexts.find(text => experienceCombinedPatterns[type].test(text));
      if (combined) return { type, key: 'all' };
    }
    for (const text of contexts) {
      const properties = Object.entries(experiencePropertyPatterns[type]).filter(([, pattern]) => pattern.test(text)).map(([key]) => key);
      if (properties.length === 1) return { type, key: properties[0] };
    }
    if (experienceSectionPatterns[type].test(ownText) && ['TEXTAREA', 'DIV'].includes(field.tagName)) return { type, key: 'all' };
    return null;
  }

  function serializeExperience(type, item) {
    const lines = [];
    if (type === 'work') lines.push([item.company, item.role].filter(Boolean).join(' | '));
    if (type === 'education') lines.push([item.school, item.degree, item.major].filter(Boolean).join(' | '));
    if (type === 'projects') lines.push([item.name, item.role].filter(Boolean).join(' | '));
    if (type === 'competitions') lines.push(item.name);
    if (['awards', 'campus', 'languages', 'publications'].includes(type)) lines.push(item.name);
    if (type === 'competitions' && item.year) lines.push(item.year);
    if (type === 'awards' && item.year) lines.push(item.year);
    if (type === 'campus') lines.push(item.role);
    lines.push([item.startDate, item.endDate].filter(Boolean).join(' - '));
    if (type === 'work' && item.location) lines.push(item.location);
    if (item.description) lines.push(item.description);
    if (item.result) lines.push(item.result);
    return lines.filter(Boolean).join('\n');
  }

  function plansForFields(fields, profile, experiences) {
    const counters = new Map();
    return fields.map(field => {
      const info = experienceInfo(field);
      if (info) {
        const items = experiences[info.type];
        if (info.key === 'all') {
          return { key: `${info.type}.all`, title: experienceTitles[info.type], value: items.map(item => serializeExperience(info.type, item)).filter(Boolean).join('\n\n') };
        }
        const counterKey = `${info.type}.${info.key}`;
        const index = counters.get(counterKey) || 0;
        counters.set(counterKey, index + 1);
        return { key: `${counterKey}.${index}`, title: `${experienceTitles[info.type]} ${index + 1}`, value: items[index]?.[info.key] || '' };
      }
      const key = keyForField(field);
      return key ? { key, title: fieldTitles[key], value: profile[key] } : null;
    });
  }

  function textForFileInput(field) {
    const chunks = [textForField(field),
      field.name,
      field.id,
      field.getAttribute('aria-label'),
      field.getAttribute('data-testid'),
      field.getAttribute('data-field')
    ];
    if (field.id) {
      const root = field.getRootNode();
      const label = root.querySelector?.(`label[for="${CSS.escape(field.id)}"]`);
      if (label) chunks.push(label.textContent);
    }
    const parent = field.closest('label, [data-field], [class*="upload"], [class*="Upload"]');
    if (parent && parent.querySelectorAll('input[type="file"]').length === 1 && parent.textContent?.trim().length <= 160) chunks.push(parent.textContent);
    return chunks.filter(Boolean).join(' ');
  }

  function isResumeFileInput(field) {
    const text = textForFileInput(field);
    const negative = /头像|照片|证件照|logo|avatar|photo|image|cover.?letter|作品|portfolio/i;
    const positive = /简历|履历|resume|curriculum|vitae|(^|[^a-z])cv([^a-z]|$)/i;
    return !negative.test(text) && positive.test(text);
  }

  function acceptsFile(field, resume) {
    const accept = (field.getAttribute('accept') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
    return !accept.length || accept.some(value => value.startsWith('.') ? resume.name.toLowerCase().endsWith(value)
      : value.endsWith('/*') ? resume.type.startsWith(value.slice(0, -1)) : resume.type === value);
  }

  function isEditable(field) {
    if (!field.isConnected || field.disabled || field.readOnly || field.matches(':disabled')) return false;
    for (let node = field; node; node = node.parentElement || node.getRootNode().host) {
      const style = getComputedStyle(node);
      if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('aria-disabled') === 'true' ||
        node.getAttribute('aria-readonly') === 'true' || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false;
    }
    return true;
  }

  function expectedValue(element, value) {
    if (element.tagName === 'SELECT') {
      const options = [...element.options].filter(item => !item.disabled && !item.parentElement.disabled && item.value &&
        (item.value === value || item.textContent.trim() === value.trim()));
      if (options.length !== 1 || element.multiple) return null;
      return options[0].value;
    }
    return value;
  }

  function readValue(element) {
    return element.isContentEditable ? element.textContent : element.value;
  }

  function dispatchChange(element) {
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function writeValue(element, value) {
    if (element.isContentEditable) {
      element.textContent = value;
    } else {
      const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;
      setter ? setter.call(element, value) : (element.value = value);
    }
  }

  function setNativeValue(element, value) {
    const expected = expectedValue(element, value);
    if (expected === null) return null;
    writeValue(element, expected);
    dispatchChange(element);
    return expected;
  }

  function collectFields() {
    return queryAllDeep('input:not([type="hidden"]):not([type="file"]), textarea, select, [contenteditable="true"]')
      .filter((field) => {
        const type = (field.getAttribute('type') || '').toLowerCase();
        return isEditable(field) && (!field.matches('input') || ['text', 'email', 'tel', 'url', ''].includes(type));
      });
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  const attemptedUploads = new WeakSet();
  function uploadPlan(resume) {
    if (!resume) return { status: 'none', message: '未保存简历附件。' };
    const candidates = queryAllDeep('input[type="file"]').filter(field => isResumeFileInput(field) && !field.matches(':disabled') &&
      isEditable(field.parentElement || field.getRootNode().host));
    if (!candidates.length) return { status: 'missing', message: '未找到明确的简历上传框。' };
    if (candidates.length > 1) return { status: 'ambiguous', message: '存在多个简历上传框，请手动选择。' };
    const field = candidates[0];
    if (field.files.length || attemptedUploads.has(field)) return { status: 'existing', message: '已有附件或已尝试上传，本次保留。' };
    if (!acceptsFile(field, resume)) return { status: 'format', message: '上传框不接受当前附件格式，请手动选择。' };
    return { status: 'ready', message: `将选择附件：${resume.name}。网站可能立即上传。`, field };
  }

  const fieldTitles = { name: '姓名', phone: '手机号', email: '邮箱', city: '城市', education: '学历', school: '学校', skills: '技能', website: '个人主页', summary: '自我介绍' };
  function preview(state) {
    const profile = ResumeData.profile(state?.profile || {});
    const resume = ResumeData.resume(state?.resume);
    const experiences = ResumeData.experiences(state?.experiences);
    const fields = collectFields();
    const plans = plansForFields(fields, profile, experiences);
    const items = fields.map((field, index) => {
      const plan = plans[index];
      if (!plan) return null;
      const current = field.isContentEditable ? readValue(field).trim() : readValue(field);
      const status = current ? 'kept' : !plan.value.trim() ? 'missing'
        : expectedValue(field, plan.value) === null ? 'unsupported' : 'ready';
      const label = field.getAttribute('aria-label') || field.labels?.[0]?.textContent || field.placeholder || field.name || field.id || plan.title;
      return { key: plan.key, title: plan.title, label: label.trim().slice(0, 100), value: plan.value, status };
    }).filter(Boolean);
    const attachment = uploadPlan(resume);
    return {
      items: items.slice(0, 80), total: items.length,
      ready: items.filter(item => item.status === 'ready').length,
      attachment: { status: attachment.status, message: attachment.message },
      message: '预览不会填写字段或选择附件。执行时会重新检查页面。'
    };
  }

  let lastFill = null;
  async function attachResume(fileInput, resume) {
    if (!resume?.dataUrl || attemptedUploads.has(fileInput) || fileInput.matches(':disabled') || fileInput.files.length || !acceptsFile(fileInput, resume)) return false;
    try {
      const bytes = Uint8Array.from(atob(resume.dataUrl.split(',')[1]), character => character.charCodeAt(0));
      const file = new File([bytes], resume.name, { type: resume.type });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      fileInput.files = transfer.files;
      if (fileInput.files.length !== 1 || fileInput.files[0].name !== resume.name) return false;
      attemptedUploads.add(fileInput);
      fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    } catch {
      return false;
    }
  }

  async function fill(state) {
    if (state?.resumeProfileId || state?.resumeProfileLabel) {
      lastResumeProfile = { id: state.resumeProfileId || '', label: state.resumeProfileLabel || '默认简历' };
    }
    const profile = ResumeData.profile(state?.profile || {});
    const resume = ResumeData.resume(state?.resume);
    const experiences = ResumeData.experiences(state?.experiences);
    let fields = collectFields();
    if (!fields.length) {
      await wait(600);
      fields = collectFields();
    }
    let kept = 0;
    let failed = 0;
    const written = [];
    const pageUrl = location.href;
    const plans = plansForFields(fields, profile, experiences);
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      if (!isEditable(field)) continue;
      const plan = plans[index];
      const currentValue = field.isContentEditable ? field.textContent.trim() : field.value;
      if (!plan || !plan.value.trim()) continue;
      if (currentValue) { kept++; continue; }
      try {
        const before = readValue(field);
        const childNodes = field.isContentEditable ? [...field.childNodes].map(node => node.cloneNode(true)) : null;
        const selectedOption = field.tagName === 'SELECT' ? field.options[field.selectedIndex] || null : null;
        const expected = setNativeValue(field, plan.value);
        if (expected === null) { failed++; continue; }
        written.push({ field, expected, before, childNodes, selectedOption });
      } catch {
        failed++;
      }
    }
    // Let synchronous and queued framework updates reject unsupported assignments.
    if (written.length) await wait(30);
    let filled = 0;
    const undoable = [];
    for (const entry of written) {
      const { field, expected } = entry;
      if (!field.isConnected || (field.isContentEditable ? field.textContent : field.value) !== expected) { failed++; continue; }
      filled++;
      entry.afterHtml = field.isContentEditable ? field.innerHTML : null;
      undoable.push(entry);
      const previousOutline = field.style.outline;
      field.style.outline = '2px solid #4aa37e';
      window.setTimeout(() => { field.style.outline = previousOutline; }, 5000);
    }
    if (undoable.length) lastFill = { pageUrl, entries: undoable };
    const attachment = uploadPlan(resume);
    const inputsToAttach = attachment.status === 'ready' ? [attachment.field] : [];
    let attached = 0;
    for (const fileInput of inputsToAttach) {
      if (await attachResume(fileInput, resume)) attached += 1;
    }
    const uploadSkipped = Boolean(resume && !attached);
    let message = `已填 ${filled} 项，保留 ${kept} 项已有内容。`;
    if (failed) message += `${failed} 项无法写入或选项不匹配，请手动填写。`;
    if (attached) message += '已选择简历附件，请检查网站上传状态。';
    if (uploadSkipped) message += attachment.status === 'ready' ? '附件选择失败，请手动上传。' : attachment.message;
    if (!filled && !kept && !failed) message += '未找到可填充的空白字段。';
    message += '请核对后手动提交。';
    showStatus(message, failed ? 'normal' : 'success');
    return { filled, attached, kept, failed, uploadSkipped, message };
  }

  let filling = false;
  async function runFill(state) {
    if (filling) throw new Error('正在填充，请稍候。');
    filling = true;
    try { return await fill(state); } finally { filling = false; }
  }

  async function undoFill() {
    if (filling) throw new Error('正在填充或撤销，请稍候。');
    if (!lastFill) return { restored: 0, skipped: 0, failed: 0, message: '当前页面没有可撤销的填写。刷新页面后记录会清除。' };
    if (lastFill.pageUrl !== location.href) throw new Error('页面地址已变化，不能撤销上一个岗位的填写。');
    filling = true;
    const batch = lastFill;
    lastFill = null;
    let skipped = 0;
    let failed = 0;
    const restored = [];
    try {
      for (const entry of batch.entries) {
        const { field, expected, before, childNodes, selectedOption } = entry;
        if (!isEditable(field) || readValue(field) !== expected) { skipped++; continue; }
        if (field.isContentEditable && field.innerHTML !== entry.afterHtml) { skipped++; continue; }
        if (field.tagName === 'SELECT' && selectedOption && ![...field.options].includes(selectedOption)) { skipped++; continue; }
        try {
          if (childNodes) field.replaceChildren(...childNodes);
          else if (field.tagName === 'SELECT') field.selectedIndex = selectedOption ? [...field.options].indexOf(selectedOption) : -1;
          else writeValue(field, before);
          dispatchChange(field);
          restored.push(entry);
        } catch { failed++; }
      }
      if (restored.length) await wait(30);
      let count = 0;
      for (const { field, before } of restored) {
        if (field.isConnected && readValue(field) === before) count++; else failed++;
      }
      const message = `已撤销 ${count} 项，跳过 ${skipped} 项已修改或失效的字段${failed ? `，${failed} 项恢复失败` : ''}。附件及网站已接收的数据无法撤回。`;
      showStatus(message);
      return { restored: count, skipped, failed, message };
    } finally { filling = false; }
  }

  function pageIdentity() {
    const candidates = [...document.querySelectorAll('h1, h2, [class*="job-title"], [class*="position-title"]')]
      .map(element => element.textContent?.trim()).filter(text => text && text.length <= 120);
    const title = candidates[0] || document.title || location.href;
    const hostname = location.hostname;
    const careerHost = /^(?:apply\.)?careers\.([^.]+)\./i.exec(hostname)?.[1];
    const genericLabels = /^(?:moka|mokahr|招聘|招聘平台|career(?:s)?|career portal|job portal)$/i;
    const metadataCompany = ['meta[property="og:site_name"]', 'meta[name="application-name"]']
      .map(selector => document.querySelector(selector)?.content?.trim() || '')
      .find(value => value && value.length <= 120 && !genericLabels.test(value));
    const company = metadataCompany || (careerHost ? (careerHost.length <= 6 ? careerHost.toUpperCase() : careerHost) : hostname);
    return { title, company };
  }

  async function markApplied(source = 'manual') {
    const data = await chrome.storage.local.get(['applications', 'activeProfileId', 'activeProfileLabel', 'resumeProfiles']);
    const applications = Array.isArray(data.applications) ? data.applications.filter(item => item && typeof item.url === 'string' && Number.isFinite(item.createdAt)) : [];
    const alreadyRecorded = applications.some((item) => item.url === location.href && Date.now() - item.createdAt < 24 * 60 * 60 * 1000);
    if (alreadyRecorded) {
      if (source === 'manual') showStatus('今天已经记录过这个页面。', 'normal');
      return false;
    }
    const identity = pageIdentity();
    const activeProfile = Array.isArray(data.resumeProfiles)
      ? data.resumeProfiles.find(item => item && item.id === data.activeProfileId)
      : null;
    const resumeProfileId = lastResumeProfile?.id || activeProfile?.id || (typeof data.activeProfileId === 'string' ? data.activeProfileId : '');
    const resumeProfileLabel = lastResumeProfile?.label || activeProfile?.label || (typeof data.activeProfileLabel === 'string' ? data.activeProfileLabel : '') || '默认简历';
    applications.unshift({ ...identity, url: location.href, createdAt: Date.now(), status: source === 'auto' ? 'submitted' : 'recorded', source, resumeProfileId, resumeProfileLabel });
    await chrome.storage.local.set({ applications: applications.slice(0, 500) });
    showStatus(source === 'auto' ? '检测到投递成功，已自动记录。' : '已记录本次投递。', 'success');
    return true;
  }

  let submissionObserver = null;
  let submissionTimer = null;
  let submissionBaseline = new Map();
  const successPattern = /投递成功|申请成功|提交成功|成功提交|已成功投递|投递完成|申请已提交|已完成申请|感谢(?:您|你的)?(?:申请|投递)|thank you for (?:applying|your application)|application (?:has been )?(?:submitted|received)|(?:submission|application) successful|successfully applied/i;
  function successCandidates() {
    const doc = window.document;
    if (!doc?.querySelectorAll) return [];
    return [...doc.querySelectorAll('[role="status"], [role="alert"], [class*="success" i], [class*="result" i], main, body')]
      .filter(element => {
        if (element.id === ROOT_ID || !isEditable(element.parentElement || doc.documentElement)) return false;
        const text = (element.innerText || element.textContent || '').trim();
        return text.length <= 2000 && successPattern.test(text);
      });
  }
  function visibleSuccessMessage() {
    return successCandidates().some(element => {
      const text = (element.innerText || element.textContent || '').trim();
      return !submissionBaseline.has(element) || submissionBaseline.get(element) !== text;
    });
  }
  function stopSubmissionWatch() {
    submissionObserver?.disconnect();
    submissionObserver = null;
    window.clearTimeout(submissionTimer);
    submissionTimer = null;
  }
  function checkSubmissionSuccess() {
    if (!visibleSuccessMessage()) return;
    stopSubmissionWatch();
    markApplied('auto').catch(error => showStatus(`自动记录失败：${error.message}。请点击“标记已投递”重试。`, 'warning'));
  }
  function watchSubmissionResult() {
    stopSubmissionWatch();
    submissionBaseline = new Map(successCandidates().map(element => [element, (element.innerText || element.textContent || '').trim()]));
    submissionObserver = new MutationObserver(checkSubmissionSuccess);
    submissionObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    submissionTimer = window.setTimeout(stopSubmissionWatch, 2 * 60 * 1000);
    window.setTimeout(checkSubmissionSuccess, 0);
  }
  document.addEventListener('submit', () => watchSubmissionResult(), true);
  document.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const control = event.target.closest('button, input[type="submit"], [role="button"]');
    const text = control?.textContent?.trim() || control?.value?.trim() || '';
    if (/提交申请|确认提交|立即申请|投递简历|预览并提交|submit application|apply now/i.test(text)) watchSubmissionResult();
  }, true);

  function showStatus(text, type = 'normal') {
    if (!uiRoot) mount();
    const status = uiRoot?.querySelector('.rqa-status');
    if (!status) return;
    status.textContent = text;
    status.dataset.type = type;
    status.hidden = false;
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => { status.hidden = true; }, 5000);
  }

  function mount() {
    if (document.getElementById(ROOT_ID)) return;
    const host = document.createElement('aside');
    host.id = ROOT_ID;
    const root = host.attachShadow({ mode: 'open' });
    uiRoot = root;
    const icon = (name) => chrome.runtime.getURL(`icons/${name}.svg`);
    root.innerHTML = `
      <div class="rqa-panel" hidden>
        <div class="rqa-head"><span><img src="${icon('briefcase-business')}" alt=""></span><div><div class="rqa-title">投简历助手</div><small>当前页面工具</small></div></div>
        <button class="rqa-fill" type="button"><img src="${icon('zap')}" alt=""><span><strong>填充页面</strong><small>保留已有内容</small></span></button>
        <div class="rqa-grid">
          <button class="rqa-preview" type="button"><img src="${icon('scan-search')}" alt="">检查字段</button>
          <button class="rqa-undo" type="button"><img src="${icon('undo-2')}" alt="">撤销填写</button>
        </div>
        <button class="rqa-mark" type="button"><img src="${icon('circle-check')}" alt="">标记已投递</button>
        <div class="rqa-hint">成功状态会自动记录；失败时可点击“标记已投递”重试。附件选择可能触发网站立即上传</div>
        <div class="rqa-status" role="status" hidden></div>
      </div>
      <button class="rqa-toggle" type="button" aria-label="打开投简历助手" aria-expanded="false"><img src="${icon('briefcase-business')}" alt=""></button>`;
    const style = document.createElement('style');
    style.textContent = `
      :host{position:fixed;z-index:2147483647;right:18px;bottom:18px;font:13px/1.4 Arial,"Microsoft YaHei",sans-serif;color:#16202a;letter-spacing:0}
      :host *{box-sizing:border-box}
      :host button{font:inherit;letter-spacing:0;cursor:pointer}
      :host img{display:block;width:17px;height:17px}
      :host [hidden]{display:none!important}
      :host .rqa-toggle{display:grid;place-items:center;width:46px;height:46px;margin-left:auto;border:0;border-radius:50%;background:#087f73;box-shadow:0 4px 16px #17202a3d}
      :host .rqa-toggle img{filter:brightness(0) invert(1)}
      :host .rqa-panel{width:224px;margin-bottom:9px;padding:12px;border:1px solid #dce3e8;border-radius:7px;background:#fff;box-shadow:0 8px 28px #17202a2e}
      :host .rqa-head{display:flex;align-items:center;gap:9px;padding-bottom:10px;border-bottom:1px solid #e7ecef}
      :host .rqa-head>span{display:grid;place-items:center;width:32px;height:32px;border-radius:6px;background:#e4f2ef}
      :host .rqa-head>span img{filter:invert(38%) sepia(52%) saturate(957%) hue-rotate(128deg)}
      :host .rqa-title{font-weight:700}
      :host .rqa-head small{color:#66727f;font-size:10px}
      :host .rqa-fill{display:flex;align-items:center;gap:9px;width:100%;min-height:48px;margin-top:10px;border:0;border-radius:5px;padding:8px 10px;background:#087f73;color:#fff;text-align:left}
      :host .rqa-fill>img{filter:brightness(0) invert(1)}
      :host .rqa-fill span{display:grid}
      :host .rqa-fill strong{font-size:12px}
      :host .rqa-fill small{color:#d4eeea;font-size:10px}
      :host .rqa-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
      :host .rqa-preview,:host .rqa-undo,:host .rqa-mark{display:flex;align-items:center;justify-content:center;gap:5px;min-height:34px;border:1px solid #dce3e8;border-radius:4px;padding:6px;background:#fff;color:#35424e;font-size:11px}
      :host .rqa-preview img,:host .rqa-undo img,:host .rqa-mark img{width:14px;height:14px}
      :host .rqa-mark{width:100%;margin-top:6px;background:#edf3f4;color:#075f58}
      :host .rqa-status{margin-top:9px;padding:7px;border-radius:4px;background:#eef3f6;color:#44515c;font-size:10px}
      :host .rqa-hint{margin-top:8px;color:#66727f;font-size:9px;text-align:center}
      :host .rqa-status[data-type="success"]{background:#e5f4f0;color:#185f54}
      :host button:focus-visible{outline:2px solid #4b8ee8;outline-offset:2px}
    `;
    root.prepend(style);
    document.documentElement.append(host);
    const panel = root.querySelector('.rqa-panel');
    const toggle = root.querySelector('.rqa-toggle');
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    root.querySelector('.rqa-fill').addEventListener('click', async event => {
      if (!event.isTrusted) return;
      try {
        const state = await chrome.storage.local.get(['profile', 'resume', 'experiences', 'activeProfileId', 'activeProfileLabel']);
        state.resumeProfileId = state.activeProfileId || '';
        state.resumeProfileLabel = state.activeProfileLabel || '默认简历';
        await runFill(state);
      } catch (error) { showStatus(error.message); }
    });
    root.querySelector('.rqa-mark').addEventListener('click', event => {
      if (event.isTrusted) markApplied('manual').catch(error => showStatus(error.message));
    });
    root.querySelector('.rqa-preview').addEventListener('click', async event => {
      if (!event.isTrusted) return;
      try {
        const state = await chrome.storage.local.get(['profile', 'resume', 'experiences']);
        const result = preview(state);
        showStatus(`识别 ${result.total} 项，可填 ${result.ready} 项。${result.attachment.message}`);
      } catch (error) { showStatus(error.message); }
    });
    root.querySelector('.rqa-undo').addEventListener('click', event => {
      if (event.isTrusted) undoFill().catch(error => showStatus(error.message));
    });
  }

  function pageLooksLikeApplicationForm() {
    const matchedFields = collectFields().filter((field) => keyForField(field) || experienceInfo(field));
    const hasResumeUpload = queryAllDeep('input[type="file"]').some(isResumeFileInput);
    return hasResumeUpload || matchedFields.length >= 2;
  }

  function mountWhenUseful() {
    if (pageLooksLikeApplicationForm()) {
      mount();
      return;
    }
    let checkTimer;
    const observer = new MutationObserver(() => {
      window.clearTimeout(checkTimer);
      checkTimer = window.setTimeout(() => {
        if (pageLooksLikeApplicationForm()) {
          observer.disconnect();
          mount();
        }
      }, 250);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'previewResume') {
      try { sendResponse(preview(message.state)); }
      catch (error) { sendResponse({ error: error.message }); }
      return;
    }
    if (message.type === 'undoResume') {
      undoFill().then(sendResponse).catch(error => sendResponse({ error: error.message }));
      return true;
    }
    if (message.type === 'fillResume') {
      mount();
      runFill(message.state)
        .then(sendResponse)
        .catch((error) => sendResponse({ error: error.message || '页面填充失败。' }));
      return true;
    }
  });

  mountWhenUseful();
})();
