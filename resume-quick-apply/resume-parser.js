// Local resume text classification. Parsing is intentionally heuristic and always reviewable.
(() => {
  const headings = {
    work: /^(?:工作经历|工作经验|职业经历|实习经历|任职经历|employment|work experience|professional experience)\s*(?:[:：|｜/-].*)?$/i,
    education: /^(?:教育经历|教育背景|学历经历|education|academic background)\s*(?:[:：|｜/-].*)?$/i,
    projects: /^(?:项目经历|项目经验|代表项目|projects?|project experience)\s*(?:[:：|｜/-].*)?$/i,
    competitions: /^(?:赛事经历|竞赛经历|比赛经历|competitions?|contest experience)\s*(?:[:：|｜/-].*)?$/i,
    awards: /^(?:专利与奖项|荣誉奖项|获奖经历|奖项|awards?|honors?|patents?(?:\s+and\s+awards?)?)\s*(?:[:：|｜/-].*)?$/i,
    campus: /^(?:校园经历|校园实践|学生工作|学生干部经历|社会实践|社团经历|课外活动|campus experience|student activities|extracurricular activities)\s*(?:[:：|｜/-].*)?$/i,
    languages: /^(?:语言能力|语言证书|外语能力|languages?|language skills?)\s*(?:[:：|｜/-].*)?$/i,
    publications: /^(?:论文\/期刊|论文|期刊|出版物|publications?|papers?)\s*(?:[:：|｜/-].*)?$/i,
    skills: /^(?:(?:岗位匹配与)?专业技能|技能清单|核心技能|技能|skills?|technical skills?)\s*(?:[:：|｜/-].*)?$/i,
    summary: /^(?:个人简介|自我介绍|个人总结|职业概述|summary|profile|about me)\s*(?:[:：|｜/-].*)?$/i
  };
  const boundaryHeading = /^(?:证书|资格证书|志愿经历|培训经历|兴趣爱好|certifications?|volunteer(?:ing)?|interests?)\s*(?:[:：|｜/-].*)?$/i;
  function headingText(line) {
    return line.replace(/^[•·●▪◆▶>-]\s*/, '').replace(/^(?:[一二三四五六七八九十]+|\d+)\s*[、.)．]\s*/, '').trim();
  }
  const headingMatches = (pattern, line) => pattern.test(headingText(line));
  const anyHeading = line => headingMatches(boundaryHeading, line) || Object.values(headings).some(pattern => headingMatches(pattern, line));
  const dateRange = /((?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?|至今|现在|present|current)\s*(?:-|–|—|~|～|至|到)\s*((?:19|20)\d{2}(?:[./年-]\d{1,2}月?)?|至今|现在|present|current)/i;

  function normalize(text) {
    if (typeof text !== 'string') throw new Error('没有读取到可解析的简历文本。');
    return text.replace(/\0/g, '').replace(/\r/g, '').replace(/[\t\u00a0]+/g, ' ')
      .replace(/[ ]{2,}/g, ' ').split('\n').map(line => line.trim()).join('\n').slice(0, 200000);
  }

  function section(lines, type) {
    const start = lines.findIndex(line => headingMatches(headings[type], line));
    if (start < 0) return [];
    const normalizedHeading = headingText(lines[start]);
    const inline = normalizedHeading.split(/[:：]/).slice(1).join('：').trim();
    const content = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (anyHeading(lines[index])) {
        if (headingMatches(headings[type], lines[index])) continue;
        break;
      }
      content.push(lines[index]);
    }
    return [...(inline ? [inline] : []), ...content];
  }

  function compact(lines) {
    return lines.map(line => line.replace(/^[•·●▪◆▶>-]\s*/, '').trim()).filter(Boolean);
  }

  function blocks(lines, includeYear = false) {
    const clean = compact(lines);
    const yearLine = /^(?:19|20)\d{2}\s*年?(?:\s*[|｜:：-]\s*|\s+).+/;
    const anchors = clean.flatMap((line, index) => dateRange.test(line) || (includeYear && (/^(?:19|20)\d{2}\s*年?$/.test(line) || yearLine.test(line))) ? [index] : []);
    if (anchors.length < 2) return clean.length ? [clean] : [];
    const starts = [0];
    for (let index = 1; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const yearOnly = /^(?:19|20)\d{2}\s*年?(?:\s*[|｜:：-]\s*|\s+).+/.test(clean[anchor]) || /^(?:19|20)\d{2}\s*年?$/.test(clean[anchor]);
      const titleOnDateLine = yearOnly || clean[anchor].replace(dateRange, '').trim().length > 1;
      const previous = clean[anchor - 1] || '';
      const beforePrevious = clean[anchor - 2] || '';
      const previousLooksCombined = /[|｜]/.test(previous);
      const educationPair = /博士|硕士|本科|学士|大专|专科|mba|ph\.?d|master|bachelor/i.test(previous) &&
        /大学|学院|college|university|school/i.test(beforePrevious);
      starts.push(Math.max(starts[index - 1] + 1, titleOnDateLine ? anchor : anchor - (previousLooksCombined && !educationPair ? 1 : 2)));
    }
    return starts.map((start, index) => clean.slice(start, starts[index + 1] ?? clean.length)).filter(group => group.length);
  }

  function dates(text) {
    const match = dateRange.exec(text);
    return match ? { startDate: match[1], endDate: match[2] } : { startDate: '', endDate: '' };
  }

  function splitTitle(line) {
    return line.split(/\s*[|｜·•]\s*/).map(value => value.trim()).filter(Boolean);
  }

  function parseWork(group) {
    const lines = compact(group);
    const range = dates(lines.join(' '));
    const details = lines.map(line => line.replace(dateRange, '').trim()).filter(Boolean);
    const first = splitTitle(details[0] || '');
    const companyPattern = /公司|集团|研究院|事务所|工作室|company|inc\.?|corp\.?|ltd\.?|studio|institute/i;
    const company = first.find(value => companyPattern.test(value)) || first[0] || '';
    const role = first.find(value => value !== company) || details[1] || '';
    const used = first.length > 1 ? 1 : Math.min(details.length, 2);
    return { company, role, location: '', ...range, description: details.slice(used).join('\n') };
  }

  function parseEducation(group) {
    const lines = compact(group);
    const range = dates(lines.join(' '));
    const details = lines.map(line => line.replace(dateRange, '').trim()).filter(Boolean);
    const tokens = details.slice(0, 3).flatMap(splitTitle).filter(Boolean);
    const school = tokens.find(value => /大学|学院|college|university|school/i.test(value)) || tokens[0] || '';
    const degree = tokens.find(value => /博士|硕士|本科|学士|大专|专科|mba|ph\.?d|master|bachelor|college/i.test(value)) || '';
    const major = tokens.find(value => value !== school && value !== degree && !/学院|faculty|school/i.test(value) &&
      /专业|工程|科学|管理|经济|金融|计算机|设计|技术|法律|文学|学|major/i.test(value)) || '';
    return { school, degree, major, ...range, description: details.slice(Math.min(details.length, 2)).join('\n') };
  }

  function parseProject(group) {
    const lines = compact(group);
    const range = dates(lines.join(' '));
    const details = lines.map(line => line.replace(dateRange, '').trim()).filter(Boolean);
    const first = splitTitle(details[0] || '');
    const rolePattern = /负责人|成员|队长|组长|部长|主席|委员|干事|志愿者|设计师|工程师|班长|主任|角色|owner|lead|captain|member|designer|engineer/i;
    const role = first.find(value => rolePattern.test(value)) || (/负责人|成员|角色|owner|lead/i.test(details[1] || '') ? details[1] : '');
    const name = first.find(value => value !== role) || first[0] || '';
    return { name, role, ...range, description: details.slice(role ? (first.length > 1 ? 1 : 2) : 1).join('\n') };
  }

  function parseCompetition(group) {
    const lines = compact(group);
    const range = dates(lines.join(' '));
    const year = range.startDate ? '' : standaloneYear(lines.join(' '));
    const details = lines.map(line => line.replace(dateRange, '').replace(/(?:19|20)\d{2}\s*年?/g, '').replace(/^[|｜:：-]\s*/, '').trim()).filter(Boolean);
    const first = splitTitle(details[0] || '');
    const rolePattern = /负责人|成员|队长|组长|部长|主席|委员|干事|志愿者|角色|owner|lead|captain|member/i;
    const role = first.find(value => rolePattern.test(value)) || '';
    const name = first.find(value => value !== role) || first[0] || '';
    return { name, year, startDate: range.startDate, endDate: range.endDate,
      description: [role, details.slice(role ? (first.length > 1 ? 1 : 2) : 1).join('\n')].filter(Boolean).join('\n') };
  }

  function standaloneYear(text) {
    return text.match(/(?:19|20)\d{2}(?:\s*年)?/)?.[0]?.replace(/\s+/g, '') || '';
  }

  function parseAward(group) {
    const lines = compact(group);
    const year = standaloneYear(lines.join(' '));
    const details = lines.map(line => line.replace(/(?:19|20)\d{2}\s*年?/g, '').replace(/^[|｜:：-]\s*/, '').trim()).filter(Boolean);
    return { name: details[0] || '', year, description: details.slice(1).join('\n') };
  }

  function parseCampus(group) {
    const project = parseProject(group);
    return { name: project.name, role: project.role, startDate: project.startDate, endDate: project.endDate,
      description: project.description };
  }

  function parseSimple(group, type) {
    const lines = compact(group);
    const keys = type === 'publications' ? ['name', 'description', 'result'] : ['name', 'description'];
    return Object.fromEntries(keys.map((key, index) => [key, index === keys.length - 1 && keys.length > 2
      ? lines.slice(index).join('\n') : (lines[index] || '')]));
  }

  function parseResumeText(input) {
    const text = normalize(input);
    if (text.trim().length < 20) throw new Error('简历文本过短，无法可靠分类。');
    const lines = text.split('\n');
    const nonempty = compact(lines);
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
    const rawPhone = text.match(/(?:\+?86[- ]?)?1[3-9]\d(?:[- ]?\d){8}/)?.[0] || '';
    const phone = rawPhone.replace(/^(?:\+?86)/, '').replace(/\D/g, '');
    const website = text.match(/https?:\/\/[^\s，。；;]+/i)?.[0] || '';
    const firstHeading = lines.findIndex(anyHeading);
    const header = compact(lines.slice(0, firstHeading < 0 ? Math.min(lines.length, 12) : firstHeading));
    const name = header.slice(0, 3).map(line => splitTitle(line)[0]?.replace(/^(?:姓名|name)\s*[:：]\s*/i, '') || '')
      .map(line => {
        const chinese = line.match(/[\u4e00-\u9fff·]{2,6}/)?.[0];
        if (chinese && /[A-Za-z]/.test(line)) return chinese;
        if (/^[\u4e00-\u9fff·]{2,6}$/.test(line) || /^[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(line)) return line;
        return '';
      }).find(Boolean) || '';
    const city = header.map(line => line.split(/[|｜]/).map(value => value.trim()).pop())
      .find(value => /^[\u4e00-\u9fff]{2,6}$/.test(value || '') && !/党员|团员|学生|研究生|本科|硕士|博士/.test(value)) || '';
    const skillLines = compact(section(lines, 'skills'));
    const summaryLines = compact(section(lines, 'summary'));
    const work = blocks(section(lines, 'work')).map(parseWork).filter(item => Object.values(item).some(Boolean)).slice(0, 20);
    let educationLines = section(lines, 'education');
    if (!educationLines.length) {
      const firstLaterSection = lines.findIndex(line => headingMatches(headings.work, line) || headingMatches(headings.projects, line) || headingMatches(headings.campus, line) || headingMatches(headings.competitions, line) || headingMatches(headings.awards, line));
      const before = compact(lines.slice(0, firstLaterSection < 0 ? lines.length : firstLaterSection));
      const firstEducationDate = before.findIndex(line => dateRange.test(line));
      if (firstEducationDate >= 2) educationLines = before.slice(firstEducationDate - 2);
    }
    const education = blocks(educationLines).map(parseEducation).filter(item => Object.values(item).some(Boolean)).slice(0, 20);
    const projects = blocks(section(lines, 'projects')).map(parseProject).filter(item => Object.values(item).some(Boolean)).slice(0, 20);
    const competitions = blocks(section(lines, 'competitions'), true).map(parseCompetition).filter(item => Object.values(item).some(Boolean)).slice(0, 20);
    const awards = blocks(section(lines, 'awards'), true).map(parseAward).filter(item => Object.values(item).some(Boolean)).slice(0, 20);
    const campus = blocks(section(lines, 'campus')).map(parseCampus).filter(item => Object.values(item).some(Boolean)).slice(0, 20);
    const languages = blocks(section(lines, 'languages')).map(group => parseSimple(group, 'languages')).filter(item => Object.values(item).some(Boolean)).slice(0, 20);
    const publications = blocks(section(lines, 'publications')).map(group => parseSimple(group, 'publications')).filter(item => Object.values(item).some(Boolean)).slice(0, 20);
    const profile = {
      name, phone, email, city,
      education: education[0]?.degree || '', school: education[0]?.school || '',
      skills: skillLines.join('、').slice(0, 1000), website,
      summary: summaryLines.join('\n').slice(0, 10000)
    };
    const detectedFields = Object.values(profile).filter(Boolean).length;
    const detectedEntries = work.length + education.length + projects.length + competitions.length + awards.length + campus.length + languages.length + publications.length;
    if (!detectedFields && !detectedEntries) throw new Error('未识别到联系方式或经历分区，请确认简历包含可复制文字。');
    return {
      profile,
      experiences: { work, education, projects, competitions, awards, campus, languages, publications },
      meta: { detectedFields, detectedEntries, textLength: text.length }
    };
  }

  const api = { parseResumeText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.ResumeParser = api;
})();
