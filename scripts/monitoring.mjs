import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_FILE = path.join(ROOT, "monitoring", "schemas", "analysis.schema.json");
const FIXTURE_DIR = path.join(ROOT, "monitoring", "fixtures");
const STORY_DIR = path.join(ROOT, "content", "stories");
const BUNDLE_FILE = path.join(ROOT, "public", "admin", "monitoring-fixtures.json");
const COMMANDS = new Set(["build", "check", "test"]);
const ACTION_RECOMMENDATIONS = new Set(["update_review", "correction_review", "follow_up"]);

function fail(message) { throw new Error(message); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isHttpUrl(value) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname); }
  catch { return false; }
}
function isTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value));
}

async function readJson(file) {
  let text;
  try { text = await readFile(file, "utf8"); }
  catch (error) { fail(`${path.relative(ROOT, file)}: ${error.message}`); }
  try { return JSON.parse(text); }
  catch (error) { fail(`${path.relative(ROOT, file)}: invalid JSON (${error.message})`); }
}

function resolveRef(schema, ref) {
  if (!ref.startsWith("#/")) fail(`Unsupported schema reference ${ref}`);
  return ref.slice(2).split("/").reduce((value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], schema);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "object") return isObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function validateSchema(value, schema, rootSchema, location = "$") {
  if (schema.$ref) return validateSchema(value, resolveRef(rootSchema, schema.$ref), rootSchema, location);
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) {
      try { validateSchema(value, candidate, rootSchema, location); return; } catch {}
    }
    fail(`${location}: value does not match an allowed schema`);
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) fail(`${location}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) fail(`${location}: value is not allowed`);
  if (schema.type && !matchesType(value, schema.type)) fail(`${location}: expected ${schema.type}`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`${location}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`${location}: invalid format`);
    if (schema.format === "uri" && !isHttpUrl(value)) fail(`${location}: must be a valid HTTP(S) URL`);
    if (schema.format === "date-time" && !isTimestamp(value)) fail(`${location}: must be a UTC ISO timestamp`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`${location}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`${location}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${location}: requires at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`${location}: exceeds ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, rootSchema, `${location}[${index}]`));
  }
  if (isObject(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) if (!Object.hasOwn(value, required)) fail(`${location}: missing required property ${required}`);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) fail(`${location}: unexpected property ${key}`);
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(value, key)) validateSchema(value[key], child, rootSchema, `${location}.${key}`);
  }
}

function unique(items, key, location) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[key])) fail(`${location}: duplicate ${key} ${item[key]}`);
    seen.add(item[key]);
  }
  return seen;
}

function validateSemantics(analysis, storiesById) {
  const baseline = storiesById.get(analysis.story_id);
  if (!baseline) fail(`story_id does not exist: ${analysis.story_id}`);
  if (baseline.status !== "published") fail(`story_id is not published: ${analysis.story_id}`);
  if (baseline.content_type !== "sample") fail(`monitoring fixture baseline must be sample content: ${analysis.story_id}`);
  const sourceIds = unique(analysis.sources, "source_id", "sources");
  const claimIds = unique(analysis.claims, "claim_id", "claims");
  for (const claim of analysis.claims) for (const ref of claim.source_refs) if (!sourceIds.has(ref)) fail(`claims: unresolved source reference ${ref}`);
  for (const source of analysis.sources) for (const ref of source.claims_supported) if (!claimIds.has(ref)) fail(`sources: unresolved claim reference ${ref}`);
  for (const conflict of analysis.source_conflicts) for (const ref of conflict.source_refs) if (!sourceIds.has(ref)) fail(`source_conflicts: unresolved source reference ${ref}`);
  if (analysis.proposed_correction) for (const ref of analysis.proposed_correction.source_refs) if (!sourceIds.has(ref)) fail(`proposed_correction: unresolved source reference ${ref}`);
  if (analysis.recommendation_confidence === "high" && analysis.claims.some((claim) => claim.material && claim.verification_status === "unverified")) fail("high confidence cannot rely on an unverified material claim");
  if (ACTION_RECOMMENDATIONS.has(analysis.recommendation) && analysis.claims.some((claim) => claim.material && claim.verification_status === "unverified")) fail("editorial action cannot rely on an unverified material claim");
  if (analysis.recommendation === "no_action") {
    if (analysis.material_change) fail("no_action requires material_change false");
    if (analysis.proposed_update || analysis.proposed_correction || analysis.proposed_follow_up) fail("no_action cannot include a proposed editorial action");
  }
  if (analysis.recommendation === "update_review") {
    if (analysis.original_story_accurate !== true) fail("update_review requires the original story to remain accurate");
    if (!analysis.proposed_update) fail("update_review requires proposed_update");
  }
  if (analysis.recommendation === "follow_up") {
    if (analysis.original_story_accurate !== true) fail("follow_up requires the original story to remain accurate");
    if (!analysis.material_change) fail("follow_up requires a material change");
    if (!analysis.proposed_follow_up) fail("follow_up requires proposed_follow_up");
    if (analysis.proposed_correction) fail("follow_up cannot include proposed_correction");
  }
  if (analysis.recommendation === "correction_review") {
    if (analysis.original_story_accurate === true) fail("correction_review cannot mark the original story accurate");
    if (analysis.affected_original_claims.length === 0) fail("correction_review requires an affected original claim");
    if (!analysis.proposed_correction) fail("correction_review requires proposed_correction");
  }
  return baseline;
}

function normalizeBaseline(story) {
  return {
    id: story.id,
    category: story.category,
    headline: story.headline,
    summary: story.summary,
    fml_kicker: story.fml_kicker,
    severity: story.severity,
    topic_tags: story.topic_tags,
    sources: story.sources.map(({ name, url }) => ({ name, url })),
    published_at: story.published_at
  };
}

async function loadStories(directory = STORY_DIR) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const map = new Map();
  for (const file of files) {
    const story = await readJson(path.join(directory, file));
    if (map.has(story.id)) fail(`duplicate story id ${story.id}`);
    map.set(story.id, story);
  }
  return map;
}

async function loadFixtures(schema, storiesById, directory = FIXTURE_DIR) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const fixtures = [];
  const monitoringIds = new Set();
  for (const file of files) {
    const analysis = await readJson(path.join(directory, file));
    validateSchema(analysis, schema, schema);
    const baseline = validateSemantics(analysis, storiesById);
    if (monitoringIds.has(analysis.monitoring_id)) fail(`duplicate monitoring_id ${analysis.monitoring_id}`);
    monitoringIds.add(analysis.monitoring_id);
    fixtures.push({ name: file, analysis, baseline_story: normalizeBaseline(baseline) });
  }
  return fixtures;
}

function bundleText(fixtures) { return `${JSON.stringify({ schema_version: "1.0", fixtures }, null, 2)}\n`; }

async function build() {
  const [schema, stories] = await Promise.all([readJson(SCHEMA_FILE), loadStories()]);
  const fixtures = await loadFixtures(schema, stories);
  await writeFile(BUNDLE_FILE, bundleText(fixtures), "utf8");
  console.log(`Built monitoring bundle: ${fixtures.length} validated fixtures with repository baselines.`);
}

async function check() {
  const [schema, stories] = await Promise.all([readJson(SCHEMA_FILE), loadStories()]);
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail("Monitoring schema must use JSON Schema draft 2020-12");
  const fixtures = await loadFixtures(schema, stories);
  const actual = await readFile(BUNDLE_FILE, "utf8");
  if (actual !== bundleText(fixtures)) fail("Monitoring fixture bundle is stale. Run: npm run monitoring:build");
  console.log(`Monitoring contract valid: 1 schema, ${fixtures.length} golden fixtures, deterministic baseline bundle current.`);
}

function clone(value) { return structuredClone(value); }
async function expectFailure(label, action, expected) {
  try { await action(); }
  catch (error) { if (!error.message.includes(expected)) fail(`${label}: expected ${expected}, got ${error.message}`); return; }
  fail(`${label}: expected failure`);
}

async function test() {
  const schema = await readJson(SCHEMA_FILE);
  const stories = await loadStories();
  const fixtures = await loadFixtures(schema, stories);
  if (fixtures.length !== 3) fail("Expected three golden monitoring fixtures");
  let count = 3;
  const byRecommendation = new Map(fixtures.map(({ analysis }) => [analysis.recommendation, analysis]));
  const noAction = byRecommendation.get("no_action");
  const followUp = byRecommendation.get("follow_up");
  const correction = byRecommendation.get("correction_review");
  const invalid = async (label, source, mutate, expected, customStories = stories) => {
    const value = clone(source); mutate(value);
    await expectFailure(label, async () => { validateSchema(value, schema, schema); validateSemantics(value, customStories); }, expected);
    count += 1;
  };
  await invalid("recommendation", noAction, (v) => { v.recommendation = "archive"; }, "not allowed");
  await invalid("missing story", noAction, (v) => { v.story_id = "missing-story"; }, "does not exist");
  const draftStories = new Map(stories); draftStories.set("draft-sample", { ...stories.get(noAction.story_id), id: "draft-sample", status: "draft" });
  await invalid("draft story", noAction, (v) => { v.story_id = "draft-sample"; }, "not published", draftStories);
  const duplicateDir = await mkdtemp(path.join(tmpdir(), "sbns-monitoring-duplicates-"));
  try {
    await writeFile(path.join(duplicateDir, "a.json"), `${JSON.stringify(noAction)}\n`);
    await writeFile(path.join(duplicateDir, "b.json"), `${JSON.stringify({ ...followUp, monitoring_id: noAction.monitoring_id })}\n`);
    await expectFailure("duplicate monitoring", () => loadFixtures(schema, stories, duplicateDir), "duplicate monitoring_id"); count += 1;
  } finally { await rm(duplicateDir, { recursive: true, force: true }); }
  await invalid("development URL", noAction, (v) => { v.development_url = "ftp://example.com/test"; }, "HTTP(S)");
  await invalid("unverified action", followUp, (v) => { v.claims[0].verification_status = "unverified"; v.recommendation_confidence = "medium"; }, "cannot rely");
  await invalid("no action proposal", noAction, (v) => { v.proposed_follow_up = followUp.proposed_follow_up; }, "no_action cannot");
  await invalid("follow-up missing proposal", followUp, (v) => { v.proposed_follow_up = null; }, "requires proposed_follow_up");
  await invalid("follow-up inaccurate", followUp, (v) => { v.original_story_accurate = false; }, "requires the original story");
  await invalid("correction accurate", correction, (v) => { v.original_story_accurate = true; }, "cannot mark");
  await invalid("correction claim", correction, (v) => { v.affected_original_claims = []; }, "affected original claim");
  await invalid("correction proposal", correction, (v) => { v.proposed_correction = null; }, "requires proposed_correction");
  const update = clone(followUp); update.monitoring_id = "synthetic-update"; update.recommendation = "update_review"; update.proposed_follow_up = null; update.proposed_update = { update_note: "Synthetic later context.", suggested_changes: "Add a dated synthetic update note.", sources: [{ name: "Synthetic update", url: "https://example.com/update" }] };
  validateSchema(update, schema, schema); validateSemantics(update, stories); count += 1;
  await invalid("update inaccurate", update, (v) => { v.original_story_accurate = false; }, "requires the original story");
  await invalid("source ref", noAction, (v) => { v.claims[0].source_refs = ["missing-source"]; }, "unresolved source reference");
  await invalid("risk", noAction, (v) => { v.factual_risk = "extreme"; }, "not allowed");
  await invalid("timestamp", noAction, (v) => { v.checked_at = "tomorrow"; }, "UTC ISO");
  const driftDir = await mkdtemp(path.join(tmpdir(), "sbns-monitoring-drift-"));
  try {
    await mkdir(path.join(driftDir, "monitoring", "schemas"), { recursive: true });
    await writeFile(path.join(driftDir, "bundle.json"), "{}\n");
    if ((await readFile(path.join(driftDir, "bundle.json"), "utf8")) === bundleText(fixtures)) fail("drift fixture unexpectedly matched");
    count += 1;
  } finally { await rm(driftDir, { recursive: true, force: true }); }
  console.log(`Monitoring tests passed: ${count} scenarios, including 3 golden fixtures and semantic/bundle failures.`);
}

const command = process.argv[2];
if (!COMMANDS.has(command)) {
  console.error("Usage: node scripts/monitoring.mjs <build|check|test>");
  process.exitCode = 1;
} else {
  try { await { build, check, test }[command](); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
