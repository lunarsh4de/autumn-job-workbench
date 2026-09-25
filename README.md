# 个人秋招管理工作台 | Personal Autumn Job Workbench

一个面向个人求职者的本地优先秋招管理工具。它把公开岗位源、岗位筛选、匹配评分、申请看板和投递记录放在同一个静态工作台中。

A local-first job search workspace for individual candidates. It combines public job feeds, job filtering, local matching, an application board, and application tracking in one static site.

## 功能 Features

- 省份 → 城市两级岗位筛选，以及公司关键字筛选。
- 自动岗位分类：技术研发、数据算法、产品项目、设计体验、运营市场等。
- CSV / JSON / Markdown / 公开 HTTPS JSON 导入，自动去重和标准化。
- 本地匹配评分、岗位详情和加入申请看板。
- GitHub Actions 定时刷新公开岗位源，GitHub Pages 发布静态工作台。
- 个人资料、投递阶段、备注和评分偏好只保存在浏览器本地 IndexedDB / `chrome.storage.local`。

- Province-to-city filtering and company keyword search.
- Automatic job categories such as engineering, data, product, design, operations, and sales.
- CSV / JSON / Markdown / public HTTPS JSON import with normalization and deduplication.
- Local matching, job details, and one-click tracking on the application board.
- Scheduled public-feed refresh through GitHub Actions and static deployment through GitHub Pages.
- Personal profiles, application stages, notes, and preferences stay in the user's browser.

## 在线使用 Online

GitHub Pages 会在首次推送后由 `Publish job workbench` 工作流部署。部署完成后，可从仓库的 **Actions → deploy** 或 **Settings → Pages** 查看公开地址。

After the first push, the `Publish job workbench` workflow deploys the static site to GitHub Pages. The public URL is shown in **Actions → deploy** or **Settings → Pages**.

## 隐私与边界 Privacy

本项目不在浏览器中绕过登录、验证码或反爬限制，也不把私人 Token 放进前端。公共岗位数据只读取配置中明确允许的公开来源；转载和再分发权限需要由仓库维护者自行确认。

The project does not bypass logins, CAPTCHAs, or anti-bot protections, and never puts private tokens in the frontend. Public job data is read only from explicitly configured public sources; the maintainer must verify redistribution rights.

详细扩展说明见 [`resume-quick-apply/README.md`](resume-quick-apply/README.md)。

See [`resume-quick-apply/README.md`](resume-quick-apply/README.md) for the detailed browser-extension documentation.
