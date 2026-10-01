PRAGMA foreign_keys = ON;

CREATE TABLE echo_packets (
  id TEXT PRIMARY KEY,
  issue_key TEXT NOT NULL CHECK (length(trim(issue_key)) BETWEEN 1 AND 200),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  evidence_snapshot_hash TEXT NOT NULL CHECK (length(evidence_snapshot_hash) = 64 AND evidence_snapshot_hash NOT GLOB '*[^0-9a-f]*'),
  brief_json TEXT NOT NULL CHECK (json_valid(brief_json) AND json_type(brief_json) = 'object'),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'ready', 'no_echo', 'failed')),
  no_echo_reason_code TEXT CHECK (no_echo_reason_code IS NULL OR length(trim(no_echo_reason_code)) BETWEEN 1 AND 80),
  no_echo_reason TEXT CHECK (no_echo_reason IS NULL OR length(trim(no_echo_reason)) BETWEEN 1 AND 500),
  created_by TEXT NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  superseded_at TEXT,
  UNIQUE (issue_key, revision),
  UNIQUE (issue_key, evidence_snapshot_hash),
  CHECK ((state = 'no_echo') = (no_echo_reason_code IS NOT NULL)),
  CHECK (state = 'no_echo' OR no_echo_reason IS NULL)
);

CREATE INDEX idx_echo_packets_issue_revision ON echo_packets(issue_key, revision DESC);
CREATE INDEX idx_echo_packets_state_updated ON echo_packets(state, updated_at);

CREATE TRIGGER echo_packet_brief_immutable BEFORE UPDATE OF issue_key, revision, evidence_snapshot_hash, brief_json, created_by, created_at ON echo_packets
BEGIN SELECT RAISE(ABORT, 'Echo packet brief revisions are immutable'); END;
CREATE TRIGGER echo_packet_delete_forbidden BEFORE DELETE ON echo_packets
BEGIN SELECT RAISE(ABORT, 'Echo packet history is retained'); END;

CREATE TABLE echo_packet_intakes (
  packet_id TEXT NOT NULL,
  intake_id TEXT NOT NULL,
  intake_role TEXT NOT NULL CHECK (intake_role IN ('primary', 'supporting')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (packet_id, intake_id),
  FOREIGN KEY (packet_id) REFERENCES echo_packets(id) ON DELETE RESTRICT,
  FOREIGN KEY (intake_id) REFERENCES intakes(id) ON DELETE RESTRICT
);

CREATE INDEX idx_echo_packet_intakes_intake ON echo_packet_intakes(intake_id, packet_id);
CREATE UNIQUE INDEX idx_echo_packet_intakes_primary ON echo_packet_intakes(packet_id) WHERE intake_role = 'primary';
CREATE TRIGGER echo_packet_intake_update_forbidden BEFORE UPDATE ON echo_packet_intakes
BEGIN SELECT RAISE(ABORT, 'Echo packet intake links are immutable'); END;
CREATE TRIGGER echo_packet_intake_delete_forbidden BEFORE DELETE ON echo_packet_intakes
BEGIN SELECT RAISE(ABORT, 'Echo packet intake links are retained'); END;

CREATE TABLE echo_jobs (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 200),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'review_ready', 'scheduled')),
  requested_by TEXT NOT NULL CHECK (length(trim(requested_by)) > 0),
  processor_version TEXT NOT NULL CHECK (length(trim(processor_version)) > 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'researching', 'verifying', 'rights_check', 'assembling', 'ready', 'no_echo', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) <= 80),
  failure_message TEXT CHECK (failure_message IS NULL OR length(failure_message) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (packet_id, idempotency_key),
  FOREIGN KEY (packet_id) REFERENCES echo_packets(id) ON DELETE RESTRICT,
  CHECK ((state IN ('ready', 'no_echo', 'failed')) = (completed_at IS NOT NULL)),
  CHECK (state = 'failed' OR (failure_code IS NULL AND failure_message IS NULL))
);

CREATE UNIQUE INDEX idx_echo_jobs_active_packet ON echo_jobs(packet_id) WHERE state IN ('pending', 'researching', 'verifying', 'rights_check', 'assembling');
CREATE INDEX idx_echo_jobs_state_updated ON echo_jobs(state, updated_at);

CREATE TABLE echo_candidates (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  canonical_artifact_id TEXT NOT NULL CHECK (length(trim(canonical_artifact_id)) > 0),
  artifact_type TEXT NOT NULL CHECK (length(trim(artifact_type)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  creator TEXT,
  creation_date TEXT,
  state TEXT NOT NULL CHECK (state IN ('found', 'researching', 'rejected_by_gate', 'editor_ready')),
  gate_reason_code TEXT CHECK (gate_reason_code IS NULL OR length(trim(gate_reason_code)) BETWEEN 1 AND 80),
  editor_ready_slot INTEGER CHECK (editor_ready_slot IS NULL OR editor_ready_slot BETWEEN 1 AND 3),
  editor_ready_assessment_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, packet_id),
  UNIQUE (id, packet_id, editor_ready_assessment_id),
  UNIQUE (packet_id, canonical_artifact_id),
  UNIQUE (packet_id, editor_ready_slot),
  FOREIGN KEY (packet_id) REFERENCES echo_packets(id) ON DELETE RESTRICT,
  FOREIGN KEY (editor_ready_assessment_id, id, packet_id) REFERENCES echo_candidate_assessments(id, candidate_id, packet_id) ON DELETE RESTRICT,
  CHECK ((state = 'editor_ready') = (editor_ready_slot IS NOT NULL)),
  CHECK ((state = 'editor_ready') = (editor_ready_assessment_id IS NOT NULL)),
  CHECK ((state = 'rejected_by_gate') = (gate_reason_code IS NOT NULL))
);

CREATE INDEX idx_echo_candidates_packet_state ON echo_candidates(packet_id, state);
CREATE TRIGGER echo_candidate_identity_immutable BEFORE UPDATE OF packet_id, canonical_artifact_id, artifact_type, title, creator, creation_date, created_at ON echo_candidates
BEGIN SELECT RAISE(ABORT, 'Echo candidate identity is immutable'); END;
CREATE TRIGGER echo_candidate_readiness_immutable BEFORE UPDATE ON echo_candidates
WHEN OLD.state = 'editor_ready' AND (
  NEW.state != 'editor_ready' OR NEW.editor_ready_slot != OLD.editor_ready_slot
  OR NEW.editor_ready_assessment_id != OLD.editor_ready_assessment_id
)
BEGIN SELECT RAISE(ABORT, 'Echo candidate readiness is pinned'); END;

CREATE TABLE echo_candidate_assessments (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  original_context TEXT NOT NULL CHECK (length(trim(original_context)) > 0),
  creator_intent_status TEXT NOT NULL CHECK (creator_intent_status IN ('documented', 'contested', 'unknown', 'not_claimed')),
  what_echoes TEXT NOT NULL CHECK (length(trim(what_echoes)) > 0),
  comparison_breaks TEXT NOT NULL CHECK (length(trim(comparison_breaks)) > 0),
  remains_uncertain TEXT NOT NULL CHECK (length(trim(remains_uncertain)) > 0),
  tempted_overclaim TEXT NOT NULL CHECK (length(trim(tempted_overclaim)) > 0),
  present_day_evidence TEXT NOT NULL CHECK (length(trim(present_day_evidence)) > 0),
  editorial_value TEXT NOT NULL CHECK (length(trim(editorial_value)) > 0),
  research_burden TEXT NOT NULL CHECK (research_burden IN ('low', 'moderate', 'high', 'disproportionate')),
  source_set_hash TEXT NOT NULL CHECK (length(source_set_hash) = 64 AND source_set_hash NOT GLOB '*[^0-9a-f]*'),
  generator_type TEXT NOT NULL CHECK (generator_type IN ('human', 'system', 'model_assisted')),
  generator_version TEXT NOT NULL CHECK (length(trim(generator_version)) > 0),
  created_by TEXT NOT NULL CHECK (length(trim(created_by)) > 0),
  created_at TEXT NOT NULL,
  UNIQUE (id, candidate_id, packet_id),
  UNIQUE (candidate_id, revision),
  FOREIGN KEY (candidate_id, packet_id) REFERENCES echo_candidates(id, packet_id) ON DELETE RESTRICT
);

CREATE INDEX idx_echo_assessments_candidate_revision ON echo_candidate_assessments(candidate_id, revision DESC);
CREATE TRIGGER echo_assessment_current_research_only BEFORE INSERT ON echo_candidate_assessments
WHEN NOT EXISTS (
  SELECT 1 FROM echo_candidates AS candidate
  JOIN echo_packets AS packet ON packet.id = candidate.packet_id
  WHERE candidate.id = NEW.candidate_id AND candidate.packet_id = NEW.packet_id
    AND candidate.state IN ('found', 'researching')
    AND packet.state = 'open' AND packet.superseded_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'Echo assessments require a current open research candidate'); END;
CREATE TRIGGER echo_assessment_update_forbidden BEFORE UPDATE ON echo_candidate_assessments
BEGIN SELECT RAISE(ABORT, 'Echo assessments are append-only'); END;
CREATE TRIGGER echo_assessment_delete_forbidden BEFORE DELETE ON echo_candidate_assessments
BEGIN SELECT RAISE(ABORT, 'Echo assessments are retained'); END;

CREATE TABLE echo_candidate_sources (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  source_role TEXT NOT NULL CHECK (source_role IN ('original_work', 'historical_context', 'contemporary_evidence', 'rights')),
  supports_field TEXT NOT NULL CHECK (supports_field IN ('original_context', 'creator_intent', 'what_echoes', 'comparison_breaks', 'remains_uncertain', 'tempted_overclaim', 'present_day_evidence', 'editorial_value', 'rights')),
  intake_source_id TEXT,
  source_intake_id TEXT,
  url TEXT,
  canonical_identifier TEXT,
  title TEXT,
  authority_rationale TEXT NOT NULL CHECK (length(trim(authority_rationale)) > 0),
  published_at TEXT,
  retrieved_at TEXT,
  content_hash TEXT CHECK (content_hash IS NULL OR (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL,
  UNIQUE (id, candidate_id, packet_id),
  FOREIGN KEY (assessment_id, candidate_id, packet_id) REFERENCES echo_candidate_assessments(id, candidate_id, packet_id) ON DELETE RESTRICT,
  FOREIGN KEY (intake_source_id, source_intake_id) REFERENCES sources(id, intake_id) ON DELETE RESTRICT,
  FOREIGN KEY (packet_id, source_intake_id) REFERENCES echo_packet_intakes(packet_id, intake_id) ON DELETE RESTRICT,
  CHECK ((source_role = 'rights') = (supports_field = 'rights')),
  CHECK ((intake_source_id IS NULL) = (source_intake_id IS NULL)),
  CHECK (intake_source_id IS NULL OR source_role = 'contemporary_evidence'),
  CHECK (intake_source_id IS NOT NULL OR (length(trim(COALESCE(url, ''))) > 0 OR length(trim(COALESCE(canonical_identifier, ''))) > 0))
);

CREATE INDEX idx_echo_sources_assessment_role ON echo_candidate_sources(assessment_id, source_role);
CREATE INDEX idx_echo_sources_intake_source ON echo_candidate_sources(intake_source_id, source_intake_id);
CREATE TRIGGER echo_source_reviewed_assessment_locked BEFORE INSERT ON echo_candidate_sources
WHEN EXISTS (SELECT 1 FROM echo_candidates WHERE id = NEW.candidate_id AND state = 'editor_ready')
  OR EXISTS (SELECT 1 FROM echo_decisions WHERE assessment_id = NEW.assessment_id)
BEGIN SELECT RAISE(ABORT, 'Reviewed Echo assessment sources are frozen'); END;
CREATE TRIGGER echo_source_update_forbidden BEFORE UPDATE ON echo_candidate_sources
BEGIN SELECT RAISE(ABORT, 'Echo source links are append-only'); END;
CREATE TRIGGER echo_source_delete_forbidden BEFORE DELETE ON echo_candidate_sources
BEGIN SELECT RAISE(ABORT, 'Echo source links are retained'); END;

CREATE TABLE echo_rights_assessments (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('text', 'lyrics', 'artwork', 'photograph', 'film_still', 'audio', 'video', 'cover_art', 'manuscript_image', 'other')),
  asset_identifier TEXT NOT NULL CHECK (length(trim(asset_identifier)) > 0),
  proposed_use TEXT NOT NULL CHECK (length(trim(proposed_use)) > 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  status TEXT NOT NULL CHECK (status IN ('public_domain', 'open_license', 'licensed', 'embed_allowed', 'link_metadata_only', 'fair_use_review_required', 'unknown', 'do_not_reproduce')),
  basis TEXT NOT NULL CHECK (length(trim(basis)) > 0),
  permitted_use TEXT NOT NULL CHECK (length(trim(permitted_use)) > 0),
  attribution TEXT,
  jurisdiction TEXT,
  rights_source_id TEXT,
  reviewed_by TEXT NOT NULL CHECK (length(trim(reviewed_by)) > 0),
  reviewed_at TEXT NOT NULL,
  recheck_at TEXT,
  supersedes_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (id, candidate_id, packet_id),
  UNIQUE (candidate_id, asset_type, asset_identifier, proposed_use, revision),
  FOREIGN KEY (candidate_id, packet_id) REFERENCES echo_candidates(id, packet_id) ON DELETE RESTRICT,
  FOREIGN KEY (rights_source_id, candidate_id, packet_id) REFERENCES echo_candidate_sources(id, candidate_id, packet_id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id, candidate_id, packet_id) REFERENCES echo_rights_assessments(id, candidate_id, packet_id) ON DELETE RESTRICT,
  CHECK ((revision = 1) = (supersedes_id IS NULL))
);

CREATE INDEX idx_echo_rights_candidate_asset ON echo_rights_assessments(candidate_id, asset_type, asset_identifier, proposed_use, revision DESC);
CREATE TRIGGER echo_rights_supersession_guard BEFORE INSERT ON echo_rights_assessments
WHEN NEW.revision > 1 AND NOT EXISTS (
  SELECT 1 FROM echo_rights_assessments
  WHERE id = NEW.supersedes_id AND candidate_id = NEW.candidate_id AND packet_id = NEW.packet_id
    AND asset_type = NEW.asset_type AND asset_identifier = NEW.asset_identifier
    AND proposed_use = NEW.proposed_use AND revision = NEW.revision - 1
)
BEGIN SELECT RAISE(ABORT, 'Echo rights revision must supersede the same asset and use'); END;
CREATE TRIGGER echo_rights_source_role_guard BEFORE INSERT ON echo_rights_assessments
WHEN NEW.rights_source_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM echo_candidate_sources WHERE id = NEW.rights_source_id
    AND candidate_id = NEW.candidate_id AND packet_id = NEW.packet_id AND source_role = 'rights'
)
BEGIN SELECT RAISE(ABORT, 'Echo rights source must have the rights role'); END;
CREATE TRIGGER echo_rights_update_forbidden BEFORE UPDATE ON echo_rights_assessments
BEGIN SELECT RAISE(ABORT, 'Echo rights assessments are append-only'); END;
CREATE TRIGGER echo_rights_delete_forbidden BEFORE DELETE ON echo_rights_assessments
BEGIN SELECT RAISE(ABORT, 'Echo rights assessments are retained'); END;

CREATE TABLE echo_decisions (
  id TEXT PRIMARY KEY,
  packet_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('feature', 'hold', 'reject')),
  decided_by TEXT NOT NULL CHECK (length(trim(decided_by)) > 0),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  decided_at TEXT NOT NULL,
  FOREIGN KEY (assessment_id, candidate_id, packet_id) REFERENCES echo_candidate_assessments(id, candidate_id, packet_id) ON DELETE RESTRICT,
  FOREIGN KEY (candidate_id, packet_id, assessment_id) REFERENCES echo_candidates(id, packet_id, editor_ready_assessment_id) ON DELETE RESTRICT
);

CREATE INDEX idx_echo_decisions_packet_decided ON echo_decisions(packet_id, decided_at DESC, id DESC);
CREATE TRIGGER echo_decision_update_forbidden BEFORE UPDATE ON echo_decisions
BEGIN SELECT RAISE(ABORT, 'Echo human decisions are append-only'); END;
CREATE TRIGGER echo_decision_delete_forbidden BEFORE DELETE ON echo_decisions
BEGIN SELECT RAISE(ABORT, 'Echo human decisions are retained'); END;

UPDATE sbns_meta SET value = '5' WHERE key = 'schema_version' AND value = '4';
