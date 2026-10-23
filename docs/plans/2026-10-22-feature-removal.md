# 2026-10-22 功能精简实施记录

## 已确认范围

- 删除一手栏目、标识、筛选与排序优先逻辑；保留 T1/T1_5/T2 分级及评分门槛。
- 下线日报、周报、月报：停止生成，移除网页、API、RSS、MCP 等入口；清理报告历史数据。
- 精选后新增可点击的订阅占位页，不采集画像、不实现推荐或推送。
- 网站、资讯后端、iOS、Android 一并对齐；不提交、推送或部署。
- 保留内部信源健康周报、备份、采集、精选、分类、全部、搜索、事件、论坛、手册、收藏、提醒、工具与账户。

## 计划与状态

1. [x] 核验依赖、三个仓库规则和干净基线；解释内部信源健康周报。
2. [x] 后端：移除目标业务和公开契约；加入兼容增量迁移以清理报告历史；验证非目标接口。
3. [x] 网站：移除入口与专用代码；增加订阅占位；清理相关文案。
4. [x] iOS / Android：移除目标功能，增加订阅占位，对齐自检断言。
5. [x] 集成回归与 diff 审查完成；记录 iOS 原生验收、Android 真机交互及 Linux MCP 超时缺口。

## 验收界面

- 公共 HTTP：旧报告入口明确返回 410；其他资讯、RSS、Agent 能力正常。
- 内容选择：不再使用一手身份；信源评分分级及门槛不变。
- UI：精选后可进入订阅占位页；分类、全部和搜索仍有效；无一手及周期报告入口。
- 数据：迁移只删除报告及其修订，不删除文章、事件、用户或其他业务记录；本轮不连接生产数据库执行清理。
- 客户端：尽力执行现有自检及构建；没有 Xcode / SDK / 模拟器时明确记录未验证，不以静态检查冒充原生验收。

## 工作区

- 网站与后端：`D:\Desktop\seuwiki`，基线 `2d976ad`。
- iOS：`D:\Desktop\seu-wiki-app`，本轮从项目远端新克隆，基线 `8e986ec`。
- Android：`D:\Desktop\seu-wiki-android`，本轮从项目远端新克隆，基线 `ed44111`。

## 环境检查

- Windows Node.js 24.15.0、npm 11.12.1；主仓依赖已安装。
- 隔离 PostgreSQL 17.10：Windows 端口 55438，WSL 端口 55440，仅本机测试库。
- Android 临时 JDK 17、SDK 36、Gradle 缓存位于 `%LOCALAPPDATA%/Temp/seuwiki-android-verify-20261022`，不修改全局工具配置。
- Windows 不具备 Xcode / iOS Simulator，iOS 本轮只完成代码与调用关系审查，自检未运行。

## 已验证

- `npm run typecheck` 通过，含后端、API、worker、Web 和测试类型。
- `npm run build -w @aihot/web` 通过；`node --test apps/web/tests/*.test.ts`：12 / 12 通过。
- Windows 全新隔离库，排除 `*shutdown*` 的后端测试：179 / 179 通过。SIGTERM 平台差异改用 Linux 单独核验，不修改产品代码绕过。
- Linux：`analyze-shutdown.test.ts` 三项、`translate-shutdown.test.ts` 两项 SIGTERM 退出及重启恢复测试全部通过。Windows MCP 退出测试 1 / 1 通过（228 ms）。合计 185 项后端测试分别在可用平台覆盖；不声称某一平台全量通过。
- 本地 `node scripts/smoke.ts --base http://127.0.0.1:3300` 通过。
- 浏览器真实检查：桌面首页、手机宽度订阅页；点击订阅、切换教务与全部、搜索“奖学金”成功；无横向溢出、控制台错误。
- 事件页以隔离库测试内容实测“全部报道 2 / 精选报道 1”切换，旧一手筛选与侧栏消失；旧报告页实际渲染 410 下线说明（浏览器记录对应 410 网络状态属预期）。
- 旧日 / 周 / 月报网页及 API、RSS、分享图返回 410；MCP 与 Agent / llms / sitemap 不再声明报告能力。
- 升级迁移验证：三种报告及其修订清空，预置的文章、事件、信源仍各 1 条，T1 分级保留。
- 信源 JSON 与基线逐项比较：643 条信源仅去掉 `first_party`，其余配置不变；门槛仍为 60 / 65 / 76。
- OpenAPI 内部引用完整。Skill 包按 LF 文件内容重算 SHA-256。
- Android：`assembleDebug testDebugUnitTest --no-daemon` 成功；SelfCheck 98 项、SecurePrefs 3 项，共 101 项，零失败。Debug APK 位于 Android 仓库 `app/build/outputs/apk/debug/app-debug.apk`；未做模拟器 / 真机视觉和交互验收，未发布。

## 发布边界与复测

- 没有提交、推送或部署；没有连接或清理生产数据库。
- 历史报告清理交付于 `database/migrations/0048_retire_reports_first_party.sql`。正式发布时先停旧 worker，再执行迁移并启动新代码，避免旧进程重新生成报告。
- 为保证增量迁移向后兼容，旧报告表与 `first_party` 列保留空结构；业务不读写这些标记，不再具有功能含义。仅在未来单独授权的不兼容 schema 清理中考虑删除。
- 本地 Windows Web 验收使用 `.data/windows-loader.mjs` 将动态导入盘符路径转成 file URL；没有扩大到无关的产品兼容修复。
- Linux 便携 PostgreSQL 不含 LZ4。仅隔离测试库执行 0034 时在内存中将存储压缩改为 pglz；产品迁移未改，原版迁移已在 Windows PostgreSQL 完整通过。
- Linux 全量跑到 `docs.test.ts` 时主动停止：其余常规测试已经在 Windows 通过，改为补验剩余退出测试。Linux MCP 退出测试超过其 5 秒限制并取消，同一测试在 Windows 通过；超时原因未进一步定位，没有放宽测试限制或改动无关代码。
- Linux PDF 依赖提示缺少原生 canvas；本轮 Linux 没有完成 PDF 渲染验收，不据此声称该能力通过。Windows 常规套件中的 PDF 用例已通过。
- 主要证据：`.data/backend-tests-supported-clean.log`、`.data/linux-backend-tests.log`（含三项分析退出测试，后续全量中止）、`.data/linux-shutdown-tests.log`（两项翻译通过、一项 MCP 超时）、`.data/mcp-shutdown-windows.log`、`.data/android-build-final.log`、`.data/typecheck-final.log`、`.data/web-tests-final.log`、`.data/smoke.log`。截图为 `.data/home-desktop.png`、`.data/subscription-mobile.png`、`.data/story-mobile.png`。
- 本次本地 API / Web / 两个临时 PostgreSQL 已停止；浏览器检查产物移至 Git 忽略的 `.data/playwright-20261022`，不完整下载已删除。保留隔离工具链、数据库和日志供未完成的原生验收与后续复测，不运行后台采集或模型任务。

## 2026-10-23 发布推进

- 用户明确授权本次三个仓库提交 PR 并合并，随后在线实测；此前“不提交、推送或部署”仅记录当时阶段的边界。
- 已核对三个远端 main 与本地基线一致，无需合并上游变更。
- 补齐自动部署顺序：先构建镜像，再等待旧 worker 停止，最后启动新栈（setup 先迁移与种子，再启动 API / worker）。避免旧进程在报告清理后重新生成内容。
- 合并前跟进 GitHub 的网站 Linux / Docker、Android、iOS macOS 构建检查。客户端本轮仅合并源码，不打 tag 或发布安装包。
- 本地预览按用户要求重新启动；预览库仅有 2 篇教务测试内容，不代表生产数据量。
- PR 地址、合并及部署结果待后续回读记录。
- 纳入用户追加的导航命名：左侧栏为“信息聚合 / 经验论坛 / 生存手册 / 我的收藏”，内容分类栏“精选”不变。
- “更多”区域按用户追加要求改为“问题反馈 / 更新日志 / Agent 接入 / 关于我们”，链接及更新日志提示保留。
- GitHub 连接器与本机 CLI 的当前身份 `Eon-cui` 对三个上游仓库均仅有 pull 权限；直接推送和合并需补充写权限或切换授权身份。
