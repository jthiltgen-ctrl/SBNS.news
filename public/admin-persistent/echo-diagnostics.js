const ADAPTER_NAMES = Object.freeze({ loc: "Library of Congress", smithsonian: "Smithsonian" });
const ADAPTER_OUTCOMES = new Set(["succeeded", "failed", "not_configured"]);
const ADAPTER_CODES = new Set([
  "TIMEOUT", "NETWORK_FAILURE", "MALFORMED_RESPONSE", "REDIRECT_REJECTED", "RATE_LIMITED", "HTTP_FAILURE",
  "NON_JSON_RESPONSE", "RESPONSE_TOO_LARGE", "INVALID_JSON", "INVALID_QUERY", "API_KEY_REQUIRED", "MISSING_API_KEY",
  "INVALID_RESPONSE", "INVALID_RESULTS", "INVALID_OPTIONS", "INVALID_FETCH", "INVALID_TIMEOUT", "INVALID_RESPONSE_LIMIT",
  "INVALID_RECORD_ID", "UNAPPROVED_ENDPOINT", "INVALID_RECORD", "CONTEXT_NOT_VERIFIED", "IDENTITY_MISMATCH", "ADAPTER_FAILURE",
]);
const FAILURE_CODES = new Set([
  "ECHO_SOURCES_UNAVAILABLE", "ECHO_FAILED", "ECHO_NOT_ELIGIBLE", "ECHO_VERIFIED_FACT_REQUIRED", "ECHO_MODEL_UNAVAILABLE",
  "ECHO_INVALID_ASSESSMENT", "ECHO_CONTEXT_NOT_VERIFIED", "ACTIVE_JOB", "DUPLICATE", "FACT_SOURCE_REQUIRED", "FIELD_TOO_LONG",
  "INVALID_ENUM", "INVALID_HASH", "INVALID_INTAKE_REFERENCE", "INVALID_ISSUE_KEY", "INVALID_JSON", "INVALID_LIST",
  "INVALID_SCHEMA", "INVALID_SHAPE", "INVALID_TEXT", "INVALID_URL", "LIST_TOO_LONG", "MISSING_FIELD", "PRIMARY_INTAKE_REQUIRED",
  "REPLAY_CONFLICT", "RETRY_INPUT_MISMATCH", "RIGHTS_SOURCE_MISSING", "ROLE_FIELD_MISMATCH", "SOURCE_IDENTITY_REQUIRED",
  "SOURCE_INTAKE_MISMATCH", "STALE_PACKET", "UNKNOWN_FIELD", "UNRESOLVED_CANDIDATES", "VERIFIED_FACT_REQUIRED",
]);

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function identifier(value, pattern, maxLength) {
  return typeof value === "string" && value.length <= maxLength && pattern.test(value) ? value : null;
}

export function echoFailureFields(event) {
  if (event?.action !== "echo.research_failed") return [];
  const metadata = safeJson(event.metadata_json);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const fields = [
    ["Top-level code", FAILURE_CODES.has(metadata.code) ? metadata.code : "ECHO_FAILED"],
    ["Stage", metadata.stage === "source_discovery" ? "source_discovery" : "research"],
    ["Analysis ID", identifier(metadata.analysis_id, /^analysis_[A-Za-z0-9_-]+$/, 120)],
    ["Run key", identifier(metadata.run_key, /^[A-Za-z0-9:_.-]+$/, 200)],
  ];
  const diagnostics = Array.isArray(metadata.adapter_diagnostics) ? metadata.adapter_diagnostics.slice(0, 2) : [];
  for (const item of diagnostics) {
    if (!item || !Object.hasOwn(ADAPTER_NAMES, item.adapter) || !ADAPTER_OUTCOMES.has(item.outcome) ||
        typeof item.configured !== "boolean" || typeof item.attempted !== "boolean") continue;
    const prefix = `Adapter: ${ADAPTER_NAMES[item.adapter]}`;
    fields.push([`${prefix} configured`, item.configured ? "Yes" : "No"]);
    fields.push([`${prefix} attempted`, item.attempted ? "Yes" : "No"]);
    fields.push([`${prefix} outcome`, item.outcome]);
    if (ADAPTER_CODES.has(item.error_code)) fields.push([`${prefix} error code`, item.error_code]);
    if (Number.isInteger(item.result_count) && item.result_count >= 0 && item.result_count <= 10)
      fields.push([`${prefix} result count`, String(item.result_count)]);
    if (Number.isInteger(item.duration_ms) && item.duration_ms >= 0 && item.duration_ms <= 60_000)
      fields.push([`${prefix} duration (ms)`, String(item.duration_ms)]);
  }
  return fields;
}
