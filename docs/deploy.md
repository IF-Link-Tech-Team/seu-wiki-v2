# 部署

## 用 Docker（推荐）

需要一台装了 Docker（带 Compose）的机器。云服务器建议至少 2 核、4 GB 内存，构建镜像时要用到。

```bash
git clone https://github.com/IF-Link-Tech-Team/seu-wiki-v2.git seuwiki
cd seuwiki
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

`init-env.ts` 会生成 `.env` 并填好随机密钥。机器上没有 Node 的话，把 `.env.example` 复制成 `.env`，自己填 `SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`、`POSTGRES_PASSWORD`（各用 `openssl rand -hex 32` 生成）和 `LLM_API_KEY`。

启动后打开 `http://服务器地址:3000`，后台在 `/admin`，用 IF.Link 统一账户登录（需要社区管理员角色）。第一次启动会导入示范信源，一两分钟后开始出现内容；第一次导入的一百多条资料大约半小时处理完（每条都要预筛、评分，入选的还要写标题摘要）。

`docker compose` 会起五个容器：`db`（PostgreSQL 17）、`setup`（每次启动先跑数据库迁移和种子数据，然后退出）、`api`、`worker`（抓取、模型处理、定时任务）、`web`（网页）。

### 在中国大陆的服务器上

- 构建时 npm 走国内镜像：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`，然后 `docker compose up -d`。
- 拉取 Docker 镜像慢，先给 Docker 配置镜像加速。
- 海外信源抓不到时，在 `.env` 里设置 `EGRESS_PROXY_URL`：抓信源、图片和模型榜数据时走这个代理，调用模型接口不走。
- 对外提供网站服务需要先完成 ICP 备案，备案号填在 `industry/site.ts` 的 `icp`。

### 配域名和 HTTPS

先把域名解析到服务器，然后在 `.env` 里设置：

```bash
SITE_URL=https://example.com
SITE_DOMAIN=example.com
PORT=127.0.0.1:3000        # 3000 端口只给本机的 Caddy 用，不直接对外
TRUST_PROXY=true           # 访客地址从 Caddy 转来的请求头里读
```

再用带 HTTPS 的方式启动，Caddy 会自动申请和续期证书：

```bash
docker compose --profile https up -d --build
```

已经有 Nginx 的话，不用 Caddy，把站点反向代理到 `http://127.0.0.1:3000`，带上 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，并在 `.env` 里设 `TRUST_PROXY=true`。`SITE_URL` 一定要写成读者实际访问的地址：生成的链接、RSS、分享图和 MCP 都用它。

### 阶跃星辰 Step Plan 按任务接入

在 `.env` 中配置 `STEPFUN_BASE_URL=https://api.stepfun.com/step_plan/v1` 和 `STEPFUN_API_KEY`，再按任务选择预设：

| 环境变量 | 模型预设 | 推理强度 |
| --- | --- | --- |
| `PREFILTER_MODEL`、`SUMMARIZE_MODEL`、`TRANSLATE_MODEL` | `step-3.5-flash-2603` | low |
| `SCORE_MODEL`、`STRUCTURE_MODEL`、`GROUP_MODEL`、`UNDERSTAND_MODEL` | `step-3.7-flash` | low |
| `GROUP_REVIEW_MODEL`、`DIGEST_MODEL` | `step-5-preview` | medium |

这些预设沿用纯文本处理，在任务原有输出额度上，分别为 `max_tokens` 额外预留 8192、16384、32768 tokens；这是包含思考与正文的生成上限，不代表实际思考量。所有阶跃型号共用 `stepfun` 的请求次数熔断和调用回执；迁移首次创建预算时继承已有 `llm` 限额，后台可以继续调整。

Step Plan 按套餐 Credit 计量，按量 API 使用另一个地址 `https://api.stepfun.com/v1`，两者余额独立；按量接口余额为零不代表 Step Plan 套餐没有额度。不要把按量 API 的人民币单价当作套餐实付；此接入不预置人民币价格，套餐额度与消耗以 Step Plan 控制台为准。接口与可用型号见[官方 Step Plan 接入说明](https://platform.stepfun.com/docs/zh/step-plan/integrations/reasoning-api.md)。

后台“模型与评测”的任务设置优先于环境变量；切换前应逐项核对已有设置。先部署预设和迁移，再配置环境变量并重建 `api`、`worker` 容器，使两者读取相同配置。以实际回执的模型名和任务来源验证切换，不以 `.env` 文件内容代替验收。

原 `LLM_*` 保留，阶跃使用独立凭据。回退时恢复各任务原有的 `*_MODEL` 和后台设置，再重建相关容器；不要只删除阶跃 Key。仅影响后续任务，历史内容不会自动重评。完整变量示例见 `.env.example`。

### 更新

```bash
git pull
docker compose up -d --build
```

数据库迁移只做向后兼容的增量，更新时自动执行。

### 备份

在 `.env` 里配置 `DB_BACKUP_STORE_*`（任何 S3 兼容的对象存储），每天 04:10 自动备份到那里。也可以手动导出：

```bash
docker compose exec -T db pg_dump -U aihot aihot | gzip > myhot-$(date +%F).sql.gz
```

数据都在三个 Docker 卷里：`db`（数据库）、`data`（上传的图片、图片缓存、本地备份）、`caddy`（证书）。`docker compose down` 不会删除它们；`docker compose down -v` 会。

### 看日志

```bash
docker compose logs -f --tail 100 api worker web
```

后台的“运行”页能看到每个定时任务最近的结果，“信源”页能看到每个信源的抓取状况。

## 花多少钱

- **模型**：每条新资料至少预筛一次；可能入选的再评分两次，入选的还要写标题摘要、打标签、归组，另外还有事件综述。此前包含周期报告的版本曾用示范信源试跑，152 条资料约 930 次模型调用；这是历史样本，不是当前版本的费用估计。之后每天用多少，取决于你的信源每天更新多少条。后台“模型与评测”页能看到每一步的调用次数和输入输出 token 数。
- **付费采集**（X、公众号、Jina）：按请求计费，默认不启用，填了 key 才会用。
- 所有付费服务都有每分钟、每小时、每天的调用上限（后台“设置 → 预算”），超过就暂停，不会一夜之间刷爆账单。填 0 表示立即停用这个服务。

## 不用 Docker

需要 Node.js 24.11 以上和 PostgreSQL 16 或 17。

```bash
npm ci
node scripts/init-env.ts --llm-key <你的模型 API Key>
createdb myhot
```

在 `.env` 里加上：

```bash
DATABASE_URL=postgres://你的用户名@127.0.0.1:5432/myhot
API_BASE_URL=http://127.0.0.1:3001
# 可选：经验论坛 / 东大生存手册页面的论坛站地址，默认 https://forum.seu.wiki
# FORUM_API_BASE=https://forum.example.com
```

然后：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @aihot/web

node --env-file=.env apps/api/src/main.ts          # 接口，3001 端口
node --env-file=.env apps/worker/src/main.ts       # 后台任务
cd apps/web && NODE_ENV=production node --env-file=../../.env server.ts   # 网页，3000 端口
```

三个进程要一直运行，生产环境用 systemd 或 pm2 守护。

开发时用带热更新的方式：`npm run dev:api`、`npm run dev:worker`、`npm run dev:web`。开发时想免登录进后台，在 `.env` 里设 `DEV_ADMIN_BYPASS=true`（仅非生产生效；生产环境设置了会拒绝启动）。
