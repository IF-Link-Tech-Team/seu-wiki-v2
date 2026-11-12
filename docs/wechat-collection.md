# 公众号采集接入

公众号和官网共用 `sources → articles → analyses → publications`，以及既有的事件归组和公开读取层。不新增图片表。

## 数据与图片

- 极致了列表使用 `history_by_ghid`；账号可配置 `ghid`、`wxid`、已知文章 `url` 或 `nickname`，返回名称必须与配置的 `nickname` 一致。
- 详情使用 GET `article_detail` 的 `mode=2`，分别读取纯文本 `content` 和 HTML `content_multi_text`。
- HTML 经现有清洗逻辑进入 `articles.body_html`；封面及正文图片链接去重后进入 `articles.media`。
- 图片沿用官网签名代理和 `AIHOT_DATA_DIR/imgcache` 缓存，不作永久原图归档，不做 OCR。
- 平台身份、封面、响应版本和请求回执 ID 保存到 `articles.raw.dajiala`；完整响应先保存到 `receipts`。
- 仅补充 HTML 或图片时，不增加文本修订、不重新付费分析，刷新现有公开投影。

## 付费与判重

请求仍受现有预算与回执保护。接口版本和详情模式包含在请求身份中，避免错误复用旧模式的结果。同一长链接去除跟踪参数后复用文章；已取得详情的文章不重复购买。结果不明的请求保留回执，先核对后处理。

这里只接通现有身份判重和事件归组。跨渠道正文相似判重仍待另行设计。

## 本地首批验收：2026-11-05

本地 PostgreSQL：`127.0.0.1:55440`，预览库 `seuwiki_wechat_preview`，测试库 `seuwiki_wechat_test`。没有修改生产数据库。

| 信源 | 入库文章 |
|---|---:|
| 公众号·东南大学 | 3 |
| 公众号·东南大学未来技术学院 | 4，其中 1 篇复用此前已购买的样本 |
| 教务处·信息通知 | 1 |

8 篇均通过既有模型分析与公开发布流程进入“全部动态”；当前没有文章达到精选门槛。教务处新版页面使用 `.news-list-item`，本轮仅调整本地数据库中的选择器。

本地列表：`http://localhost:3100/all`。示例详情：`http://localhost:3100/items/smpk9nqfzjc2n348on154kogt`。API 在 `127.0.0.1:3101`，端口与其他本地任务隔离。

运行配置、原始回执核对结果、数据库验收和浏览器截图保存在 `.data/wechat-first-batch/`，该目录不提交。`models.env` 仅保存本站现有模型配置，密钥不会进入网页。

本机 Node 未读取 Windows 系统代理会导致连接重置，验收进程通过该目录的 `local-network.cjs` 使用系统代理；这仅是本地运行适配，不改变生产网络策略。网络环境统一后可移除此适配。

新增极致了采集费为 0.46 元。模型调用费用接口未返回，不能计入该金额。未开启自动采集或消息推送。
