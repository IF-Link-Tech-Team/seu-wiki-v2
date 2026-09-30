# SEU Wiki 生产部署清单（iflink-prod / seu.wiki）

> 状态：2026-09-30 部署到 iflink-prod `/srv/seuwiki-v2`（web 在 127.0.0.1:3700），验收后切流。目标服务器
> iflink-prod（Ubuntu、Docker 29 + Compose 2.40、16G 内存），域名 seu.wiki（备案已完成，备案号待填）。
> 旧站保持可用，新站验收通过后才切流（改宿主机 Caddy，见 §5）。
> 通用机制（容器构成、更新、备份、费用）见 [deploy.md](../docs/deploy.md)，本清单只写 SEU Wiki 的差异。

## 1. 服务器准备

```bash
# 代码：git clone（仓库就绪后）。本地直推用 rsync 也行：
git clone <seuwiki-repo-url> seuwiki
cd seuwiki
```

**不要把 `docker-compose.override.yml` 拷到服务器**——它只在本地用（把数据库 5432 暴露到宿主机跑测试/调试）。
compose 默认自动加载 override；服务器上没有它，`db` 就不监听任何宿主机端口（已验证：不带 override 的
`docker compose config` 里 db 无 ports）。

防火墙/安全组放行 80、443（Caddy 用）；3000/3001 不对外（web 绑 `127.0.0.1:3000`，api 只在容器网络里）。

## 2. 生产 .env 字段清单

```bash
# ── 站点 ──
SITE_URL=https://seu.wiki
SITE_DOMAIN=seu.wiki
PORT=127.0.0.1:3000        # web 只给本机的 Caddy 用，不直接对外
TRUST_PROXY=true           # 访客地址从 Caddy 的 X-Forwarded-For 读

# ── 密钥（openssl rand -hex 32 各生成一个）──
SESSION_SECRET=
IMG_PROXY_SIGN_SECRET=
POSTGRES_PASSWORD=

# ── 模型（待给 Key；DeepSeek 写法示例）──
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=
# LLM_MODEL=

# ── IF.Link 统一账户（联调后填；缺任何一项账号功能自动关闭、后台不可用、站点其余正常）──
LOGTO_ENDPOINT=https://auth.iflink.tech
LOGTO_APP_ID=
LOGTO_APP_SECRET=
LOGTO_COOKIE_SECRET=       # openssl rand -hex 32
LOGTO_BASE_URL=https://seu.wiki
ACCOUNTS_URL=https://accounts.iflink.tech
ACCOUNTS_API_RESOURCE=https://accounts.iflink.tech/api
ACCOUNTS_M2M_APP_ID=
ACCOUNTS_M2M_APP_SECRET=

# ── 安全阀：上线顺序见 §4 ──
COLLECT_ENABLED=false      # 先 false，内容链路验证后再开
MODEL_CALLS_ENABLED=false  # 先 false，LLM_API_KEY 到位后再开

# ── 备份（S3 兼容对象存储，开了才每天 04:10 自动备份）──
# DB_BACKUP_STORE_SECRET_ID= / SECRET_KEY= / BUCKET= / REGION= / DOMAIN=

# 生产环境绝不能设：DEV_ADMIN_BYPASS、DEV_AUTH_*、ALLOW_PRIVATE_NETWORK_FETCH
# （assertProductionSecrets 会拒绝启动）。本地改前端才用 DEV_ADMIN_BYPASS=true。
```

**ICP 备案号**：拿到后填 `industry/site.ts` 的 `icp` 字段（页脚显示并链接备案系统），重新构建生效。

## 3. HTTPS 与对外链路（实际架构，2026-09-30 核实）

seu.wiki 的 DNS 已接入腾讯 EdgeOne CDN（`seu.wiki.eo.dnse2.com`）：浏览器 ↔ EdgeOne 走 HTTPS，EdgeOne 回源到
iflink-prod 的 80 端口，由宿主机 Caddy（`/etc/caddy/sites/seuwiki.caddy`）按 Host 分流。**所以本栈不需要自己的
Caddy/证书**，起栈用普通 `docker compose up -d`（不要带 `--profile https`），web 只绑 `127.0.0.1:3700`。

**切换与回退都在 `/etc/caddy/sites/seuwiki.caddy`**（见 §5），不动 DNS、不动 EdgeOne。

注意：EdgeOne 回源是 HTTP，宿主机 Caddy 上 seu.wiki 只有 `http://` 站点块。`TRUST_PROXY=true` 让 web 从
X-Forwarded-For 取访客地址；cookie 的 Secure 由 `LOGTO_BASE_URL=https://…` 决定（浏览器侧确实是 HTTPS）。

## 4. 首次启动顺序

```bash
# 1) 安全阀关闭状态下起栈（setup 容器先跑 migrate + seed，再拉起 api/worker/web）
docker compose up -d --build

# 2) 冒烟（先本机回环地址，切换后再用 https://seu.wiki）
curl -s http://127.0.0.1:3700/api/health
docker compose exec web node scripts/smoke.ts --base http://127.0.0.1:3700

# 3) 导入知识内容（手册/经验；仓库里有 scripts/import-seuwiki-docs.ts，默认读 ../seu-wiki）
#    服务器上旧站 Astro 仓库在 /srv/seuwiki/app：
docker compose exec api node scripts/import-seuwiki-docs.ts /srv/seuwiki/app

# 4) LLM_API_KEY 到位：MODEL_CALLS_ENABLED=true 重启 → 后台"运行"页看分析任务
# 5) 信源核对后 COLLECT_ENABLED=true 重启 → 后台"信源"页看抓取
# 6) IF.Link 联调完成、9 个变量填齐 → /admin 用社区账户登录（需 community_admin 角色）
```

## 5. 旧站切换与回退

- 旧栈（`/srv/seuwiki` 的 Astro 站 + seuwiki-pipeline 容器）全部保持运行，不下线、不动数据。
- **切换**：把 `/etc/caddy/sites/seuwiki.caddy` 里 `http://seu.wiki` 块的 reverse_proxy 目标从旧站
  （Astro `172.30.22.3:80` / pipeline `127.0.0.1:18001`）改成新栈 `127.0.0.1:3700`，然后
  `sudo systemctl reload caddy`（或 `caddy reload --config /etc/caddy/Caddyfile`）。改动前备份该文件。
- **回退**：恢复原 `seuwiki.caddy` 再 reload，秒级完成。旧栈一直在跑，回退即恢复。
- 手册/经验的新站 URL 与旧站逐条一致（slug 规则相同），6 个"已迁移"页有 301 映射，`/news/`、`/contribute/`
  有入口重定向——切换后旧链接不失效。

## 6. 备份

按 deploy.md：`.env` 配 `DB_BACKUP_STORE_*`（S3 兼容存储）后每天 04:10 自动备份。手动导出：

```bash
docker compose exec -T db pg_dump -U aihot aihot | gzip > seuwiki-$(date +%F).sql.gz
```

数据在三个卷：`db`（数据库）、`data`（上传、缓存）、`caddy`（证书）。`down` 不删卷，`down -v` 才删。

## 7. 验收清单

**本站功能冒烟**（smoke.ts 之外手工过一遍）：
- / 精选、/all 搜索（搜"保研"应同时命中动态与手册）、/for-you（画像条+理由 chip）、/survival 手册目录与连续阅读、/experience 三维筛选、/org/login 组织登录
- 旧路径：`/news/` → 301 /all；`/contribute/` → 301 /feedback；手册 6 个兼容页 301 到经验库
- RSS /feed.xml、sitemap.xml、/api/health

**IF.Link 登录验收**（联调后，对照接入指南 §5）：
- [ ] Logto 控制台：SEU Wiki 独立 Traditional Web 应用，Redirect URI 只填 `https://seu.wiki/api/logto/sign-in-callback`，Post sign-out 只填 `https://seu.wiki`，scope ≥ `email profile roles`，backchannel logout 填 `https://seu.wiki/api/logto/backchannel-logout` 并打开 session required
- [ ] M2M 应用授 `users:resolve`，App ID 加入 Accounts 的 `LOGTO_M2M_ALLOWED_CLIENT_IDS`
- [ ] Accounts `BOOTSTRAP_RETURN_TO_URLS` 只登记 `https://seu.wiki/api/logto/bootstrap-complete`
- [ ] 深层页面（/admin、/for-you）发起登录 → 完成后 302 回原页面；return cookie 已删；非法回 `/`
- [ ] 无 `community_admin` 角色进 /admin → 403；有角色 → 进后台；撤权后旧会话失效
- [ ] 伪造 Origin / 缺 CSRF 的写请求 403
- [ ] 断开 Accounts 时账号入口显示"暂时不可用"，后台 fail closed

## 待用户提供

- LLM_API_KEY（已用 MiniMax M3.1-Flash，2026-09-30 配置）
- ICP 备案号（填 `industry/site.ts` 的 `icp`）
- ~~IF.Link 联调~~（2026-09-30 完成：Logto 应用 `fssvaktudlraf9ab2sygh`、M2M `6tev8am9i56i45y5xkrsa` 授
  `users:resolve`、Accounts 白名单已加 `https://seu.wiki/api/logto/bootstrap-complete`）
- seu-wiki 旧站仓库在服务器上的位置（已有：`/srv/seuwiki/app`，知识内容导入用）
