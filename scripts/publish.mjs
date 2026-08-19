import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_FILE = path.join(ROOT, "publication", "schemas", "package.schema.json");
const FIXTURE_FILE = path.join(ROOT, "publication", "fixtures", "valid-publication-package.json");
const COMMANDS = new Set(["check", "prepare", "test"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CATEGORIES = new Set(["International", "National", "Local"]);
const ORIGINS = new Set(["editor", "visitor", "monitor", "discovery"]);
const RECOMMENDATIONS = new Set(["publish", "hold", "reject"]);
const PUBLIC_FIELDS = ["id", "status", "content_type", "category", "headline", "summary", "fml_kicker", "severity", "topic_tags", "sources", "published_at"];

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isUtcTimestamp(value) {
  return typeof value === "string" && UTC_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

async function readJson(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    fail(`${file}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${file}: invalid JSON (${error.message})`);
  }
}

function matchesType(value, type) {
  if (type === "object") return isObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function validateAgainstSchema(value, schema, location = "$") {
  if (Object.hasOwn(schema, "const") && value !== schema.const) fail(`${location}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`${location}: value is not allowed`);
  if (schema.type && !matchesType(value, schema.type)) fail(`${location}: expected ${schema.type}`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail(`${location}: must not be empty`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`${location}: invalid format`);
    if (schema.format === "uri" && !isHttpUrl(value)) fail(`${location}: must be a valid HTTP(S) URL`);
    if (schema.format === "date-time" && !isUtcTimestamp(value)) fail(`${location}: must be a UTC ISO-8601 timestamp`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`${location}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`${location}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`${location}: requires at least ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(item, schema.items, `${location}[${index}]`));
  }
  if (isObject(value)) {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`${location}: missing required property ${key}`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(properties, key)) fail(`${location}: unexpected property ${key}`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) validateAgainstSchema(value[key], childSchema, `${location}.${key}`);
    }
  }
}

function validatePackageSemantics(pkg) {
  if (!isObject(pkg)) fail("Publication package must be an object");
  if (pkg.schema_version !== "1.0") fail('schema_version must be "1.0"');
  if (pkg.human_decision !== "approve") fail('human_decision must be "approve"');
  if (!isUtcTimestamp(pkg.approved_at)) fail("approved_at must be a UTC ISO-8601 timestamp");
  const analysis = pkg.source_analysis;
  if (!isObject(analysis) || typeof analysis.intake_id !== "string" || !analysis.intake_id.trim()) fail("source_analysis.intake_id is required");
  if (!ORIGINS.has(analysis.intake_origin)) fail("source_analysis.intake_origin is invalid");
  if (!isHttpUrl(analysis.submitted_url)) fail("source_analysis.submitted_url must be HTTP(S)");
  if (!RECOMMENDATIONS.has(analysis.recommendation)) fail("source_analysis.recommendation is invalid");
  const story = pkg.story;
  if (!isObject(story) || !SLUG.test(story.id ?? "")) fail("story.id must be a lowercase slug");
  if (story.content_type !== "reporting") fail('story.content_type must be "reporting"');
  if (!CATEGORIES.has(story.category)) fail("story.category is invalid");
  for (const field of ["headline", "summary", "fml_kicker"]) {
    if (typeof story[field] !== "string" || !story[field].trim()) fail(`story.${field} is required`);
  }
  if (!Number.isInteger(story.severity) || story.severity < 1 || story.severity > 5) fail("story.severity must be an integer from 1 through 5");
  if (!Array.isArray(story.topic_tags) || story.topic_tags.length === 0 || story.topic_tags.some((tag) => typeof tag !== "string" || !tag.trim())) fail("story.topic_tags requires non-empty tags");
  if (!Array.isArray(story.sources) || story.sources.length === 0) fail("story.sources requires at least one source");
  for (const source of story.sources) {
    if (!isObject(source) || typeof source.name !== "string" || !source.name.trim() || !isHttpUrl(source.url)) fail("story.sources entries require a name and HTTP(S) URL");
  }
  if (!isObject(pkg.editorial_guardrails) || !Array.isArray(pkg.editorial_guardrails.do_not_claim) || pkg.editorial_guardrails.do_not_claim.some((warning) => typeof warning !== "string")) fail("editorial_guardrails.do_not_claim must be a string array");
  if (typeof pkg.editorial_guardrails.qualification_required !== "boolean") fail("editorial_guardrails.qualification_required must be boolean");
}

async function validatePackageFile(packageFile, schemaFile = SCHEMA_FILE) {
  const [schema, pkg] = await Promise.all([readJson(schemaFile), readJson(packageFile)]);
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail("Publication schema must use JSON Schema draft 2020-12");
  validateAgainstSchema(pkg, schema);
  validatePackageSemantics(pkg);
  return pkg;
}

async function run(file, args, cwd, env = process.env) {
  try {
    return await execFileAsync(file, args, { cwd, env, windowsHide: true });
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    fail(detail);
  }
}

async function currentBranch(repoRoot) {
  const { stdout } = await run("git", ["branch", "--show-current"], repoRoot);
  return stdout.trim();
}

async function requireCleanFeatureBranch(repoRoot) {
  const branch = await currentBranch(repoRoot);
  if (branch === "main" || branch === "master") fail("Publication preparation must run on a feature branch, not main.");
  if (!branch) fail("Publication preparation requires a named feature branch.");
  const { stdout } = await run("git", ["status", "--porcelain"], repoRoot);
  if (stdout.trim()) fail("Publication preparation requires a clean Git worktree.");
}

async function existingStories(repoRoot) {
  const directory = path.join(repoRoot, "content", "stories");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  const stories = [];
  for (const file of files) stories.push({ file, story: await readJson(path.join(directory, file)) });
  return stories;
}

async function repositoryChecks(pkg, repoRoot) {
  const stories = await existingStories(repoRoot);
  if (stories.some(({ story }) => story.id === pkg.story.id)) fail(`Story ID already exists: ${pkg.story.id}`);
  const target = path.join(repoRoot, "content", "stories", `${pkg.story.id}.json`);
  try {
    await readFile(target);
    fail(`Target story file already exists: content/stories/${pkg.story.id}.json`);
  } catch (error) {
    if (error.message?.startsWith("Target story file already exists")) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  await run(process.execPath, [path.join(repoRoot, "scripts", "content.mjs"), "check"], repoRoot);
  return { stories, target };
}

function publicStoryFromPackage(pkg, publishedAt) {
  return {
    id: pkg.story.id,
    status: "published",
    content_type: "reporting",
    category: pkg.story.category,
    headline: pkg.story.headline,
    summary: pkg.story.summary,
    fml_kicker: pkg.story.fml_kicker,
    severity: pkg.story.severity,
    topic_tags: [...pkg.story.topic_tags],
    sources: pkg.story.sources.map(({ name, url }) => ({ name, url })),
    published_at: publishedAt,
  };
}

async function checkPackage(packageFile, repoRoot = ROOT) {
  const pkg = await validatePackageFile(path.resolve(packageFile));
  await repositoryChecks(pkg, repoRoot);
  console.log(`Publication package valid: ${pkg.story.id}`);
  return pkg;
}

async function preparePackage(packageFile, repoRoot = ROOT, options = {}) {
  await requireCleanFeatureBranch(repoRoot);
  const pkg = await validatePackageFile(path.resolve(packageFile), options.schemaFile ?? path.join(repoRoot, "publication", "schemas", "package.schema.json"));
  const { stories, target } = await repositoryChecks(pkg, repoRoot);
  const feedFile = path.join(repoRoot, "public", "stories.json");
  const previousFeed = await readFile(feedFile, "utf8");
  const previousCount = JSON.parse(previousFeed).length;
  const publishedAt = options.now ?? new Date().toISOString();
  const story = publicStoryFromPackage(pkg, publishedAt);
  let wroteStory = false;
  try {
    await writeFile(target, `${JSON.stringify(story, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    wroteStory = true;
    for (const command of ["build", "check", "test"]) {
      await run(process.execPath, [path.join(repoRoot, "scripts", "content.mjs"), command], repoRoot);
      if (options.failAfter === command) fail(`Injected failure after ${command}`);
    }
    const feed = JSON.parse(await readFile(feedFile, "utf8"));
    if (feed.length !== previousCount + 1) fail("Generated public feed did not increment by exactly one story");
    if (!feed.some((item) => item.id === story.id)) fail("Generated public feed does not contain the prepared story");
    const keys = Object.keys(story);
    if (keys.length !== PUBLIC_FIELDS.length || keys.some((key) => !PUBLIC_FIELDS.includes(key))) fail("Generated story contains non-public fields");
    console.log(`Publication prepared: ${story.id} at ${publishedAt}`);
    return { story, previousCount, nextCount: feed.length };
  } catch (error) {
    if (wroteStory) await rm(target, { force: true });
    await writeFile(feedFile, previousFeed, "utf8");
    throw error;
  }
}

function clone(value) {
  return structuredClone(value);
}

async function expectFailure(label, action, expected) {
  try {
    await action();
  } catch (error) {
    if (!error.message.includes(expected)) fail(`${label}: expected ${JSON.stringify(expected)}, got ${error.message}`);
    return;
  }
  fail(`${label}: expected failure`);
}

async function initializeTempRepo(basePackage) {
  const root = await mkdtemp(path.join(tmpdir(), "sbns-publication-"));
  await Promise.all([
    mkdir(path.join(root, "scripts"), { recursive: true }),
    mkdir(path.join(root, "content", "stories"), { recursive: true }),
    mkdir(path.join(root, "public"), { recursive: true }),
    mkdir(path.join(root, "publication", "schemas"), { recursive: true }),
  ]);
  await copyFile(path.join(ROOT, "scripts", "content.mjs"), path.join(root, "scripts", "content.mjs"));
  await copyFile(SCHEMA_FILE, path.join(root, "publication", "schemas", "package.schema.json"));
  const existing = {
    id: "existing-sample",
    status: "published",
    content_type: "sample",
    category: "Local",
    headline: "Existing sample",
    summary: "Existing summary",
    fml_kicker: "Existing kicker",
    severity: 1,
    topic_tags: ["sample"],
    sources: [{ name: "Synthetic sample", url: null }],
    published_at: "2026-08-18T00:00:00Z"
  };
  await writeFile(path.join(root, "content", "stories", "existing.json"), `${JSON.stringify(existing, null, 2)}\n`);
  await writeFile(path.join(root, "public", "stories.json"), `${JSON.stringify([existing], null, 2)}\n`);
  await writeFile(path.join(root, "package.json"), '{"type":"module"}\n');
  const packageFile = path.join(root, "package.json.fixture");
  await writeFile(packageFile, `${JSON.stringify(basePackage, null, 2)}\n`);
  await run("git", ["init", "-b", "main"], root);
  await run("git", ["config", "user.email", "fixture@example.com"], root);
  await run("git", ["config", "user.name", "SBNS Fixture"], root);
  await run("git", ["add", "."], root);
  await run("git", ["commit", "-m", "fixture baseline"], root);
  return { root, packageFile };
}

async function test() {
  const schema = await readJson(SCHEMA_FILE);
  const valid = await readJson(FIXTURE_FILE);
  validateAgainstSchema(valid, schema);
  validatePackageSemantics(valid);
  let count = 1;
  const mutation = async (label, change, expected) => {
    const value = clone(valid);
    change(value);
    await expectFailure(label, async () => { validateAgainstSchema(value, schema); validatePackageSemantics(value); }, expected);
    count += 1;
  };
  await mutation("decision", (v) => { v.human_decision = "hold"; }, "expected");
  await mutation("story id", (v) => { v.story.id = "Bad ID"; }, "invalid format");
  await mutation("headline", (v) => { v.story.headline = ""; }, "must not be empty");
  await mutation("summary", (v) => { v.story.summary = ""; }, "must not be empty");
  await mutation("kicker", (v) => { v.story.fml_kicker = ""; }, "must not be empty");
  await mutation("severity", (v) => { v.story.severity = 6; }, "above maximum");
  await mutation("tags", (v) => { v.story.topic_tags = []; }, "requires at least");
  await mutation("sources", (v) => { v.story.sources = []; }, "requires at least");
  await mutation("source url", (v) => { v.story.sources[0].url = "ftp://example.com"; }, "HTTP(S)");
  await mutation("origin", (v) => { v.source_analysis.intake_origin = "robot"; }, "not allowed");

  const duplicateRepo = await initializeTempRepo(valid);
  try {
    const duplicate = clone(valid);
    duplicate.story.id = "existing-sample";
    await writeFile(duplicateRepo.packageFile, `${JSON.stringify(duplicate)}\n`);
    await expectFailure("duplicate id", () => checkPackage(duplicateRepo.packageFile, duplicateRepo.root), "Story ID already exists");
    count += 1;
    const targetOnly = clone(valid);
    targetOnly.story.id = "target-only";
    await writeFile(path.join(duplicateRepo.root, "content", "stories", "target-only.json"), "{}\n");
    await writeFile(duplicateRepo.packageFile, `${JSON.stringify(targetOnly)}\n`);
    await expectFailure("existing target", () => checkPackage(duplicateRepo.packageFile, duplicateRepo.root), "Target story file already exists");
    count += 1;
  } finally { await rm(duplicateRepo.root, { recursive: true, force: true }); }

  const mainRepo = await initializeTempRepo(valid);
  try {
    await expectFailure("main refusal", () => preparePackage(mainRepo.packageFile, mainRepo.root), "feature branch, not main");
    count += 1;
    await run("git", ["switch", "-c", "feature/test"], mainRepo.root);
    await writeFile(path.join(mainRepo.root, "dirty.txt"), "dirty\n");
    await expectFailure("dirty refusal", () => preparePackage(mainRepo.packageFile, mainRepo.root), "clean Git worktree");
    count += 1;
  } finally { await rm(mainRepo.root, { recursive: true, force: true }); }

  const successRepo = await initializeTempRepo(valid);
  try {
    await run("git", ["switch", "-c", "feature/test"], successRepo.root);
    const prepared = await preparePackage(successRepo.packageFile, successRepo.root, { now: "2026-08-19T21:00:00.000Z" });
    const keys = Object.keys(prepared.story);
    if (keys.length !== PUBLIC_FIELDS.length || keys.some((key) => !PUBLIC_FIELDS.includes(key))) fail("mapping test failed");
    count += 1;
    if (prepared.previousCount !== 1 || prepared.nextCount !== 2) fail("feed increment test failed");
    count += 1;
  } finally { await rm(successRepo.root, { recursive: true, force: true }); }

  const rollbackRepo = await initializeTempRepo(valid);
  try {
    await run("git", ["switch", "-c", "feature/test"], rollbackRepo.root);
    const before = await readFile(path.join(rollbackRepo.root, "public", "stories.json"), "utf8");
    await expectFailure("rollback", () => preparePackage(rollbackRepo.packageFile, rollbackRepo.root, { failAfter: "build" }), "Injected failure");
    const after = await readFile(path.join(rollbackRepo.root, "public", "stories.json"), "utf8");
    if (before !== after) fail("rollback did not restore feed");
    const files = await readdir(path.join(rollbackRepo.root, "content", "stories"));
    if (files.some((file) => file === `${valid.story.id}.json`)) fail("rollback did not remove story");
    count += 1;
  } finally { await rm(rollbackRepo.root, { recursive: true, force: true }); }

  console.log(`Publication tests passed: ${count} scenarios, including mapping, feed increment, branch/worktree guards, and rollback.`);
}

async function checkCommand(argument) {
  if (argument) return checkPackage(path.resolve(argument));
  await validatePackageFile(FIXTURE_FILE);
  console.log("Publication contract valid: 1 schema, 1 golden package fixture.");
}

const [command, argument] = process.argv.slice(2);
if (!COMMANDS.has(command) || (command === "prepare" && !argument)) {
  console.error("Usage: node scripts/publish.mjs <check [package-file]|prepare package-file|test>");
  process.exitCode = 1;
} else {
  try {
    if (command === "check") await checkCommand(argument);
    if (command === "prepare") await preparePackage(path.resolve(argument));
    if (command === "test") await test();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
