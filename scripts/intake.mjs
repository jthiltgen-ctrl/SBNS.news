import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_DIR = path.join(ROOT, "intake", "schemas");
const FIXTURE_DIR = path.join(ROOT, "intake", "fixtures");
const COMMANDS = new Set(["check", "test"]);

function fail(message) {
  throw new Error(message);
}

async function readJson(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    fail(`${path.relative(ROOT, filePath)}: ${error.message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${path.relative(ROOT, filePath)}: invalid JSON (${error.message})`);
  }
}

function resolveRef(rootSchema, reference) {
  if (!reference.startsWith("#/")) {
    fail(`Unsupported JSON Schema reference: ${reference}`);
  }

  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, key) => value?.[key], rootSchema);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isIsoTimestamp(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function validateSchema(value, schema, rootSchema, location = "$") {
  if (schema.$ref) {
    const resolved = resolveRef(rootSchema, schema.$ref);
    if (!resolved) fail(`${location}: unresolved schema reference ${schema.$ref}`);
    validateSchema(value, resolved, rootSchema, location);
    return;
  }

  if (schema.anyOf) {
    const matched = schema.anyOf.some((candidate) => {
      try {
        validateSchema(value, candidate, rootSchema, location);
        return true;
      } catch {
        return false;
      }
    });
    if (!matched) fail(`${location}: value does not match any allowed schema`);
    return;
  }

  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    fail(`${location}: expected ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    fail(`${location}: expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      fail(`${location}: expected type ${types.join(" or ")}`);
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(`${location}: must contain at least ${schema.minLength} character(s)`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      fail(`${location}: does not match required pattern ${schema.pattern}`);
    }
    if (schema.format === "uri" && !isHttpUrl(value)) {
      fail(`${location}: must be a valid HTTP(S) URL`);
    }
    if (schema.format === "date-time" && !isIsoTimestamp(value)) {
      fail(`${location}: must be an ISO-8601 UTC timestamp`);
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(`${location}: must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail(`${location}: must be at most ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(`${location}: must contain at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, index) => validateSchema(item, schema.items, rootSchema, `${location}[${index}]`));
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties ?? {};
    for (const required of schema.required ?? []) {
      if (!Object.hasOwn(value, required)) fail(`${location}: missing required property ${required}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) fail(`${location}: unexpected property ${key}`);
      }
    }
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        validateSchema(value[key], propertySchema, rootSchema, `${location}.${key}`);
      }
    }
  }
}

function requireUnique(items, key, location) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[key])) fail(`${location}: duplicate ${key} ${JSON.stringify(item[key])}`);
    seen.add(item[key]);
  }
  return seen;
}

function requireEmpty(items, location) {
  if (items.length !== 0) fail(`${location}: must be empty`);
}

function requireNonEmpty(items, location) {
  if (items.length === 0) fail(`${location}: must not be empty`);
}

function requireNonEmptyText(value, location) {
  if (typeof value !== "string" || value.trim() === "") fail(`${location}: must be non-empty text`);
}

function validateSemantics(request, analysis) {
  if (request.submitted_url !== analysis.submitted_url) {
    fail("fixture: request and analysis submitted_url values must match");
  }
  if (request.submitted_at !== analysis.submitted_at) {
    fail("fixture: request and analysis submitted_at values must match");
  }
  if (request.schema_version !== analysis.schema_version) {
    fail("fixture: request and analysis schema_version values must match");
  }

  const sourceIds = requireUnique(analysis.sources, "source_id", "analysis.sources");
  const claimIds = requireUnique(analysis.claims, "claim_id", "analysis.claims");

  for (const claim of analysis.claims) {
    for (const sourceRef of claim.source_refs) {
      if (!sourceIds.has(sourceRef)) {
        fail(`analysis.claims: claim ${claim.claim_id} references nonexistent source ${sourceRef}`);
      }
    }
  }

  for (const source of analysis.sources) {
    for (const claimRef of source.claims_supported) {
      if (!claimIds.has(claimRef)) {
        fail(`analysis.sources: source ${source.source_id} references nonexistent claim ${claimRef}`);
      }
    }
  }

  for (const conflict of analysis.source_conflicts) {
    for (const sourceRef of conflict.source_refs) {
      if (!sourceIds.has(sourceRef)) {
        fail(`analysis.source_conflicts: conflict ${conflict.conflict_id} references nonexistent source ${sourceRef}`);
      }
    }
  }

  if (analysis.human_decision !== null || analysis.approved_at !== null || analysis.published_at !== null) {
    fail("initial analysis: human_decision, approved_at, and published_at must be null");
  }
  if (analysis.human_edits.length !== 0) fail("initial analysis: human_edits must be empty");

  if (analysis.recommendation === "publish") {
    requireNonEmpty(analysis.recommendation_reasons, "publish recommendation_reasons");
    requireEmpty(analysis.hold_reasons, "publish hold_reasons");
    requireEmpty(analysis.reject_reasons, "publish reject_reasons");
    if (!analysis.systemic_failure) fail("publish: systemic_failure must be true");
    if (analysis.claims.some((claim) => claim.material && claim.verification_status === "unverified")) {
      fail("publish: no material claim may be unverified");
    }
    if (!Number.isInteger(analysis.severity) || analysis.severity < 1 || analysis.severity > 5) {
      fail("publish: severity must be an integer from 1 through 5");
    }
    requireNonEmptyText(analysis.proposed_headline, "publish proposed_headline");
    requireNonEmptyText(analysis.proposed_summary, "publish proposed_summary");
    requireNonEmptyText(analysis.proposed_fml_kicker, "publish proposed_fml_kicker");
    requireNonEmpty(analysis.proposed_topic_tags, "publish proposed_topic_tags");
    requireNonEmpty(analysis.proposed_sources, "publish proposed_sources");
    if (analysis.kicker_safety !== "acceptable") fail("publish: kicker_safety must be acceptable");
  }

  if (analysis.recommendation === "hold") {
    requireNonEmpty(analysis.hold_reasons, "hold hold_reasons");
    requireEmpty(analysis.reject_reasons, "hold reject_reasons");
  }

  if (analysis.recommendation === "reject") {
    requireNonEmpty(analysis.reject_reasons, "reject reject_reasons");
    requireEmpty(analysis.hold_reasons, "reject hold_reasons");
    if (analysis.proposed_headline !== null || analysis.proposed_summary !== null || analysis.proposed_fml_kicker !== null) {
      fail("reject: proposed headline, summary, and kicker must be null");
    }
    if (analysis.severity !== null) fail("reject: severity must be null");
    requireEmpty(analysis.proposed_topic_tags, "reject proposed_topic_tags");
    requireEmpty(analysis.proposed_sources, "reject proposed_sources");
    if (analysis.kicker_safety !== "not_applicable") fail("reject: kicker_safety must be not_applicable");
  }
}

function validateFixture(fixture, schemas, name = "fixture") {
  if (fixture === null || typeof fixture !== "object" || Array.isArray(fixture)) fail(`${name}: must be an object`);
  const keys = Object.keys(fixture).sort();
  if (keys.join(",") !== "analysis,request") fail(`${name}: must contain exactly request and analysis`);
  validateSchema(fixture.request, schemas.request, schemas.request, `${name}.request`);
  validateSchema(fixture.analysis, schemas.analysis, schemas.analysis, `${name}.analysis`);
  validateSemantics(fixture.request, fixture.analysis);
}

async function loadContract() {
  const schemas = {
    request: await readJson(path.join(SCHEMA_DIR, "request.schema.json")),
    analysis: await readJson(path.join(SCHEMA_DIR, "analysis.schema.json"))
  };

  if (schemas.request.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    fail("request.schema.json: expected JSON Schema draft 2020-12 declaration");
  }
  if (schemas.analysis.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    fail("analysis.schema.json: expected JSON Schema draft 2020-12 declaration");
  }

  const fixtureNames = (await readdir(FIXTURE_DIR)).filter((name) => name.endsWith(".json")).sort();
  const fixtures = new Map();
  for (const name of fixtureNames) {
    fixtures.set(name, await readJson(path.join(FIXTURE_DIR, name)));
  }
  return { schemas, fixtures };
}

function fixtureByName(fixtures, name) {
  const fixture = fixtures.get(name);
  if (!fixture) fail(`Missing golden fixture: ${name}`);
  return fixture;
}

function clone(value) {
  return structuredClone(value);
}

function expectInvalid(label, fixture, schemas) {
  try {
    validateFixture(fixture, schemas, label);
  } catch {
    return;
  }
  fail(`Negative test unexpectedly passed: ${label}`);
}

async function checkContract() {
  const { schemas, fixtures } = await loadContract();
  const expected = [
    "hold-insufficient-evidence.json",
    "publish-story-005.json",
    "reject-no-systemic-failure.json"
  ];
  if (JSON.stringify([...fixtures.keys()]) !== JSON.stringify(expected)) {
    fail(`Expected exactly these golden fixtures: ${expected.join(", ")}`);
  }
  for (const [name, fixture] of fixtures) validateFixture(fixture, schemas, name);
  return { schemas, fixtures };
}

async function runTests() {
  const { schemas, fixtures } = await checkContract();
  const publish = fixtureByName(fixtures, "publish-story-005.json");
  const hold = fixtureByName(fixtures, "hold-insufficient-evidence.json");
  const reject = fixtureByName(fixtures, "reject-no-systemic-failure.json");
  const tests = [];

  function mutate(label, source, mutation) {
    const value = clone(source);
    mutation(value);
    expectInvalid(label, value, schemas);
    tests.push(label);
  }

  mutate("publish with unverified material claim", publish, (value) => {
    value.analysis.claims[0].verification_status = "unverified";
  });
  mutate("publish with missing proposed headline", publish, (value) => {
    value.analysis.proposed_headline = null;
  });
  mutate("hold with no hold reasons", hold, (value) => {
    value.analysis.hold_reasons = [];
  });
  mutate("reject with no reject reasons", reject, (value) => {
    value.analysis.reject_reasons = [];
  });
  mutate("nonexistent claim-to-source reference", hold, (value) => {
    value.analysis.claims[0].source_refs = ["missing-source"];
  });
  mutate("nonexistent source-to-claim reference", hold, (value) => {
    value.analysis.sources[0].claims_supported = ["missing-claim"];
  });
  mutate("duplicate claim ID", publish, (value) => {
    value.analysis.claims.push(clone(value.analysis.claims[0]));
  });
  mutate("duplicate source ID", publish, (value) => {
    value.analysis.sources.push(clone(value.analysis.sources[0]));
  });
  mutate("invalid category", publish, (value) => {
    value.analysis.category = "Regional";
  });
  mutate("severity outside 1–5", publish, (value) => {
    value.analysis.severity = 6;
  });
  mutate("invalid URL", hold, (value) => {
    value.request.submitted_url = "ftp://example.com/not-http";
    value.analysis.submitted_url = "ftp://example.com/not-http";
  });
  mutate("request/analysis URL mismatch", hold, (value) => {
    value.analysis.submitted_url = "https://example.com/different-synthetic-url";
  });

  return tests;
}

const command = process.argv[2];
if (!COMMANDS.has(command) || process.argv.length !== 3) {
  console.error("Usage: node scripts/intake.mjs <check|test>");
  process.exit(1);
}

try {
  if (command === "check") {
    const { fixtures } = await checkContract();
    console.log(`Intake contract valid: 2 schemas, ${fixtures.size} golden fixtures.`);
  } else {
    const tests = await runTests();
    console.log(`Intake contract tests passed: 3 golden fixtures, ${tests.length} negative tests.`);
  }
} catch (error) {
  console.error(`Intake ${command} failed: ${error.message}`);
  process.exit(1);
}
