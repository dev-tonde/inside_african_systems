PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_subject TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  time_zone TEXT NOT NULL CHECK (time_zone = 'Africa/Johannesburg'),
  created_at TEXT NOT NULL
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  google_subject TEXT NOT NULL,
  email TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('personal', 'work')),
  encrypted_refresh_token TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  UNIQUE(user_id, google_subject),
  UNIQUE(user_id, context)
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_flows (
  state_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('owner_login', 'connect_account')),
  code_verifier_encrypted TEXT NOT NULL,
  context TEXT CHECK (context IN ('personal', 'work')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE email_records (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  sender TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source_version TEXT NOT NULL,
  snippet TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, provider_message_id)
);

CREATE TABLE email_classifications (
  account_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  importance TEXT NOT NULL CHECK (importance IN ('critical', 'high', 'normal', 'low')),
  workflow_state TEXT NOT NULL CHECK (workflow_state IN ('reply', 'do', 'waiting', 'read_later', 'auto_archive', 'spam_review')),
  life_priority TEXT NOT NULL CHECK (life_priority IN ('faith_and_community', 'income_and_wealth', 'personal_administration', 'primary_job_or_business', 'inside_african_systems', 'family_and_relationships')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  explanation TEXT NOT NULL,
  classified_at TEXT NOT NULL,
  PRIMARY KEY (account_id, provider_message_id, source_version),
  FOREIGN KEY (account_id, provider_message_id)
    REFERENCES email_records(account_id, provider_message_id) ON DELETE CASCADE
);

CREATE TABLE calendar_events (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider_event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  attendee_count INTEGER NOT NULL,
  source_version TEXT NOT NULL,
  location TEXT,
  organizer_email TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, provider_event_id)
);

CREATE TABLE calendar_assessments (
  account_id TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('protect', 'attend', 'optional', 'recommend_decline_or_reschedule')),
  life_priority TEXT NOT NULL CHECK (life_priority IN ('faith_and_community', 'income_and_wealth', 'personal_administration', 'primary_job_or_business', 'inside_african_systems', 'family_and_relationships')),
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  explanation TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  PRIMARY KEY (account_id, provider_event_id, source_version),
  FOREIGN KEY (account_id, provider_event_id)
    REFERENCES calendar_events(account_id, provider_event_id) ON DELETE CASCADE
);

CREATE TABLE daily_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  revision INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  UNIQUE(user_id, local_date, revision)
);

CREATE TABLE sync_cursors (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'calendar')),
  cursor TEXT,
  last_success_at TEXT,
  PRIMARY KEY (account_id, provider)
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('full', 'delta')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'degraded', 'failed')),
  input_refs_json TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('routine', 'high', 'critical')),
  dedupe_key TEXT NOT NULL,
  safe_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  UNIQUE(user_id, dedupe_key)
);

CREATE INDEX idx_email_received ON email_records(account_id, received_at DESC);
CREATE INDEX idx_calendar_starts ON calendar_events(account_id, starts_at);
CREATE INDEX idx_agent_runs_started ON agent_runs(user_id, started_at DESC);
