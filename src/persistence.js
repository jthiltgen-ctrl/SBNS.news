function database(env) {
  if (!env?.SBNS_DB) throw new Error("SBNS_DB binding is required");
  return env.SBNS_DB;
}

async function run(env, sql, values) {
  return database(env).prepare(sql).bind(...values).run();
}

export async function createIntake(env, intake) {
  return run(env, `INSERT INTO intakes
    (id, origin, submitted_url, submitted_at, submitter_note, status, analysis_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [intake.id, intake.origin, intake.submitted_url, intake.submitted_at, intake.submitter_note ?? null, intake.status, intake.analysis_status, intake.created_at, intake.updated_at]);
}

export async function getIntake(env, id) {
  return database(env).prepare("SELECT * FROM intakes WHERE id = ?").bind(id).first();
}

export async function listIntakes(env, { status = null, origin = null, limit = 50 } = {}) {
  const clauses = [];
  const values = [];
  if (status) { clauses.push("status = ?"); values.push(status); }
  if (origin) { clauses.push("origin = ?"); values.push(origin); }
  values.push(limit);
  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  const result = await database(env).prepare(`SELECT intakes.*,
    (SELECT recommendation FROM analyses WHERE intake_id = intakes.id ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_recommendation,
    (SELECT category FROM analyses WHERE intake_id = intakes.id ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_category,
    (SELECT severity FROM analyses WHERE intake_id = intakes.id ORDER BY created_at DESC, id DESC LIMIT 1) AS latest_severity,
    (SELECT revision FROM editorial_drafts WHERE intake_id = intakes.id ORDER BY revision DESC LIMIT 1) AS latest_draft_revision,
    (SELECT decision FROM editorial_decisions WHERE intake_id = intakes.id ORDER BY decided_at DESC, id DESC LIMIT 1) AS latest_decision
    FROM intakes${where} ORDER BY updated_at DESC, id ASC LIMIT ?`).bind(...values).all();
  return result.results;
}

export async function insertAnalysis(env, analysis) {
  return run(env, `INSERT INTO analyses
    (id, intake_id, schema_version, recommendation, recommendation_confidence, category, severity, systemic_failure, raw_analysis_json, created_at, superseded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [analysis.id, analysis.intake_id, analysis.schema_version, analysis.recommendation, analysis.recommendation_confidence, analysis.category, analysis.severity ?? null, analysis.systemic_failure ? 1 : 0, analysis.raw_analysis_json, analysis.created_at, analysis.superseded_at ?? null]);
}

export async function getLatestAnalysis(env, intakeId) {
  return database(env).prepare("SELECT * FROM analyses WHERE intake_id = ? ORDER BY created_at DESC, id DESC LIMIT 1").bind(intakeId).first();
}

export async function insertSource(env, source) {
  return run(env, `INSERT INTO sources
    (id, intake_id, url, normalized_url, name, source_type, verification_status, fetched_at, content_hash, source_title, published_at, updated_at, extracted_text, extraction_format, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [source.id, source.intake_id, source.url, source.normalized_url, source.name, source.source_type, source.verification_status, source.fetched_at ?? null, source.content_hash ?? null, source.source_title ?? null, source.published_at ?? null, source.updated_at ?? null, source.extracted_text ?? null, source.extraction_format ?? null, source.created_at]);
}

export async function insertClaim(env, claim) {
  return run(env, `INSERT INTO claims
    (id, intake_id, analysis_id, claim_text, material, verification_status, qualification, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [claim.id, claim.intake_id, claim.analysis_id, claim.claim_text, claim.material ? 1 : 0, claim.verification_status, claim.qualification ?? null, claim.created_at]);
}

export async function linkClaimSource(env, claimId, sourceId, intakeId) {
  return run(env, "INSERT INTO claim_sources (claim_id, source_id, intake_id) VALUES (?, ?, ?)", [claimId, sourceId, intakeId]);
}

export async function insertDraft(env, draft) {
  return run(env, `INSERT INTO editorial_drafts
    (id, intake_id, revision, story_id, headline, summary, fml_kicker, category, severity, topic_tags_json, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [draft.id, draft.intake_id, draft.revision, draft.story_id ?? null, draft.headline, draft.summary, draft.fml_kicker, draft.category, draft.severity, draft.topic_tags_json, draft.created_at, draft.created_by]);
}

export async function getDraft(env, id) {
  return database(env).prepare("SELECT * FROM editorial_drafts WHERE id = ?").bind(id).first();
}

export async function insertDecision(env, decision) {
  if (decision.decision === "approve" && !decision.draft_id) throw new Error("Approval requires an exact draft revision");
  return run(env, `INSERT INTO editorial_decisions
    (id, intake_id, draft_id, decision, decided_by, decided_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [decision.id, decision.intake_id, decision.draft_id ?? null, decision.decision, decision.decided_by, decision.decided_at, decision.notes ?? null]);
}

export async function listDecisions(env, intakeId) {
  const result = await database(env).prepare("SELECT * FROM editorial_decisions WHERE intake_id = ? ORDER BY decided_at ASC, id ASC").bind(intakeId).all();
  return result.results;
}

export async function insertPublicationAttempt(env, attempt) {
  return run(env, `INSERT INTO publication_attempts
    (id, intake_id, draft_id, state, branch_name, pull_request_number, commit_sha, failure_stage, failure_message, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [attempt.id, attempt.intake_id, attempt.draft_id, attempt.state, attempt.branch_name ?? null, attempt.pull_request_number ?? null, attempt.commit_sha ?? null, attempt.failure_stage ?? null, attempt.failure_message ?? null, attempt.started_at, attempt.completed_at ?? null]);
}

export async function insertMonitoringEvent(env, event) {
  return run(env, `INSERT INTO monitoring_events
    (id, story_id, development_url, development_type, checked_at, recommendation, original_story_accurate, material_change, analysis_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [event.id, event.story_id, event.development_url, event.development_type, event.checked_at, event.recommendation, event.original_story_accurate, event.material_change ? 1 : 0, event.analysis_json, event.status, event.created_at, event.updated_at]);
}

export async function insertAuditEvent(env, event) {
  return run(env, `INSERT INTO audit_events
    (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [event.id, event.actor_type, event.actor_id ?? null, event.action, event.entity_type, event.entity_id, event.metadata_json, event.created_at]);
}

export async function listAuditEvents(env, entityType, entityId) {
  const result = await database(env).prepare("SELECT * FROM audit_events WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC, id ASC").bind(entityType, entityId).all();
  return result.results;
}

export async function getSchemaVersion(env) {
  return database(env).prepare("SELECT value FROM sbns_meta WHERE key = ?").bind("schema_version").first("value");
}

export async function getIdempotencyRecord(env, actorId, operation, key) {
  return database(env).prepare("SELECT * FROM idempotency_records WHERE actor_id = ? AND operation = ? AND key = ?").bind(actorId, operation, key).first();
}

export async function getLatestDraft(env, intakeId) {
  return database(env).prepare("SELECT * FROM editorial_drafts WHERE intake_id = ? ORDER BY revision DESC LIMIT 1").bind(intakeId).first();
}

export async function listDrafts(env, intakeId) {
  const result = await database(env).prepare("SELECT * FROM editorial_drafts WHERE intake_id = ? ORDER BY revision ASC").bind(intakeId).all();
  return result.results;
}

export async function getIntakeDetail(env, intakeId) {
  const intake = await getIntake(env, intakeId);
  if (!intake) return null;
  const [analyses, drafts, decisions, audit] = await Promise.all([
    database(env).prepare("SELECT * FROM analyses WHERE intake_id = ? ORDER BY created_at ASC").bind(intakeId).all(),
    database(env).prepare("SELECT * FROM editorial_drafts WHERE intake_id = ? ORDER BY revision ASC").bind(intakeId).all(),
    database(env).prepare("SELECT * FROM editorial_decisions WHERE intake_id = ? ORDER BY decided_at ASC").bind(intakeId).all(),
    listAuditEvents(env, "intake", intakeId),
  ]);
  return { intake, analyses: analyses.results, drafts: drafts.results, decisions: decisions.results, audit };
}

function idempotencyStatement(env, record) {
  return database(env).prepare(`INSERT INTO idempotency_records
    (key, actor_id, operation, request_hash, response_status, response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(record.key, record.actor_id, record.operation, record.request_hash, record.response_status, record.response_json, record.created_at);
}

function auditStatement(env, event) {
  return database(env).prepare(`INSERT INTO audit_events
    (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(event.id, event.actor_type, event.actor_id, event.action, event.entity_type, event.entity_id, event.metadata_json, event.created_at);
}

export async function createIntakeWithAudit(env, intake, audit, idempotency) {
  return database(env).batch([
    database(env).prepare(`INSERT INTO intakes
      (id, origin, submitted_url, submitted_at, submitter_note, status, analysis_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(intake.id, intake.origin, intake.submitted_url, intake.submitted_at, intake.submitter_note ?? null, intake.status, intake.analysis_status, intake.created_at, intake.updated_at),
    auditStatement(env, audit), idempotencyStatement(env, idempotency),
  ]);
}

export async function createDraftWithAudit(env, draft, audit, idempotency) {
  return database(env).batch([
    database(env).prepare(`INSERT INTO editorial_drafts
      (id, intake_id, revision, story_id, headline, summary, fml_kicker, category, severity, topic_tags_json, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(draft.id, draft.intake_id, draft.revision, draft.story_id ?? null, draft.headline, draft.summary, draft.fml_kicker, draft.category, draft.severity, draft.topic_tags_json, draft.created_at, draft.created_by),
    database(env).prepare("UPDATE intakes SET updated_at = ? WHERE id = ?").bind(draft.created_at, draft.intake_id),
    auditStatement(env, audit), idempotencyStatement(env, idempotency),
  ]);
}

export async function createDecisionWithAudit(env, decision, status, audit, idempotency) {
  return database(env).batch([
    database(env).prepare(`INSERT INTO editorial_decisions
      (id, intake_id, draft_id, decision, decided_by, decided_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(decision.id, decision.intake_id, decision.draft_id ?? null, decision.decision, decision.decided_by, decision.decided_at, decision.notes ?? null),
    database(env).prepare("UPDATE intakes SET status = ?, updated_at = ? WHERE id = ?").bind(status, decision.decided_at, decision.intake_id),
    auditStatement(env, audit), idempotencyStatement(env, idempotency),
  ]);
}
