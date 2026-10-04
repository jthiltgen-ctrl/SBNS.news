import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeIntake } from "../src/analyzer.js";
import { processAnalysisMessage } from "../src/analysis-index.js";
import { attachAnalysisFailureDiagnostics } from "../src/analysis-diagnostics.js";
import { analysisFailureFields } from "../public/admin-persistent/analysis-diagnostics.js";
import analysisSchema from "../intake/schemas/analysis.schema.json" with { type: "json" };

let assertions = 0;
function pass(value, message) { assert.ok(value, message); assertions += 1; }
async function fixture() { return JSON.parse(await readFile(new URL("../intake/fixtures/hold-insufficient-evidence.json", import.meta.url), "utf8")); }
function canonical(source, intake) {
  const analysis = structuredClone(source.analysis);
  analysis.intake_id = intake.id;
  analysis.submitted_url = intake.submitted_url;
  analysis.submitted_at = intake.submitted_at;
  analysis.intake_origin = intake.origin;
  analysis.sources = [{ source_id: "source-1", name: "Synthetic source", url: intake.submitted_url, source_type: "other", authority: "Synthetic fixture", recency: "Fixture", claims_supported: analysis.claims.map((claim) => claim.claim_id) }];
  analysis.claims.forEach((claim) => { claim.source_refs = ["source-1"]; });
  analysis.claim_source_relationships = analysis.claims.map((claim) => ({ claim_id: claim.claim_id, source_id: "source-1", relation: "supports", explanation: "Synthetic fixture relationship." }));
  analysis.source_conflicts.forEach((conflict) => { conflict.source_refs = ["source-1"]; });
  analysis.proposed_sources = [{ name: "Synthetic source", url: intake.submitted_url }];
  return analysis;
}
function environment(response, extra = {}) {
  return { AI_MODEL: "@cf/synthetic/test-model", AI_GATEWAY_ID: "gateway-synthetic-01", ...extra,
    AI: { run: async () => typeof response === "function" ? response() : response } };
}
async function failure(response, base, intake, extra) {
  let caught = null;
  try { await analyzeIntake({ intake, source: { finalUrl: intake.submitted_url }, evidence: { text: "SYNTHETIC_SOURCE_SENTINEL", truncated: false }, env: environment(response, extra) }); }
  catch (error) { caught = error; }
  assert.ok(caught, "Expected analyzer failure");
  assertions += 1;
  return caught;
}

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, " ").trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  first() { return Promise.resolve(this.db.first(this.sql, this.values)); }
  run() { return this.db.run(this.sql, this.values); }
}
class FailureDB {
  constructor(intake, job) { this.intake = intake; this.job = job; this.audit = []; }
  prepare(sql) { return new Statement(this, sql); }
  async batch(statements) { for (const statement of statements) await statement.run(); return []; }
  first(sql, values) {
    if (sql === "SELECT * FROM analysis_jobs WHERE id = ?") return this.job.id === values[0] ? { ...this.job } : null;
    if (sql === "SELECT * FROM intakes WHERE id = ?") return this.intake.id === values[0] ? { ...this.intake } : null;
    throw new Error(`Unhandled diagnostic-test SELECT: ${sql}`);
  }
  run(sql, values) {
    if (sql.startsWith("UPDATE analysis_jobs SET state='running'")) { this.job.state = "running"; this.job.attempt += 1; return { meta: { changes: 1 } }; }
    if (sql.startsWith("UPDATE intakes SET status='analyzing'")) { this.intake.status = "analyzing"; return { meta: { changes: 1 } }; }
    if (sql.startsWith("UPDATE analysis_jobs SET state='retrying'")) { this.job.state = "retrying"; this.job.last_error_code = values[0]; this.job.last_error_message = values[1]; return { meta: { changes: 1 } }; }
    if (sql.startsWith("UPDATE analysis_jobs SET state=?, completed_at=?")) { this.job.state = values[0]; this.job.last_error_code = values[2]; this.job.last_error_message = values[3]; this.job.completed_at = values[1]; return { meta: { changes: 1 } }; }
    if (sql.startsWith("UPDATE intakes SET status='failed'")) { this.intake.status = "failed"; return { meta: { changes: 1 } }; }
    if (sql.startsWith("INSERT INTO audit_events")) { this.audit.push({ id: values[0], actor_type: values[1], actor_id: values[2], action: values[3], entity_type: values[4], entity_id: values[5], metadata_json: values[6], created_at: values[7] }); return { meta: { changes: 1 } }; }
    throw new Error(`Unhandled diagnostic-test write: ${sql}`);
  }
}
function queueMessage(body, attempts = 1) { return { body, attempts, acked: false, retried: false, ack() { this.acked = true; }, retry() { this.retried = true; } }; }

const intake = { id: "intake_diagnostic_test", origin: "editor", submitted_url: "https://example.test/synthetic", submitted_at: "2026-10-03T12:00:00.000Z" };
const base = await fixture();
const valid = canonical(base, intake);

const malformedText = "SECRET_PROMPT_AND_SOURCE_SENTINEL not-json";
const malformed = await failure({ response: malformedText }, base, intake);
pass(malformed.code === "invalid_model_output" && malformed.safeMessage === "Analyzer returned invalid structured output.", "non-JSON retains the existing broad code and editor-safe message");
pass(malformed.substage === "response_not_json" && malformed.diagnostics.validation_phase === "response", "non-JSON has a distinct response substage");
pass(malformed.diagnostics.json_structure.character_length === malformedText.length && malformed.diagnostics.json_structure.begins_with === "other" && malformed.diagnostics.json_structure.ends_with === "other", "unparsable response retains only bounded structural categories");
pass(!JSON.stringify(malformed.diagnostics).includes(malformedText) && !JSON.stringify(malformed.diagnostics).includes("SYNTHETIC_SOURCE_SENTINEL"), "raw model response and source material do not enter diagnostics");
pass(malformed.diagnostics.response_wrapper === "response" && malformed.diagnostics.response_top_level_type === "object" && malformed.diagnostics.response_content_length === malformedText.length, "provider wrapper/type/length are recorded without response content");

const noObject = await failure({ response: null }, base, intake);
pass(noObject.substage === "response_not_object" && noObject.safeMessage === "Analyzer returned invalid structured output.", "missing structured object is distinct and preserves safe message");

const invalidSchema = { ...structuredClone(valid), recommendation: "invented recommendation" };
const schemaFailure = await failure({ response: invalidSchema, usage: { output_tokens: 129 }, finish_reason: "length", request_id: "req-synthetic-7" }, base, intake);
pass(schemaFailure.substage === "schema_validation_failed" && schemaFailure.diagnostics.validation_phase === "schema", "schema validation has its own substage and phase");
pass(schemaFailure.diagnostics.validator_path === "analysis.recommendation" && schemaFailure.diagnostics.validator_reason_code === "invalid_enum" && schemaFailure.diagnostics.validator_detail.length <= 220, "schema diagnostic retains a bounded safe validator path/reason");
pass(schemaFailure.diagnostics.finish_reason === "length" && schemaFailure.diagnostics.completion_state === "limit_reached" && schemaFailure.diagnostics.output_tokens === 129 && schemaFailure.diagnostics.request_id === "req-synthetic-7", "available finish/token/request metadata is captured without inference");

for (const [field, value] of [["claims", { malformed: true }], ["source_conflicts", "not-an-array"], ["proposed_sources", { malformed: true }]]) {
  const malformedField = structuredClone(valid);
  malformedField[field] = value;
  const fieldFailure = await failure({ response: malformedField }, base, intake);
  pass(fieldFailure.code === "invalid_model_output" && fieldFailure.substage === "schema_validation_failed", `${field} with an invalid container type fails through schema validation`);
  pass(fieldFailure.diagnostics.validation_phase === "schema" && fieldFailure.diagnostics.validator_path === `analysis.${field}` && fieldFailure.diagnostics.validator_reason_code === "expected_type" && fieldFailure.diagnostics.validator_detail.length <= 220,
    `${field} failure reports a bounded schema path and reason`);
  pass(!(fieldFailure instanceof TypeError) && !/TypeError/.test(String(fieldFailure.message)), `${field} failure does not expose a raw TypeError`);
}

const invalidRelation = structuredClone(valid);
invalidRelation.claim_source_relationships = [];
const semanticFailure = await failure({ response: invalidRelation }, base, intake);
pass(semanticFailure.substage === "semantic_validation_failed" && semanticFailure.diagnostics.validator_reason_code === "relationship_missing" && semanticFailure.diagnostics.validation_phase === "semantics", "semantic relationship failures remain rejected with bounded reason");

const mismatched = { ...structuredClone(valid), intake_id: "intake_other" };
const metadataFailure = await failure({ response: mismatched }, base, intake);
pass(metadataFailure.substage === "intake_metadata_mismatch" && metadataFailure.diagnostics.validation_phase === "metadata", "intake identity mismatch is distinct");

const unavailable = await failure(() => { const error = new Error("SECRET_KEY article prompt source body"); error.request_id = "req-unavailable-1"; throw error; }, base, intake);
pass(unavailable.code === "model_unavailable" && unavailable.retryable === true && unavailable.substage === "model_unavailable", "model-unavailable classification remains retryable");
pass(unavailable.diagnostics.request_id === "req-unavailable-1" && !JSON.stringify(unavailable.diagnostics).includes("SECRET_KEY") && !JSON.stringify(unavailable.diagnostics).includes("article prompt source body"), "provider exception contributes only a safe correlation ID, never its message");

const configFailure = await failure({ response: valid }, base, intake, { AI_MAX_TOKENS: "99999" });
pass(configFailure.code === "analysis_configuration" && configFailure.substage === "analysis_configuration", "invalid configuration is separately identified without changing policy");

const job = { id: "job_diagnostic_test", intake_id: intake.id, state: "queued", attempt: 0 };
const db = new FailureDB({ ...intake, status: "queued", analysis_status: "queued" }, { ...job });
const message = queueMessage({ schema_version: "1", type: "intake_analysis", job_id: job.id, intake_id: intake.id });
const result = await processAnalysisMessage(message, { SBNS_DB: db }, {
  retrieveSource: async () => ({ finalUrl: intake.submitted_url, normalizedUrl: intake.submitted_url, title: "Synthetic", text: "SYNTHETIC_SOURCE_SENTINEL", truncated: false, extractionFormat: "text" }),
  expandPrimaryRecords: async () => ({ records: [], attempted: [], failures: [] }),
  analyzeIntake: async () => { throw malformed; },
});
pass(result.outcome === "failed" && message.acked && !message.retried && db.job.state === "failed", "nonretryable failure keeps the existing fail/ack behavior");
const persistedEvent = db.audit.find((event) => event.action === "analysis.failed");
const persistedMetadata = JSON.parse(persistedEvent.metadata_json);
pass(persistedMetadata.job_id === job.id && persistedMetadata.diagnostics.substage === "response_not_json" && persistedMetadata.diagnostics.attempt === 1, "failure diagnostics persist atomically in existing audit metadata with job/attempt identity");
pass(db.job.last_error_message === "Analyzer returned invalid structured output." && !persistedEvent.metadata_json.includes(malformedText) && !persistedEvent.metadata_json.includes("SYNTHETIC_SOURCE_SENTINEL"), "persisted safe message remains distinct and audit excludes response/source text");

const retryDb = new FailureDB({ ...intake, status: "queued", analysis_status: "queued" }, { ...job, id: "job_retry_diagnostic", state: "queued", attempt: 0 });
const retryMessage = queueMessage({ schema_version: "1", type: "intake_analysis", job_id: retryDb.job.id, intake_id: intake.id });
const retryOutcome = await processAnalysisMessage(retryMessage, { SBNS_DB: retryDb, ...environment(() => { const error = new Error("secret-like provider text"); error.request_id = "req-retry-safe"; throw error; }) }, {
  retrieveSource: async () => ({ finalUrl: intake.submitted_url, normalizedUrl: intake.submitted_url, title: "Synthetic", text: "SYNTHETIC_SOURCE_SENTINEL", truncated: false, extractionFormat: "text" }),
  expandPrimaryRecords: async () => ({ records: [], attempted: [], failures: [] }),
});
const retryMetadata = JSON.parse(retryDb.audit.find((event) => event.action === "analysis.retrying").metadata_json);
pass(retryOutcome.outcome === "retry" && retryMessage.retried && !retryMessage.acked && retryDb.job.state === "retrying", "model-unavailable processing preserves the existing queue retry behavior");
pass(retryMetadata.diagnostics.substage === "model_unavailable" && retryMetadata.diagnostics.retryable === true && retryMetadata.diagnostics.request_id === "req-retry-safe", "retryable model failure diagnostics are audited without provider exception text");

const lineageAudit = [...db.audit, { action: "analysis.retry_requested", metadata_json: JSON.stringify({ job_id: job.id, retry_of_job_id: "job_prior" }), created_at: "2026-10-03T12:02:00.000Z" }];
const attached = attachAnalysisFailureDiagnostics([db.job], lineageAudit);
pass(attached[0].failure_diagnostics.validator_detail === null && attached[0].failure_diagnostics.job_id === job.id, "authenticated detail mapping attaches only bounded diagnostics to the matching job");
const fields = analysisFailureFields({ ...attached[0], retry_of_job_id: "job_prior", state: "failed" });
pass(fields.some(([label, value]) => label === "Job ID" && value === job.id) && fields.some(([label, value]) => label === "Retry of" && value === "job_prior") && fields.some(([label, value]) => label === "Failure substage" && value === "response_not_json"), "admin formatter renders job lineage and stable failure information");
pass(analysisFailureFields({ state: "queued", id: "job_pending" }).length === 0, "admin formatter omits diagnostics for nonfailed jobs and handles missing fields");
const adminJs = await readFile(new URL("../public/admin-persistent/admin.js", import.meta.url), "utf8");
pass(adminJs.includes("analysisFailureFields(job)") && adminJs.includes("diagnostics.append(el(\"h3\", \"Analysis failure diagnostics\")") && adminJs.includes("node.textContent = String(value)") && !/\.innerHTML\s*=/.test(adminJs), "diagnostic fields enter the authenticated UI through textContent, not HTML parsing");

console.log(`Analysis diagnostic tests passed: ${assertions} assertions covering response stages, provider metadata, privacy, audit persistence, lineage, and safe admin rendering.`);
