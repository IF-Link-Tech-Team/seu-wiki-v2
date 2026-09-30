-- 组织投稿平台 v1：社团/学生组织凭独立轻量凭证自助投稿，管理员审核后进入统一内容库。
-- 与 admin 认证完全隔离：单独的成员令牌（只存哈希）、单独的 org_sessions，组织凭证在 /api/admin/* 上一律无效。
-- 审核通过的投稿经 upsertMaterial 进入 articles/publications：每个组织对应一条 kind='external'
-- 的信源行（first_party=true，tier T1_5），后续判重、分析、归组与普通采集一致；
-- campus 受众字段由分析流程照常产出，不建平行机制。

CREATE TABLE organizations (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  intro       text,
  contact     text,
  -- 经平台核验（管理员核验后才允许投稿进入审核队列）
  verified    boolean NOT NULL DEFAULT false,
  -- 组织的内容以该信源的身份进入内容库
  source_id   text REFERENCES sources (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 组织成员：一人一令牌。owner 管成员（换届移交：把 owner 角色交给新成员，自己退为 editor），
-- editor 只能投稿。历史内容挂在组织上，不随成员变动。
CREATE TABLE org_members (
  id          bigserial PRIMARY KEY,
  org_id      bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT '',
  role        text NOT NULL CHECK (role IN ('owner', 'editor')),
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE org_sessions (
  id_hash     text PRIMARY KEY,
  member_id   bigint NOT NULL REFERENCES org_members (id) ON DELETE CASCADE,
  csrf_token  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);

-- 投稿。状态机：pending（待审核）→ published / rejected（review_note 记驳回理由）。
-- 已发布后的改期/修改/取消不另发新帖：申请挂在原条目的 pending_change 上，
-- 管理员批准后落回原条目（改期/修改：原文按同一 identityKey 出新版本并重走分析；取消：原条目下架）。
-- event_at 过去即为「已结束」：前台列表退到历史，公开侧由 campus.deadline 过期 + valueTier 表达。
CREATE TABLE org_posts (
  id             bigserial PRIMARY KEY,
  org_id         bigint NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title          text NOT NULL,
  event_at       timestamptz,
  location       text,
  audience       text,   -- 面向对象
  fee            text,   -- 费用
  signup         text,   -- 报名方式（链接/现场报名等）
  body           text NOT NULL,
  poster_key     text,   -- stored_files.key（海报，可空）
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  review_note    text,
  article_id     text REFERENCES articles (id),
  pending_change jsonb,  -- { type: 'update'|'reschedule'|'cancel', patch, reason, requestedAt }
  created_by     bigint REFERENCES org_members (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX org_posts_org_idx ON org_posts (org_id, created_at DESC);
CREATE INDEX org_posts_pending_idx ON org_posts (status) WHERE status = 'pending';
-- 待审核的变更申请同样出现在审核队列里
CREATE INDEX org_posts_change_idx ON org_posts ((pending_change IS NOT NULL)) WHERE pending_change IS NOT NULL;
