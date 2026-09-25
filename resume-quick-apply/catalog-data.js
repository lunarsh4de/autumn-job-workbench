// Parsing, normalization, deduplication and local matching for imported job catalogs.
(() => {
  const aliases = {
    company: ['company', '公司', '企业', '公司名称'],
    title: ['title', 'job', 'position', '岗位', '职位', '岗位名称', '职位名称'],
    location: ['location', '地点', '工作地点', 'city', '城市'],
    province: ['province', '省份', '省'],
    city: ['city', '城市', '市'],
    url: ['url', 'link', '链接', '投递链接', '岗位链接'],
    platform: ['platform', 'source', '平台', '来源', '招聘平台'],
    companyType: ['companytype', 'company_type', '企业类型', '公司类型'],
    jobType: ['jobtype', 'type', '岗位类型', '职位类型', '类别'],
    tags: ['tags', 'keywords', '标签', '关键词'],
    description: ['description', 'jd', '岗位描述', '职位描述', '描述'],
    publishedAt: ['publishedat', 'publishdate', '发布时间', '发布日期'],
    deadline: ['deadline', '截止时间', '截止日期'],
    matchScore: ['matchscore', 'score', '匹配分', '匹配度']
  };

  const JOB_TYPES = ['技术研发', '数据算法', '产品项目', '设计体验', '运营市场', '销售客户', '职能管培', '供应链制造', '金融法务', '教育医疗', '其他校招'];
  const JOB_TYPE_RULES = [
    ['数据算法', ['算法', '数据科学', '数据分析', '数据开发', '大数据', '机器学习', '深度学习', 'ai', '人工智能', 'nlp', '商业分析', '数仓']],
    ['技术研发', ['开发工程师', '软件工程', '前端', '后端', '客户端', '移动端', '测试工程', '运维', '研发', '嵌入式', '硬件', '芯片', 'web', 'java', 'c++', 'golang', 'python']],
    ['产品项目', ['产品经理', '产品运营', '产品设计', '项目经理', '项目管理', '解决方案', '需求分析']],
    ['设计体验', ['设计师', '视觉设计', '交互设计', '用户体验', 'ui设计', 'ux设计', '工业设计', '内容设计']],
    ['运营市场', ['运营', '市场', '品牌', '公关', '新媒体', '内容', '增长', '活动策划', '广告']],
    ['销售客户', ['销售', '客户成功', '客户经理', '商务', '售前', '售后', '渠道', '采购']],
    ['职能管培', ['管培', '人力', '招聘', '行政', '财务', '审计', '法务', '合规', '秘书', '翻译']],
    ['供应链制造', ['供应链', '物流', '计划', '生产', '制造', '质量', '工艺', '机械', '汽车', '采购工程']],
    ['金融法务', ['投资', '证券', '银行', '保险', '信贷', '风控', '金融', '法务', '法律']],
    ['教育医疗', ['教师', '教育', '课程', '医疗', '医生', '护士', '药学', '临床', '医药']],
  ];
  const CITY_PROVINCES = {
    北京: '北京', 上海: '上海', 天津: '天津', 重庆: '重庆', 广州: '广东', 深圳: '广东', 珠海: '广东', 佛山: '广东', 东莞: '广东', 杭州: '浙江', 宁波: '浙江', 温州: '浙江', 南京: '江苏', 苏州: '江苏', 无锡: '江苏', 成都: '四川', 绵阳: '四川', 武汉: '湖北', 长沙: '湖南', 郑州: '河南', 西安: '陕西', 合肥: '安徽', 福州: '福建', 厦门: '福建', 济南: '山东', 青岛: '山东', 沈阳: '辽宁', 大连: '辽宁', 哈尔滨: '黑龙江', 长春: '吉林', 南昌: '江西', 昆明: '云南', 贵阳: '贵州', 太原: '山西', 石家庄: '河北', 乌鲁木齐: '新疆', 兰州: '甘肃', 海口: '海南', 南宁: '广西', 呼和浩特: '内蒙古', 拉萨: '西藏', 银川: '宁夏', 西宁: '青海', 香港: '香港', 澳门: '澳门', 台北: '台湾'
  };
  const PROVINCES = ['北京', '上海', '天津', '重庆', '广东', '浙江', '江苏', '四川', '湖北', '湖南', '河南', '陕西', '安徽', '福建', '山东', '辽宁', '黑龙江', '吉林', '江西', '云南', '贵州', '山西', '河北', '新疆', '甘肃', '海南', '广西', '内蒙古', '西藏', '宁夏', '青海', '香港', '澳门', '台湾'];
  const FOREIGN_COMPANY_TYPES = new Set(['外企', '外资', '跨国公司', 'foreign', 'foreign company', 'mnc']);
  const FOREIGN_COMPANY_PATTERN = /微软|英特尔|英伟达|苹果|亚马逊|谷歌|google|microsoft|amazon|apple|ibm|sap|西门子|博世|联合利华|宝洁|欧莱雅|耐克|阿迪达斯|德勤|普华永道|安永|毕马威|埃森哲|汇丰|渣打|花旗|摩根|可口可乐|百事|星巴克|麦肯锡|波士顿咨询|贝恩|airbnb|stripe|datadog|cloudflare|coinbase/i;

  function text(value, max = 2000) {
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : '';
  }

  function webUrl(value) {
    const candidate = text(value, 4000);
    if (!candidate) return '';
    try {
      const url = new URL(candidate);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function classifyJobType(value = {}) {
    const explicit = text(value.jobType || value.type, 100);
    if (JOB_TYPES.includes(explicit)) return explicit;
    const haystack = [value.title, value.tags, value.description, explicit].flat().join(' ').toLowerCase();
    for (const [type, keywords] of JOB_TYPE_RULES) {
      if (keywords.some(keyword => haystack.includes(keyword.toLowerCase()))) return type;
    }
    return '其他校招';
  }

  function regionParts(value = {}) {
    const raw = text(value.location || value.city, 120).replace(/[，,、|/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
    const explicitProvince = text(value.province, 40).replace(/省$/, '');
    const explicitCity = text(value.city, 40).replace(/市$/, '');
    if (explicitProvince && explicitCity && explicitProvince !== explicitCity) return { province: explicitProvince, city: explicitCity };
    const province = PROVINCES.find(name => raw.startsWith(name) || raw.includes(`${name}省`) || raw.includes(`${name}自治区`)) || (Object.entries(CITY_PROVINCES).find(([city]) => raw.includes(city)) || [])[1] || '其他地区';
    const city = explicitCity || Object.keys(CITY_PROVINCES).find(name => raw.includes(name)) || (province !== '其他地区' && ['北京', '上海', '天津', '重庆'].includes(province) ? province : (raw.match(/([^\s-]{2,8}?)(?:市|区|县)/)?.[1] || '未标注'));
    return { province, city };
  }

  function formatRegion(value) {
    const parts = regionParts(value);
    if (parts.city === '未标注' || parts.province === parts.city) return parts.province;
    return `${parts.province} · ${parts.city}`;
  }

  function stableId(value) {
    let hash = 2166136261;
    for (const character of value) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `catalog-${(hash >>> 0).toString(36)}`;
  }

  function canonicalRow(row) {
    const normalized = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key.toLowerCase().replace(/[\s_-]/g, ''), value]));
    return Object.fromEntries(Object.entries(aliases).map(([field, names]) => {
      const key = names.map(name => name.toLowerCase().replace(/[\s_-]/g, '')).find(name => Object.hasOwn(normalized, name));
      return [field, key ? normalized[key] : ''];
    }));
  }

  function normalizeCompanyType(value, company = '', location = '') {
    const explicit = text(value, 80).toLowerCase();
    const region = regionParts({ location });
    const mainland = region.province !== '其他地区' && !['香港', '澳门', '台湾'].includes(region.province);
    if ((FOREIGN_COMPANY_TYPES.has(explicit) || explicit.includes('外企') || explicit.includes('外资')) && mainland) return '外企（中国大陆）';
    if (explicit.includes('国企') || explicit.includes('央企') || explicit.includes('国有') || explicit.includes('事业单位')) return '国企/央企';
    if (/国家电网|南方电网|中国石油|中石油|中国石化|中石化|中国移动|中国联通|中国电信|中国建筑|中建集团|中国中铁|中国铁建|中国交建|中国航天|中国航空|中国兵器|中国烟草|中国铁路|国铁|中核|中航|中粮|中储粮|中国船舶|中国电子|中国华能|国家能源/.test(company)) return '国企/央企';
    if (!explicit && FOREIGN_COMPANY_PATTERN.test(company) && mainland) return '外企（中国大陆）';
    return text(value, 80) || '国内/综合';
  }

  function item(value, now = Date.now()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = canonicalRow(value);
    const company = text(row.company || value.company, 160) || '未知公司';
    const title = text(row.title || value.title, 240);
    if (!title) return null;
    const location = text(row.location || value.location, 120);
    const region = regionParts({ location, province: row.province || value.province, city: row.city || value.city });
    const url = webUrl(row.url || value.url);
    const platform = text(row.platform || value.platform, 100) || (url ? new URL(url).hostname : '本地导入');
    const rawTags = Array.isArray(value.tags) ? value.tags.join(',') : row.tags || value.tags;
    const tags = [...new Set(text(rawTags, 1000).split(/[,，;；|/]/).map(tag => tag.trim()).filter(Boolean))].slice(0, 20);
    const scoreValue = row.matchScore !== '' ? row.matchScore : value.matchScore;
    const rawScore = scoreValue === '' || scoreValue == null ? Number.NaN : Number(scoreValue);
    const matchScore = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : null;
    const identity = url || `${company}|${title}|${location}`;
    return {
      id: text(value.id, 120) || stableId(identity.toLowerCase()),
      company,
      title,
      location,
      url,
      platform,
      companyType: normalizeCompanyType(row.companyType || value.companyType, company, location || `${region.province} ${region.city}`),
      province: region.province,
      city: region.city,
      jobType: classifyJobType({ ...value, ...row, title, tags, description: row.description || value.description }),
      tags,
      description: text(row.description || value.description, 12000),
      publishedAt: text(row.publishedAt || value.publishedAt, 30),
      deadline: text(row.deadline || value.deadline, 30),
      matchScore,
      importedAt: Number.isFinite(value.importedAt) ? value.importedAt : now,
      updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : now
    };
  }

  function parseCsv(source) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const input = String(source || '').replace(/^\ufeff/, '');
    for (let index = 0; index <= input.length; index++) {
      const character = input[index] ?? '\n';
      if (quoted) {
        if (character === '"' && input[index + 1] === '"') { cell += '"'; index++; }
        else if (character === '"') quoted = false;
        else cell += character;
      } else if (character === '"') quoted = true;
      else if (character === ',') { row.push(cell); cell = ''; }
      else if (character === '\n') {
        row.push(cell.replace(/\r$/, ''));
        if (row.some(value => value.trim())) rows.push(row);
        row = []; cell = '';
      } else cell += character;
    }
    if (rows.length < 2) return [];
    const headers = rows[0].map(header => header.trim());
    return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }

  function parseImport(source) {
    const content = String(source || '').trim();
    if (!content) throw new Error('没有可导入的内容。');
    let rows;
    if (content.startsWith('[') || content.startsWith('{')) {
      const parsed = JSON.parse(content);
      rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed.jobs) ? parsed.jobs : [];
    } else rows = parseCsv(content);
    if (!rows.length) throw new Error('未识别到岗位，请检查 CSV 表头或 JSON 数组。');
    const jobs = rows.map(row => item(row)).filter(Boolean);
    if (!jobs.length) throw new Error('岗位至少需要“岗位/职位”字段。');
    return jobs;
  }

  function merge(existing, incoming) {
    const map = new Map();
    for (const value of existing || []) {
      const normalized = item(value);
      if (normalized) map.set(normalized.id, normalized);
    }
    let added = 0;
    let updated = 0;
    for (const value of incoming || []) {
      const normalized = item(value);
      if (!normalized) continue;
      const previous = map.get(normalized.id);
      if (previous) {
        map.set(normalized.id, {
          ...previous,
          ...normalized,
          description: normalized.description || previous.description,
          matchScore: normalized.matchScore ?? previous.matchScore,
          importedAt: previous.importedAt
        });
        updated++;
      } else {
        map.set(normalized.id, normalized);
        added++;
      }
    }
    return { items: [...map.values()], added, updated };
  }

  function preferenceTokens(preferences) {
    const split = value => text(value, 3000).toLowerCase().split(/[,，;；|/\n\s]+/).map(token => token.trim()).filter(token => token.length >= 2);
    return {
      roles: split(preferences?.roles),
      skills: split(preferences?.skills),
      cities: split(preferences?.cities)
    };
  }

  function score(value, preferences) {
    const tokens = preferenceTokens(preferences);
    if (!tokens.roles.length && !tokens.skills.length && !tokens.cities.length) return null;
    const title = value.title.toLowerCase();
    const location = [value.location, value.province, value.city].filter(Boolean).join(' ').toLowerCase();
    const haystack = `${title} ${value.company} ${value.tags.join(' ')} ${value.description}`.toLowerCase();
    const roleHits = tokens.roles.filter(token => title.includes(token)).length;
    const skillHits = tokens.skills.filter(token => haystack.includes(token)).length;
    const cityHit = tokens.cities.some(token => location.includes(token));
    let result = Math.min(45, roleHits * 45) + Math.min(35, skillHits * 10) + (cityHit ? 20 : 0);
    if (!roleHits && skillHits) result = Math.min(result, 68);
    return Math.max(0, Math.min(100, result));
  }

  function rescore(values, preferences) {
    const now = Date.now();
    return (values || []).map(value => ({ ...value, matchScore: score(value, preferences), scoredAt: now }));
  }

  function deriveResumePreferences(saved = {}) {
    const profile = saved.profile && typeof saved.profile === 'object' ? saved.profile : {};
    const experiences = saved.experiences && typeof saved.experiences === 'object' ? saved.experiences : {};
    const roles = [];
    const cities = [];
    const add = (list, value) => {
      const normalized = text(value, 120).replace(/[，,;；|/\\]+/g, ' ').trim();
      if (normalized && !list.includes(normalized)) list.push(normalized);
    };
    for (const group of ['work', 'projects']) {
      for (const entry of Array.isArray(experiences[group]) ? experiences[group] : []) {
        add(roles, entry?.role);
        add(cities, entry?.location);
      }
    }
    add(cities, profile.city);
    return {
      roles: roles.join(', '),
      skills: text(profile.skills, 3000),
      cities: cities.join(', ')
    };
  }

  function mergePreferences(manual = {}, automatic = {}) {
    return {
      roles: [manual.roles, automatic.roles].filter(Boolean).join(', '),
      skills: [manual.skills, automatic.skills].filter(Boolean).join(', '),
      cities: [manual.cities, automatic.cities].filter(Boolean).join(', ')
    };
  }

  function summary(values) {
    const jobs = values || [];
    return {
      total: jobs.length,
      companies: new Set(jobs.map(job => job.company)).size,
      highMatch: jobs.filter(job => Number.isFinite(job.matchScore) && job.matchScore >= 70).length,
      unscored: jobs.filter(job => !Number.isFinite(job.matchScore)).length
    };
  }

  const api = { item, parseCsv, parseImport, merge, score, rescore, summary, classifyJobType, regionParts, formatRegion, deriveResumePreferences, mergePreferences, normalizeCompanyType };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CatalogData = api;
})();
