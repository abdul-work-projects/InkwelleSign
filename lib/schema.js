// Generated from lib/schema.sql — kept as a module so the schema ships with the
// server bundle and needs no filesystem access at runtime.
export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  signing_key   TEXT,
  verify_key    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  prefix        TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  scopes        TEXT NOT NULL DEFAULT 'read,write',
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_apikeys_org ON api_keys(org_id);

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents(org_id);

CREATE TABLE IF NOT EXISTS document_versions (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'source',
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL DEFAULT 'application/pdf',
  byte_size     INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  storage_key   TEXT NOT NULL,
  page_count    INTEGER NOT NULL DEFAULT 0,
  page_sizes    TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_docver_doc ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_docver_org ON document_versions(org_id);

CREATE TABLE IF NOT EXISTS templates (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  document_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  roles         TEXT NOT NULL DEFAULT '[]',
  fields        TEXT NOT NULL DEFAULT '[]',
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_org ON templates(org_id);

CREATE TABLE IF NOT EXISTS envelopes (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_version_id TEXT NOT NULL REFERENCES document_versions(id),
  final_version_id  TEXT REFERENCES document_versions(id),
  certificate_version_id TEXT REFERENCES document_versions(id),
  template_id       TEXT REFERENCES templates(id),
  title             TEXT NOT NULL,
  message           TEXT,
  status            TEXT NOT NULL DEFAULT 'draft',
  ordered           INTEGER NOT NULL DEFAULT 1,
  audit_head_hash   TEXT,
  evidence_signature TEXT,
  expires_at        TEXT,
  created_by        TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL,
  sent_at           TEXT,
  completed_at      TEXT,
  voided_at         TEXT,
  void_reason       TEXT
);
CREATE INDEX IF NOT EXISTS idx_env_org ON envelopes(org_id);
CREATE INDEX IF NOT EXISTS idx_env_status ON envelopes(org_id, status);

CREATE TABLE IF NOT EXISTS recipients (
  id             TEXT PRIMARY KEY,
  envelope_id    TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_index    INTEGER NOT NULL DEFAULT 1,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  role_name      TEXT,
  kind           TEXT NOT NULL DEFAULT 'signer',
  status         TEXT NOT NULL DEFAULT 'created',
  color          TEXT NOT NULL DEFAULT '#2563eb',
  token_hash     TEXT UNIQUE,
  token_prefix   TEXT,
  access_code_hash TEXT,
  auth_method    TEXT NOT NULL DEFAULT 'link',
  sent_at        TEXT,
  viewed_at      TEXT,
  completed_at   TEXT,
  declined_at    TEXT,
  decline_reason TEXT,
  last_reminded_at TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  signed_ip      TEXT,
  signed_user_agent TEXT,
  consent_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_recip_env ON recipients(envelope_id);

CREATE TABLE IF NOT EXISTS fields (
  id            TEXT PRIMARY KEY,
  envelope_id   TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  recipient_id  TEXT REFERENCES recipients(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  page          INTEGER NOT NULL,
  x             REAL NOT NULL,
  y             REAL NOT NULL,
  w             REAL NOT NULL,
  h             REAL NOT NULL,
  required      INTEGER NOT NULL DEFAULT 1,
  label         TEXT,
  options       TEXT,
  font_size     INTEGER NOT NULL DEFAULT 12,
  value         TEXT,
  value_meta    TEXT,
  filled_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_fields_env ON fields(envelope_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  envelope_id   TEXT NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  actor_type    TEXT NOT NULL,
  actor_id      TEXT,
  actor_label   TEXT,
  ip            TEXT,
  user_agent    TEXT,
  payload       TEXT NOT NULL DEFAULT '{}',
  prev_hash     TEXT NOT NULL,
  hash          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_env_seq ON audit_events(envelope_id, seq);

CREATE TABLE IF NOT EXISTS webhooks (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  secret        TEXT NOT NULL,
  events        TEXT NOT NULL DEFAULT '["*"]',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            TEXT PRIMARY KEY,
  webhook_id    TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  org_id        TEXT NOT NULL,
  event         TEXT NOT NULL,
  payload       TEXT NOT NULL,
  status_code   INTEGER,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  delivered_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_wd_org ON webhook_deliveries(org_id, created_at);

CREATE TABLE IF NOT EXISTS email_outbox (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,
  envelope_id   TEXT,
  recipient_id  TEXT,
  to_email      TEXT NOT NULL,
  to_name       TEXT,
  subject       TEXT NOT NULL,
  html          TEXT NOT NULL,
  text          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'invitation',
  status        TEXT NOT NULL DEFAULT 'queued',
  error         TEXT,
  created_at    TEXT NOT NULL,
  sent_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_org ON email_outbox(org_id, created_at);
`;
