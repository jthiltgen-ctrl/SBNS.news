PRAGMA foreign_keys = ON;

CREATE TABLE sbns_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO sbns_meta (key, value) VALUES ('schema_version', '1');

CREATE TABLE intakes (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK (origin IN ('editor', 'visitor', 'monitor', 'discovery')),
  submitted_url TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  submitter_note TEXT,
  status TEXT NOT NULL CHECK (status IN ('submitted', 'queued', 'analyzing', 'review_ready', 'editing', 'held', 'rejected', 'approved', 'publication_pending', 'publication_pr_open', 'published', 'failed')),
  analysis_status TEXT NOT NULL CHECK (analysis_status IN ('not_started', 'queued', 'running', 'complete', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('publish', 'hold', 'reject')),
  recommendation_confidence TEXT NOT NULL CHECK (recommendation_confidence IN ('high', 'medium', 'low')),
  category TEXT NOT NULL CHECK (category IN ('International', 'National', 'Local')),
  severity INTEGER CHECK (severity IS NULL OR severity BETWEEN 1 AND 5),
  systemic_failure INTEGER NOT NULL CHECK (systemic_failure IN (0, 1)),
  raw_analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  superseded_at TEXT,
  UNIQUE (id, intake_id),
  FOREIGN KEY (intake_id) REFERENCES intakes(id) ON DELETE RESTRICT
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('primary', 'government', 'watchdog', 'audit', 'court', 'official_response', 'independent_reporting', 'other')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'verified_with_qualification', 'disputed', 'unverified')),
  fetched_at TEXT,
  content_hash TEXT,
  source_title TEXT,
  published_at TEXT,
  updated_at TEXT,
  extracted_text TEXT,
  extraction_format TEXT CHECK (extraction_format IS NULL OR extraction_format IN ('text', 'html_to_text', 'pdf_text')),
  created_at TEXT NOT NULL,
  UNIQUE (id, intake_id),
  FOREIGN KEY (intake_id) REFERENCES intakes(id) ON DELETE RESTRICT
);

CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL,
  analysis_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  material INTEGER NOT NULL CHECK (material IN (0, 1)),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'verified_with_qualification', 'disputed', 'unverified')),
  qualification TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (id, intake_id),
  FOREIGN KEY (intake_id) REFERENCES intakes(id) ON DELETE RESTRICT,
  FOREIGN KEY (analysis_id, intake_id) REFERENCES analyses(id, intake_id) ON DELETE RESTRICT
);

CREATE TABLE claim_sources (
  claim_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  intake_id TEXT NOT NULL,
  PRIMARY KEY (claim_id, source_id),
  FOREIGN KEY (claim_id, intake_id) REFERENCES claims(id, intake_id) ON DELETE RESTRICT,
  FOREIGN KEY (source_id, intake_id) REFERENCES sources(id, intake_id) ON DELETE RESTRICT
);

CREATE TABLE editorial_drafts (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  story_id TEXT,
  headline TEXT NOT NULL,
  summary TEXT NOT NULL,
  fml_kicker TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('International', 'National', 'Local')),
  severity INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 5),
  topic_tags_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (intake_id, revision),
  UNIQUE (id, intake_id),
  FOREIGN KEY (intake_id) REFERENCES intakes(id) ON DELETE RESTRICT
);

CREATE TABLE editorial_decisions (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL,
  draft_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'hold', 'reject')),
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  notes TEXT,
  CHECK ((decision = 'approve' AND draft_id IS NOT NULL) OR decision IN ('hold', 'reject')),
  FOREIGN KEY (intake_id) REFERENCES intakes(id) ON DELETE RESTRICT,
  FOREIGN KEY (draft_id, intake_id) REFERENCES editorial_drafts(id, intake_id) ON DELETE RESTRICT
);

CREATE TABLE publication_attempts (
  id TEXT PRIMARY KEY,
  intake_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'preparing', 'branch_created', 'files_written', 'pr_open', 'merged', 'deployed', 'verified', 'failed')),
  branch_name TEXT,
  pull_request_number INTEGER,
  commit_sha TEXT,
  failure_stage TEXT,
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (intake_id) REFERENCES intakes(id) ON DELETE RESTRICT,
  FOREIGN KEY (draft_id, intake_id) REFERENCES editorial_drafts(id, intake_id) ON DELETE RESTRICT
);

CREATE TABLE monitoring_events (
  id TEXT PRIMARY KEY,
  story_id TEXT NOT NULL,
  development_url TEXT NOT NULL,
  development_type TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('no_action', 'update_review', 'correction_review', 'follow_up')),
  original_story_accurate TEXT NOT NULL CHECK (original_story_accurate IN ('true', 'false', 'uncertain')),
  material_change INTEGER NOT NULL CHECK (material_change IN (0, 1)),
  analysis_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_intakes_status_updated ON intakes(status, updated_at);
CREATE INDEX idx_intakes_origin_submitted ON intakes(origin, submitted_at);
CREATE INDEX idx_analyses_intake_created ON analyses(intake_id, created_at);
CREATE INDEX idx_sources_intake ON sources(intake_id);
CREATE INDEX idx_sources_normalized_url ON sources(normalized_url);
CREATE INDEX idx_claims_intake ON claims(intake_id);
CREATE INDEX idx_claims_analysis ON claims(analysis_id);
CREATE INDEX idx_editorial_drafts_intake_revision ON editorial_drafts(intake_id, revision);
CREATE INDEX idx_editorial_decisions_intake_decided ON editorial_decisions(intake_id, decided_at);
CREATE INDEX idx_publication_attempts_intake_started ON publication_attempts(intake_id, started_at);
CREATE INDEX idx_monitoring_events_story_checked ON monitoring_events(story_id, checked_at);
CREATE INDEX idx_monitoring_events_status_checked ON monitoring_events(status, checked_at);
CREATE INDEX idx_audit_events_entity_created ON audit_events(entity_type, entity_id, created_at);
