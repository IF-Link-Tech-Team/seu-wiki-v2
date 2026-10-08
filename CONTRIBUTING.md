# 参与共建

SEU Wiki（seu.wiki）是面向东南大学同学的校园信息聚合站：采集校园信源、筛选重要信息、出校园日报，并有经验论坛与东大生存手册。欢迎 Issue 和 Pull Request。

## 开始之前

先读 [AGENTS.md](AGENTS.md) 和 [README](README.md)。行业相关的一切（站名文案、分类、信源、提示词、门槛）都在 `industry/`，通常不需要动 `apps/` 和 `packages/`。再按任务读 `docs/` 里对应的文档。

## 提交流程

1. Fork 本仓库，从 `main` 切出功能分支。
2. 提交信息用中文、说明"做了什么 + 为什么"。
3. 提 PR 回 `main`。CI 必须通过（typecheck、后端测试、web 构建与测试、Docker 冒烟），且需要至少 1 个维护者 review。
4. 合并到 `main` 后会自动部署到生产（见 `.github/workflows/deploy.yml`）。

## 改动后的自检

```bash
npm run typecheck
DATABASE_URL=postgres://127.0.0.1:5432/<名字>_test npm test   # 空库，先 node scripts/migrate.ts
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts
```

## 要守住的规则（详见 AGENTS.md）

- 前端只通过 HTTP 读 `apps/api`；公开出口都从 `packages/backend/src/publication/` 读。
- 页面不触发模型调用；付费请求走回执与预算熔断。
- 不提交 `.env`、密钥和 `.data/`；开发时保持安全阀关闭（`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 等）。
- 数据库迁移只做向后兼容的增量。

## 安全

发现安全漏洞请先私下联系维护者，不要直接开 Issue。
