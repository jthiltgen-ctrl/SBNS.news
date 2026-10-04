import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { approvedPublicRecordHost, expandPrimaryRecords, primaryRecordLinks, MAX_PRIMARY_EXPANSIONS } from "../src/primary-source-expansion.js";
import { buildAnalysisMessages } from "../src/analysis-prompt.js";
import { analyzeIntake } from "../src/analyzer.js";
import { draftZero, evidenceLedger } from "../public/admin-persistent/editorial-production.js";
import { discoverySearchUrl, searchPublicDiscovery, SEARCH_RESULT_LIMIT } from "../src/editorial-search.js";
import { processAnalysisMessage, processEchoMessage } from "../src/analysis-index.js";
import { listIntakes } from "../src/persistence.js";
import { filterAssignments } from "../public/admin-persistent/desk-state.js";
import { orchestrateSyntheticEcho } from "../src/echo-orchestration.js";
import { syntheticBrief, syntheticCandidate, AT } from "../fixtures/echo/synthetic-fixtures.mjs";
import { discoverEchoSources, echoCandidateFromRecord, runEchoResearch } from "../src/echo-runtime.js";
import { normalizeLocResult } from "../src/echo-source-adapters.js";
import { EchoSourceNetworkError } from "../src/echo-source-network.js";
import { createAdminHandler } from "../src/admin-index.js";
import { getEchoPriorUse } from "../src/echo-persistence.js";

let assertions = 0;
function pass(value, label) { assert.ok(value, label); assertions++; }
async function rejectedValue(action) {
  try { await action(); } catch (error) { return error; }
  return null;
}
const diagnosticQuery = { terms: ["institutional recordkeeping"] };
const diagnosticRecord = normalizeLocResult({ id: "https://www.loc.gov/item/diagnostic-echo/", title: "Synthetic diagnostic artifact",
  contributor_names: ["Synthetic creator"], date: "1900", original_format: ["Book"] }, AT);
const locTimeout = await rejectedValue(() => discoverEchoSources({}, diagnosticQuery, {
  discoverLoc: async () => { throw new EchoSourceNetworkError("TIMEOUT"); },
}));
pass(locTimeout?.code === "ECHO_SOURCES_UNAVAILABLE" && locTimeout.stage === "source_discovery", "all-source failure has a stable discovery-stage error");
pass(JSON.stringify(locTimeout.adapterDiagnostics) === JSON.stringify([
  { adapter: "loc", configured: true, attempted: true, outcome: "failed", error_code: "TIMEOUT", result_count: null, duration_ms: locTimeout.adapterDiagnostics[0].duration_ms },
  { adapter: "smithsonian", configured: false, attempted: false, outcome: "not_configured", error_code: null, result_count: null, duration_ms: null },
]) && Number.isInteger(locTimeout.adapterDiagnostics[0].duration_ms), "LOC timeout and optional Smithsonian absence are distinguished");
for (const code of ["NETWORK_FAILURE", "HTTP_FAILURE", "INVALID_JSON"]) {
  const failure = await rejectedValue(() => discoverEchoSources({}, diagnosticQuery, {
    discoverLoc: async () => { throw new EchoSourceNetworkError(code); },
  }));
  pass(failure?.adapterDiagnostics[0]?.error_code === code, `stable LOC ${code} code is retained`);
}
const providerKeyFixture = "synthetic-key-never-persisted";
const partialDiscovery = await discoverEchoSources({ SMITHSONIAN_API_KEY: providerKeyFixture }, diagnosticQuery, {
  discoverLoc: async () => { throw new EchoSourceNetworkError("NETWORK_FAILURE"); },
  discoverSmithsonian: async (_query, options) => { pass(options.apiKey === providerKeyFixture, "configured Smithsonian adapter receives its test key only in memory"); return [diagnosticRecord]; },
});
pass(partialDiscovery.records.length === 1 && partialDiscovery.records[0].canonicalIdentifier === diagnosticRecord.canonicalIdentifier &&
  partialDiscovery.adapterDiagnostics[0].outcome === "failed" && partialDiscovery.adapterDiagnostics[1].outcome === "succeeded",
"a successful adapter continues discovery while retaining the other adapter failure");
pass(!JSON.stringify(partialDiscovery.adapterDiagnostics).includes(providerKeyFixture) &&
  !JSON.stringify(partialDiscovery.adapterDiagnostics).includes(diagnosticRecord.title) &&
  !Object.hasOwn(partialDiscovery.records[0], "adapterDiagnostics"),
  "partial diagnostics contain no key/source text and do not annotate normalized records");
const bothFailed = await rejectedValue(() => discoverEchoSources({ SMITHSONIAN_API_KEY: providerKeyFixture }, diagnosticQuery, {
  discoverLoc: async () => { throw new EchoSourceNetworkError("HTTP_FAILURE"); },
  discoverSmithsonian: async () => { throw new EchoSourceNetworkError("INVALID_JSON"); },
}));
pass(bothFailed?.code === "ECHO_SOURCES_UNAVAILABLE" && bothFailed.adapterDiagnostics.map((item) => item.error_code).join(",") === "HTTP_FAILURE,INVALID_JSON",
  "all configured adapter failures preserve their individual stable codes");
const rawProviderMessage = "response body contains private source text and a synthetic secret";
const boundedUnknownFailure = await rejectedValue(() => discoverEchoSources({}, diagnosticQuery, {
  discoverLoc: async () => { throw new Error(rawProviderMessage); },
}));
pass(boundedUnknownFailure?.adapterDiagnostics[0]?.error_code === "ADAPTER_FAILURE" &&
  !JSON.stringify(boundedUnknownFailure).includes(rawProviderMessage), "unclassified provider exceptions collapse without retaining their message");
const fixture = JSON.parse(readFileSync(new URL("../intake/fixtures/publish-accountability-without-systemic-failure.json", import.meta.url), "utf8"));
const intake = { id: "intake_synthetic_editorial", origin: "editor", submitted_url: fixture.request.submitted_url, submitted_at: fixture.request.submitted_at };
const government = "https://www.gao.gov/products/gao-26-100000";
const cited = `See ${government} and https://www.justice.gov/oig/reports/test. Ignore http://127.0.0.1/private and https://evil.gov.example.com/report.`;
pass(approvedPublicRecordHost("www.gao.gov"), "official government hostname accepted");
pass(!approvedPublicRecordHost("gao.gov.example.com"), "lookalike hostname rejected");
pass(primaryRecordLinks(cited, intake.submitted_url).length === MAX_PRIMARY_EXPANSIONS, "at most two linked public records selected");
pass(primaryRecordLinks(cited, intake.submitted_url)[0] === government, "link order is deterministic");
pass(!primaryRecordLinks(cited, intake.submitted_url).some((url) => url.includes("127.0.0.1") || url.includes("example.com")), "private and lookalike links are excluded");
const searchUrl = new URL(discoverySearchUrl("public procurement delays"));
pass(searchUrl.hostname === "api.gdeltproject.org" && searchUrl.searchParams.get("maxrecords") === String(SEARCH_RESULT_LIMIT), "search is fixed to one approved endpoint and ten results");
assert.throws(() => discoverySearchUrl("(a OR b)")); assertions++;
const searchResults = await searchPublicDiscovery("public procurement delays", { fetchImpl: async (_url, options) => {
  pass(options.redirect === "manual" && options.method === "GET", "search never follows redirects or writes");
  return new Response(JSON.stringify({ articles: [{ title: "Synthetic accountability lead", url: "https://example.org/story", seendate: "20261002000000" }, { title: "Duplicate", url: "https://example.org/story" }, { title: "Unsafe", url: "http://localhost/private" }] }), { headers: { "content-type": "application/json" } });
} });
pass(searchResults.length === 1 && searchResults[0].url === "https://example.org/story", "search metadata is URL-validated and deduplicated");
await assert.rejects(() => searchPublicDiscovery("public procurement delays", { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.org/redirect" } }) }), /unavailable/); assertions++;

const fetched = [];
const expansion = await expandPrimaryRecords({ text: cited, finalUrl: intake.submitted_url }, {}, {
  fetchImpl: async (url) => { fetched.push(url); return new Response("Synthetic official record with documented findings.", { headers: { "content-type": "text/plain" } }); },
});
pass(expansion.records.length === 2 && expansion.failures.length === 0, "two bounded public records retrieved");
pass(fetched.length === 2 && fetched.every((url) => url.startsWith("https://")), "no unbounded or insecure fetch");
const redirected = await expandPrimaryRecords({ text: government, finalUrl: intake.submitted_url }, {}, {
  fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.com/unapproved" } }),
});
pass(redirected.records.length === 0 && redirected.failures[0].code === "source_host_not_allowed", "off-scope redirect becomes an explicit nonfatal missing-source note");

const additional = { finalUrl: government, text: "Synthetic official record", truncated: false };
const messages = buildAnalysisMessages({ intake, source: { finalUrl: intake.submitted_url }, evidence: { text: cited, truncated: false }, additionalSources: [additional] });
pass(messages[1].content.includes('"source-2"') && messages[1].content.includes(government), "secondary source is separately identified to analysis");
pass(messages[1].content.includes("BEGIN UNTRUSTED SOURCE MATERIAL"), "source material remains untrusted prompt data");

const analysis = structuredClone(fixture.analysis);
analysis.intake_id = intake.id;
analysis.sources[0].source_id = "source-1";
analysis.claims.forEach((claim) => { claim.source_refs = ["source-1"]; });
analysis.sources.push({ source_id: "source-2", name: "Synthetic public record", url: government, source_type: "government", authority: "Official record for its own findings", recency: "Synthetic fixture", claims_supported: [analysis.claims[0].claim_id] });
analysis.claims[0].source_refs.push("source-2");
analysis.claim_source_relationships = analysis.claims.flatMap((claim) => claim.source_refs.map((sourceId) => ({ claim_id: claim.claim_id, source_id: sourceId, relation: sourceId === "source-2" ? "qualifies" : "supports", explanation: "Synthetic source is scoped to this exact claim." })));
analysis.proposed_sources.push({ name: "Synthetic public record", url: government });
analysis.proposed_body = [{ text: "The synthetic administration reprocessed 18,000 claims, according to the supplied records.", claim_refs: [analysis.claims[0].claim_id] }];
const env = { AI_MODEL: "synthetic", AI_GATEWAY_ID: "synthetic", AI: { run: async () => ({ response: analysis }) } };
const verified = await analyzeIntake({ intake, source: { finalUrl: intake.submitted_url }, evidence: { text: cited, truncated: false }, additionalSources: [additional], env });
pass(verified.claims[0].source_refs.includes("source-2"), "multi-source analysis retains claim-specific source ID");
pass(evidenceLedger(verified)[0].sources.length === 2, "ledger shows both claimed sources and their separate authority");
const proposal = draftZero(verified);
pass(proposal.state === "proposal" && proposal.paragraphs[0].sources.length === 2, "Draft 0 uses only cited, verified claim references");
const contradicted = structuredClone(verified);
contradicted.claim_source_relationships.find((item) => item.claim_id === contradicted.claims[0].claim_id && item.source_id === "source-2").relation = "contradicts";
pass(draftZero(contradicted).state === "withheld", "contradicted material cannot silently become Draft 0");
const contextOnly = structuredClone(verified);
contextOnly.claim_source_relationships.filter((item) => item.claim_id === contextOnly.claims[0].claim_id).forEach((item) => { item.relation = "context"; });
pass(draftZero(contextOnly).state === "withheld", "context links alone cannot support a factual Draft 0 sentence");
pass(!Object.hasOwn(proposal, "human_decision") && !Object.hasOwn(proposal, "published_at"), "Draft 0 carries no human or publication authority");
const changed = structuredClone(analysis);
changed.proposed_body[0].claim_refs = ["invented-claim"];
await assert.rejects(() => analyzeIntake({ intake, source: { finalUrl: intake.submitted_url }, evidence: { text: cited, truncated: false }, additionalSources: [additional], env: { ...env, AI: { run: async () => ({ response: changed }) } } }), (error) => error.code === "invalid_model_output");
assertions++;
pass(draftZero({ ...verified, recommendation: "hold" }).state === "withheld", "weak story withholds Draft 0");
pass(draftZero({ ...verified, recommendation: "reject" }).state === "withheld", "rejected story cannot receive Draft 0");

// One fully isolated Story File integration: URL -> queued intake -> bounded
// source expansion -> durable analysis/evidence -> derived Draft 0. Echo uses
// the existing synthetic contract only; it is not wired to the live UI/runtime.
class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    return { bind: (...values) => ({
      run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
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
const localDb = new LocalD1();
try {
  for (const file of ["0001_editorial_foundation.sql", "0002_admin_queue.sql", "0003_live_analysis.sql", "0004_watchdesk_runs.sql", "0005_echo_durable_contracts.sql", "0006_watchdesk_source_learning.sql"])
    localDb.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  pass(localDb.sqlite.prepare("SELECT value FROM sbns_meta WHERE key='schema_version'").get().value === "6", "isolated integration database is schema v6");
  localDb.sqlite.prepare(`INSERT INTO intakes (id,origin,submitted_url,submitted_at,status,analysis_status,created_at,updated_at)
    VALUES (?,?,?,?,'queued','queued',?,?)`).run(intake.id, intake.origin, intake.submitted_url, intake.submitted_at, AT, AT);
  localDb.sqlite.prepare(`INSERT INTO analysis_jobs (id,intake_id,job_type,state,created_at,updated_at)
    VALUES ('job_editorial',?,'intake_analysis','queued',?,?)`).run(intake.id, AT, AT);
  const message = { body: { schema_version: "1", job_id: "job_editorial", intake_id: intake.id }, acked: false, ack() { this.acked = true; }, retry() { throw new Error("Synthetic acceptance must not retry"); } };
  const processed = await processAnalysisMessage(message, { SBNS_DB: localDb }, {
    retrieveSource: async () => ({ finalUrl: intake.submitted_url, normalizedUrl: intake.submitted_url, text: `Synthetic reporting links ${government}`, title: "Synthetic report", truncated: false, extractionFormat: "text" }),
    retrievalOptions: { fetchImpl: async () => new Response("Synthetic official finding", { headers: { "content-type": "text/plain" } }) },
    analyzeIntake: async () => verified,
  });
  pass(processed.outcome === "complete" && message.acked, `synthetic submitted URL completes the existing analysis queue path (${processed.outcome}: ${processed.error?.code || "ok"})`);
  const sourceRows = localDb.sqlite.prepare("SELECT * FROM sources WHERE intake_id=? ORDER BY id").all(intake.id);
  pass(sourceRows.length === 2 && sourceRows.some((row) => row.url === government), "bounded primary record is a separate durable source");
  pass(localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM claim_sources WHERE intake_id=?").get(intake.id).n >= 2, "claim-specific evidence links survive D1 round trip");
  const saved = localDb.sqlite.prepare("SELECT raw_analysis_json FROM analyses WHERE intake_id=?").get(intake.id);
  const persistedAnalysis = JSON.parse(saved.raw_analysis_json);
  pass(persistedAnalysis.source_expansion.retrieved.length === 1 && evidenceLedger(persistedAnalysis)[0].sources.length === 2, "source expansion and evidence ledger remain attached to the same Story File");
  pass(draftZero(persistedAnalysis).state === "proposal" && localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM editorial_drafts").get().n === 0, "automatic Draft 0 is visible without saving or approving a human draft");
  const active = await listIntakes({ SBNS_DB: localDb }, { status: "active" });
  pass(active.some((row) => row.id === intake.id && row.status === "review_ready"), "ready story is present in Active");
  localDb.sqlite.prepare("UPDATE intakes SET status='rejected' WHERE id=?").run(intake.id);
  pass(!(await listIntakes({ SBNS_DB: localDb }, { status: "active" })).some((row) => row.id === intake.id), "rejected story leaves Active without deletion");
  pass((await listIntakes({ SBNS_DB: localDb }, { status: "rejected" })).some((row) => row.id === intake.id), "rejected story remains retrievable");
  pass(filterAssignments([{ id: intake.id, status: "rejected", submitted_url: intake.submitted_url }], { status: "active" }).length === 0, "client Active filter agrees with server-side status");
  const brief = syntheticBrief("synthetic:editorial-pipeline");
  const contemporary = sourceRows.find((row) => row.url === intake.submitted_url);
  brief.intakes[0].intakeId = intake.id;
  brief.evidenceSources[0] = { id: contemporary.id, intakeId: intake.id, canonicalId: contemporary.url, contentHash: contemporary.content_hash, confidence: "primary_record", provenance: "Synthetic local Story File" };
  brief.verifiedFacts[0].sourceIds = [contemporary.id];
  const candidate = syntheticCandidate();
  const present = candidate.sources.find((source) => source.sourceRole === "contemporary_evidence");
  present.intakeSourceId = contemporary.id;
  present.sourceIntakeId = intake.id;
  const negative = await orchestrateSyntheticEcho({ SBNS_DB: localDb }, { brief: { ...brief, issueKey: "synthetic:editorial-no-echo" }, candidates: [], runKey: "negative", requestedBy: "synthetic-editor", triggerType: "manual", at: AT });
  pass(negative.status === "NO_CULTURAL_ECHO_WARRANTED" && negative.readyCount === 0, "synthetic Echo-negative Story File completes successfully without candidate");
  const positive = await orchestrateSyntheticEcho({ SBNS_DB: localDb }, { brief, candidates: [candidate], runKey: "positive", requestedBy: "synthetic-editor", triggerType: "manual", at: "2026-10-01T12:00:01.000Z" });
  pass(positive.status === "READY" && positive.readyCount === 1, "existing Echo contract can accept a fully supplied synthetic candidate packet");
  pass(localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM echo_decisions").get().n === 0 && localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM publication_attempts").get().n === 0, "candidate readiness creates no human Echo decision or publication");
  const eligible = { ...persistedAnalysis, echo_eligible: true, echo_search_terms: ["institutional recordkeeping"],
    echo_issue: { institution: "Fictional Civic Water Office", jurisdiction: "Invented District",
      expectation: "Maintain a complete inspection register", accountability_question: "Was a routine duty documented?",
      mechanism: "Missing entries obscure routine oversight", affected_interests: ["Synthetic residents"] } };
  const catalog = normalizeLocResult({ id: "https://www.loc.gov/item/synthetic-echo/", title: "Invented catalog work",
    contributor_names: ["Imaginary author"], date: "1900", original_format: ["Book"] }, AT);
  const verifiedCatalog = { ...catalog, context: { status: "source_supported", originalContext: "An invented archive explains how a fictional office recorded its duties.",
    contextAuthority: "limited", basis: "Synthetic detailed collection record", creatorIntentStatus: "not_claimed" } };
  const analogy = { whatEchoes: "Both matters involve a documentation gap.", comparisonBreaks: "The institutions and outcomes differ.",
    remainsUncertain: "No shared cause is established.", temptedOverclaim: "The work predicted the present.",
    presentDayEvidence: "The synthetic current record documents the gap.", editorialValue: "Clarifies the limits of the comparison.",
    researchBurden: "low", mechanismMatch: "qualified", addsValue: true };
  const unresolvedCandidate = echoCandidateFromRecord({ record: verifiedCatalog, assessment: analogy, intakeSource: contemporary, at: AT });
  pass(unresolvedCandidate.gate.culturalProtocol === "unresolved" && unresolvedCandidate.rights[0].status === "unknown", "missing catalog protocol and rights clearance never become permissions");
  const reviewedCandidate = echoCandidateFromRecord({ record: { ...verifiedCatalog, culturalProtocol: { status: "none_identified" } },
    assessment: analogy, intakeSource: contemporary, at: AT });
  pass(reviewedCandidate.gate.culturalProtocol === "clear" && reviewedCandidate.rights[0].permittedUse.includes("no protected media"), "only an explicit no-protocol finding permits the candidate gate; reuse remains metadata-only");
  const runtime = await runEchoResearch({ SBNS_DB: localDb }, { intake, analysis: eligible, sources: sourceRows,
    runKey: "fixture-live-bridge", requestedBy: "system:analysis", triggerType: "review_ready", at: AT }, {
    discoverLoc: async () => [catalog], verifyDiscoveredContext: async () => verifiedCatalog, assessEchoAnalogy: async () => analogy,
  });
  pass(runtime.status === "NO_CULTURAL_ECHO_WARRANTED" && runtime.readyCount === 0 && runtime.adapterDiagnostics[0].outcome === "succeeded" &&
    runtime.adapterDiagnostics[1].outcome === "not_configured", "bounded live-adapter bridge truthfully completes no-echo and records optional provider state");
  pass(localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='echo.no_echo_warranted' AND entity_id=?").get(runtime.packetId).n === 1 &&
    localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='echo.research_failed' AND entity_id=?").get(intake.id).n === 0,
  "successful no-echo remains distinct from technical research failure");
  pass(localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM echo_decisions").get().n === 0 &&
    localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM publication_attempts").get().n === 0, "live research bridge grants no human or publication authority");
  localDb.sqlite.prepare("UPDATE intakes SET status='review_ready' WHERE id=?").run(intake.id);
  const latestAnalysis = localDb.sqlite.prepare("SELECT id FROM analyses WHERE intake_id=? ORDER BY created_at DESC LIMIT 1").get(intake.id);
  localDb.sqlite.prepare("UPDATE analyses SET raw_analysis_json=? WHERE id=?").run(JSON.stringify(eligible), latestAnalysis.id);
  const echoMessage = { body: { schema_version: "1", type: "echo_research", intake_id: intake.id,
    analysis_id: latestAnalysis.id, run_key: "synthetic-queue", trigger_type: "review_ready", requested_by: "system:analysis" },
    acked: false, ack() { this.acked = true; } };
  let invoked = 0;
  const queuedEcho = await processEchoMessage(echoMessage, { SBNS_DB: localDb }, { runEchoResearch: async () => { invoked++; return { status: "READY" }; } });
  pass(queuedEcho.outcome === "complete" && echoMessage.acked && invoked === 1, "distinct Echo queue message reaches bounded research path");
  const failedEcho = await processEchoMessage({ ...echoMessage, acked: false, ack() { this.acked = true; } },
    { SBNS_DB: localDb }, { runEchoResearch: (_env, request) => runEchoResearch({ SBNS_DB: localDb }, request, {
      discoverLoc: async () => { throw new EchoSourceNetworkError("TIMEOUT"); },
    }) });
  const failureAudit = localDb.sqlite.prepare("SELECT metadata_json FROM audit_events WHERE action='echo.research_failed' AND entity_type='intake' AND entity_id=? ORDER BY created_at DESC, id DESC LIMIT 1").get(intake.id);
  const failureMetadata = JSON.parse(failureAudit.metadata_json);
  pass(failedEcho.outcome === "failed" && failedEcho.code === "ECHO_SOURCES_UNAVAILABLE" && failedEcho.stage === "source_discovery" &&
    failureMetadata.analysis_id === latestAnalysis.id && failureMetadata.run_key === "synthetic-queue" &&
    failureMetadata.adapter_diagnostics[0].error_code === "TIMEOUT" && failureMetadata.adapter_diagnostics[1].outcome === "not_configured",
  "source discovery failure persists bounded per-adapter diagnostics with analysis and run correlation");
  pass(!failureAudit.metadata_json.includes(providerKeyFixture) && !failureAudit.metadata_json.includes(rawProviderMessage) &&
    !failureAudit.metadata_json.includes("Synthetic diagnostic artifact"), "Echo failure audit contains no secret, raw exception, or source text");
  const genericFailure = await processEchoMessage({ ...echoMessage, body: { ...echoMessage.body, run_key: "synthetic-unsafe" }, acked: false, ack() { this.acked = true; } },
    { SBNS_DB: localDb }, { runEchoResearch: async () => { const error = new Error("secret body: synthetic source payload"); error.code = "SECRET_KEY_VALUE"; throw error; } });
  const genericFailureAudit = localDb.sqlite.prepare("SELECT metadata_json FROM audit_events WHERE action='echo.research_failed' AND entity_type='intake' AND entity_id=? AND json_extract(metadata_json,'$.run_key')='synthetic-unsafe' ORDER BY created_at DESC, id DESC LIMIT 1").get(intake.id);
  pass(genericFailure.outcome === "failed" && JSON.parse(genericFailureAudit.metadata_json).code === "ECHO_FAILED" &&
    !genericFailureAudit.metadata_json.includes("secret body") && !genericFailureAudit.metadata_json.includes("synthetic source payload"),
  "unclassified runtime exception text is not stored in Echo audit metadata");
  pass(draftZero(eligible).state === "proposal" &&
    localDb.sqlite.prepare("SELECT state FROM analysis_jobs WHERE id='job_editorial'").get().state === "complete", "Echo failure cannot erase completed reporting analysis or Draft 0");
  const pinned = localDb.sqlite.prepare("SELECT id, editor_ready_assessment_id FROM echo_candidates WHERE packet_id=? AND state='editor_ready'").get(positive.packetId);
  const humanHandler = createAdminHandler({ authenticate: async () => ({ actorType: "editor", actorId: "synthetic-editor", email: "synthetic@example.test" }) });
  const decide = (assessmentId, key = "synthetic-feature") => humanHandler(new Request(`https://admin.example/api/admin/intakes/${intake.id}/echo/decision`, {
    method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ candidate_id: pinned.id, assessment_id: assessmentId, decision: "feature", rationale: "Synthetic editorial comparison only" }),
  }), { SBNS_DB: localDb });
  pass((await decide("echo_assessment_wrong", "bad-assessment")).status === 409, "human Echo endpoint rejects an assessment other than the pinned revision");
  const featured = await decide(pinned.editor_ready_assessment_id);
  pass(featured.status === 201 && (await featured.json()).decision.assessment_id === pinned.editor_ready_assessment_id,
    "human FEATURE records the exact reviewed assessment through the authenticated Story File route");
  pass(localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM echo_decisions").get().n === 1 &&
    localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM editorial_decisions").get().n === 0 &&
    localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM publication_attempts").get().n === 0,
  "FEATURE does not approve reporting or publish any story");
  pass((await getEchoPriorUse({ SBNS_DB: localDb }, candidate.canonicalArtifactId, "synthetic:different-issue")).status === "previously_featured",
    "prior-use lookup detects a human-featured artifact across issues");
  pass((await getEchoPriorUse({ SBNS_DB: localDb }, candidate.canonicalArtifactId, brief.issueKey)).status === "never_seen",
    "a partial retry does not count its own issue packet as prior use");
  const partialRuntime = await runEchoResearch({ SBNS_DB: localDb, SMITHSONIAN_API_KEY: providerKeyFixture }, {
    intake, analysis: { ...eligible, echo_issue: { ...eligible.echo_issue, mechanism: "A separate synthetic evidence snapshot for partial-provider verification" } },
    sources: sourceRows, runKey: "fixture-partial-provider", requestedBy: "system:analysis", triggerType: "review_ready", at: "2026-10-01T12:00:02.000Z",
  }, { discoverLoc: async () => { throw new EchoSourceNetworkError("NETWORK_FAILURE"); }, discoverSmithsonian: async () => [catalog],
    verifyDiscoveredContext: async () => verifiedCatalog, assessEchoAnalogy: async () => analogy });
  pass(partialRuntime.status === "NO_CULTURAL_ECHO_WARRANTED" && partialRuntime.adapterDiagnostics[0].error_code === "NETWORK_FAILURE" &&
    partialRuntime.adapterDiagnostics[1].result_count === 1, "partial provider failure does not stop successful records from the existing no-echo flow");
  pass(localDb.sqlite.prepare("PRAGMA foreign_key_check").all().length === 0, "isolated end-to-end database has zero FK violations");
} finally { localDb.close(); }

console.log(`Editorial production tests passed: ${assertions} offline assertions for bounded expansion, source-bound analysis, evidence, Draft 0, and human authority.`);
