-- Short-lived login handoffs. Only one request can consume a pending identity.
CREATE TABLE member_oidc_pending (
  id_hash text PRIMARY KEY,
  identity jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX member_oidc_pending_expiry_idx ON member_oidc_pending (expires_at);
