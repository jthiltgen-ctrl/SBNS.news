PRAGMA foreign_keys = ON;

CREATE TABLE analysis_jobs (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type = 'intake_analysis'),
  state TEXT NOT NULL CHECK (state IN ('pending_enqueue', 'queued', 'running', 'retrying', 'complete', 'failed', 'dead_letter')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  source_id TEXT,
  analysis_id TEXT,
  enqueued_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (intake_id) REFERENCES intakes(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, intake_id) REFERENCES sources(id, intake_id) ON DELETE RESTRICT,
  FOREIGN KEY (analysis_id, intake_id) REFERENCES analyses(id, intake_id) ON DELETE RESTRICT
);

CREATE INDEX idx_analysis_jobs_intake_created
  ON analysis_jobs(intake_id, created_at);
CREATE INDEX idx_analysis_jobs_state_updated
  ON analysis_jobs(state, updated_at);
CREATE UNIQUE INDEX idx_analysis_jobs_active_intake
  ON analysis_jobs(intake_id)
  WHERE state IN ('pending_enqueue', 'queued', 'running', 'retrying');

UPDATE sbns_meta SET value = '3' WHERE key = 'schema_version';
