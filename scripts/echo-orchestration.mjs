import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  BRIEF_SCHEMA, EchoInputError, canonicalJson, canonicalBrief, evidenceSnapshotHash,
  normalizeEchoSource, sourceSetHash, canonicalCandidate, candidatePackageHash, evaluateEchoGate,
  orderEchoCandidates, noEchoReason, orchestrateSyntheticEcho,
} from "../src/echo-orchestration.js";
import { AT, TEST_HASH, SECOND_HASH, syntheticBrief, syntheticCandidate, syntheticInput, scenarios } from "../fixtures/echo/synthetic-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = ["0001_editorial_foundation.sql", "0002_admin_queue.sql", "0003_live_analysis.sql", "0004_watchdesk_runs.sql", "0005_echo_durable_contracts.sql"];
let assertions = 0;
function eq(actual, expected) { assert.deepEqual(actual, expected); assertions++; }
function ok(value) { assert(value); assertions++; }
function throws(action, code) {
  assert.throws(action, (error) => error instanceof EchoInputError && error.code === code);
  assertions++;
}
async function rejects(action, matcher) { await assert.rejects(action, matcher); assertions++; }

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
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}
async function localEnvironment() {
  const db = new LocalD1();
  for (const file of MIGRATIONS) db.sqlite.exec(await readFile(path.join(ROOT, "migrations", file), "utf8"));
  db.sqlite.prepare(`INSERT INTO intakes (id,origin,submitted_url,submitted_at,status,analysis_status,created_at,updated_at)
    VALUES ('synthetic-intake-1','editor','https://example.test/fictional-intake',?,'review_ready','complete',?,?)`).run(AT, AT, AT);
  db.sqlite.prepare(`INSERT INTO sources (id,intake_id,url,normalized_url,name,source_type,verification_status,content_hash,created_at)
    VALUES ('synthetic-source-1','synthetic-intake-1','https://example.test/fictional-audit',
      'https://example.test/fictional-audit','Invented audit','audit','verified',?,?)`).run(TEST_HASH, AT);
  return { db, env: { SBNS_DB: db } };
}
function count(db, table, predicate = "1=1") { return db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${predicate}`).get().n; }
function auditMetadata(db, action, entityId) {
  return db.sqlite.prepare("SELECT metadata_json FROM audit_events WHERE action=? AND entity_id=? ORDER BY id")
    .all(action, entityId).map((row) => JSON.parse(row.metadata_json));
}
function candidatePackageWriteCounts(db, packetId) {
  return ["echo_candidates", "echo_candidate_assessments", "echo_candidate_sources", "echo_rights_assessments"]
    .map((table) => count(db, table, `packet_id='${packetId}'`)).concat([
      count(db, "audit_events", `action='echo.candidate_evaluated' AND entity_id IN
        (SELECT id FROM echo_candidates WHERE packet_id='${packetId}')`),
      count(db, "audit_events", `action='echo.candidate_package_bound' AND entity_id='${packetId}'`),
    ]);
}

async function check() {
  eq(BRIEF_SCHEMA, "echo-brief-v1");
  eq(canonicalBrief(syntheticBrief()).schema, BRIEF_SCHEMA);
  eq(canonicalCandidate(syntheticCandidate()).schema, "echo-candidate-v1");
  eq(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  eq(evaluateEchoGate(canonicalCandidate(syntheticCandidate())), null);
  eq(noEchoReason([], []), "NO_CANDIDATES");
  console.log(`Echo orchestration pure check passed: ${assertions} assertions, no D1 or network.`);
}

async function test() {
  await check();
  const brief = syntheticBrief();
  const reordered = structuredClone(brief);
  reordered.verifiedFacts = [{ sourceIds: ["synthetic-source-1"], text: brief.verifiedFacts[0].text, id: "fact-1" }];
  reordered.evidenceSources = [{ provenance: brief.evidenceSources[0].provenance,
    confidence: "primary_record", contentHash: TEST_HASH, canonicalId: "synthetic:audit:1",
    intakeId: "synthetic-intake-1", id: "synthetic-source-1" }];
  reordered.title = "Different display title";
  reordered.runtimeAt = "2099-01-01T00:00:00Z";
  eq(await evidenceSnapshotHash(brief), await evidenceSnapshotHash(reordered));
  const changedFact = structuredClone(brief); changedFact.verifiedFacts[0].text += " Material addition.";
  ok(await evidenceSnapshotHash(brief) !== await evidenceSnapshotHash(changedFact));
  const changedQualifier = structuredClone(brief); changedQualifier.materialQualifications.push("Another synthetic caveat");
  ok(await evidenceSnapshotHash(brief) !== await evidenceSnapshotHash(changedQualifier));
  const changedSource = structuredClone(brief); changedSource.evidenceSources[0].contentHash = SECOND_HASH;
  ok(await evidenceSnapshotHash(brief) !== await evidenceSnapshotHash(changedSource));
  const changedIntake = structuredClone(brief); changedIntake.intakes.push({ intakeId: "synthetic-intake-2", role: "supporting" });
  ok(await evidenceSnapshotHash(brief) !== await evidenceSnapshotHash(changedIntake));
  const changedLimit = structuredClone(brief); changedLimit.mustNotClaim.push("Do not infer a cause");
  ok(await evidenceSnapshotHash(brief) !== await evidenceSnapshotHash(changedLimit));
  const source = syntheticCandidate().sources;
  eq(await sourceSetHash(source), await sourceSetHash(source.toReversed()));
  const changedSourceSet = structuredClone(source); changedSourceSet[0].contentHash = SECOND_HASH;
  ok(await sourceSetHash(source) !== await sourceSetHash(changedSourceSet));
  const removedSource = source.slice(1);
  ok(await sourceSetHash(source) !== await sourceSetHash(removedSource));
  const changedRole = structuredClone(source); changedRole[0].sourceRole = "original_work";
  ok(await sourceSetHash(source) !== await sourceSetHash(changedRole));
  const rightsOnlyChange = structuredClone(source); rightsOnlyChange[2].contentHash = SECOND_HASH;
  eq(await sourceSetHash(source), await sourceSetHash(rightsOnlyChange));
  const packageCandidates = [syntheticCandidate(1), syntheticCandidate(2)];
  const packageDigest = await candidatePackageHash(packageCandidates);
  eq(packageDigest, await candidatePackageHash(packageCandidates.toReversed()));
  const unicodeCandidates = [syntheticCandidate(1), syntheticCandidate(2)];
  unicodeCandidates[0].canonicalArtifactId = "synthetic:work:é";
  unicodeCandidates[1].canonicalArtifactId = "synthetic:work:e\u0301";
  eq(unicodeCandidates[0].canonicalArtifactId.localeCompare(unicodeCandidates[1].canonicalArtifactId), 0);
  eq(await candidatePackageHash(unicodeCandidates), await candidatePackageHash(unicodeCandidates.toReversed()));
  const reorderedPackageSources = structuredClone(packageCandidates);
  reorderedPackageSources[0].sources.reverse();
  eq(packageDigest, await candidatePackageHash(reorderedPackageSources));
  const unicodeSources = syntheticCandidate();
  const contextSource = unicodeSources.sources[0];
  unicodeSources.sources.push(
    { ...contextSource, canonicalIdentifier: "synthetic:archive:é", url: null, title: "Composed synthetic source" },
    { ...contextSource, canonicalIdentifier: "synthetic:archive:e\u0301", url: null, title: "Decomposed synthetic source" },
  );
  const reversedUnicodeSources = structuredClone(unicodeSources);
  reversedUnicodeSources.sources.reverse();
  eq(await candidatePackageHash([unicodeSources]), await candidatePackageHash([reversedUnicodeSources]));
  ok(packageDigest !== await candidatePackageHash(packageCandidates.slice(0, 1)));
  ok(packageDigest !== await candidatePackageHash([...packageCandidates, syntheticCandidate(3)]));
  const changedPackageSource = structuredClone(packageCandidates);
  changedPackageSource[0].sources[2].url = "https://example.test/fictional-rights/rechecked";
  changedPackageSource[0].rights[0].rightsSource = changedPackageSource[0].sources[2];
  ok(packageDigest !== await candidatePackageHash(changedPackageSource));
  const changedPackageMetadata = structuredClone(packageCandidates);
  changedPackageMetadata[0].sources[0].authorityRationale = "A different synthetic catalog basis";
  ok(packageDigest !== await candidatePackageHash(changedPackageMetadata));
  const changedPackageRights = structuredClone(packageCandidates);
  changedPackageRights[0].rights[0].basis = "A revised synthetic rights basis";
  ok(packageDigest !== await candidatePackageHash(changedPackageRights));
  const changedPackageAssessment = structuredClone(packageCandidates);
  changedPackageAssessment[0].assessment.whatEchoes += " A distinct synthetic interpretation.";
  ok(packageDigest !== await candidatePackageHash(changedPackageAssessment));
  const changedPackageGate = structuredClone(packageCandidates);
  changedPackageGate[0].gate.mechanismMatch = "qualified";
  ok(packageDigest !== await candidatePackageHash(changedPackageGate));
  const changedPackageAuthority = structuredClone(packageCandidates);
  changedPackageAuthority[0].gate.contextAuthority = "limited";
  ok(packageDigest !== await candidatePackageHash(changedPackageAuthority));
  const changedPackagePriorUse = structuredClone(packageCandidates);
  changedPackagePriorUse[0].priorUse = { status: "recently_featured", justification: "Synthetic re-use rationale" };
  ok(packageDigest !== await candidatePackageHash(changedPackagePriorUse));
  const changedPackageJustification = structuredClone(changedPackagePriorUse);
  changedPackageJustification[0].priorUse.justification = "A different synthetic rationale";
  ok(await candidatePackageHash(changedPackagePriorUse) !== await candidatePackageHash(changedPackageJustification));
  eq(normalizeEchoSource({ ...source[0], url: "https://EXAMPLE.test:443/fictional-archive/1#fragment" }).url,
    "https://example.test/fictional-archive/1");
  throws(() => canonicalJson({ a: [undefined] }), "INVALID_JSON");
  throws(() => canonicalBrief({ ...brief, schema: undefined }), "INVALID_SCHEMA");
  throws(() => canonicalBrief({ ...brief, issueKey: "" }), "MISSING_FIELD");
  throws(() => canonicalBrief({ ...brief, intakes: [{ intakeId: "x", role: "supporting" }] }), "PRIMARY_INTAKE_REQUIRED");
  throws(() => canonicalBrief({ ...brief, intakes: [brief.intakes[0], brief.intakes[0]] }), "DUPLICATE");
  throws(() => canonicalBrief({ ...brief, intakes: [{ intakeId: "x", role: "spectator" }] }), "INVALID_ENUM");
  throws(() => canonicalBrief({ ...brief, accountabilityQuestion: "" }), "MISSING_FIELD");
  throws(() => canonicalBrief({ ...brief, unresolvedFacts: "not a list" }), "INVALID_LIST");
  throws(() => canonicalBrief({ ...brief, provenanceSummary: { confidence: "made_up", basis: "x" } }), "INVALID_ENUM");
  throws(() => canonicalBrief({ ...brief, verifiedFacts: [{ id: "f", text: "fact", sourceIds: ["missing"] }] }), "FACT_SOURCE_REQUIRED");
  throws(() => canonicalCandidate({ ...syntheticCandidate(), sources: "broken" }), "INVALID_LIST");
  throws(() => canonicalCandidate({ ...syntheticCandidate(), assessment: { ...syntheticCandidate().assessment, whatEchoes: "" } }), "MISSING_FIELD");
  throws(() => normalizeEchoSource({ ...source[0], sourceRole: "rights" }), "ROLE_FIELD_MISMATCH");
  const prior = syntheticCandidate(); prior.priorUse = { status: "recently_featured" };
  eq(evaluateEchoGate(canonicalCandidate(prior)), "PRIOR_USE_JUSTIFICATION_REQUIRED");
  prior.priorUse.justification = "A synthetic, exceptionally clear mechanism";
  eq(evaluateEchoGate(canonicalCandidate(prior)), null);
  const ranked = [3, 1, 2].map(syntheticCandidate);
  ranked[0].gate.contextAuthority = "limited";
  eq(orderEchoCandidates(ranked.map(canonicalCandidate)).map((item) => item.canonicalArtifactId),
    ["synthetic:work:1", "synthetic:work:2", "synthetic:work:3"]);
  const mechanismFirst = [1, 2].map(syntheticCandidate);
  mechanismFirst[0].gate.mechanismMatch = "qualified";
  mechanismFirst[1].gate.contextAuthority = "limited";
  eq(orderEchoCandidates(mechanismFirst.map(canonicalCandidate))[0].canonicalArtifactId, "synthetic:work:2");
  const contextSecond = [1, 2].map(syntheticCandidate);
  contextSecond[0].gate.contextAuthority = "limited";
  eq(orderEchoCandidates(contextSecond.map(canonicalCandidate))[0].canonicalArtifactId, "synthetic:work:2");
  const burdenThird = [1, 2].map(syntheticCandidate);
  burdenThird[0].assessment.researchBurden = "high";
  eq(orderEchoCandidates(burdenThird.map(canonicalCandidate))[0].canonicalArtifactId, "synthetic:work:2");
  const priorFourth = [1, 2].map(syntheticCandidate);
  priorFourth[0].priorUse = { status: "recently_featured", justification: "Synthetic reason" };
  eq(orderEchoCandidates(priorFourth.map(canonicalCandidate))[0].canonicalArtifactId, "synthetic:work:2");
  eq(orderEchoCandidates([2, 1].map(syntheticCandidate).map(canonicalCandidate))[0].canonicalArtifactId, "synthetic:work:1");
  const legacyAuthority = syntheticCandidate(); legacyAuthority.gate.authority = "primary";
  throws(() => canonicalCandidate(legacyAuthority), "UNKNOWN_FIELD");
  for (const [scenario, reason] of [["D_weak", "ANALOGY_TOO_WEAK"], ["E_context", "ORIGINAL_CONTEXT_INSUFFICIENT"],
    ["F_present", "PRESENT_EVIDENCE_INSUFFICIENT"]]) eq(evaluateEchoGate(canonicalCandidate(scenarios[scenario]().candidates[0])), reason);
  const noContext = syntheticCandidate(); noContext.sources = noContext.sources.filter((item) => item.sourceRole !== "historical_context");
  eq(evaluateEchoGate(canonicalCandidate(noContext)), "ORIGINAL_CONTEXT_INSUFFICIENT");
  const noCurrent = syntheticCandidate(); noCurrent.sources = noCurrent.sources.filter((item) => item.sourceRole !== "contemporary_evidence");
  eq(evaluateEchoGate(canonicalCandidate(noCurrent)), "PRESENT_EVIDENCE_INSUFFICIENT");
  const noRights = syntheticCandidate(); noRights.rights = [];
  eq(evaluateEchoGate(canonicalCandidate(noRights)), "RIGHTS_REVIEW_MISSING");
  const misleading = syntheticCandidate(); misleading.gate.mechanismMatch = "misleading";
  eq(evaluateEchoGate(canonicalCandidate(misleading)), "ANALOGY_MISLEADING");
  const noValue = syntheticCandidate(); noValue.gate.editorialValue = "none";
  eq(evaluateEchoGate(canonicalCandidate(noValue)), "NO_EDITORIAL_VALUE");
  const protocol = syntheticCandidate(); protocol.gate.culturalProtocol = "unresolved";
  eq(evaluateEchoGate(canonicalCandidate(protocol)), "CULTURAL_PROTOCOL_UNRESOLVED");
  const burden = syntheticCandidate(); burden.assessment.researchBurden = "disproportionate";
  eq(evaluateEchoGate(canonicalCandidate(burden)), "RESEARCH_BURDEN_DISPROPORTIONATE");
  eq(evaluateEchoGate(canonicalCandidate(scenarios.G_restrictive().candidates[0])), null);
  const { db, env } = await localEnvironment();
  try {
    eq(db.sqlite.prepare("SELECT value FROM sbns_meta WHERE key='schema_version'").get().value, "5");
    const strong = await orchestrateSyntheticEcho(env, scenarios.A_strong());
    eq(strong.status, "READY"); eq(strong.readyCount, 1);
    eq(count(db, "echo_candidates", `packet_id='${strong.packetId}' AND state='editor_ready'`), 1);
    eq(count(db, "echo_decisions"), 0);
    eq(db.sqlite.prepare("SELECT source_set_hash FROM echo_candidate_assessments WHERE packet_id=?").get(strong.packetId).source_set_hash,
      await sourceSetHash(syntheticCandidate().sources));
    eq(count(db, "echo_candidate_sources", `packet_id='${strong.packetId}'`), 3);
    eq(db.sqlite.prepare("SELECT status FROM echo_rights_assessments WHERE packet_id=?").get(strong.packetId).status, "link_metadata_only");
    const multiple = await orchestrateSyntheticEcho(env, scenarios.B_multiple());
    eq(multiple.readyCount, 3);
    eq(count(db, "echo_candidates", `packet_id='${multiple.packetId}' AND state='editor_ready'`), 3);
    eq(count(db, "echo_candidates", `packet_id='${multiple.packetId}' AND gate_reason_code='NOT_IN_TOP_THREE'`), 1);
    eq(db.sqlite.prepare("SELECT COUNT(*) AS n FROM echo_candidates WHERE packet_id=? AND editor_ready_slot NOT BETWEEN 1 AND 3").get(multiple.packetId).n, 0);
    const evaluatedMultiple = db.sqlite.prepare(`SELECT candidate.canonical_artifact_id AS artifact_id, audit.metadata_json
      FROM audit_events AS audit JOIN echo_candidates AS candidate ON candidate.id = audit.entity_id
      WHERE audit.action='echo.candidate_evaluated' AND candidate.packet_id=? ORDER BY candidate.canonical_artifact_id`).all(multiple.packetId)
      .map((row) => ({ artifactId: row.artifact_id, ...JSON.parse(row.metadata_json) }));
    eq(evaluatedMultiple.length, 4);
    eq(evaluatedMultiple.slice(0, 3).map((row) => [row.substantive_gate, row.selection_outcome]),
      [["PASS", "SLOT_1"], ["PASS", "SLOT_2"], ["PASS", "SLOT_3"]]);
    eq([evaluatedMultiple[3].substantive_gate, evaluatedMultiple[3].selection_outcome], ["PASS", "NOT_IN_TOP_THREE"]);
    eq(evaluatedMultiple[0].context_authority, "primary");
    eq(evaluatedMultiple[0].context_evidence_present, true);
    eq(evaluatedMultiple[0].contemporary_evidence_present, true);
    eq(evaluatedMultiple[0].rights_review_present, true);
    eq(Object.keys(evaluatedMultiple[0]).sort(), ["artifactId", "candidate_id", "packet_id", "processor_version",
      "substantive_gate", "selection_outcome", "mechanism_match", "research_burden", "prior_use_status",
      "prior_use_justification_present", "context_authority", "context_evidence_present",
      "contemporary_evidence_present", "rights_review_present"].sort());
    const empty = await orchestrateSyntheticEcho(env, scenarios.C_no_echo());
    eq(empty.status, "NO_CULTURAL_ECHO_WARRANTED"); eq(empty.reasonCode, "NO_CANDIDATES");
    eq(count(db, "echo_candidates", `packet_id='${empty.packetId}'`), 0);
    eq(db.sqlite.prepare("SELECT state FROM echo_jobs WHERE id=?").get(empty.jobId).state, "no_echo");
    eq(auditMetadata(db, "echo.job_state_changed", empty.packetId).map((row) => row.to), ["researching"]);
    const weak = await orchestrateSyntheticEcho(env, scenarios.D_weak());
    eq(weak.reasonCode, "ALL_ANALOGY_FAILED");
    eq(count(db, "echo_candidates", `packet_id='${weak.packetId}' AND state='rejected_by_gate'`), 1);
    const weakCandidateId = db.sqlite.prepare("SELECT id FROM echo_candidates WHERE packet_id=?").get(weak.packetId).id;
    eq(auditMetadata(db, "echo.candidate_evaluated", weakCandidateId).map((row) =>
      [row.substantive_gate, row.selection_outcome]), [["ANALOGY_TOO_WEAK", "SUBSTANTIVE_REJECTION"]]);
    eq(auditMetadata(db, "echo.job_state_changed", weak.packetId).map((row) => row.to), ["researching"]);
    const context = await orchestrateSyntheticEcho(env, scenarios.E_context());
    eq(context.reasonCode, "ALL_CONTEXT_FAILED");
    const present = await orchestrateSyntheticEcho(env, scenarios.F_present());
    eq(present.reasonCode, "ALL_PRESENT_EVIDENCE_FAILED");
    const restrictive = await orchestrateSyntheticEcho(env, scenarios.G_restrictive());
    eq(restrictive.status, "READY");
    eq(db.sqlite.prepare("SELECT status FROM echo_rights_assessments WHERE packet_id=?").get(restrictive.packetId).status, "do_not_reproduce");
    eq(count(db, "echo_decisions"), 0);
    const familiar = await orchestrateSyntheticEcho(env, scenarios.H_prior_use());
    eq(familiar.status, "READY");
    const familiarCandidateId = db.sqlite.prepare("SELECT id FROM echo_candidates WHERE packet_id=?").get(familiar.packetId).id;
    const familiarAudit = auditMetadata(db, "echo.candidate_evaluated", familiarCandidateId);
    eq(familiarAudit.length, 1);
    eq(familiarAudit[0].prior_use_status, "recently_featured");
    eq(familiarAudit[0].prior_use_justification_present, true);
    ok(!JSON.stringify(familiarAudit).includes("unusually apt"));
    ok(!JSON.stringify(familiarAudit).includes("fabricated audit"));
    const replayInput = scenarios.J_replay();
    const first = await orchestrateSyntheticEcho(env, replayInput);
    const countsBefore = [count(db, "echo_packets"), count(db, "echo_jobs"), count(db, "echo_candidates"), count(db, "audit_events", "action='echo.candidate_evaluated'")];
    const replay = await orchestrateSyntheticEcho(env, replayInput);
    eq(replay.status, "ALREADY_PROCESSED"); eq(replay.packetId, first.packetId);
    eq([count(db, "echo_packets"), count(db, "echo_jobs"), count(db, "echo_candidates"), count(db, "audit_events", "action='echo.candidate_evaluated'")], countsBefore);
    const retitled = structuredClone(replayInput); retitled.brief.title = "New display-only working label";
    eq((await orchestrateSyntheticEcho(env, retitled)).status, "ALREADY_PROCESSED");
    eq([count(db, "echo_packets"), count(db, "echo_jobs"), count(db, "echo_candidates"), count(db, "audit_events", "action='echo.candidate_evaluated'")], countsBefore);
    const culturalOnlyChange = structuredClone(replayInput);
    culturalOnlyChange.candidates[0].gate.contextAuthority = "limited";
    eq((await orchestrateSyntheticEcho(env, culturalOnlyChange)).status, "ALREADY_PROCESSED");
    eq([count(db, "echo_packets"), count(db, "echo_jobs"), count(db, "echo_candidates"), count(db, "audit_events", "action='echo.candidate_evaluated'")], countsBefore);
    const revisionA = await orchestrateSyntheticEcho(env, syntheticInput("revision"));
    const revisionInput = syntheticInput("revision"); revisionInput.brief.verifiedFacts[0].text += " Another fabricated fact.";
    const revisionB = await orchestrateSyntheticEcho(env, revisionInput);
    eq(revisionB.packetRevision, 2);
    eq(db.sqlite.prepare("SELECT superseded_at FROM echo_packets WHERE id=?").get(revisionA.packetId).superseded_at, AT);
    eq(count(db, "echo_candidate_assessments", `packet_id='${revisionA.packetId}'`), 1);
    const staleInput = scenarios.I_stale();
    await rejects(() => orchestrateSyntheticEcho(env, staleInput, { onStep: async (point) => {
      if (point === "researching") {
        const changed = structuredClone(staleInput.brief); changed.verifiedFacts[0].text += " New evidence.";
        const newInput = { ...staleInput, brief: changed, runKey: "revision-2", candidates: [] };
        await orchestrateSyntheticEcho(env, newInput);
      }
    } }), (error) => error.code === "STALE_PACKET");
    const stalePacket = db.sqlite.prepare("SELECT id,state,superseded_at FROM echo_packets WHERE issue_key=? AND revision=1").get(staleInput.brief.issueKey);
    eq(stalePacket.state, "open"); ok(stalePacket.superseded_at);
    eq(db.sqlite.prepare("SELECT state FROM echo_jobs WHERE packet_id=?").get(stalePacket.id).state, "failed");
    eq(count(db, "echo_candidates", `packet_id='${stalePacket.id}'`), 0);
    const lateInput = syntheticInput("stale-before-completion");
    await rejects(() => orchestrateSyntheticEcho(env, lateInput, { onStep: async (point) => {
      if (point === "before_completion") {
        const changed = structuredClone(lateInput.brief); changed.materialQualifications.push("Later fabricated qualification");
        await orchestrateSyntheticEcho(env, { ...lateInput, brief: changed, runKey: "revision-2", candidates: [] });
      }
    } }), (error) => error.code === "STALE_PACKET");
    const latePacket = db.sqlite.prepare("SELECT id,state,superseded_at FROM echo_packets WHERE issue_key=? AND revision=1").get(lateInput.brief.issueKey);
    eq(latePacket.state, "open"); ok(latePacket.superseded_at);
    eq(db.sqlite.prepare("SELECT state FROM echo_jobs WHERE packet_id=?").get(latePacket.id).state, "failed");
    eq(count(db, "echo_candidates", `packet_id='${latePacket.id}' AND state='editor_ready'`), 1);
    for (const [point, stage] of [["during_candidate", "researching"], ["during_verification", "verifying"],
      ["during_rights", "rights_check"], ["during_assembly", "assembling"], ["before_completion", "assembling"]]) {
      const input = syntheticInput(`failure-${point}`);
      await rejects(() => orchestrateSyntheticEcho(env, input, { onStep: async (name, { jobId }) => {
        if (name === point) {
          eq(db.sqlite.prepare("SELECT state FROM echo_jobs WHERE id=?").get(jobId).state, stage);
          throw new Error(`Synthetic failure at ${point}`);
        }
      } }), /Synthetic failure/);
      const packet = db.sqlite.prepare("SELECT id,state FROM echo_packets WHERE issue_key=?").get(input.brief.issueKey);
      eq(packet.state, "open");
      eq(db.sqlite.prepare("SELECT state FROM echo_jobs WHERE packet_id=?").get(packet.id).state, "failed");
      const failedAudit = auditMetadata(db, "echo.job_failed", packet.id);
      eq([failedAudit[0].from, failedAudit[0].to], [stage, "failed"]);
      eq(count(db, "echo_candidates", `packet_id='${packet.id}'`), 1);
      eq(count(db, "echo_candidate_assessments", `packet_id='${packet.id}'`), stage === "researching" ? 0 : 1);
      eq(count(db, "echo_candidate_sources", `packet_id='${packet.id}'`),
        stage === "researching" ? 0 : stage === "verifying" ? 2 : 3);
      eq(count(db, "echo_rights_assessments", `packet_id='${packet.id}'`),
        ["researching", "verifying"].includes(stage) ? 0 : 1);
      const packageBinding = auditMetadata(db, "echo.candidate_package_bound", packet.id);
      eq(packageBinding.length, 1);
      eq(packageBinding[0].candidate_package_digest, await candidatePackageHash(input.candidates));
      eq(packageBinding[0].candidate_count, 1);
      input.runKey = "retry-2";
      const retried = await orchestrateSyntheticEcho(env, input);
      eq(retried.status, "READY");
      eq(count(db, "echo_candidates", `packet_id='${packet.id}'`), 1);
      eq(count(db, "echo_candidate_assessments", `packet_id='${packet.id}'`), 1);
      eq(count(db, "echo_candidate_sources", `packet_id='${packet.id}'`), 3);
      eq(count(db, "echo_rights_assessments", `packet_id='${packet.id}'`), 1);
      eq(count(db, "audit_events", `action='echo.candidate_evaluated' AND entity_id=(SELECT id FROM echo_candidates WHERE packet_id='${packet.id}')`), 1);
      eq(count(db, "audit_events", `action='echo.packet_ready' AND entity_id='${packet.id}'`), 1);
      eq(auditMetadata(db, "echo.candidate_package_bound", packet.id), packageBinding);
    }
    const reorderedRetryInput = syntheticInput("package-order", [syntheticCandidate(1), syntheticCandidate(2)]);
    await rejects(() => orchestrateSyntheticEcho(env, reorderedRetryInput, { onStep: async (point) => {
      if (point === "during_verification") throw new Error("Synthetic package-order interruption");
    } }), /package-order interruption/);
    const orderPacket = db.sqlite.prepare("SELECT id FROM echo_packets WHERE issue_key=?").get(reorderedRetryInput.brief.issueKey);
    const orderCounts = candidatePackageWriteCounts(db, orderPacket.id);
    const reorderedRetry = structuredClone(reorderedRetryInput);
    reorderedRetry.runKey = "retry-2";
    reorderedRetry.candidates.reverse();
    reorderedRetry.candidates[1].sources.reverse();
    eq(await candidatePackageHash(reorderedRetryInput.candidates), await candidatePackageHash(reorderedRetry.candidates));
    eq((await orchestrateSyntheticEcho(env, reorderedRetry)).status, "READY");
    eq(count(db, "echo_candidates", `packet_id='${orderPacket.id}'`), 2);
    eq(count(db, "audit_events", `action='echo.candidate_package_bound' AND entity_id='${orderPacket.id}'`), 1);
    eq(candidatePackageWriteCounts(db, orderPacket.id)[0], orderCounts[0]);

    async function assertChangedPackageRejected(suffix, mutate) {
      const original = syntheticInput(`package-${suffix}`);
      await rejects(() => orchestrateSyntheticEcho(env, original, { onStep: async (point) => {
        if (point === "during_rights") throw new Error("Synthetic package interruption");
      } }), /package interruption/);
      const packet = db.sqlite.prepare("SELECT id,state FROM echo_packets WHERE issue_key=?").get(original.brief.issueKey);
      const before = candidatePackageWriteCounts(db, packet.id);
      const jobsBefore = count(db, "echo_jobs", `packet_id='${packet.id}'`);
      const binding = auditMetadata(db, "echo.candidate_package_bound", packet.id);
      eq(binding.length, 1);
      eq(binding[0].candidate_package_digest, await candidatePackageHash(original.candidates));
      const changed = structuredClone(original);
      changed.runKey = "changed-package-retry";
      mutate(changed);
      ok(await candidatePackageHash(changed.candidates) !== binding[0].candidate_package_digest);
      await rejects(() => orchestrateSyntheticEcho(env, changed), (error) => error.code === "RETRY_INPUT_MISMATCH");
      eq(candidatePackageWriteCounts(db, packet.id), before);
      eq(count(db, "echo_jobs", `packet_id='${packet.id}'`), jobsBefore);
      eq(auditMetadata(db, "echo.candidate_package_bound", packet.id), binding);
      eq(db.sqlite.prepare("SELECT state FROM echo_packets WHERE id=?").get(packet.id).state, "open");
    }
    await assertChangedPackageRejected("rights-citation", (input) => {
      input.candidates[0].sources[2].url = "https://example.test/fictional-rights/new-citation";
      input.candidates[0].rights[0].rightsSource = input.candidates[0].sources[2];
    });
    await assertChangedPackageRejected("rights-review", (input) => {
      input.candidates[0].rights[0].status = "unknown";
      input.candidates[0].rights[0].basis = "A newly discovered synthetic restriction";
    });
    await assertChangedPackageRejected("source-metadata", (input) => {
      input.candidates[0].sources[0].authorityRationale = "Different invented archive authority";
    });
    await assertChangedPackageRejected("added-candidate", (input) => {
      input.candidates.push(syntheticCandidate(2));
    });
    await assertChangedPackageRejected("analogy", (input) => {
      input.candidates[0].assessment.whatEchoes += " A materially different invented comparison.";
    });
    await assertChangedPackageRejected("gate", (input) => {
      input.candidates[0].gate.mechanismMatch = "topic_only";
    });
    await assertChangedPackageRejected("context-authority", (input) => {
      input.candidates[0].gate.contextAuthority = "limited";
    });
    await assertChangedPackageRejected("prior-use", (input) => {
      input.candidates[0].priorUse = { status: "recently_featured", justification: "Synthetic prior-use explanation" };
    });
    const omittedInput = syntheticInput("package-omitted", [syntheticCandidate(1), syntheticCandidate(2)]);
    for (const candidate of omittedInput.candidates) candidate.gate.mechanismMatch = "topic_only";
    await rejects(() => orchestrateSyntheticEcho(env, omittedInput, { onStep: async (point) => {
      if (point === "before_completion") throw new Error("Synthetic omitted-candidate interruption");
    } }), /omitted-candidate interruption/);
    const omittedPacket = db.sqlite.prepare("SELECT id,state FROM echo_packets WHERE issue_key=?").get(omittedInput.brief.issueKey);
    eq(count(db, "echo_candidates", `packet_id='${omittedPacket.id}'`), 2);
    const omittedCounts = candidatePackageWriteCounts(db, omittedPacket.id);
    const omittedJobs = count(db, "echo_jobs", `packet_id='${omittedPacket.id}'`);
    const fewerCandidates = structuredClone(omittedInput);
    fewerCandidates.runKey = "omitted-retry";
    fewerCandidates.candidates = fewerCandidates.candidates.slice(0, 1);
    await rejects(() => orchestrateSyntheticEcho(env, fewerCandidates), (error) => error.code === "RETRY_INPUT_MISMATCH");
    eq(candidatePackageWriteCounts(db, omittedPacket.id), omittedCounts);
    eq(count(db, "echo_jobs", `packet_id='${omittedPacket.id}'`), omittedJobs);
    eq(db.sqlite.prepare("SELECT state FROM echo_packets WHERE id=?").get(omittedPacket.id).state, "open");
    eq(count(db, "audit_events", `action='echo.no_echo_warranted' AND entity_id='${omittedPacket.id}'`), 0);
    const emptyCandidates = structuredClone(omittedInput);
    emptyCandidates.runKey = "empty-retry";
    emptyCandidates.candidates = [];
    await rejects(() => orchestrateSyntheticEcho(env, emptyCandidates), (error) => error.code === "RETRY_INPUT_MISMATCH");
    eq(candidatePackageWriteCounts(db, omittedPacket.id), omittedCounts);
    eq(count(db, "echo_jobs", `packet_id='${omittedPacket.id}'`), omittedJobs);
    omittedInput.runKey = "exact-omitted-retry";
    eq((await orchestrateSyntheticEcho(env, omittedInput)).status, "NO_CULTURAL_ECHO_WARRANTED");
    eq(count(db, "echo_candidates", `packet_id='${omittedPacket.id}'`), 2);
    const preBindingInput = syntheticInput("package-before-binding", []);
    await rejects(() => orchestrateSyntheticEcho(env, preBindingInput, { onStep: async (point) => {
      if (point === "researching") throw new Error("Synthetic pre-binding interruption");
    } }), /pre-binding interruption/);
    const preBindingPacket = db.sqlite.prepare("SELECT id,state FROM echo_packets WHERE issue_key=?").get(preBindingInput.brief.issueKey);
    eq(auditMetadata(db, "echo.candidate_package_bound", preBindingPacket.id), []);
    eq(count(db, "echo_candidates", `packet_id='${preBindingPacket.id}'`), 0);
    preBindingInput.runKey = "new-package-after-pre-binding-failure";
    preBindingInput.candidates = [syntheticCandidate(1)];
    eq((await orchestrateSyntheticEcho(env, preBindingInput)).status, "READY");
    eq(auditMetadata(db, "echo.candidate_package_bound", preBindingPacket.id).length, 1);
    const frozenEvaluation = syntheticInput("evaluation-conflict");
    await rejects(() => orchestrateSyntheticEcho(env, frozenEvaluation, { onStep: async (point) => {
      if (point === "during_candidate") throw new Error("Synthetic post-evaluation interruption");
    } }), /post-evaluation interruption/);
    const frozenPacket = db.sqlite.prepare("SELECT id FROM echo_packets WHERE issue_key=?").get(frozenEvaluation.brief.issueKey);
    const frozenCandidateId = db.sqlite.prepare("SELECT id FROM echo_candidates WHERE packet_id=?").get(frozenPacket.id).id;
    eq(auditMetadata(db, "echo.candidate_evaluated", frozenCandidateId).length, 1);
    const changedEvaluation = structuredClone(frozenEvaluation);
    changedEvaluation.runKey = "changed-evaluation";
    changedEvaluation.candidates[0].gate.contextAuthority = "limited";
    await rejects(() => orchestrateSyntheticEcho(env, changedEvaluation), (error) => error.code === "RETRY_INPUT_MISMATCH");
    eq(auditMetadata(db, "echo.candidate_evaluated", frozenCandidateId).length, 1);
    eq(db.sqlite.prepare("SELECT state FROM echo_packets WHERE id=?").get(frozenPacket.id).state, "open");
    frozenEvaluation.runKey = "matching-retry";
    eq((await orchestrateSyntheticEcho(env, frozenEvaluation)).status, "READY");
    eq(auditMetadata(db, "echo.candidate_evaluated", frozenCandidateId).length, 1);
    const wrongSource = syntheticInput("wrong-source");
    wrongSource.candidates[0].sources[1].intakeSourceId = "other-intake-source";
    await rejects(() => orchestrateSyntheticEcho(env, wrongSource), (error) => error.code === "SOURCE_INTAKE_MISMATCH");
    const invalidPacket = db.sqlite.prepare("SELECT id,state FROM echo_packets WHERE issue_key='synthetic:wrong-source'").get();
    eq(invalidPacket.state, "open");
    eq(db.sqlite.prepare("SELECT state FROM echo_jobs WHERE packet_id=?").get(invalidPacket.id).state, "failed");
    eq(count(db, "echo_candidates", `packet_id='${invalidPacket.id}'`), 0);
    for (const action of ["echo.issue_brief_created", "echo.job_created", "echo.candidate_found", "echo.candidate_rejected_by_gate",
      "echo.analogy_checked", "echo.source_linked", "echo.rights_checked", "echo.candidate_ready", "echo.packet_ready",
      "echo.no_echo_warranted", "echo.job_failed"]) ok(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action=?").get(action).n > 0);
    eq(count(db, "echo_decisions"), 0);
    eq(db.sqlite.prepare("PRAGMA foreign_key_check").all(), []);
    console.log(`Echo synthetic orchestration passed: ${assertions} assertions, schema v5, zero FK violations, offline fixtures only.`);
  } finally { db.close(); }
}

const action = process.argv[2];
if (action === "check") await check();
else if (action === "test") await test();
else throw new Error("Use check or test");
