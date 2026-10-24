-- Cloudflare D1: sedx-admin
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image TEXT DEFAULT '',
  audience TEXT DEFAULT 'Todos os alunos',
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  ra TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Aluno',
  status TEXT NOT NULL DEFAULT 'Ativo',
  last_seen TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_ra TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS site_metrics (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS published_tools (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL CHECK (action_type IN ('copy', 'site')),
  content TEXT NOT NULL,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS published_partnerships (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  logo TEXT NOT NULL DEFAULT '',
  banner TEXT NOT NULL DEFAULT '',
  destination_url TEXT NOT NULL,
  partnership_type TEXT NOT NULL CHECK (partnership_type IN ('Discord', 'WhatsApp', 'Outro')),
  is_published INTEGER NOT NULL DEFAULT 0 CHECK (is_published IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Web Push. Tokens de sessão ficam criptografados no Worker antes de chegar ao D1.
CREATE TABLE IF NOT EXISTS push_users (
  user_ra TEXT PRIMARY KEY,
  session_ciphertext TEXT NOT NULL,
  session_iv TEXT NOT NULL,
  task_ids_json TEXT DEFAULT NULL,
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
CREATE TABLE IF NOT EXISTS push_notice_deliveries (
  user_ra TEXT NOT NULL,
  notice_id TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_ra, notice_id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_published ON notifications(published_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_published_tools_published ON published_tools(published_at);
CREATE INDEX IF NOT EXISTS idx_published_partnerships_status ON published_partnerships(is_published, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_ra);

-- Chat público dos alunos. O Worker valida a sessão SED em cada rota.
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  author_ra TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_avatar_url TEXT DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  attachment_url TEXT DEFAULT '',
  attachment_name TEXT DEFAULT '',
  attachment_type TEXT DEFAULT '',
  audio_url TEXT DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  edited_at TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_mutes (
  user_ra TEXT PRIMARY KEY,
  muted_until TEXT DEFAULT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_bans (
  user_ra TEXT PRIMARY KEY,
  reason TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_author ON chat_messages(author_ra, created_at DESC);
