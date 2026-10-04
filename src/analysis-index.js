import { analyzeIntake } from "./analyzer.js";
import {
  claimAnalysisJob, completeAnalysis, getAnalysisJob, getIntake, getIntakeDetail, insertAuditEvent,
  markAnalysisFailed, markAnalysisRetrying, markIntakeAnalyzing,
} from "./persistence.js";
import { AnalysisFailure, retrieveSource, sha256 } from "./source-retrieval.js";
import { expandPrimaryRecords } from "./primary-source-expansion.js";
import { echoEligible, runEchoResearch } from "./echo-runtime.js";
import { sanitizeAnalysisFailureDiagnostic } from "./analysis-diagnostics.js";

const MAIN_QUEUE = "sbns-analysis-staging";
const DLQ = "sbns-analysis-dlq-staging";

function timestamp() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function validMessage(body) { return body && body.schema_version === "1" && (body.type === undefined || body.type === "intake_analysis") && typeof body.job_id === "string" && body.job_id.startsWith("job_") && typeof body.intake_id === "string" && body.intake_id.startsWith("intake_"); }
function safeError(error) {
  if (error instanceof AnalysisFailure) return error;
  return new AnalysisFailure("transient_internal", "Transient analysis failure.", { retryable: true, safeMessage: "Analysis temporarily failed." });
}
function log(event, fields) { console.log(JSON.stringify({ event, ...fields })); }
async function echoAudit(env, intakeId, action, metadata) {
  try { await insertAuditEvent(env, { id: id("audit"), actor_type: "system", actor_id: null, action,
    entity_type: "intake", entity_id: intakeId, metadata_json: JSON.stringify(metadata), created_at: timestamp() }); }
  catch { log("echo_audit_write_failed", { intake_id: intakeId, action }); }
}

const ECHO_FAILURE_STAGES = new Set(["source_discovery", "research"]);
const ECHO_ADAPTERS = new Set(["loc", "smithsonian"]);
const ECHO_ADAPTER_OUTCOMES = new Set(["succeeded", "failed", "not_configured"]);
const ECHO_FAILURE_CODES = new Set([
  "ECHO_SOURCES_UNAVAILABLE", "ECHO_FAILED", "ECHO_NOT_ELIGIBLE", "ECHO_VERIFIED_FACT_REQUIRED", "ECHO_MODEL_UNAVAILABLE",
  "ECHO_INVALID_ASSESSMENT", "ECHO_CONTEXT_NOT_VERIFIED", "ACTIVE_JOB", "DUPLICATE", "FACT_SOURCE_REQUIRED", "FIELD_TOO_LONG",
  "INVALID_ENUM", "INVALID_HASH", "INVALID_INTAKE_REFERENCE", "INVALID_ISSUE_KEY", "INVALID_JSON", "INVALID_LIST",
  "INVALID_SCHEMA", "INVALID_SHAPE", "INVALID_TEXT", "INVALID_URL", "LIST_TOO_LONG", "MISSING_FIELD", "PRIMARY_INTAKE_REQUIRED",
  "REPLAY_CONFLICT", "RETRY_INPUT_MISMATCH", "RIGHTS_SOURCE_MISSING", "ROLE_FIELD_MISMATCH", "SOURCE_IDENTITY_REQUIRED",
  "SOURCE_INTAKE_MISMATCH", "STALE_PACKET", "UNKNOWN_FIELD", "UNRESOLVED_CANDIDATES", "VERIFIED_FACT_REQUIRED",
]);
const ECHO_ADAPTER_CODES = new Set([
  "TIMEOUT", "NETWORK_FAILURE", "MALFORMED_RESPONSE", "REDIRECT_REJECTED", "RATE_LIMITED", "HTTP_FAILURE",
  "NON_JSON_RESPONSE", "RESPONSE_TOO_LARGE", "INVALID_JSON", "INVALID_QUERY", "API_KEY_REQUIRED", "MISSING_API_KEY",
  "INVALID_RESPONSE", "INVALID_RESULTS", "INVALID_OPTIONS", "INVALID_FETCH", "INVALID_TIMEOUT", "INVALID_RESPONSE_LIMIT",
  "INVALID_RECORD_ID", "UNAPPROVED_ENDPOINT", "INVALID_RECORD", "CONTEXT_NOT_VERIFIED", "IDENTITY_MISMATCH", "ADAPTER_FAILURE",
]);
const SAFE_ECHO_MESSAGE_CODES = new Set([
  "ECHO_NOT_ELIGIBLE", "ECHO_VERIFIED_FACT_REQUIRED", "ECHO_MODEL_UNAVAILABLE", "ECHO_INVALID_ASSESSMENT", "ECHO_CONTEXT_NOT_VERIFIED",
]);

function safeEchoFailure(error) {
  const errorCode = ECHO_FAILURE_CODES.has(error?.code) ? error.code : null;
  const messageCode = SAFE_ECHO_MESSAGE_CODES.has(error?.message) ? error.message : null;
  const code = errorCode || messageCode || "ECHO_FAILED";
  const stage = ECHO_FAILURE_STAGES.has(error?.stage) ? error.stage : "research";
  return { code, stage, adapter_diagnostics: safeAdapterDiagnostics(error?.adapterDiagnostics) };
}

function safeAdapterDiagnostics(input) {
  return Array.isArray(input) ? input.slice(0, 2).flatMap((item) => {
    if (!item || !ECHO_ADAPTERS.has(item.adapter) || !ECHO_ADAPTER_OUTCOMES.has(item.outcome) ||
        typeof item.configured !== "boolean" || typeof item.attempted !== "boolean") return [];
    const validDuration = Number.isInteger(item.duration_ms) && item.duration_ms >= 0 && item.duration_ms <= 60_000;
    const validCount = Number.isInteger(item.result_count) && item.result_count >= 0 && item.result_count <= 10;
    return [{ adapter: item.adapter, configured: item.configured, attempted: item.attempted, outcome: item.outcome,
      error_code: ECHO_ADAPTER_CODES.has(item.error_code) ? item.error_code : null,
      result_count: validCount ? item.result_count : null, duration_ms: validDuration ? item.duration_ms : null }];
  }) : [];
}

function safeEchoRunKey(value) {
  return typeof value === "string" && value.length <= 200 && /^[A-Za-z0-9:_.-]+$/.test(value) ? value : null;
}

function safeEchoId(value, prefix) {
  return typeof value === "string" && value.length <= 120 && new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,110}$`).test(value) ? value : null;
}

export async function processAnalysisMessage(message, env, dependencies = {}) {
  if (!validMessage(message.body)) { message.ack(); return { outcome: "invalid_message" }; }
  const { job_id: jobId, intake_id: intakeId } = message.body;
  const retrieve = dependencies.retrieveSource ?? retrieveSource;
  const expand = dependencies.expandPrimaryRecords ?? expandPrimaryRecords;
  const analyze = dependencies.analyzeIntake ?? analyzeIntake;
  const job = await getAnalysisJob(env, jobId);
  if (!job || job.intake_id !== intakeId || ["complete", "dead_letter", "failed"].includes(job.state)) { message.ack(); return { outcome: "noop" }; }
  const startedAt = timestamp();
  if (!await claimAnalysisJob(env, jobId, intakeId, startedAt)) { message.ack(); return { outcome: "not_claimed" }; }
  await markIntakeAnalyzing(env, intakeId, startedAt);
  const intake = await getIntake(env, intakeId);
  if (!intake) { await markAnalysisFailed(env, jobId, intakeId, timestamp(), "missing_intake", "Intake no longer exists."); message.ack(); return { outcome: "failed" }; }
  try {
    const evidence = await retrieve(intake.submitted_url, env, dependencies.retrievalOptions);
    const expansion = await expand(evidence, env, dependencies.retrievalOptions);
    const materials = [evidence, ...expansion.records];
    const analysis = await analyze({ intake, source: { ...evidence, sourceId: "source-1" }, evidence, additionalSources: expansion.records, env });
    const sourceMap = new Map();
    const sources = await Promise.all(materials.map(async (material, index) => {
      const reference = `source-${index + 1}`;
      const linkedClaims = analysis.claims.filter((claim) => claim.material && claim.source_refs.includes(reference));
      const status = linkedClaims.some((claim) => claim.verification_status === "disputed") ? "disputed"
        : linkedClaims.length && linkedClaims.every((claim) => ["verified", "verified_with_qualification"].includes(claim.verification_status))
          ? linkedClaims.some((claim) => claim.verification_status === "verified_with_qualification") ? "verified_with_qualification" : "verified"
          : "unverified";
      const row = { id: id("source"), intake_id: intakeId, url: material.finalUrl, normalized_url: material.normalizedUrl, name: material.title || new URL(material.finalUrl).hostname,
        source_type: analysis.sources.find((item) => item.source_id === reference)?.source_type || "other", verification_status: status, fetched_at: timestamp(), content_hash: await sha256(material.text),
        source_title: material.title, extracted_text: material.text, extraction_format: material.extractionFormat === "markdown" ? "text" : material.extractionFormat, created_at: timestamp() };
      sourceMap.set(reference, row.id);
      return row;
    }));
    const analysisId = id("analysis");
    const claimMap = new Map(analysis.claims.map((claim) => [claim.claim_id, id("claim")]));
    const claims = analysis.claims.map((claim) => ({ id: claimMap.get(claim.claim_id), claim_text: claim.claim_text, material: claim.material, verification_status: claim.verification_status, qualification: claim.qualification }));
    const links = analysis.claims.flatMap((claim) => claim.source_refs.map((ref) => ({ claim_id: claimMap.get(claim.claim_id), source_id: sourceMap.get(ref) })).filter((link) => link.source_id));
    const completedAt = timestamp();
    await completeAnalysis(env, { intakeId, jobId, source: sources[0], sources, analysisRow: { id: analysisId, schema_version: analysis.schema_version, recommendation: analysis.recommendation, recommendation_confidence: analysis.recommendation_confidence, category: analysis.category, severity: analysis.severity, systemic_failure: analysis.systemic_failure, raw_analysis_json: JSON.stringify({ ...analysis, source_expansion: { attempted: expansion.attempted, retrieved: expansion.records.map((item) => item.finalUrl), failures: expansion.failures } }) }, claims, links, timestamp: completedAt });
    if (echoEligible(analysis)) {
      try {
        await env.ANALYSIS_QUEUE.send({ schema_version: "1", type: "echo_research", intake_id: intakeId, analysis_id: analysisId,
          run_key: `analysis:${analysisId}`, requested_by: "system:analysis", trigger_type: "review_ready" });
        await echoAudit(env, intakeId, "echo.research_queued", { analysis_id: analysisId });
        log("echo_research_queued", { intake_id: intakeId, analysis_id: analysisId });
      } catch { await echoAudit(env, intakeId, "echo.research_enqueue_failed", { analysis_id: analysisId }); log("echo_research_enqueue_failed", { intake_id: intakeId, analysis_id: analysisId }); }
    }
    message.ack(); log("analysis_completed", { job_id: jobId, intake_id: intakeId, recommendation: analysis.recommendation, attempt: job.attempt + 1 });
    return { outcome: "complete", analysis };
  } catch (caught) {
    const error = safeError(caught); const failedAt = timestamp();
    const attempt = Math.min(1000, Math.max(0, Number.isInteger(job.attempt) ? job.attempt + 1 : message.attempts ?? 0));
    const diagnostics = sanitizeAnalysisFailureDiagnostic(error.diagnostics, { jobId, errorCode: error.code, substage: error.substage, retryable: error.retryable, attempt, failedAt });
    if (error.retryable) { await markAnalysisRetrying(env, jobId, intakeId, failedAt, error.code, error.safeMessage, diagnostics); message.retry({ delaySeconds: Math.min(300, 2 ** Math.min(message.attempts ?? 1, 8)) }); log("analysis_retry", { job_id: jobId, intake_id: intakeId, error_code: error.code, substage: diagnostics.substage }); return { outcome: "retry", error }; }
    await markAnalysisFailed(env, jobId, intakeId, failedAt, error.code, error.safeMessage, "analysis.failed", "failed", diagnostics); message.ack(); log("analysis_failed", { job_id: jobId, intake_id: intakeId, error_code: error.code, substage: diagnostics.substage }); return { outcome: "failed", error };
  }
}

export async function processEchoMessage(message, env, dependencies = {}) {
  const body = message.body;
  if (!body || body.schema_version !== "1" || body.type !== "echo_research" ||
      !/^intake_[a-zA-Z0-9_-]+$/.test(body.intake_id || "") ||
      !/^analysis_[a-zA-Z0-9_-]+$/.test(body.analysis_id || "") ||
      typeof body.run_key !== "string" || body.run_key.length > 200 ||
      !["manual", "review_ready"].includes(body.trigger_type)) {
    message.ack(); return { outcome: "invalid_message" };
  }
  const detail = await getIntakeDetail(env, body.intake_id);
  const latest = detail?.analyses.at(-1);
  if (!latest || latest.id !== body.analysis_id || detail.intake.status !== "review_ready") { message.ack(); return { outcome: "stale" }; }
  let analysis;
  try { analysis = JSON.parse(latest.raw_analysis_json); } catch { message.ack(); return { outcome: "invalid_analysis" }; }
  if (!echoEligible(analysis)) { message.ack(); return { outcome: "ineligible" }; }
  try {
    const research = dependencies.runEchoResearch ?? runEchoResearch;
    const result = await research(env, { intake: detail.intake, analysis, sources: detail.sources,
      runKey: body.run_key, requestedBy: body.requested_by || "system:analysis", triggerType: body.trigger_type });
    message.ack(); log("echo_research_completed", { intake_id: safeEchoId(body.intake_id, "intake"), analysis_id: safeEchoId(body.analysis_id, "analysis"),
      run_key: safeEchoRunKey(body.run_key), status: result.status,
      adapter_diagnostics: safeAdapterDiagnostics(result?.adapterDiagnostics) });
    return { outcome: "complete", result };
  } catch (error) {
    // Optional cultural research cannot rewrite or block the completed story analysis.
    const failure = safeEchoFailure(error);
    const metadata = { analysis_id: safeEchoId(body.analysis_id, "analysis"), run_key: safeEchoRunKey(body.run_key), ...failure };
    await echoAudit(env, body.intake_id, "echo.research_failed", metadata);
    message.ack(); log("echo_research_failed", { intake_id: safeEchoId(body.intake_id, "intake"), analysis_id: metadata.analysis_id,
      run_key: metadata.run_key, ...failure });
    return { outcome: "failed", code: failure.code, stage: failure.stage };
  }
}

export async function processDeadLetterMessage(message, env) {
  if (message.body?.type === "echo_research") { message.ack(); return { outcome: "echo_dead_letter" }; }
  if (!validMessage(message.body)) { message.ack(); return { outcome: "invalid_message" }; }
  const job = await getAnalysisJob(env, message.body.job_id);
  if (!job || ["complete", "dead_letter"].includes(job.state)) { message.ack(); return { outcome: "noop" }; }
  await markAnalysisFailed(env, job.id, job.intake_id, timestamp(), job.last_error_code || "retry_exhausted", job.last_error_message || "Analysis retries were exhausted.", "analysis.dead_lettered", "dead_letter");
  message.ack(); log("analysis_dead_lettered", { job_id: job.id, intake_id: job.intake_id, attempt: job.attempt }); return { outcome: "dead_letter" };
}

export default {
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (batch.queue === DLQ) await processDeadLetterMessage(message, env);
      else if (batch.queue === MAIN_QUEUE && message.body?.type === "echo_research") await processEchoMessage(message, env);
      else if (batch.queue === MAIN_QUEUE) await processAnalysisMessage(message, env);
      else message.ack();
    }
  },
};
