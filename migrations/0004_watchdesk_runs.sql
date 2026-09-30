PRAGMA foreign_keys = ON;

CREATE TABLE watchdesk_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'scheduled')),
  dry_run INTEGER NOT NULL CHECK (dry_run IN (0, 1)),
  requested_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped-overlap')),
  metrics_json TEXT,
  source_health_json TEXT,
  source_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (source_failure_count >= 0),
  submitted_count INTEGER NOT NULL DEFAULT 0 CHECK (submitted_count BETWEEN 0 AND 5),
  submitted_ids_json TEXT NOT NULL DEFAULT '[]',
  error_class TEXT,
  error_message TEXT
);

CREATE INDEX idx_watchdesk_runs_started ON watchdesk_runs(started_at DESC, id DESC);

CREATE TABLE watchdesk_run_lock (
  name TEXT PRIMARY KEY CHECK (name = 'watchdesk'),
  run_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

UPDATE sbns_meta SET value = '4' WHERE key = 'schema_version';
