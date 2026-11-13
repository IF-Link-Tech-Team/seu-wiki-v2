-- Subscription profiles are Wiki business data. They use the stable Accounts UUID
-- already stored in members.id and never duplicate Logto subjects as a business key.
CREATE TABLE member_subscription_profiles (
  member_id         uuid PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  profile           jsonb NOT NULL CHECK (jsonb_typeof(profile) = 'object'),
  taxonomy_version  text NOT NULL,
  revision          integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

