import analysisSchema from "../intake/schemas/analysis.schema.json" with { type: "json" };
import { buildAnalysisMessages } from "./analysis-prompt.js";
import { validateAnalysis } from "./intake-validation.js";
import { AnalysisFailure } from "./source-retrieval.js";

const DEFAULT_MAX_TOKENS = 4096;
const MIN_MAX_TOKENS = 512;
const MAX_MAX_TOKENS = 8192;

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function parseJson(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); }
  catch { throw new AnalysisFailure("invalid_model_output", "Analyzer output was not raw JSON.", { safeMessage: "Analyzer returned invalid structured output." }); }
}
function normalizeModelResponse(result) {
  let value = result;
  if (isRecord(value) && Object.hasOwn(value, "response")) value = value.response;
  else if (isRecord(value) && isRecord(value.result) && Object.hasOwn(value.result, "response")) value = value.result.response;
  if (typeof value === "string") return parseJson(value);
  if (isRecord(value)) return value;
  throw new AnalysisFailure("invalid_model_output", "Analyzer returned no structured object.", { safeMessage: "Analyzer returned invalid structured output." });
}
function resolveMaxTokens(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_MAX_TOKENS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_MAX_TOKENS || parsed > MAX_MAX_TOKENS) throw new AnalysisFailure("analysis_configuration", `AI_MAX_TOKENS must be an integer from ${MIN_MAX_TOKENS} through ${MAX_MAX_TOKENS}.`, { safeMessage: "Analyzer configuration is invalid." });
  return parsed;
}

export async function analyzeIntake({ intake, source, evidence, env }) {
  if (!env.AI_MODEL || !env.AI_GATEWAY_ID) throw new AnalysisFailure("analysis_configuration", "AI_MODEL and AI_GATEWAY_ID are required.", { safeMessage: "Analyzer configuration is incomplete." });
  const maxTokens = resolveMaxTokens(env.AI_MAX_TOKENS);
  let result;
  try { result = await env.AI.run(env.AI_MODEL, { messages: buildAnalysisMessages({ intake, source, evidence }), response_format: { type: "json_schema", json_schema: analysisSchema }, max_tokens: maxTokens }, { gateway: { id: env.AI_GATEWAY_ID, skipCache: true } }); }
  catch { throw new AnalysisFailure("model_unavailable", "Workers AI request failed.", { retryable: true, safeMessage: "The analyzer is temporarily unavailable." }); }
  const analysis = normalizeModelResponse(result);
  if (Array.isArray(analysis?.sources) && (analysis.sources.some((item) => item.source_id !== "source-1" || item.url !== source.finalUrl) || analysis.claims?.some((claim) => claim.source_refs?.some((ref) => ref !== "source-1")) || analysis.source_conflicts?.some((conflict) => conflict.source_refs?.some((ref) => ref !== "source-1")))) throw new AnalysisFailure("invented_source_reference", "Analyzer referenced a source that was not supplied.", { safeMessage: "Analyzer returned an invalid source reference." });
  const request = { schema_version: "1.0", submitted_url: intake.submitted_url, submitted_at: intake.submitted_at };
  try { validateAnalysis(request, analysis, analysisSchema, "analysis"); }
  catch (error) { throw new AnalysisFailure("invalid_model_output", error.message, { safeMessage: "Analyzer returned invalid structured output." }); }
  if (analysis.intake_id !== intake.id || analysis.intake_origin !== intake.origin) throw new AnalysisFailure("invalid_model_output", "Analyzer did not preserve intake metadata.", { safeMessage: "Analyzer returned invalid structured output." });
  if (evidence.truncated && !analysis.qualification_required) throw new AnalysisFailure("semantic_validation", "Truncated evidence requires qualification.", { safeMessage: "Analyzer did not preserve required qualifications." });
  return analysis;
}
