CREATE TABLE IF NOT EXISTS push_users (
  user_ra TEXT PRIMARY KEY,
  session_ciphertext TEXT NOT NULL,
  session_iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_ra TEXT NOT NULL,
  subscription_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_daily_log (
  user_ra TEXT NOT NULL,
  local_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_ra, local_date, kind)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_ra ON push_subscriptions(user_ra);
CREATE INDEX IF NOT EXISTS idx_push_users_updated_at ON push_users(updated_at);

CREATE TABLE IF NOT EXISTS push_notice_deliveries (
  user_ra TEXT NOT NULL,
  notice_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_ra, notice_id)
);

CREATE INDEX IF NOT EXISTS idx_push_notice_deliveries_notice ON push_notice_deliveries(notice_id);
