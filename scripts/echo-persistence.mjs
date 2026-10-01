import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as echo from "../src/echo-persistence.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const MIGRATIONS = ["0001_editorial_foundation.sql", "0002_admin_queue.sql", "0003_live_analysis.sql", "0004_watchdesk_runs.sql", "0005_echo_durable_contracts.sql", "0006_watchdesk_source_learning.sql"];
const ECHO_TABLES = ["echo_candidate_assessments", "echo_candidate_sources", "echo_candidates", "echo_decisions", "echo_jobs", "echo_packet_intakes", "echo_packets", "echo_rights_assessments"];
const ECHO_INDEXES = ["idx_echo_assessments_candidate_revision", "idx_echo_candidates_packet_state", "idx_echo_decisions_packet_decided", "idx_echo_jobs_active_packet", "idx_echo_jobs_state_updated", "idx_echo_packet_intakes_intake", "idx_echo_packet_intakes_primary", "idx_echo_packets_issue_revision", "idx_echo_packets_state_updated", "idx_echo_rights_candidate_asset", "idx_echo_sources_assessment_role", "idx_echo_sources_intake_source"];
const execFileAsync = promisify(execFile);
const AT = "2026-09-30T20:00:00.000Z";
const hash = (letter) => letter.repeat(64);

async function withLocalD1(action) {
  const persist = await mkdtemp(path.join(tmpdir(), "sbns-echo-d1-"));
  async function wrangler(args) {
    const { stdout } = await execFileAsync(process.execPath, [WRANGLER, ...args, "--local", "--persist-to", persist],
      { cwd: ROOT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  }
  async function query(sql) {
    const result = JSON.parse(await wrangler(["d1", "execute", "SBNS_DB", "--command", sql, "--json"]));
    assert(result.every((part) => part.success === true));
    return result.at(-1)?.results ?? [];
  }
  try {
    await wrangler(["d1", "migrations", "apply", "SBNS_DB"]);
    await action(query);
  } finally {
    await rm(persist, { recursive: true, force: true });
  }
}

// D1's production API is asynchronous; this small adapter runs the identical
// migrated SQL in isolated SQLite memory to exercise the JS persistence code.
// The independent Wrangler checks above verify real local D1 migration state.
class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    return { bind: (...values) => ({
      run: async () => { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
      first: async (column) => { const row = statement.get(...values) ?? null; return column ? row?.[column] ?? null : row; },
      all: async () => ({ results: statement.all(...values) }),
    }) };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

async function migratedMemoryDatabase() {
  const db = new LocalD1();
  for (const file of MIGRATIONS) db.sqlite.exec(await readFile(path.join(ROOT, "migrations", file), "utf8"));
  return db;
}

async function check() {
  await withLocalD1(async (query) => {
    const version = await query("SELECT value FROM sbns_meta WHERE key = 'schema_version'");
    assert.equal(version[0]?.value, "6");
    const tables = (await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'echo_%' ORDER BY name")).map((row) => row.name);
    const indexes = (await query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_echo_%' ORDER BY name")).map((row) => row.name);
    assert.deepEqual(tables, ECHO_TABLES);
    assert.deepEqual(indexes, ECHO_INDEXES.toSorted());
    assert.equal((await query("PRAGMA foreign_keys"))[0]?.foreign_keys, 1);
    assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
  });
  console.log(`Echo persistence schema valid in isolated local D1: v6, ${ECHO_TABLES.length} tables, ${ECHO_INDEXES.length} indexes, zero FK violations.`);
}

async function test() {
  // The Wrangler-backed portion ensures this test always starts by applying
  // the actual six migrations locally, never by using a remote binding.
  await withLocalD1(async (query) => {
    assert.equal((await query("SELECT value FROM sbns_meta WHERE key='schema_version'"))[0]?.value, "5");
    await query(`INSERT INTO intakes (id,origin,submitted_url,submitted_at,status,analysis_status,created_at,updated_at)
      VALUES ('d1-intake','editor','https://example.test/d1','${AT}','review_ready','complete','${AT}','${AT}')`);
    await query(`INSERT INTO intakes (id,origin,submitted_url,submitted_at,status,analysis_status,created_at,updated_at)
      VALUES ('d1-intake-2','editor','https://example.test/d1-2','${AT}','review_ready','complete','${AT}','${AT}')`);
    await query(`INSERT INTO echo_packets
      (id,issue_key,revision,evidence_snapshot_hash,brief_json,state,created_by,created_at,updated_at)
      VALUES ('d1-packet','d1-issue',1,'${hash("a")}','{}','open','editor','${AT}','${AT}')`);
    await assert.rejects(() => query(`INSERT INTO echo_packets
      (id,issue_key,revision,evidence_snapshot_hash,brief_json,state,created_by,created_at,updated_at)
      VALUES ('d1-invalid-failed','invalid-failed',1,'${hash("c")}','{}','failed','editor','${AT}','${AT}')`));
    await query(`INSERT INTO echo_jobs
      (id,packet_id,idempotency_key,trigger_type,requested_by,processor_version,state,created_at,updated_at,completed_at)
      VALUES ('d1-failed-job','d1-packet','failed-attempt','manual','editor','contracts-v1','failed','${AT}','${AT}','${AT}')`);
    assert.equal((await query("SELECT state FROM echo_packets WHERE id='d1-packet'"))[0]?.state, "open");
    assert.equal((await query("SELECT state FROM echo_jobs WHERE id='d1-failed-job'"))[0]?.state, "failed");
    await query(`INSERT INTO echo_packet_intakes VALUES ('d1-packet','d1-intake','primary','${AT}')`);
    await assert.rejects(() => query(`INSERT INTO echo_packet_intakes VALUES ('d1-packet','d1-intake-2','primary','${AT}')`));
    await assert.rejects(() => query(`INSERT INTO echo_packet_intakes VALUES ('d1-packet','missing','supporting','${AT}')`));
    for (let n = 1; n <= 4; n++) {
      await query(`INSERT INTO echo_candidates
        (id,packet_id,canonical_artifact_id,artifact_type,title,state,created_at,updated_at)
        VALUES ('d1-candidate-${n}','d1-packet','catalog:${n}','literature','Synthetic ${n}','found','${AT}','${AT}')`);
      await query(`INSERT INTO echo_candidate_assessments
        (id,packet_id,candidate_id,revision,original_context,creator_intent_status,what_echoes,
         comparison_breaks,remains_uncertain,tempted_overclaim,present_day_evidence,editorial_value,
         research_burden,source_set_hash,generator_type,generator_version,created_by,created_at)
        VALUES ('d1-assessment-${n}','d1-packet','d1-candidate-${n}',1,'Synthetic context','unknown',
          'Bounded echo','Different causes','Uncertain intent','False prediction','Synthetic evidence',
          'Explains a mechanism','low','${hash("d")}','human','contracts-v1','editor','${AT}')`);
    }
    await assert.rejects(() => query(`UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=1,
      editor_ready_assessment_id='d1-assessment-1' WHERE id='d1-candidate-1'`));
    await query(`INSERT INTO echo_candidate_sources
      (id,packet_id,candidate_id,assessment_id,source_role,supports_field,url,authority_rationale,created_at)
      SELECT 'd1-context-' || candidate_id,packet_id,candidate_id,id,'historical_context','original_context',
        'https://example.test/context','Synthetic archive','${AT}'
      FROM echo_candidate_assessments WHERE packet_id='d1-packet'`);
    await query(`INSERT INTO echo_candidate_sources
      (id,packet_id,candidate_id,assessment_id,source_role,supports_field,url,authority_rationale,created_at)
      SELECT 'd1-current-' || candidate_id,packet_id,candidate_id,id,'contemporary_evidence','present_day_evidence',
        'https://example.test/current','Synthetic reporting','${AT}'
      FROM echo_candidate_assessments WHERE packet_id='d1-packet'`);
    await query(`INSERT INTO echo_rights_assessments
      (id,packet_id,candidate_id,asset_type,asset_identifier,proposed_use,revision,status,basis,permitted_use,reviewed_by,reviewed_at,created_at)
      SELECT 'd1-rights-' || id,packet_id,id,'text','metadata:' || id,'link only',1,'unknown',
        'Synthetic review','link only','editor','${AT}','${AT}'
      FROM echo_candidates WHERE packet_id='d1-packet'`);
    await query(`INSERT INTO echo_candidate_assessments
      (id,packet_id,candidate_id,revision,original_context,creator_intent_status,what_echoes,
       comparison_breaks,remains_uncertain,tempted_overclaim,present_day_evidence,editorial_value,
       research_burden,source_set_hash,generator_type,generator_version,created_by,created_at)
      VALUES ('d1-assessment-1b','d1-packet','d1-candidate-1',2,'Alternate context','unknown',
        'Bounded echo','Different causes','Uncertain intent','False prediction','Synthetic evidence',
        'Explains a mechanism','low','${hash("e")}','human','contracts-v1','editor','${AT}')`);
    for (let n = 1; n <= 3; n++) {
      await query(`UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=${n},
        editor_ready_assessment_id='d1-assessment-${n}' WHERE id='d1-candidate-${n}'`);
    }
    const directSource = (id, assessmentId, role, field) => `INSERT INTO echo_candidate_sources
      (id,packet_id,candidate_id,assessment_id,source_role,supports_field,url,authority_rationale,created_at)
      VALUES ('${id}','d1-packet','d1-candidate-1','${assessmentId}','${role}','${field}',
        'https://example.test/${id}','Synthetic provenance','${AT}')`;
    await assert.rejects(() => query(directSource("d1-late-context", "d1-assessment-1", "historical_context", "original_context")));
    await assert.rejects(() => query(directSource("d1-unpinned-rights", "d1-assessment-1b", "rights", "rights")));
    await assert.rejects(() => query(directSource("d1-bad-rights-field", "d1-assessment-1", "rights", "original_context")));
    await assert.rejects(() => query(directSource("d1-bad-context-role", "d1-assessment-1", "historical_context", "rights")));
    await query(directSource("d1-later-rights", "d1-assessment-1", "rights", "rights"));
    assert.equal((await query("SELECT assessment_id FROM echo_candidate_sources WHERE id='d1-later-rights'"))[0]?.assessment_id, "d1-assessment-1");
    await assert.rejects(() => query("UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=4, editor_ready_assessment_id='d1-assessment-4' WHERE id='d1-candidate-4'"));
    await assert.rejects(() => query("UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=1, editor_ready_assessment_id='d1-assessment-4' WHERE id='d1-candidate-4'"));
    await assert.rejects(() => query("UPDATE echo_candidates SET editor_ready_assessment_id='d1-assessment-2' WHERE id='d1-candidate-1'"));
    await assert.rejects(() => query(`INSERT INTO echo_candidate_assessments
      (id,packet_id,candidate_id,revision,original_context,creator_intent_status,what_echoes,
       comparison_breaks,remains_uncertain,tempted_overclaim,present_day_evidence,editorial_value,
       research_burden,source_set_hash,generator_type,generator_version,created_by,created_at)
      VALUES ('d1-late','d1-packet','d1-candidate-1',3,'Late context','unknown','Echo','Breaks',
        'Uncertain','Overclaim','Evidence','Value','low','${hash("e")}','human','contracts-v1','editor','${AT}')`));
    assert.equal((await query("SELECT COUNT(*) AS n FROM echo_candidates WHERE packet_id='d1-packet' AND state='editor_ready'"))[0]?.n, 3);
    await query(`INSERT INTO echo_packets
      (id,issue_key,revision,evidence_snapshot_hash,brief_json,state,no_echo_reason_code,created_by,created_at,updated_at)
      VALUES ('d1-no-echo','d1-zero',1,'${hash("b")}','{}','no_echo','NO_MEANINGFUL_CANDIDATE','editor','${AT}','${AT}')`);
    assert.equal((await query("SELECT state FROM echo_packets WHERE id='d1-no-echo'"))[0]?.state, "no_echo");
    assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
  });
  const db = await migratedMemoryDatabase();
  const env = { SBNS_DB: db };
  let count = 0;
  const pass = (condition, label) => { assert(condition, label); count += 1; };
  const fails = async (action, label) => { await assert.rejects(action, undefined, label); count += 1; };
  const row = (sql, ...values) => db.sqlite.prepare(sql).get(...values);
  const rows = (sql, ...values) => db.sqlite.prepare(sql).all(...values);
  try {
    for (const id of ["intake-a", "intake-b", "intake-c"]) {
      db.sqlite.prepare(`INSERT INTO intakes
        (id,origin,submitted_url,submitted_at,status,analysis_status,created_at,updated_at)
        VALUES (?,'editor',?,?, 'review_ready','complete',?,?)`)
        .run(id, `https://example.test/${id}`, AT, AT, AT);
    }
    const packetA = await echo.createEchoPacket(env, { id: "echo-packet-a", issueKey: "synthetic-issue", evidenceSnapshotHash: hash("a"),
      brief: { institution: "Synthetic office", must_not_claim: ["Creator predicted event"] },
      intakes: [{ intakeId: "intake-a", role: "primary" }, { intakeId: "intake-b", role: "supporting" }],
      createdBy: "editor@example.test", createdAt: AT });
    pass(packetA.revision === 1 && packetA.state === "open", "first packet revision");
    pass(rows("SELECT * FROM echo_packet_intakes WHERE packet_id=?", packetA.id).length === 2, "multi-intake packet");
    const packetAudits = () => row("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id='echo-packet-a'").n;
    await fails(() => echo.createEchoPacket(env, { id: "echo-duplicate", issueKey: "synthetic-issue", evidenceSnapshotHash: hash("a"),
      brief: {}, intakes: [{ intakeId: "intake-a", role: "primary" }], createdBy: "editor@example.test", createdAt: AT }), "unchanged evidence replay");
    pass(packetAudits() === 1 && !row("SELECT id FROM echo_packets WHERE id='echo-duplicate'"), "replay leaves no orphan audit");
    await fails(async () => db.sqlite.prepare("UPDATE echo_packets SET brief_json='{}' WHERE id=?").run(packetA.id), "brief immutable");
    await fails(async () => db.sqlite.prepare("DELETE FROM echo_packets WHERE id=?").run(packetA.id), "packet history retained");
    await fails(() => echo.createEchoPacket(env, { id: "echo-bad-link", issueKey: "other", evidenceSnapshotHash: hash("c"),
      brief: {}, intakes: [{ intakeId: "missing", role: "primary" }], createdBy: "editor@example.test", createdAt: AT }), "intake FK");
    pass(!row("SELECT id FROM echo_packets WHERE id='echo-bad-link'"), "packet/intake/audit batch atomic");

    const jobA = await echo.createEchoJob(env, { id: "echo-job-a", packetId: packetA.id, idempotencyKey: "manual-synthetic-a",
      triggerType: "manual", requestedBy: "editor@example.test", processorVersion: "contracts-v1", createdAt: AT });
    pass(jobA.state === "pending", "job created pending");
    await fails(() => echo.createEchoJob(env, { id: "echo-job-replay", packetId: packetA.id, idempotencyKey: "manual-synthetic-a",
      triggerType: "manual", requestedBy: "editor@example.test", processorVersion: "contracts-v1", createdAt: AT }), "job idempotency");
    await fails(() => echo.transitionEchoJob(env, { jobId: jobA.id, from: "verifying", to: "rights_check", at: AT }), "stale job transition");
    pass(row("SELECT state FROM echo_jobs WHERE id=?", jobA.id).state === "pending", "stale transition rolled back");
    for (const [from, to] of [["pending", "researching"], ["researching", "verifying"], ["verifying", "rights_check"], ["rights_check", "assembling"]]) {
      await echo.transitionEchoJob(env, { jobId: jobA.id, from, to, at: AT });
    }
    pass(row("SELECT state,attempt FROM echo_jobs WHERE id=?", jobA.id).state === "assembling" &&
      row("SELECT attempt FROM echo_jobs WHERE id=?", jobA.id).attempt === 1, "restrained job lifecycle");
    await fails(() => echo.transitionEchoJob(env, { jobId: jobA.id, from: "assembling", to: "published", at: AT }), "no publish state");

    const candidate = async (id, packetId = packetA.id) => echo.createEchoCandidate(env,
      { id, packetId, canonicalArtifactId: `catalog:${id}`, artifactType: "literature", title: `Synthetic ${id}`,
        creator: "Test creator", creationDate: "1960", createdAt: AT }, "system:test");
    for (const id of ["candidate-1", "candidate-2", "candidate-3", "candidate-4"]) await candidate(id);
    const assessment = (id, candidateId, packetId = packetA.id) => ({ id, packetId, candidateId,
      originalContext: "Synthetic original context", creatorIntentStatus: "unknown", whatEchoes: "A bounded mechanism",
      comparisonBreaks: "Different causes", remainsUncertain: "Intent not documented",
      temptedOverclaim: "Predicted the present", presentDayEvidence: "Synthetic intake evidence",
      editorialValue: "Explains a mechanism", researchBurden: "low", sourceSetHash: hash("d"),
      generatorType: "human", generatorVersion: "contracts-v1", createdBy: "editor@example.test", createdAt: AT });
    const syntheticSource = (id, candidateId, assessmentId, sourceRole, supportsField, packetId = packetA.id) =>
      echo.createEchoSource(env, { id, packetId, candidateId, assessmentId, sourceRole, supportsField,
        url: `https://archive.example.test/${id}`, authorityRationale: "Synthetic test provenance", createdAt: AT }, "system:test");
    const rights = (id, assetType, status, candidateId = "candidate-1", rightsSourceId = null, packetId = packetA.id) =>
      ({ id, packetId, candidateId, assetType, assetIdentifier: `synthetic:${assetType}`,
        proposedUse: "homepage illustration", status, basis: "Synthetic rights assessment",
        permittedUse: status === "do_not_reproduce" ? "none" : "metadata only", rightsSourceId,
        reviewedBy: "editor@example.test", reviewedAt: AT, createdAt: AT });
    for (let n = 1; n <= 4; n++) await echo.createEchoAssessment(env, assessment(`assessment-${n}`, `candidate-${n}`));
    pass(row("SELECT revision FROM echo_candidate_assessments WHERE id='assessment-1'").revision === 1, "assessment revision one");
    const secondAssessment = await echo.createEchoAssessment(env, assessment("assessment-1b", "candidate-1"));
    pass(secondAssessment.revision === 2, "assessment revision two");
    const thirdAssessment = await echo.createEchoAssessment(env, assessment("assessment-1c", "candidate-1"));
    pass(thirdAssessment.revision === 3, "assessment revision three before readiness");
    await fails(async () => db.sqlite.prepare("UPDATE echo_candidate_assessments SET original_context='changed' WHERE id='assessment-1'").run(), "assessment append-only");
    await fails(async () => db.sqlite.prepare("DELETE FROM echo_candidate_assessments WHERE id='assessment-1'").run(), "assessment retained");
    const independent = await echo.createEchoSource(env, { id: "echo-source-independent", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1b", sourceRole: "historical_context",
      supportsField: "original_context", url: "https://archive.example.test/item", title: "Synthetic archive",
      authorityRationale: "Original institutional archive", retrievedAt: AT, contentHash: hash("e"), createdAt: AT }, "system:test");
    pass(independent.intake_source_id === null && independent.content_hash === hash("e"), "independent source provenance round trip");
    db.sqlite.prepare(`INSERT INTO sources
      (id,intake_id,url,normalized_url,name,source_type,verification_status,created_at)
      VALUES (?,?,?,?,?,'audit','verified',?)`)
      .run("source-a", "intake-a", "https://example.test/a", "https://example.test/a", "Synthetic report", AT);
    db.sqlite.prepare(`INSERT INTO sources
      (id,intake_id,url,normalized_url,name,source_type,verification_status,created_at)
      VALUES (?,?,?,?,?,'audit','verified',?)`)
      .run("source-c", "intake-c", "https://example.test/c", "https://example.test/c", "Unrelated report", AT);
    const linked = await echo.createEchoSource(env, { id: "echo-source-existing", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1b", sourceRole: "contemporary_evidence",
      supportsField: "present_day_evidence", intakeSourceId: "source-a", sourceIntakeId: "intake-a",
      authorityRationale: "Verified Newsroom source", createdAt: AT }, "system:test");
    pass(linked.intake_source_id === "source-a" && linked.url === null, "existing evidence referenced without duplication");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-cross-candidate", packetId: packetA.id,
      candidateId: "candidate-2", assessmentId: "assessment-1", sourceRole: "historical_context",
      supportsField: "original_context", url: "https://archive.example.test/cross", authorityRationale: "Synthetic", createdAt: AT }),
      "cross-candidate assessment/source rejected");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-cross-intake", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1", sourceRole: "contemporary_evidence",
      supportsField: "present_day_evidence", intakeSourceId: "source-c", sourceIntakeId: "intake-c",
      authorityRationale: "Synthetic", createdAt: AT }), "source intake must be linked to packet");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-invalid-role", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1", sourceRole: "blog_prediction",
      supportsField: "original_context", url: "https://example.test/x", authorityRationale: "Synthetic", createdAt: AT }),
      "source role vocabulary");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-rights-mismatch", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1b", sourceRole: "rights",
      supportsField: "original_context", url: "https://example.test/rights", authorityRationale: "Synthetic", createdAt: AT }),
      "rights-role source must support rights");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-field-mismatch", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1b", sourceRole: "historical_context",
      supportsField: "rights", url: "https://example.test/context", authorityRationale: "Synthetic", createdAt: AT }),
      "rights field must use rights-role source");

    await fails(() => echo.markEchoCandidateReady(env, { candidateId: "candidate-1", slot: 1, at: AT }),
      "readiness requires exact assessment ID");
    await fails(() => echo.markEchoCandidateReady(env, { candidateId: "candidate-1", assessmentId: "assessment-2", slot: 1, at: AT }),
      "readiness cannot pin another candidate assessment");
    await fails(() => echo.markEchoCandidateReady(env, { candidateId: "candidate-1", assessmentId: "assessment-1b", slot: 1, at: AT }),
      "readiness needs a rights assessment even with historical and contemporary evidence");
    await syntheticSource("source-c2-current", "candidate-2", "assessment-2", "contemporary_evidence", "present_day_evidence");
    await echo.createEchoRightsAssessment(env, rights("rights-c2", "text", "unknown", "candidate-2"));
    await fails(() => echo.markEchoCandidateReady(env, { candidateId: "candidate-2", assessmentId: "assessment-2", slot: 2, at: AT }),
      "readiness needs historical or original-work evidence");
    await syntheticSource("source-c3-context", "candidate-3", "assessment-3", "historical_context", "original_context");
    await echo.createEchoRightsAssessment(env, rights("rights-c3", "text", "do_not_reproduce", "candidate-3"));
    await fails(() => echo.markEchoCandidateReady(env, { candidateId: "candidate-3", assessmentId: "assessment-3", slot: 3, at: AT }),
      "readiness needs contemporary evidence");
    pass([1, 2, 3].every((n) => row("SELECT state FROM echo_candidates WHERE id=?", `candidate-${n}`).state === "found"),
      "missing evidence leaves candidates pre-ready");
    await syntheticSource("source-c2-context", "candidate-2", "assessment-2", "original_work", "original_context");
    await syntheticSource("source-c3-current", "candidate-3", "assessment-3", "contemporary_evidence", "present_day_evidence");
    const initialRightsSource = await syntheticSource("source-rights-initial", "candidate-1", "assessment-1b", "rights", "rights");
    const rights1 = await echo.createEchoRightsAssessment(env, rights("rights-art-1", "artwork", "unknown",
      "candidate-1", initialRightsSource.id));
    for (let n = 1; n <= 3; n++) await echo.markEchoCandidateReady(env, {
      candidateId: `candidate-${n}`, assessmentId: n === 1 ? "assessment-1b" : `assessment-${n}`, slot: n, at: AT });
    pass(row("SELECT COUNT(*) AS n FROM echo_candidates WHERE packet_id=? AND state='editor_ready'", packetA.id).n === 3,
      "three editor-ready candidates");
    pass(row("SELECT editor_ready_assessment_id FROM echo_candidates WHERE id='candidate-1'").editor_ready_assessment_id === "assessment-1b" &&
      row("SELECT metadata_json FROM audit_events WHERE action='echo.candidate_ready' AND entity_id='candidate-1'").metadata_json.includes('"assessment_id":"assessment-1b"'),
      "readiness pins and audits exact assessment revision");
    await fails(() => echo.createEchoAssessment(env, assessment("assessment-1d", "candidate-1")),
      "later assessment creation after readiness rejected");
    await syntheticSource("source-c4-context", "candidate-4", "assessment-4", "historical_context", "original_context");
    await syntheticSource("source-c4-current", "candidate-4", "assessment-4", "contemporary_evidence", "present_day_evidence");
    await echo.createEchoRightsAssessment(env, rights("rights-c4", "text", "link_metadata_only", "candidate-4"));
    await fails(() => echo.markEchoCandidateReady(env, { candidateId: "candidate-4", assessmentId: "assessment-4", slot: 1, at: AT }), "fourth ready candidate blocked by unique slot");
    await fails(async () => db.sqlite.prepare(`UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=4,
      editor_ready_assessment_id='assessment-4' WHERE id='candidate-4'`).run(),
      "fourth ready candidate blocked by slot constraint");
    pass(row("SELECT state FROM echo_candidates WHERE id='candidate-4'").state === "found", "fourth candidate state unchanged");
    await fails(() => echo.completeEchoPacket(env, { packetId: packetA.id, jobId: jobA.id, result: "ready", at: AT }),
      "ready packet cannot retain an unresolved found candidate");
    pass(row("SELECT state FROM echo_jobs WHERE id=?", jobA.id).state === "assembling" &&
      row("SELECT state FROM echo_packets WHERE id=?", packetA.id).state === "open", "unresolved ready attempt rolls back atomically");
    const rejected = await echo.rejectEchoCandidateByGate(env, { candidateId: "candidate-4",
      reasonCode: "ANALOGY_TOO_WEAK", actorId: "system:test", at: AT });
    pass(rejected.state === "rejected_by_gate" && rejected.gate_reason_code === "ANALOGY_TOO_WEAK" &&
      row("SELECT action FROM audit_events WHERE entity_id='candidate-4' AND action='echo.candidate_rejected_by_gate'")?.action === "echo.candidate_rejected_by_gate",
      "gate rejection has bounded reason and audit");
    await fails(() => echo.rejectEchoCandidateByGate(env, { candidateId: "candidate-4", reasonCode: "RETRY", at: AT }),
      "gate rejection is not silently repeated");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-after-ready", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1b", sourceRole: "historical_context",
      supportsField: "original_context", url: "https://example.test/late-ready", authorityRationale: "Synthetic", createdAt: AT }),
      "editor-ready historical context is frozen");
    await fails(() => syntheticSource("source-late-current", "candidate-1", "assessment-1b",
      "contemporary_evidence", "present_day_evidence"), "editor-ready contemporary evidence is frozen");
    await fails(() => syntheticSource("source-late-unpinned-rights", "candidate-1", "assessment-1",
      "rights", "rights"), "post-readiness rights source must use pinned assessment");
    const recheckedRightsSource = await syntheticSource("source-rights-recheck", "candidate-1", "assessment-1b", "rights", "rights");
    const rights2 = await echo.createEchoRightsAssessment(env, rights("rights-art-2", "artwork", "do_not_reproduce",
      "candidate-1", recheckedRightsSource.id));
    const rights3 = await echo.createEchoRightsAssessment(env, rights("rights-text-1", "text", "link_metadata_only"));
    pass(rights1.revision === 1 && rights1.rights_source_id === initialRightsSource.id &&
      rights2.revision === 2 && rights2.supersedes_id === rights1.id && rights2.rights_source_id === recheckedRightsSource.id &&
      rights3.revision === 1 && rows("SELECT id FROM echo_candidate_sources WHERE id IN (?,?)", initialRightsSource.id, recheckedRightsSource.id).length === 2,
      "post-readiness rights evidence and both append-only rights revisions survive");
    await fails(() => echo.createEchoRightsAssessment(env, rights("rights-bad", "lyrics", "automatically_cleared")), "rights vocabulary");
    await fails(async () => db.sqlite.prepare("UPDATE echo_rights_assessments SET status='licensed' WHERE id='rights-art-1'").run(), "rights append-only");
    await fails(async () => db.sqlite.prepare(`INSERT INTO echo_rights_assessments
      (id,packet_id,candidate_id,asset_type,asset_identifier,proposed_use,revision,status,basis,permitted_use,reviewed_by,reviewed_at,supersedes_id,created_at)
      VALUES ('rights-cross-asset',?,?,'lyrics','synthetic:lyrics','homepage illustration',2,'unknown','Synthetic','none','editor',?,? ,?)`)
      .run(packetA.id, "candidate-1", AT, rights1.id, AT), "rights supersession cannot cross assets");

    const ready = await echo.completeEchoPacket(env, { packetId: packetA.id, jobId: jobA.id, result: "ready", at: AT });
    pass(ready.state === "ready" && row("SELECT state FROM echo_jobs WHERE id=?", jobA.id).state === "ready", "ready packet/job terminal together");
    await fails(() => echo.createEchoAssessment(env, assessment("assessment-terminal", "candidate-1")),
      "terminal packet assessment creation rejected");
    const otherPacket = await echo.createEchoPacket(env, { id: "echo-other-packet", issueKey: "unrelated-issue",
      evidenceSnapshotHash: hash("9"), brief: {}, intakes: [{ intakeId: "intake-c", role: "primary" }],
      createdBy: "editor@example.test", createdAt: AT });
    await candidate("candidate-other", otherPacket.id);
    await echo.createEchoAssessment(env, assessment("assessment-other", "candidate-other", otherPacket.id));
    const beforeReportingDecisions = row("SELECT COUNT(*) AS n FROM editorial_decisions").n;
    const beforePublications = row("SELECT COUNT(*) AS n FROM publication_attempts").n;
    await fails(() => echo.createEchoDecision(env, { id: "decision-no-actor", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1", decision: "feature", decidedBy: "", rationale: "Synthetic", decidedAt: AT }),
      "human actor required");
    await fails(() => echo.createEchoDecision(env, { id: "decision-cross", packetId: packetA.id,
      candidateId: "candidate-2", assessmentId: "assessment-1", decision: "feature", decidedBy: "editor@example.test",
      rationale: "Synthetic", decidedAt: AT }), "decision must anchor exact candidate/assessment");
    for (const [id, assessmentId] of [["decision-older", "assessment-1"], ["decision-newer", "assessment-1c"],
      ["decision-other-packet", "assessment-other"]]) {
      await fails(() => echo.createEchoDecision(env, { id, packetId: packetA.id,
        candidateId: "candidate-1", assessmentId, decision: "feature", decidedBy: "editor@example.test",
        rationale: "Synthetic", decidedAt: AT }), `decision rejects unpinned ${assessmentId}`);
    }
    const decision = await echo.createEchoDecision(env, { id: "decision-feature", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1b", decision: "feature", decidedBy: "editor@example.test",
      rationale: "Synthetic bounded comparison", decidedAt: AT });
    pass(decision.assessment_id === "assessment-1b" && secondAssessment.revision === 2 && thirdAssessment.revision === 3,
      "decision retains exactly pinned assessment");
    await fails(async () => db.sqlite.prepare(`INSERT INTO echo_decisions
      (id,packet_id,candidate_id,assessment_id,decision,decided_by,rationale,decided_at)
      VALUES ('decision-sql-unpinned',?,?,?,?,?,?,?)`).run(packetA.id, "candidate-1", "assessment-1c",
      "feature", "editor@example.test", "Synthetic", AT), "database FK rejects unpinned decision");
    await fails(async () => db.sqlite.prepare(`UPDATE echo_candidates SET editor_ready_assessment_id='assessment-1c'
      WHERE id='candidate-1'`).run(), "readiness pin cannot change after review");
    pass(row("SELECT COUNT(*) AS n FROM editorial_decisions").n === beforeReportingDecisions &&
      row("SELECT COUNT(*) AS n FROM publication_attempts").n === beforePublications, "FEATURE neither approves nor publishes");
    await fails(async () => db.sqlite.prepare("UPDATE echo_decisions SET assessment_id='assessment-1c' WHERE id='decision-feature'").run(), "decision append-only");
    await fails(async () => db.sqlite.prepare("DELETE FROM echo_decisions WHERE id='decision-feature'").run(), "decision retained");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-after-decision", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1b", sourceRole: "historical_context",
      supportsField: "original_context", url: "https://example.test/late", authorityRationale: "Synthetic", createdAt: AT }),
      "reviewed source set frozen");
    const packetB = await echo.createEchoPacket(env, { id: "echo-packet-b", issueKey: "synthetic-issue", evidenceSnapshotHash: hash("b"),
      brief: { institution: "Synthetic office", later_fact: true }, intakes: [{ intakeId: "intake-a", role: "primary" }],
      createdBy: "editor@example.test", createdAt: AT });
    pass(packetB.revision === 2 && row("SELECT superseded_at FROM echo_packets WHERE id=?", packetA.id).superseded_at === AT,
      "new evidence increments revision and supersedes without overwriting");
    await fails(() => echo.createEchoJob(env, { id: "echo-stale-job", packetId: packetA.id, idempotencyKey: "stale",
      triggerType: "manual", requestedBy: "editor@example.test", processorVersion: "contracts-v1", createdAt: AT }),
      "superseded packet cannot start a new job");
    await fails(() => echo.createEchoDecision(env, { id: "echo-stale-decision", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1b", decision: "feature", decidedBy: "editor@example.test",
      rationale: "Stale", decidedAt: AT }), "superseded packet cannot receive a new human decision");
    await echo.createEchoPacket(env, { id: "echo-other-packet-revision", issueKey: "unrelated-issue",
      evidenceSnapshotHash: hash("8"), brief: { updated: true },
      intakes: [{ intakeId: "intake-c", role: "primary" }], createdBy: "editor@example.test", createdAt: AT });
    await fails(() => echo.createEchoAssessment(env, assessment("assessment-other-late", "candidate-other", otherPacket.id)),
      "superseded packet cannot gain a new assessment revision");

    const noEchoPacket = await echo.createEchoPacket(env, { id: "echo-no-echo", issueKey: "another-issue",
      evidenceSnapshotHash: hash("f"), brief: { no_candidate: true },
      intakes: [{ intakeId: "intake-b", role: "primary" }], createdBy: "editor@example.test", createdAt: AT });
    const noEchoJob = await echo.createEchoJob(env, { id: "echo-job-zero", packetId: noEchoPacket.id,
      idempotencyKey: "zero", triggerType: "manual", requestedBy: "editor@example.test", processorVersion: "contracts-v1", createdAt: AT });
    await fails(() => echo.completeEchoPacket(env, { packetId: noEchoPacket.id, jobId: noEchoJob.id,
      result: "no_echo", reasonCode: "PREMATURE", at: AT }), "pending job cannot conclude no echo");
    pass(row("SELECT state FROM echo_jobs WHERE id=?", noEchoJob.id).state === "pending" &&
      row("SELECT state FROM echo_packets WHERE id=?", noEchoPacket.id).state === "open", "premature no-echo rolls back atomically");
    await echo.transitionEchoJob(env, { jobId: noEchoJob.id, from: "pending", to: "researching", at: AT });
    const zero = await echo.completeEchoPacket(env, { packetId: noEchoPacket.id, jobId: noEchoJob.id,
      result: "no_echo", reasonCode: "NO_MEANINGFUL_CANDIDATE", reason: "Synthetic search found no sound analogy", at: AT });
    pass(zero.state === "no_echo" && row("SELECT state FROM echo_jobs WHERE id=?", noEchoJob.id).state === "no_echo" &&
      row("SELECT COUNT(*) AS n FROM echo_candidates WHERE packet_id=?", zero.id).n === 0, "zero-candidate success is not failure");
    pass(row("SELECT action FROM audit_events WHERE entity_id=? AND action='echo.no_echo_warranted'", zero.id)?.action === "echo.no_echo_warranted",
      "no-echo audit");
    await fails(() => echo.completeEchoPacket(env, { packetId: noEchoPacket.id, jobId: noEchoJob.id, result: "no_echo",
      reasonCode: "RETRY", at: AT }), "terminal no-echo cannot replay");
    for (const [suffix, states] of [["verifying", ["researching", "verifying"]],
      ["rights", ["researching", "verifying", "rights_check"]],
      ["assembling", ["researching", "verifying", "rights_check", "assembling"]]]) {
      const packet = await echo.createEchoPacket(env, { id: `echo-no-echo-${suffix}`, issueKey: `no-echo-${suffix}`,
        evidenceSnapshotHash: hash("f"), brief: {}, intakes: [{ intakeId: "intake-b", role: "primary" }],
        createdBy: "editor@example.test", createdAt: AT });
      const job = await echo.createEchoJob(env, { id: `echo-job-${suffix}`, packetId: packet.id,
        idempotencyKey: suffix, triggerType: "manual", requestedBy: "editor@example.test",
        processorVersion: "contracts-v1", createdAt: AT });
      let from = "pending";
      for (const to of states) { await echo.transitionEchoJob(env, { jobId: job.id, from, to, at: AT }); from = to; }
      const terminal = await echo.completeEchoPacket(env, { packetId: packet.id, jobId: job.id,
        result: "no_echo", reasonCode: "NO_MEANINGFUL_CANDIDATE", at: AT });
      pass(terminal.state === "no_echo" && row("SELECT state FROM echo_jobs WHERE id=?", job.id).state === "no_echo",
        `no-echo legal from ${from}`);
    }
    const rejectedPacket = await echo.createEchoPacket(env, { id: "echo-rejected-packet", issueKey: "rejected-issue",
      evidenceSnapshotHash: hash("f"), brief: {}, intakes: [{ intakeId: "intake-b", role: "primary" }],
      createdBy: "editor@example.test", createdAt: AT });
    const rejectedJob = await echo.createEchoJob(env, { id: "echo-rejected-job", packetId: rejectedPacket.id,
      idempotencyKey: "rejected", triggerType: "manual", requestedBy: "editor@example.test",
      processorVersion: "contracts-v1", createdAt: AT });
    await echo.transitionEchoJob(env, { jobId: rejectedJob.id, from: "pending", to: "researching", at: AT });
    await candidate("candidate-rejected", rejectedPacket.id);
    await fails(() => echo.completeEchoPacket(env, { packetId: rejectedPacket.id, jobId: rejectedJob.id,
      result: "no_echo", reasonCode: "UNRESOLVED", at: AT }), "no-echo cannot retain an unresolved candidate");
    pass(row("SELECT state FROM echo_jobs WHERE id=?", rejectedJob.id).state === "researching" &&
      row("SELECT state FROM echo_packets WHERE id=?", rejectedPacket.id).state === "open", "unresolved no-echo rolls back atomically");
    db.sqlite.prepare("UPDATE echo_candidates SET state='researching' WHERE id='candidate-rejected'").run();
    await fails(() => echo.completeEchoPacket(env, { packetId: rejectedPacket.id, jobId: rejectedJob.id,
      result: "no_echo", reasonCode: "STILL_UNRESOLVED", at: AT }), "no-echo cannot retain a researching candidate");
    await echo.rejectEchoCandidateByGate(env, { candidateId: "candidate-rejected", reasonCode: "NO_VALUE", at: AT });
    const resolvedNoEcho = await echo.completeEchoPacket(env, { packetId: rejectedPacket.id, jobId: rejectedJob.id,
      result: "no_echo", reasonCode: "NO_MEANINGFUL_CANDIDATE", at: AT });
    pass(resolvedNoEcho.state === "no_echo" && row("SELECT state FROM echo_candidates WHERE id='candidate-rejected'").state === "rejected_by_gate",
      "no-echo succeeds with all candidates gate-rejected");
    for (const countReady of [1, 2]) {
      const packet = await echo.createEchoPacket(env, { id: `echo-ready-${countReady}`, issueKey: `ready-${countReady}`,
        evidenceSnapshotHash: hash("a"), brief: {}, intakes: [{ intakeId: "intake-b", role: "primary" }],
        createdBy: "editor@example.test", createdAt: AT });
      const job = await echo.createEchoJob(env, { id: `echo-job-ready-${countReady}`, packetId: packet.id,
        idempotencyKey: `ready-${countReady}`, triggerType: "manual", requestedBy: "editor@example.test",
        processorVersion: "contracts-v1", createdAt: AT });
      await echo.transitionEchoJob(env, { jobId: job.id, from: "pending", to: "researching", at: AT });
      for (let n = 1; n <= countReady; n++) {
        const id = `candidate-ready-${countReady}-${n}`;
        const assessmentId = `assessment-ready-${countReady}-${n}`;
        await candidate(id, packet.id);
        await echo.createEchoAssessment(env, assessment(assessmentId, id, packet.id));
        await syntheticSource(`source-${id}-context`, id, assessmentId, "historical_context", "original_context", packet.id);
        await syntheticSource(`source-${id}-current`, id, assessmentId, "contemporary_evidence", "present_day_evidence", packet.id);
        await echo.createEchoRightsAssessment(env, rights(`rights-${id}`, "text", "unknown", id, null, packet.id));
        await echo.markEchoCandidateReady(env, { candidateId: id, assessmentId, slot: n, at: AT });
      }
      await fails(() => echo.completeEchoPacket(env, { packetId: packet.id, jobId: job.id, result: "ready", at: AT }),
        "ready cannot be entered before assembling");
      pass(row("SELECT state FROM echo_jobs WHERE id=?", job.id).state === "researching" &&
        row("SELECT state FROM echo_packets WHERE id=?", packet.id).state === "open", "premature ready rolls back atomically");
      for (const [from, to] of [["researching", "verifying"], ["verifying", "rights_check"], ["rights_check", "assembling"]]) {
        await echo.transitionEchoJob(env, { jobId: job.id, from, to, at: AT });
      }
      const terminal = await echo.completeEchoPacket(env, { packetId: packet.id, jobId: job.id, result: "ready", at: AT });
      pass(terminal.state === "ready" && row("SELECT state FROM echo_jobs WHERE id=?", job.id).state === "ready" &&
        row("SELECT COUNT(*) AS n FROM echo_candidates WHERE packet_id=? AND state='editor_ready'", packet.id).n === countReady,
        `ready succeeds with ${countReady} candidate(s)`);
    }
    const failedPacket = await echo.createEchoPacket(env, { id: "echo-failed", issueKey: "failed-issue",
      evidenceSnapshotHash: hash("0"), brief: {}, intakes: [{ intakeId: "intake-c", role: "primary" }],
      createdBy: "editor@example.test", createdAt: AT });
    const failedJob = await echo.createEchoJob(env, { id: "echo-job-failed", packetId: failedPacket.id,
      idempotencyKey: "failure", triggerType: "manual", requestedBy: "editor@example.test", processorVersion: "contracts-v1", createdAt: AT });
    await echo.transitionEchoJob(env, { jobId: failedJob.id, from: "pending", to: "failed", failureCode: "SYNTHETIC_ERROR",
      failureMessage: "Synthetic bounded failure", at: AT });
    pass(row("SELECT state FROM echo_packets WHERE id=?", failedPacket.id).state === "open" &&
      row("SELECT state FROM echo_jobs WHERE id=?", failedJob.id).state === "failed", "failed job preserves open packet");
    const retryJob = await echo.createEchoJob(env, { id: "echo-job-retry", packetId: failedPacket.id,
      idempotencyKey: "failure-retry", triggerType: "manual", requestedBy: "editor@example.test",
      processorVersion: "contracts-v1", createdAt: AT });
    pass(retryJob.state === "pending" && row("SELECT state FROM echo_jobs WHERE id=?", failedJob.id).state === "failed" &&
      row("SELECT COUNT(*) AS n FROM echo_packets WHERE issue_key='failed-issue'").n === 1,
      "new idempotency key retries same immutable packet after job failure");
    pass(row("PRAGMA foreign_key_check") === undefined && rows("PRAGMA foreign_key_check").length === 0, "zero foreign-key violations");
    console.log(`Echo persistence tests passed: ${count} deterministic contract assertions; isolated local D1 migrations and zero FK violations.`);
  } finally {
    db.close();
  }
}

const command = process.argv[2];
try {
  if (command === "check") await check();
  else if (command === "test") await test();
  else throw new Error("Usage: node scripts/echo-persistence.mjs <check|test>");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
