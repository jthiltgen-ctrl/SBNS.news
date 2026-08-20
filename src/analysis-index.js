import { analyzeIntake } from "./analyzer.js";
import {
  claimAnalysisJob, completeAnalysis, getAnalysisJob, getIntake,
  markAnalysisFailed, markAnalysisRetrying, markIntakeAnalyzing,
} from "./persistence.js";
import { AnalysisFailure, retrieveSource, sha256 } from "./source-retrieval.js";

const MAIN_QUEUE = "sbns-analysis-staging";
const DLQ = "sbns-analysis-dlq-staging";

function timestamp() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function validMessage(body) { return body && body.schema_version === "1" && typeof body.job_id === "string" && body.job_id.startsWith("job_") && typeof body.intake_id === "string" && body.intake_id.startsWith("intake_"); }
function safeError(error) {
  if (error instanceof AnalysisFailure) return error;
  return new AnalysisFailure("transient_internal", "Transient analysis failure.", { retryable: true, safeMessage: "Analysis temporarily failed." });
}
function log(event, fields) { console.log(JSON.stringify({ event, ...fields })); }

export async function processAnalysisMessage(message, env, dependencies = {}) {
  if (!validMessage(message.body)) { message.ack(); return { outcome: "invalid_message" }; }
  const { job_id: jobId, intake_id: intakeId } = message.body;
  const retrieve = dependencies.retrieveSource ?? retrieveSource;
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
    const source = { id: id("source"), intake_id: intakeId, url: evidence.finalUrl, normalized_url: evidence.normalizedUrl, name: evidence.title || new URL(evidence.finalUrl).hostname, source_type: "other", verification_status: "unverified", fetched_at: timestamp(), content_hash: await sha256(evidence.text), source_title: evidence.title, extracted_text: evidence.text, extraction_format: evidence.extractionFormat === "markdown" ? "text" : evidence.extractionFormat, created_at: timestamp() };
    const analysis = await analyze({ intake, source: { ...evidence, sourceId: "source-1" }, evidence, env });
    const analysisId = id("analysis");
    const claimMap = new Map(analysis.claims.map((claim) => [claim.claim_id, id("claim")]));
    const claims = analysis.claims.map((claim) => ({ id: claimMap.get(claim.claim_id), claim_text: claim.claim_text, material: claim.material, verification_status: claim.verification_status, qualification: claim.qualification }));
    const links = analysis.claims.flatMap((claim) => claim.source_refs.includes("source-1") ? [{ claim_id: claimMap.get(claim.claim_id) }] : []);
    const completedAt = timestamp();
    await completeAnalysis(env, { intakeId, jobId, source, analysisRow: { id: analysisId, schema_version: analysis.schema_version, recommendation: analysis.recommendation, recommendation_confidence: analysis.recommendation_confidence, category: analysis.category, severity: analysis.severity, systemic_failure: analysis.systemic_failure, raw_analysis_json: JSON.stringify(analysis) }, claims, links, timestamp: completedAt });
    message.ack(); log("analysis_completed", { job_id: jobId, intake_id: intakeId, recommendation: analysis.recommendation, attempt: job.attempt + 1 });
    return { outcome: "complete", analysis };
  } catch (caught) {
    const error = safeError(caught); const failedAt = timestamp();
    if (error.retryable) { await markAnalysisRetrying(env, jobId, intakeId, failedAt, error.code, error.safeMessage); message.retry({ delaySeconds: Math.min(300, 2 ** Math.min(message.attempts ?? 1, 8)) }); log("analysis_retry", { job_id: jobId, intake_id: intakeId, error_code: error.code }); return { outcome: "retry", error }; }
    await markAnalysisFailed(env, jobId, intakeId, failedAt, error.code, error.safeMessage); message.ack(); log("analysis_failed", { job_id: jobId, intake_id: intakeId, error_code: error.code }); return { outcome: "failed", error };
  }
}

export async function processDeadLetterMessage(message, env) {
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
      else if (batch.queue === MAIN_QUEUE) await processAnalysisMessage(message, env);
      else message.ack();
    }
  },
};
