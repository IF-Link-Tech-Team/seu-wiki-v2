# 上游 AIHOT 同步与升级计划（v2 详版）

> 状态：**待审批**（2026-11-08 Andiii 审阅）
> 分叉基线：上游 `877d6d5`（2026-09-29 "AIHOT: the open-source framework"）
> 上游参考：`KKKKhazix/AIHOT` main 最新 `4edbe4b`（2026-11-08，9.7k stars）
> 本地对照副本：`C:/Users/26895/AppData/Local/Temp/aihot-upstream`（只读分析用，升级执行时以 `git fetch` 到的远端为准）

---

## 一、执行摘要

我们从上游分叉后各自走了 5 周：上游 232 个提交（其中 37 个是"同步引擎"噪声提交，只有 `Engine-Commit: <sha>` 一行说明），我们自己 44 个非合并提交（`589f79e` 与上游是同一个 git 对象，实际自有 43 个）。

**落后的本质不是"提交数"，而是三件事**：

1. **安全债**：我们的 dependabot 正要把 sanitize-html 升到带漏洞的 2.18.0（GHSA-c9rx-x947-fp3h），另有 fastify/undici/zod 三个安全修复版本未跟进；上游还做了 19 个安全加固提交（TLS 曲线重试、SSRF 边界、私网放行等）。
2. **采集质量债**：上游把日期解析整个重写（主机无关 + 相对日期 + 精度模型），我们还在用分叉时的内联实现——这直接影响 585 个东大频道抓回来的日期对不对。
3. **结构性分叉**：上游 4.0.0 起把站点配置搬进 `site/` 包并引入 `modules/` 模块系统；我们的 SEU 定制（member/org/手册 2.0/信源目录/订阅画像）全部直接写在框架文件里。这决定了：**后续不能按 commit 合并，只能按文件对照收割**。

**总体策略**：不做 `git merge`，不做整体框架化；按"安全 → 清理 → 内容质量 → 采集 → 测试 → 前端 → 工程"七个批次选择性吸收，每批独立 PR、独立验证、可回滚。总计约 12–18 人天（不含独立立项的模块化改造）。

---

## 二、需要 Andiii 拍板的四个决策

| # | 决策 | 建议 | 理由 |
|---|---|---|---|
| 1 | **日期精度方案二选一** | 改用上游 `publication_time`（text 列 + `sources/dates.ts`） | 上游实现是我们的超集（相对日期、英文月份、夏令时无关、compact 14 位、AM/PM、结构化校验）；我们只需把 `.day`/`.year` 双 span 合成逻辑作为 SEU 特化补回去。我们的 `0049_published_at_precision`（enum）作废，改编号为 `0051` 应用上游 `0089` 的语义 |
| 2 | **leaderboard/monitor 定制功能是否彻底清理** | 清理（跟上游 4.0.0 一致） | 功能早已被 `features.ts` 关掉（两项均 false），但代码和表还在，残留 22 项 + 109 个引用文件，是后续每批合并的冲突源。**若 Andiii 还想保留模型榜能力则改为保留并标记为永久分叉**——这条需要你确认，因为这是功能取舍不是技术问题 |
| 3 | **日报/周报/月报** | 坚决不吸收 | 我们主动退役的产品线（路由 410、迁移 0048 清表）；上游同期反而扩成了"按规则成刊"的完整能力。取回 = 复活被砍掉的产品 |
| 4 | **整体框架化（site/ + modules/）** | 不做，独立立项 | 我们的定制面（feed 改版、手册 2.0、org/member 体系、admin 19 页）已远超上游插口预留；硬套模块系统要 2–4 周且只降低未来合并成本，不产生用户可见收益。建议本计划执行完、稳定运行一个版本后再评估 |

---

## 三、七个批次总览

| 批次 | 名称 | 工作量 | 依赖 | 核心收益 |
|---|---|---|---|---|
| P0 | 安全批 | 0.5 天 | 无 | 堵住正在生效的依赖漏洞 + 三个 TLS/SSRF 加固 |
| P1 | 清理批 | 1–2 天 | P0 | 删掉 22 项 leaderboard/monitor 残留，扫清后续冲突面 |
| P2 | 提示词与内容质量批 | 2–3 天 | P1 | 评分/摘要/归组质量实质提升（含 safety 防注入） |
| P3 | 采集健壮性批 | 3–4 天 | P1、P2 | 585 个东大频道的日期、正文、去重质量 |
| P4 | 测试资产批 | 2–3 天 | 随各批走 | 38 个测试直搬 + 并行化（测试墙钟时间大降） |
| P5 | 前端与读取层批 | 2–3 天 | P1 | SEO、零请求重访、退役接口 Deprecation 头 |
| P6 | 工程与 CI 批 | 1–2 天 | P3、P4 | 在线迁移门禁、CI 补齐 |
| P7 | 模块化改造（独立立项） | 2–4 周 | 以上全部 | 未来合并成本趋零 |

依赖说明：P3 的日期重写依赖 P2 的 structure 引擎改造先落地（两者都改 `analyze.ts`）；P4 的测试可提前穿插——每批代码落地时同步搬对应测试。

---

## 四、批次明细

### P0 安全批（0.5 天）

| # | 内容 | 来源 | 做法 | 冲突 |
|---|---|---|---|---|
| 0.1 | sanitize-html 2.17.7 → **2.18.1**（dependabot PR `multi-c403de7b47` 指向的 2.18.0 是漏洞版本，**不要合该 PR**，手动改版本号） | 上游 `b3998dc` | 改 package.json + lock | 1 处版本号 |
| 0.2 | fastify 5.12.5 → 5.12.7、undici 8.11.2 → 8.12.3 | 同上 | 同上 | 1 处 |
| 0.3 | zod 4.6.5 → 4.6.6（超大约束集合校验可能耗尽内存） | 上游 `85a1632` | 同上 | 1 处 |
| 0.4 | TLS 握手被拒时以 P-256 曲线重试一次 | 上游 `0c75802`/`fd54d04`/`5b2aaaa` | `packages/backend/src/lib/http-fetch.ts`（上游 +180 行版；我们未改过该文件，整文件替换后核对我们的 egress 代理调用点） | 低 |
| 0.5 | 出站代理防 DNS rebinding（本地解析 + 校验后再 CONNECT） | 上游新文件 `lib/egress-proxy.ts` | 新文件直搬 + 在 config 的 `egressProxy` 读取处接线 | 新文件 |
| 0.6 | 私网/元数据地址边界补全（阿里云 100.100.100.200 落在 CGNAT 被误放行） | 上游 `9df66b1` | `lib/url.ts`（上游 +100 行版），我们只改过该文件 4 行内的 import，手工并 | 低 |
| 0.7 | ingest 入库前完整批次校验（非对象 body/非法项 400） | 上游 `17ade63`(#27) | `ingest/items.ts`，我们改了 7 行，手工并 | 低-中 |
| 0.8 | 推文 URL host 校验后再做材料去重 | 上游 `6a8ad4b`(#14) | `lib/url.ts` 随 0.6 | 低 |

**验证**：`npm run typecheck` + 后端测试 + web 构建。
**本批不动**：marked 18（我们只在自己的 `knowledge/markdown.ts` 用 1 处 `marked()`，但跨大版本单独评估）、pg-boss 12.37、opentype.js 2.0（我们完全没用）。

### P1 清理批（1–2 天）

**背景**：上游 4.0.0（`1ca5d6d`）把 leaderboard/monitor/codex-reset 整体移出框架（293 文件，−17295 行）。我们保留了全部代码（被 `features.ts` 两个 false 开关门控），实测残留 22 项、代码引用 109 个文件。保留 = 后续每批都要人工解冲突。

清理清单（分 4 个小提交，每步跑 typecheck + 构建）：

1. **web 路由与组件**：`routes/leaderboard{,-model,-rules,-source,-sources,-boards}.tsx`（6 个）、`routes/codex-reset.tsx`、`routes/admin/monitor.tsx`、`features/leaderboard/`、`features/monitor/`
2. **api/worker**：`apps/api/src/routes/leaderboard.ts` 及注册、worker 的 leaderboard 首轮触发与 cron 分支、`packages/backend/src/admin/monitor.ts`、`packages/backend/src/publication/monitor.ts`
3. **backend 与 contracts**：`packages/backend/src/leaderboard/`（40 文件）、`packages/backend/src/monitor/`、`packages/contracts/src/leaderboard.ts`、`packages/contracts/src/monitor.ts`、`industry/features.ts`（清 39 处 import）
4. **资产与迁移**：`assets/leaderboard-sources/`、`assets/model-providers/`、`database/seeds/`（4 个 lb-* 文件）、`scripts/{import-leaderboard-prices,lb-round,lb-fetch-check}.ts`、`docs/leaderboard.md`、新增迁移 `0051_drop_leaderboard_monitor.sql`（照上游 `0053` 的表名抄，以我们 `877d6d5` 的表结构为准）

**同步核对**：`reference/public-v1.openapi.json` 删 `/api/v1/codex-resets*`；`llms.txt`/MCP 工具表去掉对应项；`.env.example` 删 `ARTIFICIAL_ANALYSIS_API_KEY`。

**待 Andiii 确认**：若决策 2 选"保留模型榜"，本批只做 monitor/codex-reset 清理，leaderboard 部分跳过并在文档标记为永久分叉。

### P2 提示词与内容质量批（2–3 天）

上游 21 个提示词文件的演进主线是"发布规则精细化"（归组去重、综合稿识别、事实引证、去翻译腔、防注入）。我们是东大场景定制版。**合并原则：绝大多数保持我们的场景版，只移植上游的"结构性改进"**。逐个矩阵如下（`industry/prompts/`）：

| 文件 | 上游改了什么 | 我们的定制 | 合并策略 |
|---|---|---|---|
| `summarize-article/-long-post/-short-post.md`、`translate-post.md` | 插入 `{{> safety}}` include（`ea96060`） | 整篇校园化 | **加一行 include**（防推文/文章里的注入指令，零风险） |
| `content-understanding.md` | 加 1 句"原文把发布写成过去的事…选 tutorial_explainer"（`4947ad0`） | 整篇东大化 | 移植该句的校园版 |
| `rules-self-contained-title.md` | 新增第 6 条"旧发布 vs 本次动作" | 1/3/4/5 条校园化 | 上游思想改写成校园版追加 |
| `rules-answer-first-summary.md` | 新增"'做了什么'是本条动作，旧发布只作背景" | 第 3 条学生视角 | 取上游基线 + 打回我们的第 3 条 |
| `group-definitions.md` | "同一具体对象"收紧、ROUNDUP 扩展、SAME_STORY 持续调查条款（`5794327`） | 整篇校园化 | 保持我们的 + 移植 2 条通用改进（共同身份落到具体对象；ROUNDUP 含每周要闻/简报/合辑） |
| `group-method.md` | 新增"先判综合稿 ROUNDUP"+时间精度规则 | 未改 | 取上游 + 时间规则校园化（相对日期按资料发布时间或今天换算） |
| `group-pair.md` | 方法内联改为 `{{> group-method}}` include | 只改角色名首句 | 取上游结构 + 保留角色名 |
| `story-digest.md` | **完全重写**：首句讲核心变化结论、不按日期复述、输出去掉 `latest`（`fd51bcf`） | 只改角色名 | 取上游新版；**引擎必须同步** `events/digest.ts:68`（latest 取最后一篇报道标题），不同步就不要拿 |
| `structure.md` | **大改**：新增 scope(single/composite/unknown)、fact.evidence+conditions 原文引证、`normalizeStructure` 引文校验（`04978ba`） | 新增 campus 第五步 + suggestedTopic | **上游新基线 + 打回我们的 campus/suggestedTopic**；引擎同步 `StructureSchema` 加 scope/evidence/conditions，保留 `normalizeCampus`；taxonomy 的 9 个类别补 `guide` 字段。**本批最大的一块，也是唯一能实质提升归组质量的合并** |
| `group-batch.md` | 新增 `selection.addsValue` 输出 + 9 条增量规则 | 只改角色名 | prompt 保持我们的；9 条规则文字摘进 `group-definitions.md`；addsValue 引擎依赖（`0047_selection_candidate` + group.ts 重写）列二期 |
| `translate-body.md` + 新文件 `translate-body-rules.md` | 抽出通用规则 + "去翻译腔"总要求 + safety | 改角色句 | 三个文件都拿，保留我们的角色句 |
| 新文件 `mend-wording.md` + `industry/wording.ts` | **读者文字改用词**（`a68d525`）：命中词表才发一次模型调用，数字集合不变 + 问题不减少就不采用 | 无 | **建议接入**：词表填校园版（"重磅/速戳/来袭/神仙/yyds"正是东大公众号高发区，我们的提示词禁词表管不住已成文的标题摘要）。需在 `analyze.ts` 写作后挂钩 `mendWording`（约 50 行）+ `jobs/content.ts` 加步骤 |
| `report-*.md` | 上游重写 | **我们已删除** | 保持删除 |
| `org-draft.md`/`topic-confirm.md` | 上游没有 | 我们新增 | 保留 |

**配套（industry/ 非提示词）**：
- `selection.ts`：**接 `browseFloor: 40`**（"全部动态"只列平均分 ≥40，搜索仍全量；阈值用我们的 gold 集观察后定 40–50，不照抄）；`classes` 不接（我们的 `reson ≤ 2 且 act ≤ 1` 已压住同类问题）
- `taxonomy.ts`：补 `tagColor`/`feedLabel`（纯增量）；`CATEGORY_BY_ITEM_TYPE` **保留我们的**（analyze.ts fallback 真实在用，标记为与上游的有意分歧）；ENTITIES 类型加 `orgNames`/`otherNames` 可选字段（为将来吸收上游代表机制铺路）
- `docs/selection.md`：搬上游的"校准"章节（金标 100–200 条、开发集/留出集、SelectBench 逐条看错例、先改标准再动门槛）；`scripts/eval-selection.ts` 只手工移植"覆盖率/完整准确率"两个指标（整体替换依赖上游 analyze.ts 新导出，不做）
- **topics 表：保持我们的 DB 播种模式**。上游 4.0.0 删表改只读 topics.json，但我们深度依赖 topics 表（`seedTopics`/60s 缓存/0039 topic_groups/related 相关主题），且上游新版 `TopicFile` 没有 related 字段——直接拿会静默丢功能

**验证**：typecheck + 后端测试（analyze/events 相关用例需按新 StructureSchema 更新）+ 本地对 3–5 条真实东大通知试跑分析，人工核对 scope/evidence/摘要质量。

### P3 采集健壮性批（3–4 天）

| # | 内容 | 来源 | 做法 | 冲突 |
|---|---|---|---|---|
| 3.1 | **日期解析重做**（决策 1 落地） | 上游新文件 `sources/dates.ts`（142 行，`de4be99`/`21e5c03`/`ce83484`/`ed4cbd1`/`e47bf83`/`2908224` 系列） | 新文件直搬；删我们的 `parseLooseDate*`（`web-list.ts` 内联）改 import；**回插我们的 `.day`/`.year` 双 span 合成**（上游没有）和纯日期按信源时区解析（`ddf909c` 的语义上游已覆盖）；`SANE` 年份闸门可弃（上游 `calendarDay()` 同样拒绝荒诞年份）；迁移以上游 `0089` 语义重写为 `0052_publication_time`，废弃我们的 `0049`（新环境直接不建旧列，老库用新迁移补） | 中 |
| 3.2 | 登录/注册页不再变成文章（Devise `/users/sign_in`、WordPress `/wp-login.php`、带扩展名 `/login.php`，列表选择器 + 重定向两层） | 上游 `690456b`/`79d962e`/`a0d1e75`，`content/extract.ts` +517 | 上游为基线，并回我们的 WebPlus `.wp_articlecontent` 直连 | 中 |
| 3.3 | 内联 SVG 插图替换为原站文字说明 | 上游 `9b550e0`(#208) 等 4 个提交 | 随 3.2 一次手工并 | 中 |
| 3.4 | 按浏览器规则识别内联样式/`hidden`/`aria-hidden` 隐藏内容；引号属性里的标签识别 | 上游 `c45cf68`/`7d6ac83`/`e6cda05` | 随 3.2 | 中 |
| 3.5 | 正文原生视频保留 + 空正文/纯链接原帖保留自己的文字与媒体 | 上游 `660d45f`/`f6b08a6`/`7b6be43`，新文件 `content/video.ts`、`content/posts.ts` | 新文件直搬 + extract.ts 接线 | 低-中 |
| 3.6 | `collect.ts` 先去重再读详情（URL 别名不重复购买、不挤占抓取窗口、详情规则变化即重读） | 上游近乎重写（+427/−199） | **以上游为基线**，把我们的 `collectSource(maxItems)` 手动批次上限作为小补丁重新打上 | 中-高 |
| 3.7 | per-source `acceptLanguage` + Atom 纯文本保留 + JSON 坏日期不中断整批 | 上游 `2908224`，`rss.ts`/`json-list.ts` | 手工并（这两个文件我们都改过：我们的 `requestHeaders` 已覆盖 Accept-Language，补成上游式一等公民 + 校验） | 中 |
| 3.8 | 信源健康度 + 按自身节奏判静默（90 天窗口中位数间隔 ×4，失败频率双阈值） | 上游新文件 `sources/health.ts`（202 行） | 新文件直搬 + 接我们 `alerts.ts` 的定制点 | 低 |
| 3.9 | Jina per-read listing 按自身 ID 计缓存键 | 上游新文件 `sources/listing-fetch.ts` | 新文件直搬 | 低 |
| 3.10 | 评分门槛 = tier 门槛与信源类别门槛取高 | 上游 `c9e68c3` + 迁移 `0090` | **不接**（同 P2 classes 决策，我们的评分提示词已处理） | — |
| 3.11 | `detail.preserve`（保留表格 widget）/`publishedAfter`（早于它的不收） | 上游 config-keys 新增 | **评估后可选**：考试安排表/教室分配表对教务处类信源有价值；`publishedAfter` 挡旧闻重复采集。都要改 config-keys 白名单 + collect 逻辑 | 中 |

**配套测试**（来自 P4 资产）：`source-dates`、`source-date-elements`、`source-config-dates`、`source-published-formats`、`collection-*`（11 个 A 类）、`streamed-body`、`invalid-dates`。
**验证**：typecheck + 采集测试 + 本地试抓 3 个东大信源（一个 web_list、一个公众号、一个 RSS）核对日期/正文/去重行为。

### P4 测试资产批（2–3 天，可穿插前几批）

上游分叉后新增 146 个测试文件 + 3 个基建文件。清点结论：**A 类 38 个直搬、B 类 22 个改造后可搬、C 类 86 个搬不了**（依赖我们没有的 site 包/modules/reports-edition/dates 等——搬不了的大多随对应功能批一起到位）。

| # | 内容 | 说明 |
|---|---|---|
| 4.1 | `tests/standalone.ts` 直搬（5 行）+ `package.json` 加 `test:standalone` | 免数据库测试拆分 |
| 4.2 | **A 类 38 个直搬**：collection 11、公开出口一致性 8、receipt/队列/关机 4、topic 2、嵌入/投递/admin 7、standalone 6 | 拷文件 → `npm test` 全量验证。**注意**：`readpath-performance` 可裁剪（去掉 reports 用例，前 5 个是纯共有代码） |
| 4.3 | `tests/databases.ts` 并行化基建：每测试文件一份库副本 + 独立 data/tmp，`--test-concurrency=6` | **必改一处**：Windows 下 `os.tmpdir()` 不读 `TMPDIR`，需同时设 `TEMP`/`TMP`。已逐项核查兼容性：我们 48 个测试全部自建 fixture 无跨文件数据依赖、预算 stub 每副本全新、pg-boss 每副本独立 |
| 4.4 | B 类 22 个按"差什么"逐个补（多数 1–15 行） | 优先：`url-identity`（url.ts 的 sn 参数语义）、`source-config-dates`（补 KEYS）、`source-date-elements`（tooltip 不当日期）、`streamed-body`（$RC 流式边界）、`queue-recovery`（getBoss supervise 参数）、mcp 两件套（bodyLimit 413 + host 解析） |
| 4.5 | `setup.ts` 升级：`pointModels`（改用我们的 `MODELS` from `@aihot/backend/providers/llm`）、`embeddingsStub`（EMBEDDING_* + DASHSCOPE_* 双设、DIMS=1024） | `editionAt` 不搬（reports 已退役）；`beijingAt` 移植进 `contracts/time.ts` |
| 4.6 | web 测试：合上游新版 `session-cache.test.ts`（import 路径改回 `features/feed/session-cache.ts`，新版语义更强）；`local-state`/`markdown` 直搬 | playwright（5 个用例）等对应功能核对存在后再上，只搬命中的 |
| 4.7 | **我们该补的测试**（上游反推的裸奔区）：日期解析链、迁移安全、MCP 安全三件套 | 随对应功能批落地 |

**验证**：全量 `npm test`（并行模式）+ `npm run test:standalone` + CI 绿。

### P5 前端与读取层批（2–3 天）

| # | 内容 | 位置 | 冲突/做法 |
|---|---|---|---|
| 5.1 | **SEO 全家桶**：`siteLd`（Organization+WebSite+Dataset）、`itemListLd`/`articleLd`（NewsArticle + isBasedOn）/`storyLd`、`readFilters`（筛选组合 noindex）/`googleNoindex` | `apps/web/app/lib/seo.ts`（上游 +243 行） | **我们完全没改过这个文件——最干净的整体替换对象**。先搬不依赖 report 的部分；依赖 `@aihot/site` 的新 import 用我们的 `@aihot/industry/site` 等价字段替 |
| 5.2 | `pageReuse()` + `cachedPage()`/`edgeTtl()`（服务端 deadline 内重访页面零请求） | 新文件 `lib/page-reuse.ts` + `api.server.ts` | 要改所有页面 loader 返回值形状（加 `expiresAt`）——本批工作量的大头，但收益直接 |
| 5.3 | `Deprecation`/`Sunset`/`Link rel=terms-of-service` 响应头 | `apps/api/src/http/respond.ts` | **配合我们已退役的日报页正合适**（410 桩加 Sunset 头告知调用方） |
| 5.4 | `V1_OPERATIONS` 集中表（queryKeys + Cache-Control 一处定义） | `apps/api/src/routes/v1.ts` | 低，纯重构 |
| 5.5 | `RequestLogs` + `setChildLoggerFactory`（静默常规访问日志、warn/error 去重） | `apps/api/src/app.ts` | 我们 app.ts 只 +6 行，可整段搬 |
| 5.6 | AVIF 优先 + 签名剩余寿命重算 max-age（CDN 不继承老化值） | `apps/api/src/routes/media.ts` + backend `media/images.ts` | 中（我们改了 images.ts 16 行） |
| 5.7 | OG 缓存头收紧（`max-age=300, s-maxage=3600, must-revalidate`）+ topics 卡动态主题数 | `apps/api/src/routes/og.ts` | 低 |
| 5.8 | `api-proxy.server.ts` 抽离 + 逐跳头过滤 + `DEPLOYMENT.originHost` | `server.ts`、`vite.config.ts` | 中 |
| 5.9 | 跨年日期显示三连（`monthDay(now)`、Timeline/story/topic/日报 chip） | `lib/format.ts` + 调用点 | 低（我们 format.ts 只 +14 行） |
| 5.10 | Sidebar 只点亮最具体项（`activeSidebarItem` 最长匹配） | `shell/Sidebar.tsx`、`nav.ts` | 高——我们 nav.ts 是常量结构（+26 行），手工移植逻辑 |
| 5.11 | `local-state.ts` 逐函数合并（只读未读、字体偏好、导入导出校验） | `lib/local-state.ts` | 高——逐个函数对照，不整文件替换 |
| 5.12 | 精选时间线「只看未读」 | `publication/timeline.ts` + Timeline 组件 | 中 |
| 5.13 | `entry.client.tsx` + `render-recovery.ts`（部署后旧文档渲染报错自动 reload） | 新文件 | 低，自包含 |
| 5.14 | server.ts：`.data` MIME 改 `text/plain`（下载管理器误判）+ 无 loader 路由兜底 + Cache-Control 写法简化 | `server.ts` | 中 |
| 5.15 | `splitRouteModules: false` + vite 8.3.3 + codeSplitting 补 `feed` 组 | `react-router.config.ts`、`vite.config.ts` | 低 |

**验证**：typecheck + web 构建 + `node --test apps/web/tests/*.test.ts` + smoke + 人工过一遍首页/信息流/主题页/后台。

### P6 工程与 CI 批（1–2 天）

| # | 内容 | 来源 | 说明 |
|---|---|---|---|
| 6.1 | **在线迁移安全门禁**：`scripts/migration-safety.ts`（只放行 6 类在线安全语句：并发索引/VALIDATE CONSTRAINT/MCV 统计/单列 ANALYZE/常量默认 ADD COLUMN/受控 DROP）+ `scripts/check-migrations.ts`（CI 强制：已部署迁移不可改写、编号规范、必须过安全计划） | 上游 `50b562b` | 我们的 `0049` 回填式迁移今后不能再写；历史文件不回溯。**这是对我们数据库操作纪律的长期保护** |
| 6.2 | `scripts/migrate.ts` 重构（106 行版）：同名文件检测、`CREATE INDEX CONCURRENTLY` 事务外执行并事后校验 `indisvalid`、锁超时 1s/10s（在线类放宽）、等备份 pg_dump 释放锁、支持 `modules/*/migrations`、导出 `runMigrations()` | 上游 `4947ad0` | 同时解锁 B 类 `migrations.test.ts` |
| 6.3 | 百度主动推送（`BAIDU_PUSH_ENABLED`/`BAIDU_PUSH_TOKEN`，每小时 :55） | 上游 `4edbe4b` + `operations/baidu-push.ts` | 国内比 IndexNow 实用；`seo.indexnow` 同时改每小时 :50 |
| 6.4 | `boss.deleteQueue` 清理退役定时器的残留 job | 上游 worker 变更 | 我们删了日报 schedule，队列里可能有残留 |
| 6.5 | `schedules.ts`：`sources.mp-reconcile` 改 `dajialaConfigured()` 门控；shutdown 打耗时 | 上游 | 低 |
| 6.6 | CI check.yml：`fetch-depth: 0`、migration safety 步、smoke 加 `node scripts/mcp-check.ts http://127.0.0.1:3000/api/mcp`（**我们已有脚本只是 CI 没跑**）、web tests 改 `npm run test:web`、docker job smoke 前 `compose ps` | 上游 check.yml | 逐项采纳；pg_dump/pg_restore 恢复测试和 playwright 步骤随对应批次 |
| 6.7 | `docs/deploy.md` 补"更新"章节（升级历史 + 占锁/无效索引失败处理 + Docker/非 Docker 更新序列） | 上游 deploy.md | 文档，借鉴结构 |
| 6.8 | `.env.example` 同步新增项：`DINGTALK_*`、`FEISHU_ALERT_WEBHOOK_URL`、`BAIDU_PUSH_*`、`PRIVATE_FEED_HOSTS`、`INGEST_RATE_LIMIT`、`IMGPROXY_UPSTREAM_*` | 上游 | 随功能批落地 |

**验证**：CI 全绿 + 本地 `check-migrations.ts` 对新迁移放行、对违规迁移拒绝的实测。

---

## 五、明确不做清单（含原因）

| 内容 | 原因 |
|---|---|
| 日报/周报/月报产线（`reports/edition.ts` 411 行 + `publication/reports.ts` + feeds daily + alerts） | 我们主动退役的产品线；取回 = 复活 |
| 上游 4.0.0 的 `0045_drop_topics`（删 topics 表改只读 json） | 我们深度依赖 topics 表（0039 topic_groups/related/60s 缓存），且上游新版 TopicFile 没有 related 字段，直接拿会静默丢功能 |
| 上游 `0051_drop_unused_state` 删列（`stories.status`/`admin_users.role`/`first_party` 等） | 与我们的 `0048` 语义交叠，且需逐个核对 100+ 引用；收益是 schema 洁癖，排最后 |
| `group.ts` 964 行重写 + `0047_selection_candidate` + addsValue | 依赖链太长（recall.ts/related.ts/representative.ts），列二期 |
| 上游代表机制 `representative.ts`/`seat`（迁移 0043） | 方向与我们"精简信息流"一致但实现不同；等 P7 模块化时再评估，避免现在动 publish.ts 引发连锁 |
| 手机端整体重写（PhoneBar/TabBar/PullToRefresh + app.css 断点 961→700） | 最大一块，我们改了整套东大绿色板；只挑自包含组件，整体作独立项目 |
| SearchOverlay + `/api/site/search/suggestions` | 我们连后端接口都没有，独立项目 |
| X 采集全套（分片水位/改名发现/x-renames） | 我们不做 X 采集 |
| marked 18 / pg-boss 12.37 / opentype.js 2.0 大版本 | 我们 marked 只用 1 处、opentype 完全没用；单独评估，不占本计划批次 |
| 整体框架化（site/ 包 + modules/） | 决策 4，独立立项 |

---

## 六、风险登记册

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 迁移编号撞车：上游 `0041–0050` 与我们全部撞号且语义不同 | 升级执行错乱 | 要采纳的上游迁移顺延重编号（`0051–0064`），记账按完整文件名；P6.1 门禁建立后杜绝手滑 |
| R3 | `COLLECT_ENABLED` 语义（上游 3.0.0 起只认 `"true"`，默认关） | 升级后采集静默关闭 | 我们 `.env` 已是 `false` 不受影响；P3 若触及 worker 入口需核对；P6.8 在 `.env.example` 标注 |
| R4 | `contracts/time.ts` 取上游日期方案时必须同步删我们的 `PUBLISHED_AT_PRECISIONS`/`PublishedAtPrecision`/`hasPublishedClock` 三个导出并改所有引用 | 类型错误 | P3.1 同批处理，typecheck 兜底 |
| R5 | `structure.md` 引擎改造（scope/evidence/conditions）与我们的 campus 定制互踩 | 归组质量回退 | 以上游为基线打补丁；analyze 测试先更新再实现；本地真实通知人工核对 |
| R6 | `story-digest.md` 拿新版但 `digest.ts` 没同步 → latest 永远为空 | 事件页显示异常 | prompt 与引擎一行改动绑在同一个提交 |
| R7 | 并行测试改造的 Windows tmp 陷阱 | 并行测试互相踩 | 4.3 必改：同时设 `TEMP`/`TMP`；先在 Windows 本机全量跑绿再推 CI |
| R8 | 每批改动面比预估大（尤其 P3 的 collect.ts / extract.ts） | 批次延期 | 每批独立 PR；批次内按"新文件直搬优先、同名文件逐个过"的顺序，做不完的移下一批，不阻塞后续批次的独立部分 |
| R9 | 数据库结构变更遇生产占锁 | 升级失败 | 所有新迁移遵守在线安全词汇表；P6.2 锁超时 + 事前 pg_dump 备份；涉及 DROP 的一个 PR 只做一个 |

---

## 七、里程碑与验收

```
M1（第 1 周末）P0 + P1 完成：安全债清零、冲突面扫清
M2（第 2 周末）P2 完成：提示词/结构抽取/改用词上线，真实通知人工抽检通过
M3（第 3 周末）P3 完成：585 信源日期/正文质量抽检通过，采集成本（Jina 详情读取）下降
M4（第 4 周末）P4 + P5 完成：86+ 测试并行跑绿、SEO/重访零请求上线
M5（第 5 周末）P6 完成：CI 门禁生效、docs 补齐 → 发一个版本，稳定观察两周
M6（观察期后）P7 模块化立项评估（单独审批）
```

每批验收标准 = AGENTS.md 全套自检 + 该批"验证"列 + CI 绿。全部批次完成后，本计划文档随最后一批提交进 `docs/plans/`（与 `2026-10-22-feature-removal.md` 先例一致）。

---

## 附：分析依据索引

- 上游本地副本：`C:/Users/26895/AppData/Local/Temp/aihot-upstream`（分叉后 232 提交、74 迁移、173 测试文件）
- 全量提交归类：24 个主题域（extract 22 / sources 19 / 安全 19 / worker 定时 18 / feed 16 / 测试基建 16 / events 11 / providers 11 / 依赖 9 …）
- 与我们修复的重叠：日期解析（我们的 `ddf909c`+`13a2302`+`d42450b` vs 上游 `dates.ts` 重写）为最大重叠区；Agent 出口我们自建 vs 上游模块化；模型预设位置（我们的 `providers/llm.ts` vs 上游 `site/models.ts`）
- 上游删除清单：4.0.0 删 293 文件（leaderboard 40 + monitor 8 + web 页面 17 + chronicle 4 + assets 34 + seeds 4 + tests 21 + contracts 2 + industry/scripts 7 + 其他）
