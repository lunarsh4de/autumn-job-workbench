# GitHub 登录与账号云保存

现有 GitHub Pages 地址保持不变。账号服务使用 Supabase Auth 的 GitHub OAuth、官方 SDK 的 PKCE 会话和 Postgres。无 Supabase 配置时，网站显示“尚未启用”，访客本机模式继续可用。

## 首次启用

1. 新建 Supabase 项目，在 SQL Editor 执行 `schema.sql`。保留 RLS；不要开放匿名读写。
2. 在 GitHub Developer Settings 新建 OAuth App。Homepage URL 填 `https://lunarsh4de.github.io/autumn-job-workbench/`；Authorization callback URL 填 Supabase 控制台 GitHub provider 显示的回调地址（通常为 `https://PROJECT.supabase.co/auth/v1/callback`）。
3. Supabase → Authentication → Sign In / Providers → GitHub，填 Client ID 与 Client Secret，启用 provider。GitHub secret 只放 Supabase，不能放仓库、前端或 Actions 普通变量。
4. Supabase → URL Configuration：Site URL 和允许的 Redirect URLs 均设为 `https://lunarsh4de.github.io/autumn-job-workbench/`。避免通配符；本机联调如确有需要，单独加入准确的 `http://127.0.0.1:4173/`，并在本机配置中使用相同地址。
5. GitHub 仓库 Actions variables 配置 `PUBLIC_SUPABASE_URL` 和 `PUBLIC_SUPABASE_PUBLISHABLE_KEY`。可使用 Supabase publishable key 或旧版 `anon` key；**绝不能使用 service_role / secret key**。发布流程只把公开配置写入 `account-config.js`。
6. 重新运行 Pages workflow。使用两个不同 GitHub 账号，在两个独立浏览器会话中完成下方验收。

## 本机预览

在工作台目录启动静态服务器，打开 `/resume-quick-apply/dashboard.html`。账号服务默认未配置；浏览、导入与本机管理可直接预览。需要真实登录时，在未提交的本机配置副本中填入公开项目配置，使用 SQL 已初始化的专用开发项目，并将实际预览 URL 加入 Supabase 白名单。

SDK 由锁定依赖本地打包：在 `resume-quick-apply` 运行 `npm run build:auth`。产物不加载远程 JavaScript；版本及 MIT 许可证来自 `@supabase/supabase-js`。浏览器会话由 SDK 保存在本机 localStorage，这是 SPA 的会话模型；不要在共用设备保持登录。此代码未申请 Gist 权限，也不将 GitHub provider token 写入账号资料。

## 数据与隔离

- 云保存白名单：用户填写的姓名、学校、学历、毕业时间、目标岗位、邮箱；手动匹配偏好；收藏岗位、投递阶段、备注及日程。简历附件、插件简历全文/结构化经历、GitHub Gist token、公共岗位全集不进入账号 payload。
- 访客模式保留旧浏览器键；账号使用 `smart-job:user:<uid>:` 键和独立 IndexedDB。首次登录不上传访客、插件或其他账号数据。用户可显式“导入此浏览器的访客记录”。
- 账号空间不自动连接插件。插件继续在本机维护其数据；退出账号后可在访客模式连接。旧 Secret Gist 手动备份独立保留，仅在插件内使用，且持有链接者可以访问。
- RLS 只允许读取 `auth.uid() = user_id`。匿名无访问权限。写操作仅开放给鉴权 RPC，所有权仅取数据库 `auth.uid()`；前端 `expected_user_id` 仅用于会话一致性校验，不能指定写入他人账号。乐观版本号加数据库锁防止两台设备静默覆盖；冲突保留本机副本，用户先导出，再重新读取云端。
- 退出保留该账号本机缓存；切换账号按 uid 隔离并刷新页面。云端读写带调用代次检查；旧会话完成的请求不应用到新账号界面。

## 上线前验收

真实服务配置后检查：匿名查询被拒绝；A 无法查询/修改 B；新账号空间为空；明确导入后仅出现访客白名单字段；换账号不出现 A 的资料；退出回到访客；两台设备同时保存旧版本会显示冲突；离线保存后恢复可重试；附件不出现在数据库；OAuth 取消/回调异常有错误反馈。当前未配置真实项目时，这些远端验收不能声称已通过。

## 运维

SQL 以 `if not exists` / `create or replace` 为主，可重复执行。不要在生产取消 RLS。备份 Postgres；删除 Supabase Auth 用户会级联删除其账号数据。公开仓库只保存程序、SQL 和公开配置，不保存个人资料。账号表不属于公共岗位采集与 Pages 工件输入。
