# 订阅试验的统一账号本地联调清单

本清单依据 IF.Link Accounts 仓库的 `docs/site-integration.md` 整理。目标是让本机 Wiki 使用团队的**测试版** Logto 与 Accounts；不要连接生产账户服务，也不要为了 localhost 放宽生产白名单。

## 管理员需要准备

1. 提供测试版 Logto 和 Accounts 地址。
2. 在测试 Logto 创建 Wiki 独立的 Traditional Web 应用，例如 `IF.Link SEU Wiki Local Web`，不得复用官网、论坛或生产 Wiki 的 Secret。
3. 只为该应用登记精确开发地址：
   - Redirect URI：`http://localhost:3000/api/logto/sign-in-callback`
   - Post sign-out redirect URI：`http://localhost:3000`
   - localhost 仅加入测试 tenant 的开发配置。
4. 创建 Wiki 独立的 M2M 应用，只授予 Accounts API 的 `users:resolve` 权限；把该客户端 ID 加入测试 Accounts 的 `LOGTO_M2M_ALLOWED_CLIENT_IDS`。
5. 把固定完成地址 `http://localhost:3000/api/logto/bootstrap-complete` 精确加入测试 Accounts 的 `BOOTSTRAP_RETURN_TO_URLS`。不得加入任意页面、通配符或跨域地址。
6. 真实测试站上线时再登记 `https://<测试站>/api/logto/backchannel-logout` 并启用 “Backchannel logout session required”。远端 Logto 无法调用本机 localhost，此链路在本机只做自动化验证。

## 本机配置模板

只把真实值写入不提交的 `.env`：

```dotenv
SUBSCRIPTION_EXPERIMENT_ENABLED=true

LOGTO_ENDPOINT=<测试 Logto 地址>
LOGTO_APP_ID=<Wiki Local Web App ID>
LOGTO_APP_SECRET=<仅服务端保存>
LOGTO_COOKIE_SECRET=<至少 32 位随机字符>
LOGTO_BASE_URL=http://localhost:3000

ACCOUNTS_URL=<测试 Accounts 地址>
ACCOUNTS_API_RESOURCE=<测试 Accounts API resource>
ACCOUNTS_M2M_APP_ID=<Wiki Local M2M App ID>
ACCOUNTS_M2M_APP_SECRET=<仅服务端保存>
```

本机还需要执行数据库迁移。订阅画像存在 Wiki 自己的数据库，Accounts 只提供稳定 UUID 和撤销状态，不保存 Wiki 的兴趣画像。

## 验收状态

- 自动化桩可验证：站内回跳消毒、Accounts UUID 建档、会话撤销 fail closed、画像账号隔离、CSRF/Origin、并发修订冲突和开关关闭时 404。
- 待团队提供测试环境后人工验证：真实登录、首次 Accounts 建档回跳、开启订阅后的 `/welcome` 画像弹窗及保存后进入订阅、关闭开关时搜索 query/文章页原路径回跳、后台/机构回跳、跨浏览器恢复、切换账号、中心会话撤销。当前产品流程见 [订阅上线验收](subscription-release.md)。
- 远端 back-channel logout 到 localhost 不作为真实链路验收；必须在团队 HTTPS 测试站补验。
- 完成产品与隐私评审、真实界面和登录链路验收前，PR 保持 Draft，生产环境保持开关关闭。
