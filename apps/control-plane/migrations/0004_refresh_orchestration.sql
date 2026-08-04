CREATE TABLE daily_plan_revisions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  next_revision INTEGER NOT NULL CHECK (next_revision >= 2),
  PRIMARY KEY (user_id, local_date)
);

CREATE TABLE refresh_leases (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_daily_plans_latest ON daily_plans(user_id, local_date, revision DESC);
CREATE INDEX idx_agent_runs_completed ON agent_runs(user_id, completed_at DESC);
