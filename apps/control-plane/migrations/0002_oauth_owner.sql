ALTER TABLE oauth_flows ADD COLUMN user_id TEXT;
CREATE INDEX idx_oauth_flows_expires ON oauth_flows(expires_at);
