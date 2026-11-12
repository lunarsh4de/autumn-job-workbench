# 智能求职工作台：交互取舍与扩展入口

## 当前实现

发现页采用“先岗位类型，再组合筛选，最后展开公司”。同组多选取并集，不同组取交集；选项计数应用其他组条件并排除自身。已选零结果项保留，可逐项删除、单组清空、全部重置。省份改变时清理不兼容城市并提示。公司名称规范化后精确分组，过滤始终在分组前；展开按 50 条递增，不用模糊公司搜索代替展开。

保留原生 `details`、`checkbox`、`fieldset`，减少自制弹层对焦点、键盘和窄屏的额外负担。桌面显示浮层、窄屏展开在文档流。角色快捷片与所选标签重绘后恢复语义焦点。两种结果视图分别服务快速比较公司和逐行看岗位。

## 实际查阅的开源参考

2026-11-12 阅读 README、组件或文档，未复制源码、样式、品牌资产。

- [shadcn/ui tasks faceted filter](https://github.com/shadcn-ui/ui/blob/dd41d19e2f80ff6891951f7ced74c2c9a650b065/apps/v4/app/%28app%29/examples/tasks/components/data-table-faceted-filter.tsx)：参考所选数量、选项勾选、整组清除；这里以原生 DOM 重写。
- [TanStack Table faceting](https://github.com/TanStack/table/blob/c14e0221b1e656c7bb35e7b3d4cdf188719a3599/docs/framework/react/guide/column-faceting.md)：参考维度计数与过滤语义。
- [TanStack createFacetedRowModel](https://github.com/TanStack/table/blob/c14e0221b1e656c7bb35e7b3d4cdf188719a3599/packages/table-core/src/features/column-faceting/createFacetedRowModel.ts)：确认排除当前维度自身的计数规则。
- [JobSync](https://github.com/Gsync/jobsync/blob/8c20325c35dbf203334a270cef5aef446f06a774/src/components/myjobs/jobs-container/JobsFilterPopover.tsx)：参考职位、申请与下一步任务的分区，保留本项目适合中文长文本的布局。

## 账号与插件

Supabase 云账号只保存基础资料、手动偏好和申请记录。访客、云账号、其他账号和插件各有边界；没有静默上传或跨账号合并。需要导入插件已有岗位时，先退出云账号，在访客模式显式连接插件，完成本机同步后重新登录并点击“导入此浏览器的访客记录”。云账号内自动插件双向同步不在本次实现范围。

旧 Secret Gist 是扩展内的独立手动备份，可含简历附件，持有链接者可以访问；不能把它当作账号数据库。Supabase 配置与 RLS 步骤见 [账号部署说明](../supabase/README.md)。未配置项目时明确显示未启用，不展示假登录成功。

## 飞书与其他入口

| 方案 | 能解决什么 | 还需要什么 | 当前决定 |
|---|---|---|---|
| 飞书自定义群机器人 Webhook | 推送公开岗位摘要、更新失败提示 | 服务端签名密钥、限流、群管理员配置 | 可作后续通知，不新增个人数据通路 |
| 飞书应用机器人 | 命令搜索、个人消息、交互卡片 | 应用权限、事件回调、账号绑定、验签、重放保护、幂等操作队列 | 账号服务真实验收后再评估 |
| 飞书多维表格 | 团队共享公开岗位清单 | 表授权、同步适配、来源许可、字段映射 | 适合公开清单，不直接替代个人账号状态 |
| 网站 + 浏览器扩展 | 浏览招聘网站时记录与管理 | 当前浏览器授权连接 | 当前主要入口 |

飞书[自定义机器人说明](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)明确其只做当前群推送，无法接收 `@` 消息，卡片按钮不支持服务端回传。收藏或已投递写回不能只靠一个 Webhook。应用机器人必须把动作送入可信的操作队列，避免与网站/插件形成多个相互覆盖的状态来源。当前没有创建或配置机器人，也没有发送消息。
