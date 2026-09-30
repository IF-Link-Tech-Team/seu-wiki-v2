-- 兴趣词表的运行时管理（决策 13.6）：Git 种子（industry/taxonomy.ts 的 TOPIC_GROUPS）+ 数据库
-- 运行时词表 + 后台审核生长。词表是内容与画像的共同语言：模型打标签从这里选，/for-you 的
-- 兴趣 chip 也从这里读（active 词，60s 缓存）。
-- status：active 在词表 / candidate 候选池（count ≥ 3 才进审核队列）/ rejected（同词不再进候选池）。
-- source：seed 种子 / model 模型提议 / org 组织投稿提议 / admin 管理员手动加。

CREATE TABLE taxonomy_terms (
  id           bigserial PRIMARY KEY,
  grp          text NOT NULL,        -- 学业发展/科研竞赛/实习就业/校园生活/技能成长（候选未批准时为 ''）
  name         text NOT NULL UNIQUE,
  aliases      text[] NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'candidate', 'rejected')),
  source       text NOT NULL DEFAULT 'admin' CHECK (source IN ('seed', 'model', 'org', 'admin')),
  count        integer NOT NULL DEFAULT 0,   -- 候选被提议次数
  examples     text[] NOT NULL DEFAULT '{}', -- 提议时的示例内容链接（保留最近几条）
  reviewed_by  text,
  reviewed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX taxonomy_terms_status_idx ON taxonomy_terms (status, count DESC);

-- 组织投稿表单的"建议新增标签"
ALTER TABLE org_posts ADD COLUMN IF NOT EXISTS suggested_tags text[] NOT NULL DEFAULT '{}';
