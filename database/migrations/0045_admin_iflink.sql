-- 后台管理员登录切换到 IF.Link 账户（决策 13.7）：admin_users 按 Accounts UUID 建档；
-- admin_sessions 带上撤销目录要的三元组（sub/sid/iat），旧会话没有它们，在启用统一账户后
-- 视为失效（fail closed，管理员重新登录一次即可）。

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS accounts_uuid text UNIQUE;

ALTER TABLE admin_sessions
  ADD COLUMN IF NOT EXISTS sub text,
  ADD COLUMN IF NOT EXISTS sid text,
  ADD COLUMN IF NOT EXISTS iat bigint;
