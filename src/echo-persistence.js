// Echo Desk persists research state only. Nothing here discovers, decides, or publishes.
function database(env) {
  if (!env?.SBNS_DB) throw new Error("SBNS_DB binding is required");
  return env.SBNS_DB;
}

function nonempty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function timestamp(value) { return value ?? new Date().toISOString(); }
function auditId() { return `audit_${crypto.randomUUID()}`; }

function auditStatement(db, { action, entityType, entityId, actorType, actorId, at, metadata = {}, requireChange = false }) {
  // When the preceding conditional write changed no row, NULL violates the
  // existing NOT NULL constraint and rolls the entire D1 batch back.
  const actor = requireChange ? "CASE WHEN changes() = 1 THEN ? ELSE NULL END" : "?";
  return db.prepare(`INSERT INTO audit_events
    (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES (?, ${actor}, ?, ?, ?, ?, ?, ?)`)
    .bind(auditId(), actorType, actorId ?? null, action, entityType, entityId, JSON.stringify(metadata), at);
}

export async function createEchoPacket(env, { id, issueKey, evidenceSnapshotHash, brief, intakes, createdBy, createdAt }) {
  const db = database(env);
  const at = timestamp(createdAt);
  nonempty(id, "packet ID");
  nonempty(issueKey, "issue key");
  nonempty(createdBy, "creator");
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) throw new Error("Structured issue brief is required");
  if (!Array.isArray(intakes) || !intakes.length || intakes.filter((item) => item.role === "primary").length !== 1 ||
      new Set(intakes.map((item) => item.intakeId)).size !== intakes.length) {
    throw new Error("A packet needs distinct intakes and exactly one primary intake");
  }
  const statements = [db.prepare(`INSERT INTO echo_packets
    (id, issue_key, revision, evidence_snapshot_hash, brief_json, state, created_by, created_at, updated_at)
    SELECT ?, ?, COALESCE(MAX(revision), 0) + 1, ?, ?, 'open', ?, ?, ?
    FROM echo_packets WHERE issue_key = ?`)
    .bind(id, issueKey, evidenceSnapshotHash, JSON.stringify(brief), createdBy, at, at, issueKey)];
  for (const item of intakes) {
    statements.push(db.prepare(`INSERT INTO echo_packet_intakes (packet_id, intake_id, intake_role, created_at)
      VALUES (?, ?, ?, ?)`).bind(id, item.intakeId, item.role, at));
  }
  statements.push(db.prepare(`UPDATE echo_packets SET superseded_at = ?, updated_at = ?
    WHERE issue_key = ? AND id != ? AND superseded_at IS NULL`).bind(at, at, issueKey, id));
  statements.push(auditStatement(db, { action: "echo.issue_brief_created", entityType: "echo_packet", entityId: id,
    actorType: createdBy.startsWith("system:") ? "system" : "editor", actorId: createdBy, at,
    metadata: { issue_key: issueKey, evidence_snapshot_hash: evidenceSnapshotHash } }));
  await db.batch(statements);
  return db.prepare("SELECT * FROM echo_packets WHERE id = ?").bind(id).first();
}

export async function getEchoPacket(env, packetId) {
  return database(env).prepare("SELECT * FROM echo_packets WHERE id = ?").bind(packetId).first();
}

export async function getEchoStoryState(env, intakeId) {
  const db = database(env);
  const packet = await db.prepare(`SELECT packet.* FROM echo_packets AS packet
    JOIN echo_packet_intakes AS linked ON linked.packet_id = packet.id
    WHERE linked.intake_id = ? AND linked.intake_role = 'primary' AND packet.superseded_at IS NULL
    ORDER BY packet.created_at DESC, packet.id DESC LIMIT 1`).bind(intakeId).first();
  if (!packet) return null;
  const rows = async (sql) => (await db.prepare(sql).bind(packet.id).all()).results;
  return { packet,
    package_binding: await db.prepare(`SELECT id, created_at FROM audit_events
      WHERE action = 'echo.candidate_package_bound' AND entity_type = 'echo_packet' AND entity_id = ?
      ORDER BY created_at, id LIMIT 1`).bind(packet.id).first(),
    jobs: await rows("SELECT * FROM echo_jobs WHERE packet_id = ? ORDER BY created_at, id"),
    candidates: await rows("SELECT * FROM echo_candidates WHERE packet_id = ? ORDER BY editor_ready_slot, id"),
    assessments: await rows("SELECT * FROM echo_candidate_assessments WHERE packet_id = ? ORDER BY candidate_id, revision"),
    sources: await rows("SELECT * FROM echo_candidate_sources WHERE packet_id = ? ORDER BY candidate_id, id"),
    rights: await rows("SELECT * FROM echo_rights_assessments WHERE packet_id = ? ORDER BY candidate_id, revision"),
    decisions: await rows("SELECT * FROM echo_decisions WHERE packet_id = ? ORDER BY decided_at, id"),
    evaluations: await rows(`SELECT audit.* FROM audit_events AS audit JOIN echo_candidates AS candidate
      ON candidate.id = audit.entity_id WHERE candidate.packet_id = ?
      AND audit.entity_type = 'echo_candidate' AND audit.action = 'echo.candidate_evaluated' ORDER BY audit.created_at, audit.id`),
  };
}

// Search only other issues: a partially persisted attempt for the current
// issue must not change its own candidate-package digest on retry.
export async function getEchoPriorUse(env, canonicalArtifactId, issueKey) {
  const row = await database(env).prepare(`SELECT COUNT(*) AS considered,
    COALESCE(SUM(EXISTS(SELECT 1 FROM echo_decisions AS decision
      WHERE decision.candidate_id = candidate.id AND decision.decision = 'feature')), 0) AS featured,
    COALESCE(SUM(EXISTS(SELECT 1 FROM echo_decisions AS decision
      WHERE decision.candidate_id = candidate.id AND decision.decision = 'reject')), 0) AS rejected
    FROM echo_candidates AS candidate JOIN echo_packets AS packet ON packet.id = candidate.packet_id
    WHERE candidate.canonical_artifact_id = ? AND packet.issue_key <> ?`)
    .bind(canonicalArtifactId, issueKey).first();
  if (Number(row?.featured)) return { status: "previously_featured" };
  if (Number(row?.rejected)) return { status: "previously_rejected" };
  if (Number(row?.considered)) return { status: "previously_considered" };
  return { status: "never_seen" };
}

// Read-only views for the synthetic orchestrator. Writes still pass through the
// existing audited persistence functions and database constraints.
export async function getEchoIssueSnapshot(env, issueKey, evidenceSnapshotHash) {
  return database(env).prepare("SELECT * FROM echo_packets WHERE issue_key = ? AND evidence_snapshot_hash = ?")
    .bind(issueKey, evidenceSnapshotHash).first();
}

export async function getEchoPacketProgress(env, packetId) {
  const db = database(env);
  const read = async (sql) => (await db.prepare(sql).bind(packetId).all()).results;
  return {
    jobs: await read("SELECT * FROM echo_jobs WHERE packet_id = ? ORDER BY created_at, id"),
    candidates: await read("SELECT * FROM echo_candidates WHERE packet_id = ? ORDER BY id"),
    assessments: await read("SELECT * FROM echo_candidate_assessments WHERE packet_id = ? ORDER BY id"),
    sources: await read("SELECT * FROM echo_candidate_sources WHERE packet_id = ? ORDER BY id"),
    rights: await read("SELECT * FROM echo_rights_assessments WHERE packet_id = ? ORDER BY id"),
  };
}

// One content-free candidate-package receipt per packet. A deterministic ID
// lets an interrupted attempt and its retry share the same durable binding.
export async function getEchoCandidatePackageBinding(env, id) {
  return database(env).prepare("SELECT action, entity_type, entity_id, metadata_json FROM audit_events WHERE id = ?")
    .bind(id).first();
}

export async function bindEchoCandidatePackage(env, { id, packetId, metadata, actorId, at }) {
  const db = database(env);
  const encoded = JSON.stringify(metadata);
  if (!encoded || encoded.length > 500) throw new Error("Echo candidate package audit metadata is too large");
  await db.prepare(`INSERT OR IGNORE INTO audit_events
    (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
    SELECT ?, 'system', ?, 'echo.candidate_package_bound', 'echo_packet', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM echo_packets
      WHERE id = ? AND state = 'open' AND superseded_at IS NULL)`)
    .bind(id, actorId ?? null, packetId, encoded, timestamp(at), packetId).run();
  return getEchoCandidatePackageBinding(env, id);
}

export async function createEchoJob(env, { id, packetId, idempotencyKey, triggerType, requestedBy, processorVersion, createdAt }) {
  const db = database(env);
  const at = timestamp(createdAt);
  nonempty(requestedBy, "requesting actor");
  await db.batch([
    db.prepare(`INSERT INTO echo_jobs
      (id, packet_id, idempotency_key, trigger_type, requested_by, processor_version, state, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, 'pending', ?, ?
      WHERE EXISTS (SELECT 1 FROM echo_packets WHERE id = ? AND state = 'open' AND superseded_at IS NULL)`)
      .bind(id, packetId, idempotencyKey, triggerType, requestedBy, processorVersion, at, at, packetId),
    auditStatement(db, { action: "echo.job_created", entityType: "echo_packet", entityId: packetId,
      actorType: triggerType === "manual" ? "editor" : "system", actorId: requestedBy, at,
      metadata: { job_id: id }, requireChange: true }),
  ]);
  return db.prepare("SELECT * FROM echo_jobs WHERE id = ?").bind(id).first();
}

const NEXT_JOB_STATE = {
  pending: new Set(["researching", "failed"]),
  researching: new Set(["verifying", "failed"]),
  verifying: new Set(["rights_check", "failed"]),
  rights_check: new Set(["assembling", "failed"]),
  assembling: new Set(["failed"]),
};

export async function transitionEchoJob(env, { jobId, from, to, actorId, at, failureCode = null, failureMessage = null }) {
  if (!NEXT_JOB_STATE[from]?.has(to)) throw new Error("Invalid Echo job transition");
  const db = database(env);
  const when = timestamp(at);
  const packet = await db.prepare("SELECT packet_id FROM echo_jobs WHERE id = ?").bind(jobId).first();
  if (!packet) throw new Error("Echo job not found");
  const statements = [
    db.prepare(`UPDATE echo_jobs SET state = ?, attempt = attempt + CASE WHEN ? = 'researching' THEN 1 ELSE 0 END,
      failure_code = ?, failure_message = ?, completed_at = CASE WHEN ? = 'failed' THEN ? ELSE NULL END,
      updated_at = ? WHERE id = ? AND state = ?`)
      .bind(to, to, to === "failed" ? failureCode : null, to === "failed" ? failureMessage : null, to, when, when, jobId, from),
  ];
  statements.push(
    auditStatement(db, { action: to === "failed" ? "echo.job_failed" : "echo.job_state_changed", entityType: "echo_packet",
      entityId: packet.packet_id, actorType: "system", actorId: actorId ?? null, at: when,
      metadata: { job_id: jobId, from, to, failure_code: to === "failed" ? failureCode : null }, requireChange: true }),
  );
  await db.batch(statements);
  return db.prepare("SELECT * FROM echo_jobs WHERE id = ?").bind(jobId).first();
}

export async function createEchoCandidate(env, candidate, actorId) {
  const db = database(env);
  const at = timestamp(candidate.createdAt);
  await db.batch([
    db.prepare(`INSERT INTO echo_candidates
      (id, packet_id, canonical_artifact_id, artifact_type, title, creator, creation_date, state, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'found', ?, ?
      WHERE EXISTS (SELECT 1 FROM echo_packets WHERE id = ? AND state = 'open' AND superseded_at IS NULL)`)
      .bind(candidate.id, candidate.packetId, candidate.canonicalArtifactId, candidate.artifactType, candidate.title,
        candidate.creator ?? null, candidate.creationDate ?? null, at, at, candidate.packetId),
    auditStatement(db, { action: "echo.candidate_found", entityType: "echo_candidate", entityId: candidate.id,
      actorType: "system", actorId: actorId ?? null, at, metadata: { packet_id: candidate.packetId }, requireChange: true }),
  ]);
  return db.prepare("SELECT * FROM echo_candidates WHERE id = ?").bind(candidate.id).first();
}

// One bounded evaluation plan per packet/candidate. The deterministic ID is
// independent of job attempts, so a new-key retry cannot rewrite history or
// manufacture duplicate evaluations. Candidate state-transition audits remain
// the separate receipts for actual rejection or readiness.
export async function recordEchoCandidateEvaluation(env, { id, packetId, candidateId, metadata, actorId, at }) {
  const db = database(env);
  const encoded = JSON.stringify(metadata);
  if (!encoded || encoded.length > 1500) throw new Error("Echo evaluation audit metadata is too large");
  const read = () => db.prepare("SELECT action, entity_type, entity_id, metadata_json FROM audit_events WHERE id = ?")
    .bind(id).first();
  let existing = await read();
  if (!existing) {
    await db.prepare(`INSERT OR IGNORE INTO audit_events
      (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
      SELECT ?, 'system', ?, 'echo.candidate_evaluated', 'echo_candidate', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM echo_candidates AS candidate
        JOIN echo_packets AS packet ON packet.id = candidate.packet_id
        WHERE candidate.id = ? AND candidate.packet_id = ?
          AND packet.state = 'open' AND packet.superseded_at IS NULL)`)
      .bind(id, actorId ?? null, candidateId, encoded, timestamp(at), candidateId, packetId).run();
    existing = await read();
  }
  if (!existing || existing.action !== "echo.candidate_evaluated" || existing.entity_type !== "echo_candidate" ||
      existing.entity_id !== candidateId || existing.metadata_json !== encoded) {
    throw new Error("Echo candidate evaluation conflicts with durable audit or packet is stale");
  }
  return existing;
}

export async function createEchoAssessment(env, assessment) {
  const db = database(env);
  const at = timestamp(assessment.createdAt);
  await db.batch([
    db.prepare(`INSERT INTO echo_candidate_assessments
      (id, packet_id, candidate_id, revision, original_context, creator_intent_status, what_echoes,
       comparison_breaks, remains_uncertain, tempted_overclaim, present_day_evidence, editorial_value,
       research_burden, source_set_hash, generator_type, generator_version, created_by, created_at)
      SELECT ?, ?, ?, COALESCE(MAX(revision), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM echo_candidate_assessments WHERE candidate_id = ?
      HAVING EXISTS (SELECT 1 FROM echo_candidates AS candidate
        JOIN echo_packets AS packet ON packet.id = candidate.packet_id
        WHERE candidate.id = ? AND candidate.packet_id = ?
          AND candidate.state IN ('found', 'researching')
          AND packet.state = 'open' AND packet.superseded_at IS NULL)`)
      .bind(assessment.id, assessment.packetId, assessment.candidateId, assessment.originalContext,
        assessment.creatorIntentStatus, assessment.whatEchoes, assessment.comparisonBreaks, assessment.remainsUncertain,
        assessment.temptedOverclaim, assessment.presentDayEvidence, assessment.editorialValue, assessment.researchBurden,
        assessment.sourceSetHash, assessment.generatorType, assessment.generatorVersion, assessment.createdBy, at,
        assessment.candidateId, assessment.candidateId, assessment.packetId),
    auditStatement(db, { action: "echo.analogy_checked", entityType: "echo_candidate", entityId: assessment.candidateId,
      actorType: assessment.generatorType === "human" ? "editor" : "system", actorId: assessment.createdBy,
      at, metadata: { assessment_id: assessment.id, packet_id: assessment.packetId }, requireChange: true }),
  ]);
  return db.prepare("SELECT * FROM echo_candidate_assessments WHERE id = ?").bind(assessment.id).first();
}

export async function createEchoSource(env, source, actorId) {
  const db = database(env);
  const at = timestamp(source.createdAt);
  await db.batch([
    db.prepare(`INSERT INTO echo_candidate_sources
      (id, packet_id, candidate_id, assessment_id, source_role, supports_field, intake_source_id, source_intake_id,
       url, canonical_identifier, title, authority_rationale, published_at, retrieved_at, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(source.id, source.packetId, source.candidateId, source.assessmentId, source.sourceRole, source.supportsField,
        source.intakeSourceId ?? null, source.sourceIntakeId ?? null, source.url ?? null, source.canonicalIdentifier ?? null,
        source.title ?? null, source.authorityRationale, source.publishedAt ?? null, source.retrievedAt ?? null,
        source.contentHash ?? null, at),
    auditStatement(db, { action: "echo.source_linked", entityType: "echo_candidate", entityId: source.candidateId,
      actorType: "system", actorId: actorId ?? null, at,
      metadata: { source_id: source.id, assessment_id: source.assessmentId, source_role: source.sourceRole } }),
  ]);
  return db.prepare("SELECT * FROM echo_candidate_sources WHERE id = ?").bind(source.id).first();
}

export async function createEchoRightsAssessment(env, rights) {
  const db = database(env);
  const at = timestamp(rights.createdAt);
  const reviewedAt = timestamp(rights.reviewedAt);
  await db.batch([
    db.prepare(`INSERT INTO echo_rights_assessments
      (id, packet_id, candidate_id, asset_type, asset_identifier, proposed_use, revision, status, basis,
       permitted_use, attribution, jurisdiction, rights_source_id, reviewed_by, reviewed_at, recheck_at, supersedes_id, created_at)
      SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(revision), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        (SELECT id FROM echo_rights_assessments WHERE candidate_id = ? AND asset_type = ? AND asset_identifier = ? AND proposed_use = ? ORDER BY revision DESC LIMIT 1), ?
      FROM echo_rights_assessments WHERE candidate_id = ? AND asset_type = ? AND asset_identifier = ? AND proposed_use = ?`)
      .bind(rights.id, rights.packetId, rights.candidateId, rights.assetType, rights.assetIdentifier, rights.proposedUse,
        rights.status, rights.basis, rights.permittedUse, rights.attribution ?? null, rights.jurisdiction ?? null,
        rights.rightsSourceId ?? null, rights.reviewedBy, reviewedAt, rights.recheckAt ?? null,
        rights.candidateId, rights.assetType, rights.assetIdentifier, rights.proposedUse, at,
        rights.candidateId, rights.assetType, rights.assetIdentifier, rights.proposedUse),
    auditStatement(db, { action: "echo.rights_checked", entityType: "echo_candidate", entityId: rights.candidateId,
      actorType: rights.reviewedBy.startsWith("system:") ? "system" : "editor", actorId: rights.reviewedBy, at,
      metadata: { rights_id: rights.id, asset_type: rights.assetType, status: rights.status } }),
  ]);
  return db.prepare("SELECT * FROM echo_rights_assessments WHERE id = ?").bind(rights.id).first();
}

export async function markEchoCandidateReady(env, { candidateId, assessmentId, slot, actorId, at }) {
  const db = database(env);
  const when = timestamp(at);
  nonempty(assessmentId, "readiness assessment ID");
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new Error("Editor-ready slot must be 1, 2, or 3");
  const candidate = await db.prepare("SELECT packet_id FROM echo_candidates WHERE id = ?").bind(candidateId).first();
  if (!candidate) throw new Error("Echo candidate not found");
  await db.batch([
    db.prepare(`UPDATE echo_candidates SET state = 'editor_ready', editor_ready_slot = ?,
      editor_ready_assessment_id = ?, updated_at = ?
      WHERE id = ? AND state IN ('found', 'researching') AND EXISTS
      (SELECT 1 FROM echo_candidate_assessments WHERE id = ? AND candidate_id = ?
        AND packet_id = echo_candidates.packet_id)
      AND EXISTS (SELECT 1 FROM echo_candidate_sources AS source
        WHERE source.assessment_id = ? AND source.candidate_id = echo_candidates.id
          AND source.packet_id = echo_candidates.packet_id
          AND source.source_role IN ('original_work', 'historical_context'))
      AND EXISTS (SELECT 1 FROM echo_candidate_sources AS source
        WHERE source.assessment_id = ? AND source.candidate_id = echo_candidates.id
          AND source.packet_id = echo_candidates.packet_id AND source.source_role = 'contemporary_evidence')
      AND EXISTS (SELECT 1 FROM echo_rights_assessments AS rights
        WHERE rights.candidate_id = echo_candidates.id AND rights.packet_id = echo_candidates.packet_id)
      AND EXISTS (SELECT 1 FROM echo_packets WHERE id = echo_candidates.packet_id AND state = 'open' AND superseded_at IS NULL)`)
      .bind(slot, assessmentId, when, candidateId, assessmentId, candidateId, assessmentId, assessmentId),
    auditStatement(db, { action: "echo.candidate_ready", entityType: "echo_candidate", entityId: candidateId,
      actorType: "system", actorId: actorId ?? null, at: when,
      metadata: { packet_id: candidate.packet_id, assessment_id: assessmentId, slot }, requireChange: true }),
  ]);
  return db.prepare("SELECT * FROM echo_candidates WHERE id = ?").bind(candidateId).first();
}

export async function rejectEchoCandidateByGate(env, { candidateId, reasonCode, actorId, at }) {
  nonempty(reasonCode, "gate reason code");
  const db = database(env);
  const when = timestamp(at);
  await db.batch([
    db.prepare(`UPDATE echo_candidates SET state = 'rejected_by_gate', gate_reason_code = ?, updated_at = ?
      WHERE id = ? AND state IN ('found', 'researching')
      AND EXISTS (SELECT 1 FROM echo_packets WHERE id = echo_candidates.packet_id AND state = 'open' AND superseded_at IS NULL)`)
      .bind(reasonCode, when, candidateId),
    auditStatement(db, { action: "echo.candidate_rejected_by_gate", entityType: "echo_candidate", entityId: candidateId,
      actorType: "system", actorId: actorId ?? null, at: when, metadata: { reason_code: reasonCode }, requireChange: true }),
  ]);
  return db.prepare("SELECT * FROM echo_candidates WHERE id = ?").bind(candidateId).first();
}

export async function completeEchoPacket(env, { packetId, jobId, result, actorId, at, reasonCode = null, reason = null }) {
  if (!new Set(["ready", "no_echo"]).has(result)) throw new Error("Invalid Echo packet result");
  const db = database(env);
  const when = timestamp(at);
  if (result === "no_echo") {
    nonempty(reasonCode, "no-echo reason code");
    if (reason && reason.length > 500) throw new Error("No-echo reason is too long");
  }
  const candidatePredicate = result === "ready"
    ? "EXISTS (SELECT 1 FROM echo_candidates WHERE packet_id = ? AND state = 'editor_ready')"
    : "NOT EXISTS (SELECT 1 FROM echo_candidates WHERE packet_id = ? AND state = 'editor_ready')";
  const allowedJobStates = result === "ready"
    ? "state = 'assembling'"
    : "state IN ('researching', 'verifying', 'rights_check', 'assembling')";
  await db.batch([
    db.prepare(`UPDATE echo_jobs SET state = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND packet_id = ? AND ${allowedJobStates}
      AND EXISTS (SELECT 1 FROM echo_packets WHERE id = ? AND state = 'open' AND superseded_at IS NULL)
      AND ${candidatePredicate}
      AND NOT EXISTS (SELECT 1 FROM echo_candidates WHERE packet_id = ? AND state IN ('found', 'researching'))`)
      .bind(result, when, when, jobId, packetId, packetId, packetId, packetId),
    db.prepare(`UPDATE echo_packets SET state = ?, no_echo_reason_code = ?, no_echo_reason = ?, updated_at = ?
      WHERE id = ? AND state = 'open' AND superseded_at IS NULL AND changes() = 1
      AND EXISTS (SELECT 1 FROM echo_jobs WHERE id = ? AND packet_id = ? AND state = ?)`)
      .bind(result, result === "no_echo" ? reasonCode : null, result === "no_echo" ? reason : null,
        when, packetId, jobId, packetId, result),
    auditStatement(db, { action: result === "no_echo" ? "echo.no_echo_warranted" : "echo.packet_ready",
      entityType: "echo_packet", entityId: packetId, actorType: "system", actorId: actorId ?? null,
      at: when, metadata: { job_id: jobId, reason_code: result === "no_echo" ? reasonCode : null }, requireChange: true }),
  ]);
  return db.prepare("SELECT * FROM echo_packets WHERE id = ?").bind(packetId).first();
}

export async function createEchoDecision(env, decision) {
  const db = database(env);
  const at = timestamp(decision.decidedAt);
  nonempty(decision.decidedBy, "human decision actor");
  nonempty(decision.rationale, "decision rationale");
  await db.batch([
    db.prepare(`INSERT INTO echo_decisions
      (id, packet_id, candidate_id, assessment_id, decision, decided_by, rationale, decided_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM echo_packets WHERE id = ? AND state = 'ready' AND superseded_at IS NULL)
        AND EXISTS (SELECT 1 FROM echo_candidates WHERE id = ? AND packet_id = ? AND state = 'editor_ready'
          AND editor_ready_assessment_id = ?)`)
      .bind(decision.id, decision.packetId, decision.candidateId, decision.assessmentId,
        decision.decision, decision.decidedBy, decision.rationale, at,
        decision.packetId, decision.candidateId, decision.packetId, decision.assessmentId),
    auditStatement(db, { action: `echo.human_${decision.decision === "feature" ? "featured" : decision.decision === "hold" ? "held" : "rejected"}`,
      entityType: "echo_candidate", entityId: decision.candidateId, actorType: "editor", actorId: decision.decidedBy,
      at, metadata: { decision_id: decision.id, packet_id: decision.packetId, assessment_id: decision.assessmentId },
      requireChange: true }),
  ]);
  return db.prepare("SELECT * FROM echo_decisions WHERE id = ?").bind(decision.id).first();
}
