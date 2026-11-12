# 智能求职工作台 | Smart Job Workbench

一个面向个人求职者的本地优先求职管理工具。它把公开岗位源、岗位筛选、匹配评分、申请看板和投递记录放在同一个静态工作台中。

A local-first job search workspace for individual candidates. It combines public job feeds, job filtering, local matching, an application board, and application tracking in one static site.

## 2026-11-12 网站更新

- 岗位类型优先，多选筛选遵循组内 OR / 组间 AND，显示上下文数量、已选标签和单组清除。
- 先筛岗位再按公司折叠，默认收起；同公司展开每批 50 条，保留岗位列表视图。
- 公开来源每日 08:00 / 14:00（北京时间）自动整理；失败来源保留上次成功快照并标陈旧，成功零岗位会清除该来源旧数据，全源失败不覆盖上版。网页打开期间每 30 分钟及恢复可见/联网时检查。
- Supabase Auth GitHub + PKCE 账号接入与 RLS / 版本冲突保护已编写；**Supabase 项目与 GitHub provider 已配置，真实浏览器 OAuth 和云端持久化验收进行中**。配置步骤见 [supabase/README.md](supabase/README.md)。不向公共仓库保存个人资料或简历附件。
- 账号与访客空间隔离，不自动吸收插件记录；可先在访客模式连接插件，再登录显式导入访客快照。账号内插件双向云同步未实现。

交互参考与飞书取舍见 [docs/INTERACTION_OPTIONS.md](docs/INTERACTION_OPTIONS.md)。

飞书评估：自定义群机器人适合公开岗位摘要通知，不能处理收藏/阶段写回；应用机器人需要用户身份绑定、回调服务和操作队列。当前未创建机器人或发送通知，后续优先作为通知入口。

## v0.18.0 插件与网站同步

在线工作台：https://lunarsh4de.github.io/autumn-job-workbench/ 。插件更新后，在同一浏览器中打开网站并点击「连接插件」。岗位、阶段、备注和日程双向同步；网站关闭期间插件继续记录，下次打开补齐。失败时本机保留待同步修改。支持完整 JSON 备份恢复、并行字段合并与删除保护。同步范围是同一浏览器配置文件，简历附件及个人资料不经岗位同步桥传输。

发布包见 [Releases](https://github.com/lunarsh4de/autumn-job-workbench/releases)。用户场景、参考项目和验证范围见 [同步设计说明](resume-quick-apply/SYNC_DESIGN.md)。

## 功能 Features

- 省份 → 城市两级岗位筛选，以及公司关键字筛选。
- 中国大陆外企岗位单独归类与筛选；香港、新加坡和海外地点不会进入“外企（中国大陆）”结果。
- 自动岗位分类：技术研发、数据算法、产品项目、设计体验、运营市场等。
- CSV / JSON / Markdown / 公开 HTTPS JSON 导入，自动去重和标准化。
- 本地匹配评分、岗位详情和加入申请看板。
- GitHub Actions 定时刷新公开岗位源，GitHub Pages 发布静态工作台。
- 访客和插件资料保存在本机；配置 Supabase 后，可用 GitHub 登录保存账号基础资料、偏好和申请进度。
- 插件解析或切换简历档案后，工作台会在本地自动同步活动档案，并用岗位/技能/城市生成自动匹配偏好；手动偏好不会被覆盖。
- 支持在工作台上传 PDF、DOCX、TXT 简历，先本地解析预览，再更新简历档案和岗位匹配。
- 扩展工作台支持通过 GitHub OAuth Device Flow 保存到用户自己的 Secret Gist（不公开列出，持链接者可访问）；只请求 `gist` 权限，与网页版 Supabase 账号服务互相独立。

- Province-to-city filtering and company keyword search.
- A separate Mainland-China foreign-company filter; Hong Kong, Singapore, and overseas locations are excluded from that view.
- Automatic job categories such as engineering, data, product, design, operations, and sales.
- CSV / JSON / Markdown / public HTTPS JSON import with normalization and deduplication.
- Local matching, job details, and one-click tracking on the application board.
- Scheduled public-feed refresh through GitHub Actions and static deployment through GitHub Pages.
- Guest/plugin data stays local; optional Supabase accounts store explicitly selected profile fields, preferences, and application progress.
- Parsed or switched resume profiles sync locally to the workbench and refresh matching from roles, skills, and cities without overwriting manual preferences.
- PDF, DOCX, and TXT resumes can be uploaded in the workbench, reviewed locally, and applied to matching.
- The extension workbench can save a user-approved backup to the user's unlisted Secret GitHub Gist through the OAuth Device Flow with the `gist` scope.

## 在线使用 Online

GitHub Pages 会在首次推送后由 `Publish job workbench` 工作流部署。部署完成后，可从仓库的 **Actions → deploy** 或 **Settings → Pages** 查看公开地址。

After the first push, the `Publish job workbench` workflow deploys the static site to GitHub Pages. The public URL is shown in **Actions → deploy** or **Settings → Pages**.

## 隐私与边界 Privacy

本项目不在浏览器中绕过登录、验证码或反爬限制，也不把私人 Token 放进前端。公共岗位数据只读取配置中明确允许的公开来源；转载和再分发权限需要由仓库维护者自行确认。

The project does not bypass logins, CAPTCHAs, or anti-bot protections, and never puts private tokens in the frontend. Public job data is read only from explicitly configured public sources; the maintainer must verify redistribution rights.

详细扩展说明见 [`resume-quick-apply/README.md`](resume-quick-apply/README.md)。

See [`resume-quick-apply/README.md`](resume-quick-apply/README.md) for the detailed browser-extension documentation.
