import analysisSchema from "../intake/schemas/analysis.schema.json" with { type: "json" };
import { buildAnalysisMessages } from "./analysis-prompt.js";
import { validateAnalysisSemantics, validateSchema } from "./intake-validation.js";
import { AnalysisFailure } from "./source-retrieval.js";
import { classifyFinishState, sanitizeValidatorDetail } from "./analysis-diagnostics.js";

const DEFAULT_MAX_TOKENS = 4096;
const MIN_MAX_TOKENS = 512;
const MAX_MAX_TOKENS = 8192;

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function parseJson(text, diagnostics) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); }
  catch {
    throw new AnalysisFailure("invalid_model_output", "Analyzer output was not raw JSON.", {
      safeMessage: "Analyzer returned invalid structured output.", substage: "response_not_json",
      diagnostics: { ...diagnostics, validation_phase: "response", json_structure: jsonStructure(text) },
    });
  }
}
function typeName(value) { return value === null ? "null" : Array.isArray(value) ? "array" : typeof value; }
function jsonStructure(text) {
  const trimmed = text.trim();
  const begins = trimmed[0]; const ends = trimmed.at(-1);
  const category = (char, start) => !char ? "empty" : start && char === "{" ? "open_brace" : start && char === "[" ? "open_bracket" : !start && char === "}" ? "close_brace" : !start && char === "]" ? "close_bracket" : "other";
  return { character_length: text.length, begins_with: category(begins, true), ends_with: category(ends, false) };
}
function safeOutputLength(value) {
  if (typeof value === "string") return Math.min(value.length, 1_000_000);
  try { const serialized = JSON.stringify(value); return typeof serialized === "string" ? Math.min(serialized.length, 1_000_000) : null; } catch { return null; }
}
function safeProviderId(value) { return typeof value === "string" && value.length <= 120 && /^[A-Za-z0-9@._:/-]+$/.test(value) ? value : null; }
function firstInteger(...values) { return values.find((value) => Number.isInteger(value) && value >= 0) ?? null; }
function providerMetadata(result, model, gatewayId) {
  const top = isRecord(result) ? result : {};
  const wrapped = Object.hasOwn(top, "response") || (isRecord(top.result) && Object.hasOwn(top.result, "response"));
  const metadata = [wrapped ? top : {}, wrapped && isRecord(top.result) ? top.result : {}, isRecord(top.response_metadata) ? top.response_metadata : {}];
  const usage = metadata.map((entry) => entry.usage).find(isRecord) || {};
  const finish = metadata.flatMap((entry) => [entry.finish_reason, entry.stop_reason, entry.finishReason]).find((value) => typeof value === "string")
    ?? (Array.isArray(top.choices) ? top.choices[0]?.finish_reason : null);
  const incomplete = metadata.some((entry) => entry.incomplete_details != null || entry.incomplete === true);
  const rawRequestId = metadata.flatMap((entry) => [entry.request_id, entry.requestId, entry.cf_ai_request_id, entry.correlation_id]).find((value) => typeof value === "string");
  return {
    model: safeProviderId(model), gateway_id: safeProviderId(gatewayId), request_id: safeProviderId(rawRequestId),
    finish_reason: finish && /^[A-Za-z0-9_-]{1,40}$/.test(finish) ? finish.toLowerCase() : null,
    completion_state: classifyFinishState(finish, incomplete),
    output_tokens: firstInteger(usage.output_tokens, usage.completion_tokens, top.output_tokens, top.completion_tokens),
    response_top_level_type: typeName(result),
  };
}
function normalizeModelResponse(result, metadata) {
  let value = result;
  let wrapper = "absent_or_other";
  if (isRecord(value) && Object.hasOwn(value, "response")) { value = value.response; wrapper = "response"; }
  else if (isRecord(value) && isRecord(value.result) && Object.hasOwn(value.result, "response")) { value = value.result.response; wrapper = "result.response"; }
  else if (typeof value === "string") wrapper = "string";
  else if (isRecord(value)) wrapper = "direct_object";
  const diagnostics = { ...metadata, response_wrapper: wrapper, response_content_length: safeOutputLength(value) };
  if (typeof value === "string") {
    const parsed = parseJson(value, diagnostics);
    if (isRecord(parsed)) return { analysis: parsed, diagnostics };
    throw new AnalysisFailure("invalid_model_output", "Analyzer response JSON was not an object.", {
      safeMessage: "Analyzer returned invalid structured output.", substage: "response_not_object",
      diagnostics: { ...diagnostics, validation_phase: "response" },
    });
  }
  if (isRecord(value)) return { analysis: value, diagnostics };
  throw new AnalysisFailure("invalid_model_output", "Analyzer returned no structured object.", {
    safeMessage: "Analyzer returned invalid structured output.", substage: "response_not_object",
    diagnostics: { ...diagnostics, validation_phase: "response" },
  });
}
function resolveMaxTokens(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_MAX_TOKENS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_MAX_TOKENS || parsed > MAX_MAX_TOKENS) throw new AnalysisFailure("analysis_configuration", `AI_MAX_TOKENS must be an integer from ${MIN_MAX_TOKENS} through ${MAX_MAX_TOKENS}.`, { safeMessage: "Analyzer configuration is invalid.", substage: "analysis_configuration" });
  return parsed;
}

export async function analyzeIntake({ intake, source, evidence, additionalSources = [], env }) {
  if (!env.AI_MODEL || !env.AI_GATEWAY_ID) throw new AnalysisFailure("analysis_configuration", "AI_MODEL and AI_GATEWAY_ID are required.", { safeMessage: "Analyzer configuration is incomplete.", substage: "analysis_configuration" });
  const maxTokens = resolveMaxTokens(env.AI_MAX_TOKENS);
  let result;
  try { result = await env.AI.run(env.AI_MODEL, { messages: buildAnalysisMessages({ intake, source, evidence, additionalSources }), response_format: { type: "json_schema", json_schema: analysisSchema }, max_tokens: maxTokens }, { gateway: { id: env.AI_GATEWAY_ID, skipCache: true } }); }
  catch (error) {
    const requestId = error && typeof error === "object" ? (error.request_id ?? error.requestId ?? error.cf_ai_request_id) : null;
    throw new AnalysisFailure("model_unavailable", "Workers AI request failed.", { retryable: true, safeMessage: "The analyzer is temporarily unavailable.", substage: "model_unavailable",
      diagnostics: { ...providerMetadata(null, env.AI_MODEL, env.AI_GATEWAY_ID), request_id: safeProviderId(requestId) } });
  }
  const normalized = normalizeModelResponse(result, providerMetadata(result, env.AI_MODEL, env.AI_GATEWAY_ID));
  const analysis = normalized.analysis;
  const responseDiagnostics = normalized.diagnostics;
  const allowedSources = new Map([["source-1", source.finalUrl], ...additionalSources.map((item, index) => [`source-${index + 2}`, item.finalUrl])]);
  const invalidSourceReference = Array.isArray(analysis?.sources) && analysis.sources.some((item) => allowedSources.get(item.source_id) !== item.url)
    ? "analysis.sources" : analysis.claims?.some((claim) => claim.source_refs?.some((ref) => !allowedSources.has(ref)))
      ? "analysis.claims" : analysis.source_conflicts?.some((conflict) => conflict.source_refs?.some((ref) => !allowedSources.has(ref)))
        ? "analysis.source_conflicts" : analysis.proposed_sources?.some((item) => ![...allowedSources.values()].includes(item.url)) ? "analysis.proposed_sources" : null;
  if (invalidSourceReference) throw new AnalysisFailure("invented_source_reference", "Analyzer referenced a source that was not supplied.", {
    safeMessage: "Analyzer returned an invalid source reference.", substage: "invented_source_reference",
    diagnostics: { ...responseDiagnostics, validation_phase: "source_references", validator_path: invalidSourceReference, validator_detail: `${invalidSourceReference}: source reference was not supplied` },
  });
  const request = { schema_version: "1.0", submitted_url: intake.submitted_url, submitted_at: intake.submitted_at };
  try { validateSchema(analysis, analysisSchema, analysisSchema, "analysis"); }
  catch (error) {
    const validator = sanitizeValidatorDetail(error.message, "schema");
    throw new AnalysisFailure("invalid_model_output", error.message, { safeMessage: "Analyzer returned invalid structured output.", substage: "schema_validation_failed", diagnostics: { ...responseDiagnostics, ...validator } });
  }
  if (analysis.intake_id !== intake.id || analysis.intake_origin !== intake.origin) throw new AnalysisFailure("invalid_model_output", "Analyzer did not preserve intake metadata.", {
    safeMessage: "Analyzer returned invalid structured output.", substage: "intake_metadata_mismatch",
    diagnostics: { ...responseDiagnostics, ...sanitizeValidatorDetail("analysis.intake_id: mismatch", "metadata") },
  });
  try { validateAnalysisSemantics(request, analysis); }
  catch (error) {
    const metadataMismatch = /submitted_url|submitted_at|schema_version/.test(String(error.message || ""));
    const validator = sanitizeValidatorDetail(error.message, metadataMismatch ? "metadata" : "semantics");
    throw new AnalysisFailure("invalid_model_output", error.message, { safeMessage: "Analyzer returned invalid structured output.",
      substage: metadataMismatch ? "intake_metadata_mismatch" : "semantic_validation_failed", diagnostics: { ...responseDiagnostics, ...validator } });
  }
  if ((evidence.truncated || evidence.text.length > 35_000 || additionalSources.some((item) => item.truncated || item.text.length > 12_000)) && !analysis.qualification_required) throw new AnalysisFailure("semantic_validation", "Truncated evidence requires qualification.", {
    safeMessage: "Analyzer did not preserve required qualifications.", substage: "qualification_validation_failed",
    diagnostics: { ...responseDiagnostics, ...sanitizeValidatorDetail("analysis.qualification_required: qualification is required", "qualification") },
  });
  return analysis;
}
