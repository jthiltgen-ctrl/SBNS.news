function fail(message) { throw new Error(message); }

function resolveRef(rootSchema, reference) {
  if (!reference.startsWith("#/")) fail(`Unsupported JSON Schema reference: ${reference}`);
  return reference.slice(2).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, key) => value?.[key], rootSchema);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

export function isHttpUrl(value) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname); }
  catch { return false; }
}

export function isIsoTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateSchema(value, schema, rootSchema, location = "$") {
  if (schema.$ref) { const resolved = resolveRef(rootSchema, schema.$ref); if (!resolved) fail(`${location}: unresolved schema reference ${schema.$ref}`); return validateSchema(value, resolved, rootSchema, location); }
  if (schema.anyOf) {
    const matched = schema.anyOf.some((candidate) => { try { validateSchema(value, candidate, rootSchema, location); return true; } catch { return false; } });
    if (!matched) fail(`${location}: value does not match any allowed schema`); return;
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) fail(`${location}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) fail(`${location}: expected one of ${schema.enum.map(JSON.stringify).join(", ")}`);
  if (schema.type) { const types = Array.isArray(schema.type) ? schema.type : [schema.type]; if (!types.some((type) => matchesType(value, type))) fail(`${location}: expected type ${types.join(" or ")}`); }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`${location}: must contain at least ${schema.minLength} character(s)`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`${location}: does not match required pattern ${schema.pattern}`);
    if (schema.format === "uri" && !isHttpUrl(value)) fail(`${location}: must be a valid HTTP(S) URL`);
    if (schema.format === "date-time" && !isIsoTimestamp(value)) fail(`${location}: must be an ISO-8601 UTC timestamp`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`${location}: must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`${location}: must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${location}: must contain at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, rootSchema, `${location}[${index}]`));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) fail(`${location}: missing required property ${required}`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) fail(`${location}: unexpected property ${key}`);
    for (const [key, propertySchema] of Object.entries(properties)) if (Object.hasOwn(value, key)) validateSchema(value[key], propertySchema, rootSchema, `${location}.${key}`);
  }
}

function unique(items, key, location) { const seen = new Set(); for (const item of items) { if (seen.has(item[key])) fail(`${location}: duplicate ${key} ${JSON.stringify(item[key])}`); seen.add(item[key]); } return seen; }
function empty(items, location) { if (items.length) fail(`${location}: must be empty`); }
function nonEmpty(items, location) { if (!items.length) fail(`${location}: must not be empty`); }
function text(value, location) { if (typeof value !== "string" || !value.trim()) fail(`${location}: must be non-empty text`); }

export function validateAnalysisSemantics(request, analysis) {
  if (request.submitted_url !== analysis.submitted_url) fail("fixture: request and analysis submitted_url values must match");
  if (request.submitted_at !== analysis.submitted_at) fail("fixture: request and analysis submitted_at values must match");
  if (request.schema_version !== analysis.schema_version) fail("fixture: request and analysis schema_version values must match");
  const sourceIds = unique(analysis.sources, "source_id", "analysis.sources");
  const claimIds = unique(analysis.claims, "claim_id", "analysis.claims");
  for (const claim of analysis.claims) for (const ref of claim.source_refs) if (!sourceIds.has(ref)) fail(`analysis.claims: claim ${claim.claim_id} references nonexistent source ${ref}`);
  for (const source of analysis.sources) for (const ref of source.claims_supported) if (!claimIds.has(ref)) fail(`analysis.sources: source ${source.source_id} references nonexistent claim ${ref}`);
  for (const conflict of analysis.source_conflicts) for (const ref of conflict.source_refs) if (!sourceIds.has(ref)) fail(`analysis.source_conflicts: conflict ${conflict.conflict_id} references nonexistent source ${ref}`);
  if (analysis.human_decision !== null || analysis.approved_at !== null || analysis.published_at !== null) fail("initial analysis: human_decision, approved_at, and published_at must be null");
  if (analysis.human_edits.length) fail("initial analysis: human_edits must be empty");
  if (analysis.qualification_required && analysis.do_not_claim.length === 0) fail("qualified analysis: do_not_claim must not be empty");
  if (analysis.recommendation === "publish") {
    nonEmpty(analysis.recommendation_reasons, "publish recommendation_reasons"); empty(analysis.hold_reasons, "publish hold_reasons"); empty(analysis.reject_reasons, "publish reject_reasons");
    if (!analysis.systemic_failure) fail("publish: systemic_failure must be true");
    if (analysis.claims.some((claim) => claim.material && claim.verification_status === "unverified")) fail("publish: no material claim may be unverified");
    if (!Number.isInteger(analysis.severity) || analysis.severity < 1 || analysis.severity > 5) fail("publish: severity must be an integer from 1 through 5");
    text(analysis.proposed_headline, "publish proposed_headline"); text(analysis.proposed_summary, "publish proposed_summary"); text(analysis.proposed_fml_kicker, "publish proposed_fml_kicker");
    nonEmpty(analysis.proposed_topic_tags, "publish proposed_topic_tags"); nonEmpty(analysis.proposed_sources, "publish proposed_sources");
    if (analysis.kicker_safety !== "acceptable") fail("publish: kicker_safety must be acceptable");
  }
  if (analysis.recommendation === "hold") { nonEmpty(analysis.hold_reasons, "hold hold_reasons"); empty(analysis.reject_reasons, "hold reject_reasons"); }
  if (analysis.recommendation === "reject") {
    nonEmpty(analysis.reject_reasons, "reject reject_reasons"); empty(analysis.hold_reasons, "reject hold_reasons");
    if (analysis.proposed_headline !== null || analysis.proposed_summary !== null || analysis.proposed_fml_kicker !== null) fail("reject: proposed headline, summary, and kicker must be null");
    if (analysis.severity !== null) fail("reject: severity must be null"); empty(analysis.proposed_topic_tags, "reject proposed_topic_tags"); empty(analysis.proposed_sources, "reject proposed_sources");
    if (analysis.kicker_safety !== "not_applicable") fail("reject: kicker_safety must be not_applicable");
  }
}

export function validateAnalysis(request, analysis, analysisSchema, name = "analysis") {
  validateSchema(analysis, analysisSchema, analysisSchema, name);
  validateAnalysisSemantics(request, analysis);
  return analysis;
}

export function validateFixture(fixture, schemas, name = "fixture") {
  if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture)) fail(`${name}: must be an object`);
  if (Object.keys(fixture).sort().join(",") !== "analysis,request") fail(`${name}: must contain exactly request and analysis`);
  validateSchema(fixture.request, schemas.request, schemas.request, `${name}.request`);
  return validateAnalysis(fixture.request, fixture.analysis, schemas.analysis, `${name}.analysis`);
}

export function expectInvalid(label, fixture, schemas) {
  try { validateFixture(fixture, schemas, label); } catch { return; }
  fail(`Negative test unexpectedly passed: ${label}`);
}
