PRAGMA foreign_keys = ON;

CREATE TABLE idempotency_records (
  key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_id, operation, key)
);

CREATE INDEX idx_idempotency_actor_created
  ON idempotency_records(actor_id, created_at);

UPDATE sbns_meta SET value = '2' WHERE key = 'schema_version';
