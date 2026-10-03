const SUBSTAGES = new Set([
  "response_not_json", "response_not_object", "schema_validation_failed",
  "semantic_validation_failed", "intake_metadata_mismatch", "invented_source_reference",
  "model_unavailable", "analysis_configuration", "qualification_validation_failed",
]);
const VALIDATION_PHASES = new Set(["response", "schema", "semantics", "metadata", "source_references", "qualification", "model", "configuration"]);
const TYPE_NAMES = new Set(["null", "array", "object", "string", "number", "boolean", "undefined"]);
const WRAPPERS = new Set(["direct_object", "response", "result.response", "string", "absent_or_other"]);
const STRUCTURE_CATEGORIES = new Set(["open_brace", "open_bracket", "close_brace", "close_bracket", "other", "empty"]);

function boundedInteger(value, max = 1_000_000) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, max) : null;
}

function safeIdentifier(value, max = 120) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && /^[A-Za-z0-9@._:/-]+$/.test(trimmed) ? trimmed : null;
}

function finishReason(value) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return ["stop", "end_turn", "stop_sequence", "eos", "completed", "complete", "length", "max_tokens", "max_output_tokens", "token_limit", "output_limit", "incomplete", "content_filter", "tool_calls"].includes(normalized) ? normalized : null;
}

export function classifyFinishState(reason, incomplete) {
  const normalized = finishReason(reason);
  if (normalized && ["length", "max_tokens", "max_output_tokens", "token_limit", "output_limit"].includes(normalized)) return "limit_reached";
  if (normalized === "incomplete" || incomplete === true || (incomplete && typeof incomplete === "object")) return "incomplete";
  if (normalized) return "normal";
  return null;
}

function validatorReason(message) {
  const text = String(message || "").toLowerCase();
  if (/source reference was not supplied/.test(text)) return ["source_reference_not_supplied", "source reference was not supplied to the analyzer"];
  if (/missing required property/.test(text)) return ["missing_required_property", "missing required property"];
  if (/unexpected property/.test(text)) return ["unexpected_property", "unexpected property"];
  if (/expected type/.test(text)) return ["expected_type", "expected value type"];
  if (/expected one of/.test(text)) return ["invalid_enum", "value is outside the allowed set"];
  if (/must be a valid http/.test(text)) return ["invalid_url", "expected a valid HTTP(S) URL"];
  if (/must be an iso/.test(text)) return ["invalid_timestamp", "expected an ISO-8601 UTC timestamp"];
  if (/does not match required pattern/.test(text)) return ["pattern_mismatch", "value does not match the required pattern"];
  if (/must contain at least/.test(text)) return ["minimum_length_or_items", "value is shorter or smaller than required"];
  if (/nonexistent claim or source/.test(text)) return ["relationship_reference_invalid", "relationship references a missing claim or source"];
  if (/relation must match a claim\/source link/.test(text)) return ["relationship_link_mismatch", "relationship does not match a claim/source link"];
  if (/duplicate claim\/source relation/.test(text)) return ["duplicate_relationship", "duplicate claim/source relationship"];
  if (/every linked source needs a relation/.test(text)) return ["relationship_missing", "every linked source requires a relation"];
  if (/submitted_url/.test(text)) return ["submitted_url_mismatch", "submitted URL does not match the intake"];
  if (/submitted_at/.test(text)) return ["submitted_at_mismatch", "submission time does not match the intake"];
  if (/schema_version/.test(text)) return ["schema_version_mismatch", "schema version does not match the intake contract"];
  if (/qualification/.test(text)) return ["qualification_required", "required qualification is missing"];
  return ["validation_failed", "analysis did not satisfy the validation contract"];
}

export function sanitizeValidatorDetail(message, phase) {
  const safePhase = VALIDATION_PHASES.has(phase) ? phase : "semantics";
  const raw = String(message || "");
  const match = raw.match(/^((?:analysis|fixture)(?:\.[A-Za-z0-9_]+|\[\d+\])*)\s*:\s*/);
  let path = match?.[1] || "analysis";
  if (path.startsWith("fixture")) {
    const lowered = raw.toLowerCase();
    path = lowered.includes("submitted_url") ? "analysis.submitted_url"
      : lowered.includes("submitted_at") ? "analysis.submitted_at"
        : lowered.includes("schema_version") ? "analysis.schema_version" : "analysis";
  }
  if (!/^(?:analysis)(?:\.[A-Za-z0-9_]+|\[\d+\])*$/.test(path)) path = "analysis";
  const [reasonCode, reason] = validatorReason(raw);
  return { validation_phase: safePhase, validator_path: path.slice(0, 120), validator_reason_code: reasonCode, validator_detail: `${path}: ${reason}`.slice(0, 220) };
}

export function sanitizeAnalysisFailureDiagnostic(input, context = {}) {
  const source = input && typeof input === "object" ? input : {};
  const substage = SUBSTAGES.has(source.substage) ? source.substage
    : SUBSTAGES.has(context.substage) ? context.substage
    : safeIdentifier(context.errorCode, 80) || "analysis_failure";
  const phase = VALIDATION_PHASES.has(source.validation_phase) ? source.validation_phase : null;
  const output = {
    version: 1,
    job_id: safeIdentifier(context.jobId, 160),
    substage,
    retryable: context.retryable === true,
    attempt: boundedInteger(context.attempt, 1000),
    failed_at: typeof context.failedAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(context.failedAt) ? context.failedAt.slice(0, 40) : null,
    model: safeIdentifier(source.model, 120),
    gateway_id: safeIdentifier(source.gateway_id, 120),
    request_id: safeIdentifier(source.request_id, 120),
    finish_reason: finishReason(source.finish_reason),
    completion_state: ["normal", "limit_reached", "incomplete"].includes(source.completion_state) ? source.completion_state : null,
    output_tokens: boundedInteger(source.output_tokens),
    response_content_length: boundedInteger(source.response_content_length),
    response_top_level_type: TYPE_NAMES.has(source.response_top_level_type) ? source.response_top_level_type : null,
    response_wrapper: WRAPPERS.has(source.response_wrapper) ? source.response_wrapper : null,
    validation_phase: phase,
    validator_path: null,
    validator_reason_code: null,
    validator_detail: null,
    json_structure: null,
  };
  if (phase && typeof source.validator_detail === "string" && source.validator_detail.length) Object.assign(output, sanitizeValidatorDetail(source.validator_detail, phase));
  if (source.json_structure && typeof source.json_structure === "object") {
    output.json_structure = {
      character_length: boundedInteger(source.json_structure.character_length),
      begins_with: STRUCTURE_CATEGORIES.has(source.json_structure.begins_with) ? source.json_structure.begins_with : null,
      ends_with: STRUCTURE_CATEGORIES.has(source.json_structure.ends_with) ? source.json_structure.ends_with : null,
    };
  }
  return output;
}

function eventMetadata(event) {
  try { return JSON.parse(event?.metadata_json || "{}"); } catch { return {}; }
}

export function attachAnalysisFailureDiagnostics(jobs, audit) {
  const jobRows = Array.isArray(jobs) ? jobs : [];
  const auditRows = Array.isArray(audit) ? audit : [];
  return jobRows.map((job) => {
    let failureEvent = null;
    let retryEvent = null;
    for (const event of auditRows) {
      const metadata = eventMetadata(event);
      if (metadata.job_id !== job.id) continue;
      if (["analysis.failed", "analysis.retrying", "analysis.dead_lettered"].includes(event.action) && metadata.diagnostics) failureEvent = { event, metadata };
      if (event.action === "analysis.retry_requested" && safeIdentifier(metadata.retry_of_job_id, 160)) retryEvent = metadata;
    }
    return {
      ...job,
      retry_of_job_id: retryEvent ? safeIdentifier(retryEvent.retry_of_job_id, 160) : null,
      failure_diagnostics: failureEvent
        ? sanitizeAnalysisFailureDiagnostic(failureEvent.metadata.diagnostics, {
          jobId: job.id,
          errorCode: failureEvent.metadata.error_code,
          retryable: failureEvent.metadata.diagnostics.retryable,
          attempt: failureEvent.metadata.diagnostics.attempt,
          failedAt: failureEvent.metadata.diagnostics.failed_at || failureEvent.event.created_at,
        })
        : null,
    };
  });
}
