PRAGMA foreign_keys = ON;

CREATE TABLE watchdesk_source_candidates (
  hostname TEXT PRIMARY KEY,
  representative_url TEXT NOT NULL,
  first_intake_id TEXT NOT NULL,
  first_origin TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_intake_id TEXT NOT NULL,
  last_origin TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1 CHECK (observation_count >= 1),
  qualifying_intake_count INTEGER NOT NULL DEFAULT 0 CHECK (qualifying_intake_count >= 0),
  status TEXT NOT NULL DEFAULT 'observed' CHECK (status IN ('observed', 'eligible', 'approved', 'rejected')),
  source_id TEXT UNIQUE,
  source_name TEXT,
  source_class TEXT CHECK (source_class IS NULL OR source_class IN ('primary_oversight', 'primary_institutional', 'secondary_reporting_signal', 'local_regional', 'public_whistleblower_signal')),
  jurisdiction TEXT,
  discovery_url TEXT,
  adapter TEXT CHECK (adapter IS NULL OR adapter IN ('html_links', 'rss_atom')),
  allowed_hosts_json TEXT CHECK (allowed_hosts_json IS NULL OR (json_valid(allowed_hosts_json) AND json_type(allowed_hosts_json) = 'array')),
  allowed_path_prefixes_json TEXT CHECK (allowed_path_prefixes_json IS NULL OR (json_valid(allowed_path_prefixes_json) AND json_type(allowed_path_prefixes_json) = 'array')),
  primary_record INTEGER CHECK (primary_record IS NULL OR primary_record IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  decision_note TEXT,
  decided_by TEXT,
  decided_at TEXT,
  FOREIGN KEY (first_intake_id) REFERENCES intakes(id) ON DELETE RESTRICT,
  FOREIGN KEY (last_intake_id) REFERENCES intakes(id) ON DELETE RESTRICT,
  CHECK (status != 'approved' OR (
    source_id IS NOT NULL AND source_name IS NOT NULL AND source_class IS NOT NULL
    AND jurisdiction IS NOT NULL AND discovery_url IS NOT NULL AND adapter IS NOT NULL
    AND allowed_hosts_json IS NOT NULL AND allowed_path_prefixes_json IS NOT NULL
    AND primary_record IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL
  )),
  CHECK (enabled = 0 OR status = 'approved')
);

CREATE INDEX idx_watchdesk_source_candidates_status_activity
  ON watchdesk_source_candidates(status, qualifying_intake_count DESC, last_seen_at DESC);

UPDATE sbns_meta SET value = '6' WHERE key = 'schema_version' AND value = '5';
