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
const MIGRATIONS = ["0001_editorial_foundation.sql", "0002_admin_queue.sql", "0003_live_analysis.sql", "0004_watchdesk_runs.sql", "0005_echo_durable_contracts.sql"];
const ECHO_TABLES = ["echo_candidate_assessments", "echo_candidate_sources", "echo_candidates", "echo_decisions", "echo_jobs", "echo_packet_intakes", "echo_packets", "echo_rights_assessments"];
const ECHO_INDEXES = ["idx_echo_assessments_candidate_revision", "idx_echo_candidates_packet_state", "idx_echo_decisions_packet_decided", "idx_echo_jobs_active_packet", "idx_echo_jobs_state_updated", "idx_echo_packet_intakes_intake", "idx_echo_packets_issue_revision", "idx_echo_packets_state_updated", "idx_echo_rights_candidate_asset", "idx_echo_sources_assessment_role", "idx_echo_sources_intake_source"];
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
    assert.equal(version[0]?.value, "5");
    const tables = (await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'echo_%' ORDER BY name")).map((row) => row.name);
    const indexes = (await query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_echo_%' ORDER BY name")).map((row) => row.name);
    assert.deepEqual(tables, ECHO_TABLES);
    assert.deepEqual(indexes, ECHO_INDEXES.toSorted());
    assert.equal((await query("PRAGMA foreign_keys"))[0]?.foreign_keys, 1);
    assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
  });
  console.log(`Echo persistence schema valid in isolated local D1: v5, ${ECHO_TABLES.length} tables, ${ECHO_INDEXES.length} indexes, zero FK violations.`);
}

async function test() {
  // The Wrangler-backed portion ensures this test always starts by applying
  // the actual five migrations locally, never by using a remote binding.
  await withLocalD1(async (query) => {
    assert.equal((await query("SELECT value FROM sbns_meta WHERE key='schema_version'"))[0]?.value, "5");
    await query(`INSERT INTO intakes (id,origin,submitted_url,submitted_at,status,analysis_status,created_at,updated_at)
      VALUES ('d1-intake','editor','https://example.test/d1','${AT}','review_ready','complete','${AT}','${AT}')`);
    await query(`INSERT INTO echo_packets
      (id,issue_key,revision,evidence_snapshot_hash,brief_json,state,created_by,created_at,updated_at)
      VALUES ('d1-packet','d1-issue',1,'${hash("a")}','{}','open','editor','${AT}','${AT}')`);
    await query(`INSERT INTO echo_packet_intakes VALUES ('d1-packet','d1-intake','primary','${AT}')`);
    await assert.rejects(() => query(`INSERT INTO echo_packet_intakes VALUES ('d1-packet','missing','supporting','${AT}')`));
    for (let n = 1; n <= 4; n++) {
      await query(`INSERT INTO echo_candidates
        (id,packet_id,canonical_artifact_id,artifact_type,title,state,created_at,updated_at)
        VALUES ('d1-candidate-${n}','d1-packet','catalog:${n}','literature','Synthetic ${n}','found','${AT}','${AT}')`);
    }
    for (let n = 1; n <= 3; n++) {
      await query(`UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=${n} WHERE id='d1-candidate-${n}'`);
    }
    await assert.rejects(() => query("UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=4 WHERE id='d1-candidate-4'"));
    await assert.rejects(() => query("UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=1 WHERE id='d1-candidate-4'"));
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
    for (let n = 1; n <= 4; n++) await echo.createEchoAssessment(env, assessment(`assessment-${n}`, `candidate-${n}`));
    pass(row("SELECT revision FROM echo_candidate_assessments WHERE id='assessment-1'").revision === 1, "assessment revision one");
    const secondAssessment = await echo.createEchoAssessment(env, assessment("assessment-1b", "candidate-1"));
    pass(secondAssessment.revision === 2, "assessment revision two");
    await fails(async () => db.sqlite.prepare("UPDATE echo_candidate_assessments SET original_context='changed' WHERE id='assessment-1'").run(), "assessment append-only");
    await fails(async () => db.sqlite.prepare("DELETE FROM echo_candidate_assessments WHERE id='assessment-1'").run(), "assessment retained");
    const independent = await echo.createEchoSource(env, { id: "echo-source-independent", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1", sourceRole: "historical_context",
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
      candidateId: "candidate-1", assessmentId: "assessment-1", sourceRole: "contemporary_evidence",
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

    for (let n = 1; n <= 3; n++) await echo.markEchoCandidateReady(env, { candidateId: `candidate-${n}`, slot: n, at: AT });
    pass(row("SELECT COUNT(*) AS n FROM echo_candidates WHERE packet_id=? AND state='editor_ready'", packetA.id).n === 3,
      "three editor-ready candidates");
    await fails(() => echo.markEchoCandidateReady(env, { candidateId: "candidate-4", slot: 1, at: AT }), "fourth ready candidate blocked by unique slot");
    await fails(async () => db.sqlite.prepare(`UPDATE echo_candidates SET state='editor_ready', editor_ready_slot=4 WHERE id='candidate-4'`).run(),
      "fourth ready candidate blocked by slot constraint");
    pass(row("SELECT state FROM echo_candidates WHERE id='candidate-4'").state === "found", "fourth candidate state unchanged");
    const rejected = await echo.rejectEchoCandidateByGate(env, { candidateId: "candidate-4",
      reasonCode: "ANALOGY_TOO_WEAK", actorId: "system:test", at: AT });
    pass(rejected.state === "rejected_by_gate" && rejected.gate_reason_code === "ANALOGY_TOO_WEAK" &&
      row("SELECT action FROM audit_events WHERE entity_id='candidate-4' AND action='echo.candidate_rejected_by_gate'")?.action === "echo.candidate_rejected_by_gate",
      "gate rejection has bounded reason and audit");
    await fails(() => echo.rejectEchoCandidateByGate(env, { candidateId: "candidate-4", reasonCode: "RETRY", at: AT }),
      "gate rejection is not silently repeated");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-after-ready", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1", sourceRole: "historical_context",
      supportsField: "original_context", url: "https://example.test/late-ready", authorityRationale: "Synthetic", createdAt: AT }),
      "editor-ready source set frozen");

    const rights = (id, assetType, status) => ({ id, packetId: packetA.id, candidateId: "candidate-1", assetType,
      assetIdentifier: `synthetic:${assetType}`, proposedUse: "homepage illustration", status,
      basis: "Synthetic rights assessment", permittedUse: status === "do_not_reproduce" ? "none" : "metadata only",
      reviewedBy: "editor@example.test", reviewedAt: AT, createdAt: AT });
    const rights1 = await echo.createEchoRightsAssessment(env, rights("rights-art-1", "artwork", "unknown"));
    const rights2 = await echo.createEchoRightsAssessment(env, rights("rights-art-2", "artwork", "do_not_reproduce"));
    const rights3 = await echo.createEchoRightsAssessment(env, rights("rights-text-1", "text", "link_metadata_only"));
    pass(rights1.revision === 1 && rights2.revision === 2 && rights2.supersedes_id === rights1.id && rights3.revision === 1,
      "asset-specific rights revisions preserve history");
    await fails(() => echo.createEchoRightsAssessment(env, rights("rights-bad", "lyrics", "automatically_cleared")), "rights vocabulary");
    await fails(async () => db.sqlite.prepare("UPDATE echo_rights_assessments SET status='licensed' WHERE id='rights-art-1'").run(), "rights append-only");
    await fails(async () => db.sqlite.prepare(`INSERT INTO echo_rights_assessments
      (id,packet_id,candidate_id,asset_type,asset_identifier,proposed_use,revision,status,basis,permitted_use,reviewed_by,reviewed_at,supersedes_id,created_at)
      VALUES ('rights-cross-asset',?,?,'lyrics','synthetic:lyrics','homepage illustration',2,'unknown','Synthetic','none','editor',?,? ,?)`)
      .run(packetA.id, "candidate-1", AT, rights1.id, AT), "rights supersession cannot cross assets");

    const ready = await echo.completeEchoPacket(env, { packetId: packetA.id, jobId: jobA.id, result: "ready", at: AT });
    pass(ready.state === "ready" && row("SELECT state FROM echo_jobs WHERE id=?", jobA.id).state === "ready", "ready packet/job terminal together");
    const beforeReportingDecisions = row("SELECT COUNT(*) AS n FROM editorial_decisions").n;
    const beforePublications = row("SELECT COUNT(*) AS n FROM publication_attempts").n;
    await fails(() => echo.createEchoDecision(env, { id: "decision-no-actor", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1", decision: "feature", decidedBy: "", rationale: "Synthetic", decidedAt: AT }),
      "human actor required");
    await fails(() => echo.createEchoDecision(env, { id: "decision-cross", packetId: packetA.id,
      candidateId: "candidate-2", assessmentId: "assessment-1", decision: "feature", decidedBy: "editor@example.test",
      rationale: "Synthetic", decidedAt: AT }), "decision must anchor exact candidate/assessment");
    const decision = await echo.createEchoDecision(env, { id: "decision-feature", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1", decision: "feature", decidedBy: "editor@example.test",
      rationale: "Synthetic bounded comparison", decidedAt: AT });
    pass(decision.assessment_id === "assessment-1" && secondAssessment.revision === 2, "decision retains exact earlier assessment");
    pass(row("SELECT COUNT(*) AS n FROM editorial_decisions").n === beforeReportingDecisions &&
      row("SELECT COUNT(*) AS n FROM publication_attempts").n === beforePublications, "FEATURE neither approves nor publishes");
    await fails(async () => db.sqlite.prepare("UPDATE echo_decisions SET assessment_id='assessment-1b' WHERE id='decision-feature'").run(), "decision append-only");
    await fails(async () => db.sqlite.prepare("DELETE FROM echo_decisions WHERE id='decision-feature'").run(), "decision retained");
    await fails(() => echo.createEchoSource(env, { id: "echo-source-after-decision", packetId: packetA.id,
      candidateId: "candidate-1", assessmentId: "assessment-1", sourceRole: "historical_context",
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

    const noEchoPacket = await echo.createEchoPacket(env, { id: "echo-no-echo", issueKey: "another-issue",
      evidenceSnapshotHash: hash("f"), brief: { no_candidate: true },
      intakes: [{ intakeId: "intake-b", role: "primary" }], createdBy: "editor@example.test", createdAt: AT });
    const noEchoJob = await echo.createEchoJob(env, { id: "echo-job-zero", packetId: noEchoPacket.id,
      idempotencyKey: "zero", triggerType: "manual", requestedBy: "editor@example.test", processorVersion: "contracts-v1", createdAt: AT });
    const zero = await echo.completeEchoPacket(env, { packetId: noEchoPacket.id, jobId: noEchoJob.id,
      result: "no_echo", reasonCode: "NO_MEANINGFUL_CANDIDATE", reason: "Synthetic search found no sound analogy", at: AT });
    pass(zero.state === "no_echo" && row("SELECT state FROM echo_jobs WHERE id=?", noEchoJob.id).state === "no_echo" &&
      row("SELECT COUNT(*) AS n FROM echo_candidates WHERE packet_id=?", zero.id).n === 0, "zero-candidate success is not failure");
    pass(row("SELECT action FROM audit_events WHERE entity_id=? AND action='echo.no_echo_warranted'", zero.id)?.action === "echo.no_echo_warranted",
      "no-echo audit");
    await fails(() => echo.completeEchoPacket(env, { packetId: noEchoPacket.id, jobId: noEchoJob.id, result: "no_echo",
      reasonCode: "RETRY", at: AT }), "terminal no-echo cannot replay");
    const failedPacket = await echo.createEchoPacket(env, { id: "echo-failed", issueKey: "failed-issue",
      evidenceSnapshotHash: hash("0"), brief: {}, intakes: [{ intakeId: "intake-c", role: "primary" }],
      createdBy: "editor@example.test", createdAt: AT });
    const failedJob = await echo.createEchoJob(env, { id: "echo-job-failed", packetId: failedPacket.id,
      idempotencyKey: "failure", triggerType: "manual", requestedBy: "editor@example.test", processorVersion: "contracts-v1", createdAt: AT });
    await echo.transitionEchoJob(env, { jobId: failedJob.id, from: "pending", to: "failed", failureCode: "SYNTHETIC_ERROR",
      failureMessage: "Synthetic bounded failure", at: AT });
    pass(row("SELECT state FROM echo_packets WHERE id=?", failedPacket.id).state === "failed" &&
      row("SELECT state FROM echo_jobs WHERE id=?", failedJob.id).state === "failed", "operational failure distinct from no-echo");
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
