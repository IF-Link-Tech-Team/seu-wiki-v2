# PR #17 订阅修订测试报告

验证日期：2026-11-06。基线：已合并 `origin/main` 的 #18、#19。

## 自动化结果

- `npm run typecheck`：通过。
- 独立空测试库：47 个迁移全部通过，包含 `0050_member_subscription_profiles.sql`。
- Windows 可运行后端套件：252 项通过、0 项失败。仓库本地工具按既有约定跳过仅适用于 POSIX `SIGTERM` 的 `analyze-shutdown` 与 `translate-shutdown`，由 Linux CI 验证。
- 订阅与会员定向套件：55 项通过、0 项失败，覆盖登录回跳、试验开关、画像账号隔离、标签校验、CSRF/Origin、修订冲突、清除、并列身份对象句和订阅读取边界。
- Web 生产构建：通过。
- Web 测试：18 项通过、0 项失败，覆盖开关关闭、未登录门禁、首次调查、数据库读取失败不冒充首次使用、回跳路径和气泡布局。
- 本地冒烟：站点、API、RSS、MCP、静态资源等检查全部通过；匿名访问 `/subscription` 返回 200、显示登录解锁提示且不渲染画像 iframe。

## 尚未完成的真实验收

- 团队尚未提供允许 localhost 回调的测试版 Logto／Accounts 应用，因此没有连接生产账户服务，也没有用真实账户验证首次建档、搜索 query/文章/订阅回跳、跨浏览器恢复、切换账号和统一会话撤销。
- 远端 Logto 无法调用本机 back-channel logout 地址；需在团队 HTTPS 测试站补验。
- 产品与正式隐私条款评审、Linux check 与 Docker CI 由 PR 流程完成。上述项目完成前，PR 保持 Draft，生产试验开关保持关闭。
