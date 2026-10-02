import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { approvedPublicRecordHost, expandPrimaryRecords, primaryRecordLinks, MAX_PRIMARY_EXPANSIONS } from "../src/primary-source-expansion.js";
import { buildAnalysisMessages } from "../src/analysis-prompt.js";
import { analyzeIntake } from "../src/analyzer.js";
import { draftZero, evidenceLedger } from "../public/admin-persistent/editorial-production.js";
import { discoverySearchUrl, searchPublicDiscovery, SEARCH_RESULT_LIMIT } from "../src/editorial-search.js";
import { processAnalysisMessage } from "../src/analysis-index.js";
import { listIntakes } from "../src/persistence.js";
import { filterAssignments } from "../public/admin-persistent/desk-state.js";
import { orchestrateSyntheticEcho } from "../src/echo-orchestration.js";
import { syntheticBrief, syntheticCandidate, AT } from "../fixtures/echo/synthetic-fixtures.mjs";

let assertions = 0;
function pass(value, label) { assert.ok(value, label); assertions++; }
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
analysis.proposed_sources.push({ name: "Synthetic public record", url: government });
analysis.proposed_body = [{ text: "The synthetic administration reprocessed 18,000 claims, according to the supplied records.", claim_refs: [analysis.claims[0].claim_id] }];
const env = { AI_MODEL: "synthetic", AI_GATEWAY_ID: "synthetic", AI: { run: async () => ({ response: analysis }) } };
const verified = await analyzeIntake({ intake, source: { finalUrl: intake.submitted_url }, evidence: { text: cited, truncated: false }, additionalSources: [additional], env });
pass(verified.claims[0].source_refs.includes("source-2"), "multi-source analysis retains claim-specific source ID");
pass(evidenceLedger(verified)[0].sources.length === 2, "ledger shows both claimed sources and their separate authority");
const proposal = draftZero(verified);
pass(proposal.state === "proposal" && proposal.paragraphs[0].sources.length === 2, "Draft 0 uses only cited, verified claim references");
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
  const positive = await orchestrateSyntheticEcho({ SBNS_DB: localDb }, { brief, candidates: [candidate], runKey: "positive", requestedBy: "synthetic-editor", triggerType: "manual", at: AT });
  pass(positive.status === "READY" && positive.readyCount === 1, "existing Echo contract can accept a fully supplied synthetic candidate packet");
  pass(localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM echo_decisions").get().n === 0 && localDb.sqlite.prepare("SELECT COUNT(*) AS n FROM publication_attempts").get().n === 0, "candidate readiness creates no human Echo decision or publication");
  pass(localDb.sqlite.prepare("PRAGMA foreign_key_check").all().length === 0, "isolated end-to-end database has zero FK violations");
} finally { localDb.close(); }

console.log(`Editorial production tests passed: ${assertions} offline assertions for bounded expansion, source-bound analysis, evidence, Draft 0, and human authority.`);
