import analysisSchema from "../intake/schemas/analysis.schema.json" with { type: "json" };
import { buildAnalysisMessages } from "./analysis-prompt.js";
import { validateAnalysis } from "./intake-validation.js";
import { AnalysisFailure } from "./source-retrieval.js";

function modelText(result) {
  if (typeof result === "string") return result;
  if (typeof result?.response === "string") return result.response;
  if (typeof result?.result?.response === "string") return result.result.response;
  throw new AnalysisFailure("invalid_model_output", "Analyzer returned no text.", { safeMessage: "Analyzer returned invalid structured output." });
}
function parseJson(text) {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); }
  catch { throw new AnalysisFailure("invalid_model_output", "Analyzer output was not raw JSON.", { safeMessage: "Analyzer returned invalid structured output." }); }
}

export async function analyzeIntake({ intake, source, evidence, env }) {
  if (!env.AI_MODEL || !env.AI_GATEWAY_ID) throw new AnalysisFailure("analysis_configuration", "AI_MODEL and AI_GATEWAY_ID are required.", { safeMessage: "Analyzer configuration is incomplete." });
  let result;
  try { result = await env.AI.run(env.AI_MODEL, { messages: buildAnalysisMessages({ intake, source, evidence, schema: analysisSchema }), response_format: { type: "json_object" } }, { gateway: { id: env.AI_GATEWAY_ID, skipCache: true } }); }
  catch { throw new AnalysisFailure("model_unavailable", "Workers AI request failed.", { retryable: true, safeMessage: "The analyzer is temporarily unavailable." }); }
  const analysis = parseJson(modelText(result));
  if (Array.isArray(analysis?.sources) && (analysis.sources.some((item) => item.source_id !== "source-1" || item.url !== source.finalUrl) || analysis.claims?.some((claim) => claim.source_refs?.some((ref) => ref !== "source-1")) || analysis.source_conflicts?.some((conflict) => conflict.source_refs?.some((ref) => ref !== "source-1")))) throw new AnalysisFailure("invented_source_reference", "Analyzer referenced a source that was not supplied.", { safeMessage: "Analyzer returned an invalid source reference." });
  const request = { schema_version: "1.0", submitted_url: intake.submitted_url, submitted_at: intake.submitted_at };
  try { validateAnalysis(request, analysis, analysisSchema, "analysis"); }
  catch (error) { throw new AnalysisFailure("invalid_model_output", error.message, { safeMessage: "Analyzer returned invalid structured output." }); }
  if (analysis.intake_id !== intake.id || analysis.intake_origin !== intake.origin) throw new AnalysisFailure("invalid_model_output", "Analyzer did not preserve intake metadata.", { safeMessage: "Analyzer returned invalid structured output." });
  if (evidence.truncated && !analysis.qualification_required) throw new AnalysisFailure("semantic_validation", "Truncated evidence requires qualification.", { safeMessage: "Analyzer did not preserve required qualifications." });
  return analysis;
}
