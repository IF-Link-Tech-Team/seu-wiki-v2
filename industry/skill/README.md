# SEU Wiki — Agent Skill

让支持 Agent Skills（`SKILL.md`）的工具直接用中文查询 [SEU Wiki](https://seu.wiki)：最新精选与全部公开动态（可按教务、奖助、竞赛科研、交流升学、实习就业、社团活动、生活服务、校园新闻分类过滤）、关键词搜索（最近 7 天）、当前热点与事件来龙去脉、校园日报。

**装一次就好，以后不用再更新。** 这个 Skill 只负责把问题交给 SEU Wiki、把结果讲给你；查什么、怎么整理都在 SEU Wiki 服务器上完成，并持续改进。SEU Wiki 以后新增的能力，已经装好的 Skill 会自动用上。

基础能力长期保持匿名、只读、无需 API Key。本 Skill 遵循 [SEU Wiki 使用规则](https://seu.wiki/terms)：个人阅读、学习和班级/社团内部转告可以直接使用；商业产品中使用、公开转载批量内容、再分发数据或绕过频率限制批量抓取，须事先取得同意。

## 安装前可审阅

- [SKILL.md](https://seu.wiki/seuwiki-skill/SKILL.md)
- [安装包清单](https://seu.wiki/seuwiki-skill/manifest.sha256)
- [install.sh](https://seu.wiki/seuwiki-skill/install.sh)
- [LICENSE](https://seu.wiki/seuwiki-skill/LICENSE)
- [agents/openai.yaml](https://seu.wiki/seuwiki-skill/agents/openai.yaml)
- [GitHub 镜像](https://github.com/IF-Link-Tech-Team/seu-wiki-v2/tree/main/industry/skill)（Skill 源文件）

安装包只有 3 个文件：

```text
SKILL.md
LICENSE
agents/openai.yaml
```

## 让 Agent 安装

把这句话发给你的 Agent：`请安装 SEU Wiki Skill：https://seu.wiki/seuwiki-skill/README.md 装完告诉我是否需要开启新会话。`

给 Agent 的做法：

- 能运行 Bash（macOS、Linux、WSL）：用下面的安装命令，Claude Code 用 `--target claude`，其它支持 Agent Skills 的工具用 `--target agents`。
- 不能运行 Bash（例如 Windows 原生环境）：不要把 Bash 命令粘贴到 PowerShell。按 [安装包清单](https://seu.wiki/seuwiki-skill/manifest.sha256) 从 `https://seu.wiki/seuwiki-skill/<文件名>` 下载其中 3 个文件，逐个核对 SHA-256，放进当前 Agent 实际读取的 skills 目录下名为 `seuwiki` 的文件夹，整体替换里面的旧内容。

## 命令行安装

以下 Bash 命令适用于 macOS、Linux 与 WSL。脚本不会猜测平台，必须显式指定 `--target` 或 `--dir`，无参数只显示帮助并退出。

Skill 正文安装到 Agent Skills 通用目录 `~/.agents/skills/seuwiki`（Codex、Gemini CLI、GitHub Copilot、OpenCode 共用）：

```bash
bash <(curl -fsSL https://seu.wiki/seuwiki-skill/install.sh) --target agents
```

Claude Code 按官方约定从 `~/.claude/skills` 发现个人 Skill；下面的命令把正文装到通用目录，再建一个指向同一实体的兼容软链，不复制第二份：

```bash
bash <(curl -fsSL https://seu.wiki/seuwiki-skill/install.sh) --target claude
```

装到自定义目录：

```bash
bash <(curl -fsSL https://seu.wiki/seuwiki-skill/install.sh) \
  --dir "$HOME/path/to/skills/seuwiki"
```

安装器先把完整包下载到同一磁盘的临时目录，逐文件验证 SHA-256 与 Skill 身份，全部通过后才一次替换目标目录。人类说明 `README.md` 不会放进 Skill 安装目录。

安装器会检查以下位置，防止同名 Skill 被一个 Agent 重复发现：

```text
~/.claude/skills/seuwiki
~/.codex/skills/seuwiki
~/.gemini/skills/seuwiki
~/.copilot/skills/seuwiki
~/.config/opencode/skills/seuwiki
```

发现旧副本时默认停止，不会静默覆盖或再造一份。确认这些目录都是旧的 SEU Wiki Skill 后，显式迁移：

```bash
bash <(curl -fsSL https://seu.wiki/seuwiki-skill/install.sh) \
  --target agents \
  --migrate-legacy
```

也可以用 `--dir <旧目录>` 原地更新单一旧副本；这种方式不会处理其它重复副本。迁移完成后，厂商目录不再保留独立副本；Claude Code 的兼容入口是指向 `~/.agents/skills/seuwiki` 的软链。

## 安装后验证

1. 重启 Agent 或开启新会话。
2. 让 Agent 列出它发现的 skills，确认只有一份 `seuwiki`。
3. 提问：`过去 24 小时校园里最重要的 5 件事是什么？`

成功的回答会写明时间范围，给出中文摘要，并把标题链接到 SEU Wiki 站内阅读页。

## 能查询什么

SEU Wiki 目前能查的全部内容，以 [给 Agent 的使用说明](https://seu.wiki/api/v1/agent) 为准；新能力会先加在那里。现在包括：

- 过去 24 小时或最近 7 天的精选与全部公开动态，可按教务、奖助、竞赛科研、交流升学、实习就业、社团活动、生活服务、校园新闻分类过滤。
- 部门、学院、活动和话题关键词搜索（最近 7 天）。
- 现在最热的多源校园事件，以及每个事件的最新进展、报道时间线和综述。
- 最新或指定日期的校园日报（每天 08:00 北京时间发布）。

超过 7 天的历史搜索暂不支持；单篇文章全文请回原文。

## 不装 Skill 也能用

- 让 Agent 读 [https://seu.wiki/api/v1/agent](https://seu.wiki/api/v1/agent)，按里面的说明查询。
- 支持远程 MCP 的客户端可以接 `https://seu.wiki/api/mcp`，工具返回的内容与上面相同。

## 内容、许可与署名

- `LICENSE` 中的 MIT License 只覆盖 Skill 指令与随附文件。
- SEU Wiki 服务与数据输出适用 [SEU Wiki 使用规则](https://seu.wiki/terms)。匿名、无需 API Key 只说明技术访问方式，不代表所有用途均获许可。
- 第三方原文及全文版权归各来源单位所有，不因经过 SEU Wiki 而改变；重要信息（报名时间、资格条件、截止时间等）请回原文核对。

详细接入文档：[seu.wiki/agent](https://seu.wiki/agent)

反馈：[seu.wiki/feedback](https://seu.wiki/feedback)
