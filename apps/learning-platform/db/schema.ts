export const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  client_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS reading_progress (
  space_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  scroll_position REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (space_id, document_id)
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  target_json TEXT NOT NULL,
  body TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'cyan',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annotation_messages (
  id TEXT PRIMARY KEY,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_drafts (
  space_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  base_revision TEXT NOT NULL,
  source TEXT NOT NULL,
  format TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (space_id, document_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_documents USING fts5(
  space_id UNINDEXED,
  space_slug UNINDEXED,
  space_title,
  category,
  document_id UNINDEXED,
  document_slug UNINDEXED,
  title,
  summary,
  body,
  tags,
  tokenize='trigram'
);

CREATE INDEX IF NOT EXISTS idx_annotations_document
ON annotations(space_id, document_id, status);

CREATE INDEX IF NOT EXISTS idx_annotations_updated
ON annotations(updated_at);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry
ON admin_sessions(expires_at);
`
