const test = require('node:test');
const assert = require('node:assert/strict');
const { parseResumeText } = require('../resume-parser.js');

test('classifies contact details and multiple Chinese resume sections', () => {
  const result = parseResumeText(`林晓
138 0013 8000 | lin@example.com | https://example.com/lin

个人简介
专注数据产品与增长分析。

工作经历
星河科技 | 高级产品经理
2022.06 - 至今
负责数据平台与指标体系

云帆网络 | 产品经理
2019.07 - 2022.05
负责商业化产品

教育经历
同济大学 | 硕士 | 计算机科学
2016.09 - 2019.06

项目经历
经营分析平台 | 项目负责人
2023.01 - 2023.08
覆盖二十个业务团队

专业技能
Python SQL 数据分析`);
  assert.equal(result.profile.name, '林晓');
  assert.equal(result.profile.phone, '13800138000');
  assert.equal(result.profile.email, 'lin@example.com');
  assert.equal(result.experiences.work.length, 2);
  assert.equal(result.experiences.work[1].company, '云帆网络');
  assert.equal(result.experiences.education[0].school, '同济大学');
  assert.equal(result.experiences.projects[0].name, '经营分析平台');
  assert.equal(result.meta.detectedEntries, 4);
});

test('English headings and date ranges are recognized', () => {
  const result = parseResumeText(`Alex Chen
alex@example.com

Work Experience
Example Inc | Software Engineer
2021.03 - Present
Built internal tools

Education
Example University | Master of Science
2018.09 - 2021.01

Projects
Resume Assistant | Lead
2024.01 - 2024.06
Browser extension`);
  assert.equal(result.profile.name, 'Alex Chen');
  assert.equal(result.experiences.work[0].role, 'Software Engineer');
  assert.equal(result.experiences.education.length, 1);
  assert.equal(result.experiences.projects[0].role, 'Lead');
});

test('DOCX-style blank paragraphs and inline dates stay grouped by date range', () => {
  const result = parseResumeText(`张三
test@example.com

工作经历

产品经理 | 甲公司 2022.01-2023.01

负责产品规划

高级产品经理 | 乙公司 2023.02-至今

负责增长

项目经历

负责人 | 项目甲 2021.01-2021.06

项目说明甲

成员 | 项目乙 2021.07-2021.12

项目说明乙

专业技能：Axure、SQL`);
  assert.equal(result.experiences.work.length, 2);
  assert.equal(result.experiences.work[0].company, '甲公司');
  assert.equal(result.experiences.work[0].role, '产品经理');
  assert.equal(result.experiences.projects.length, 2);
  assert.equal(result.experiences.projects[0].name, '项目甲');
  assert.match(result.profile.skills, /Axure/);
});

test('bilingual header and untitled education block are classified correctly', () => {
  const result = parseResumeText(`LI Ming 李明
2027届硕士研究生｜中共党员｜江苏南京
Tel.: 13800138000｜Email: li@example.com
工业设计｜产品设计｜智能硬件开发

示例大学｜工程学院
创新设计与技术｜硕士
2026.09–至今
相关课程｜产品开发与应用编程

示例理工学院
工业设计｜工学学士
2020.09–2024.06
专业基础｜三维建模与交互设计

工作经历
示例公司
工业设计师
2024.06–2025.06
负责产品设计

岗位匹配与专业技能
三维设计与视觉
Rhino、KeyShot、Figma`);
  assert.equal(result.profile.name, '李明');
  assert.equal(result.profile.city, '江苏南京');
  assert.equal(result.experiences.education.length, 2);
  assert.equal(result.experiences.education[0].school, '示例大学');
  assert.equal(result.experiences.education[0].degree, '硕士');
  assert.equal(result.experiences.education[0].major, '创新设计与技术');
  assert.equal(result.experiences.education[1].school, '示例理工学院');
  assert.equal(result.experiences.education[1].degree, '工学学士');
  assert.equal(result.experiences.education[1].major, '工业设计');
  assert.match(result.profile.skills, /Rhino/);
});

test('award sections are classified without polluting the last project', () => {
  const result = parseResumeText(`张三
test@example.com
项目经历
项目甲 | 负责人
2023.01 - 2023.06
项目说明
专利与奖项
某项发明专利｜某项设计奖
资格证书
产品经理证书
专业技能
SQL、Python`);
  assert.equal(result.experiences.projects.length, 1);
  assert.equal(result.experiences.projects[0].description, '项目说明');
  assert.doesNotMatch(result.experiences.projects[0].description, /专利|证书/);
  assert.equal(result.experiences.awards[0].name, '某项发明专利｜某项设计奖');
  assert.match(result.profile.skills, /SQL/);
});

test('competition, language and publication sections are classified', () => {
  const result = parseResumeText(`李明
li@example.com
赛事经历
全国创新设计大赛 | 队长
2023.03 - 2023.08
完成智能硬件原型并获一等奖
语言能力
大学英语六级
580 分
论文/期刊
面向交互设计的研究
发表于示例期刊
第一作者`);
  assert.deepEqual(result.experiences.competitions[0], {
    name: '全国创新设计大赛', year: '', startDate: '2023.03', endDate: '2023.08', description: '队长\n完成智能硬件原型并获一等奖'
  });
  assert.deepEqual(result.experiences.languages[0], { name: '大学英语六级', description: '580 分' });
  assert.deepEqual(result.experiences.publications[0], {
    name: '面向交互设计的研究', description: '发表于示例期刊', result: '第一作者'
  });
});

test('awards preserve standalone year and campus experiences are classified', () => {
  const result = parseResumeText(`王五
wang@example.com
获奖经历
2024 年
全国大学生工业设计大赛一等奖
负责方案设计并获金奖
2023年
校级优秀学生干部
负责学生组织管理
校园经历
学生会 | 宣传部部长
2021.09 - 2023.06
组织校园活动与新媒体运营
社团经历
机器人协会 | 核心成员
2022.03 - 2023.05
参与竞赛和技术分享`);
  assert.deepEqual(result.experiences.awards[0], {
    name: '全国大学生工业设计大赛一等奖', year: '2024年', description: '负责方案设计并获金奖'
  });
  assert.deepEqual(result.experiences.awards[1], {
    name: '校级优秀学生干部', year: '2023年', description: '负责学生组织管理'
  });
  assert.equal(result.experiences.campus.length, 2);
  assert.deepEqual(result.experiences.campus[0], {
    name: '学生会', role: '宣传部部长', startDate: '2021.09', endDate: '2023.06', description: '组织校园活动与新媒体运营'
  });
  assert.deepEqual(result.experiences.campus[1], {
    name: '机器人协会', role: '核心成员', startDate: '2022.03', endDate: '2023.05', description: '参与竞赛和技术分享'
  });
});

test('multiple competitions with standalone years remain separate', () => {
  const result = parseResumeText(`赵六
zhao@example.com
比赛经历
2024 年
全国大学生创新大赛 | 队长
获得一等奖
2023年
省级工业设计竞赛 | 成员
获得二等奖`);
  assert.deepEqual(result.experiences.competitions, [{
    name: '全国大学生创新大赛', year: '2024年', startDate: '', endDate: '', description: '队长\n获得一等奖'
  }, {
    name: '省级工业设计竞赛', year: '2023年', startDate: '', endDate: '', description: '成员\n获得二等奖'
  }]);
});

test('inline year markers are retained for award records', () => {
  const result = parseResumeText(`钱七
qian@example.com
获奖经历
2024年｜全国设计大赛一等奖
方案获得评委认可
2023 年 校级优秀志愿者
服务时长 100 小时`);
  assert.deepEqual(result.experiences.awards, [{
    name: '全国设计大赛一等奖', year: '2024年', description: '方案获得评委认可'
  }, {
    name: '校级优秀志愿者', year: '2023年', description: '服务时长 100 小时'
  }]);
});

test('rejects image-only or unrelated short text', () => {
  assert.throws(() => parseResumeText('扫描件'), /过短/);
  assert.throws(() => parseResumeText('这是一段没有任何联系方式也没有经历标题的普通长文本内容。'), /未识别/);
});
