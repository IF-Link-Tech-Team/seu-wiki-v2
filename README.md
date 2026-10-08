<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-176b75?style=flat-square" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/Node.js-24-176b75?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 24">
  <img src="https://img.shields.io/badge/PostgreSQL-17-176b75?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 17">
  <img src="https://img.shields.io/badge/Docker-Compose-176b75?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose">
  <a href="https://seu.wiki"><img src="https://img.shields.io/badge/site-seu.wiki-202a30?style=flat-square" alt="seu.wiki"></a>
</p>

<p align="center">
  <b>SEU Wiki — 东南大学信息聚合</b><br>
  与你有关的东大信息。
</p>

<p align="center">
  <a href="#这是什么">这是什么</a> ·
  <a href="#它是怎么工作的">它是怎么工作的</a> ·
  <a href="#跑起来">跑起来</a> ·
  <a href="#文档">文档</a>
</p>

<br>

## 这是什么

[SEU Wiki](https://seu.wiki) 是面向东南大学同学的校园信息聚合站，由 IF.Link 社区维护。

学校里的通知和机会很多：教务处、学生处、各学院官网和公众号，分散在几十个入口里。SEU Wiki 替你盯着这些信源——抓取消重、用模型筛选和写摘要，把同一件事的多次通知归到一起，每天早上 8 点出一份**校园日报**。免费，不用注册。

除了信息流，站点还包括：

- **东大生存手册**（`/handbook`）：学习、生活、就业等版块的长文指南；
- **经验社区**：经验帖与讨论（论坛后端在 [seu-wiki-forum](https://github.com/IF-Link-Tech-Team/seu-wiki-forum)）；
- **手机 App**：[iOS](https://github.com/IF-Link-Tech-Team/seu-wiki-app) 与 [Android](https://github.com/IF-Link-Tech-Team/seu-wiki-android) 原生客户端；
- **开放接口**：RSS、公开 API、MCP、`llms.txt`，同一份内容给人看也给 Agent 用。

本仓库基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 开源框架构建（致谢 @数字生命卡兹克），行业相关的一切——站名文案、分类标签、校园信源、精选提示词、入选门槛——都在 [`industry/`](industry/) 目录。

## 它是怎么工作的

一条通知从信源进来，先判重，再预筛；可能重要的独立打两次分，过了门槛才进精选；然后写中文标题和摘要，和别的报道聚成事件，算进热度，最后进日报。每一步的提示词都在 [`industry/prompts/`](industry/prompts/)，改标准不用改代码。详见 [精选与校准](docs/selection.md)。

热度按事件算，不按文章算：48 小时内每个独立来源只算一次，24 小时减半。重复发布不会多算，所以排在前面的，是真正有很多渠道在说的事。

技术上分三个进程（详见 [架构](docs/architecture.md)）：

| 进程 | 位置 | 做什么 |
|---|---|---|
| api | `apps/api/` | Fastify。网站自用接口、公开 API（`/api/v1/`）、RSS、MCP、后台接口 |
| worker | `apps/worker/` | pg-boss 任务队列：抓信源、调模型、归组、热度、日报、告警 |
| web | `apps/web/` | React Router 服务端渲染的网页。只通过 HTTP 读 api，不碰数据库 |

几条不变的规则：所有公开出口都从 `packages/backend/src/publication/` 这一个读取层读；读者打开页面不触发模型调用；付费请求（模型、公众号抓取等）走回执与预算熔断。

## 你会得到什么

| | |
|---|---|
| **六种信源** | RSS、网页列表、JSON 接口、X 账号、微信公众号，以及脚本推送。信源分级，抓取频率按产出自动调整 |
| **精选** | 预筛 + 独立两次评分 + 按信源分级的入选门槛。提示词和门槛全部公开、可校准 |
| **写作** | 中文标题、答案先行的摘要、推荐理由、标签；防止模型编造原文没有的内容 |
| **聚簇与热点** | 同一件事的多次通知归为一个事件，延期和更正会更新原条目；事件页有综述 |
| **校园日报** | 每天 08:00 出日报，每周一出周报，每月 1 日出月报，按分类分节 |
| **主题与搜索** | 按部门、话题、内容形态组织主题页；标题摘要搜索和全文相关搜索 |
| **给 Agent 用** | RSS（精选、全部、全文、日报）、公开 API、MCP、`llms.txt` |
| **后台** | 信源管理与试抓、内容诊断、精选评测、每一步单独换模型、预算熔断、运行记录与告警 |

## 跑起来

需要 [Docker](https://docs.docker.com/get-docker/)，和一个 OpenAI 兼容的模型 API Key（DeepSeek、千问、智谱都可以）。

```bash
git clone https://github.com/IF-Link-Tech-Team/seu-wiki-v2.git
cd seu-wiki-v2
node scripts/init-env.ts --llm-key <你的模型 API Key>
docker compose up -d --build
```

打开 <http://localhost:3000>。后台在 `/admin`，用 IF.Link 统一账户登录（需要社区管理员角色，配置见 `.env.example` 的 LOGTO_*/ACCOUNTS_*）；本地改前端可设 DEV_ADMIN_BYPASS=true 跳过登录（仅非生产）。

服务器部署、域名和 HTTPS、备份，见 [部署](docs/deploy.md)；本仓库的生产部署说明见 [deploy/seuwiki-prod.md](deploy/seuwiki-prod.md)。

## 参与共建

欢迎 Issue 和 Pull Request，先读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。改动后的自检：

```bash
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/<名字>_test npm test   # 空库，先 node scripts/migrate.ts
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
```

## 文档

| 文档 | 内容 |
|---|---|
| [改成你的行业](docs/customize.md) | 站名、分类、信源、提示词、门槛、品牌（上游框架的通用定制指南） |
| [信源](docs/sources.md) | 六种信源怎么配，分级和全文，外部推送接口 |
| [精选与校准](docs/selection.md) | 一条资料怎么变成精选，怎么用标注样本校准 |
| [部署](docs/deploy.md) | Docker、域名和 HTTPS、中国大陆、更新、备份 |
| [架构](docs/architecture.md) | 三个进程、几条不变的规则、目录、对外出口 |

技术栈：Node.js 24 · TypeScript · React Router（服务端渲染）· Fastify · PostgreSQL · pg-boss · Tailwind CSS · Docker Compose。

## 许可

代码使用 [MIT 许可证](LICENSE)。AIHOT 的名字和 Logo 不在许可范围内，归上游作者所有；字体、模型厂商和评测来源的标志各有自己的许可和商标归属，见 [NOTICE](NOTICE)。
