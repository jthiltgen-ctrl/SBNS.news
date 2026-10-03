const SAFE_SUBSTAGES = new Set([
  "response_not_json", "response_not_object", "schema_validation_failed", "semantic_validation_failed",
  "intake_metadata_mismatch", "invented_source_reference", "model_unavailable", "analysis_configuration",
  "qualification_validation_failed",
]);

function safe(value, max = 220) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

export function analysisFailureFields(job) {
  if (!job || !["failed", "dead_letter", "retrying"].includes(job.state)) return [];
  const diagnostic = job.failure_diagnostics && typeof job.failure_diagnostics === "object" ? job.failure_diagnostics : {};
  const fields = [
    ["Job ID", safe(job.id, 160)],
    ["Retry of", safe(job.retry_of_job_id, 160)],
    ["Stable code", safe(job.last_error_code, 80)],
    ["Failure substage", SAFE_SUBSTAGES.has(diagnostic.substage) ? diagnostic.substage : null],
    ["Retryable", typeof diagnostic.retryable === "boolean" ? (diagnostic.retryable ? "Yes" : "No") : null],
    ["Attempt", Number.isInteger(job.attempt) && job.attempt >= 0 ? String(job.attempt) : null],
    ["Model", safe(diagnostic.model, 120)],
    ["Gateway", safe(diagnostic.gateway_id, 120)],
    ["Failed at", safe(diagnostic.failed_at, 40)],
    ["Validation phase", safe(diagnostic.validation_phase, 40)],
    ["Validator detail", safe(diagnostic.validator_detail, 220)],
    ["Finish reason", safe(diagnostic.finish_reason, 40)],
    ["Completion", safe(diagnostic.completion_state, 40)],
    ["Output tokens", Number.isInteger(diagnostic.output_tokens) ? String(diagnostic.output_tokens) : null],
    ["Response length", Number.isInteger(diagnostic.response_content_length) ? String(diagnostic.response_content_length) : null],
    ["Response wrapper", safe(diagnostic.response_wrapper, 40)],
    ["Correlation ID", safe(diagnostic.request_id, 120)],
  ];
  return fields.filter(([, value]) => value !== null);
}
