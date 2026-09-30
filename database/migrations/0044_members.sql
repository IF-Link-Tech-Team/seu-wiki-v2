-- IF.Link 统一账户接入（member 认证层）：Logto（OIDC 身份）+ Accounts（跨站 UUID 花名册）。
-- 本站业务只认 Accounts UUID 为主键；Logto sub 只用于登录时解析 UUID，不当业务键。
-- member_sessions 仿 admin_sessions（哈希、CSRF、过期），与 admin/org 的凭证完全隔离；
-- 信任本地会话前要查 Accounts 的撤销目录（见 member/accounts.ts）。

CREATE TABLE members (
  id            uuid PRIMARY KEY,          -- Accounts UUID
  logto_sub     text NOT NULL UNIQUE,      -- Logto subject，仅用于登录解析
  email         text,
  display_name  text,
  -- 画像（登录后从 seuwiki_profile cookie 一键迁入；匿名时画像只在 cookie）
  college       text,
  degree        text,
  grade         text,
  interests     jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE member_sessions (
  id_hash     text PRIMARY KEY,
  member_id   uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  csrf_token  text NOT NULL,
  -- 撤销目录要的三元组：Logto 会话 sid / 用户 sub / token 签发 iat
  sid         text,
  sub         text NOT NULL,
  iat         bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);

CREATE INDEX member_sessions_member_idx ON member_sessions (member_id);
