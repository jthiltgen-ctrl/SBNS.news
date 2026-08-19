import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = resolve(process.env.SBNS_CONTENT_DIR || join(ROOT, "content", "stories"));
const OUTPUT_FILE = resolve(process.env.SBNS_OUTPUT_FILE || join(ROOT, "public", "stories.json"));
const COMMANDS = new Set(["build", "check", "test"]);
const REQUIRED_FIELDS = [
  "id",
  "status",
  "content_type",
  "category",
  "headline",
  "summary",
  "fml_kicker",
  "severity",
  "topic_tags",
  "sources",
  "published_at",
];
const STATUSES = new Set(["draft", "published"]);
const CONTENT_TYPES = new Set(["sample", "reporting"]);
const CATEGORIES = new Set(["International", "National", "Local"]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidTimestamp(value) {
  return (
    isNonEmptyString(value) &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateStory(story, filename) {
  const errors = [];
  const issue = (message) => errors.push(`${filename}: ${message}`);

  if (!story || typeof story !== "object" || Array.isArray(story)) {
    return [`${filename}: story must be a JSON object`];
  }

  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(story, field)) issue(`missing required field "${field}"`);
  }

  if (!isNonEmptyString(story.id) || !ID_PATTERN.test(story.id)) {
    issue('"id" must be a non-empty lowercase slug');
  }
  if (!STATUSES.has(story.status)) issue('"status" must be "draft" or "published"');
  if (!CONTENT_TYPES.has(story.content_type)) {
    issue('"content_type" must be "sample" or "reporting"');
  }
  if (!CATEGORIES.has(story.category)) {
    issue('"category" must be International, National, or Local');
  }

  for (const field of ["headline", "summary", "fml_kicker"]) {
    if (!isNonEmptyString(story[field])) issue(`"${field}" must be a non-empty string`);
  }

  if (!Number.isInteger(story.severity) || story.severity < 1 || story.severity > 5) {
    issue('"severity" must be an integer from 1 through 5');
  }

  if (!Array.isArray(story.topic_tags)) {
    issue('"topic_tags" must be an array of strings');
  } else if (story.topic_tags.some((tag) => !isNonEmptyString(tag))) {
    issue('"topic_tags" entries must be non-empty strings');
  }

  if (!Array.isArray(story.sources)) {
    issue('"sources" must be an array');
  } else {
    story.sources.forEach((source, index) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        issue(`"sources[${index}]" must be an object with name and url`);
        return;
      }
      if (!isNonEmptyString(source.name)) {
        issue(`"sources[${index}].name" must be a non-empty string`);
      }
      if (!Object.hasOwn(source, "url")) {
        issue(`"sources[${index}]" is missing required field "url"`);
      } else if (source.url !== null && source.url !== "" && !isValidHttpUrl(source.url)) {
        issue(`"sources[${index}].url" must be null, empty, or a valid http:// or https:// URL`);
      }
    });
  }

  if (story.published_at !== null && !isValidTimestamp(story.published_at)) {
    issue('"published_at" must be null or a valid ISO-8601 timestamp');
  }
  if (story.status === "published" && !isValidTimestamp(story.published_at)) {
    issue('published stories require a valid "published_at" timestamp');
  }

  if (story.status === "published" && story.content_type === "reporting") {
    if (!Array.isArray(story.sources) || story.sources.length === 0) {
      issue("published reporting stories require at least one source");
    } else if (!story.sources.some((source) => source && isValidHttpUrl(source.url))) {
      issue("published reporting stories require at least one valid http:// or https:// source URL");
    }
  }

  return errors;
}

function normalizedStory(story) {
  return {
    id: story.id,
    status: story.status,
    content_type: story.content_type,
    category: story.category,
    headline: story.headline,
    summary: story.summary,
    fml_kicker: story.fml_kicker,
    severity: story.severity,
    topic_tags: story.topic_tags,
    sources: story.sources.map(({ name, url }) => ({ name, url })),
    published_at: story.published_at,
  };
}

function generateFeed(stories) {
  const published = stories
    .filter(({ story }) => story.status === "published")
    .map(({ story }) => normalizedStory(story))
    .sort((a, b) => {
      const newestFirst = b.published_at.localeCompare(a.published_at);
      return newestFirst || a.id.localeCompare(b.id);
    });

  return `${JSON.stringify(published, null, 2)}\n`;
}

async function loadStories(contentDir = CONTENT_DIR) {
  let entries;
  try {
    entries = await readdir(contentDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Unable to read content directory ${contentDir}: ${error.message}`);
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const stories = [];
  const errors = [];

  for (const filename of files) {
    const path = join(contentDir, filename);
    let story;
    try {
      story = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      errors.push(`${filename}: invalid JSON (${error.message})`);
      continue;
    }
    errors.push(...validateStory(story, filename));
    stories.push({ filename, story });
  }

  const ids = new Map();
  for (const { filename, story } of stories) {
    if (!isNonEmptyString(story.id)) continue;
    if (ids.has(story.id)) {
      errors.push(`${filename}: duplicate id "${story.id}" also used by ${ids.get(story.id)}`);
    } else {
      ids.set(story.id, filename);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Content validation failed:\n- ${errors.join("\n- ")}`);
  }
  return stories;
}

async function build() {
  const stories = await loadStories();
  const output = generateFeed(stories);
  await writeFile(OUTPUT_FILE, output, "utf8");
  const publishedCount = stories.filter(({ story }) => story.status === "published").length;
  console.log(`Built ${publishedCount} published stories -> ${OUTPUT_FILE}`);
}

async function check() {
  const stories = await loadStories();
  const expected = generateFeed(stories);
  let actual;
  try {
    actual = await readFile(OUTPUT_FILE, "utf8");
  } catch (error) {
    throw new Error(`Unable to read generated feed ${OUTPUT_FILE}: ${error.message}`);
  }
  if (actual !== expected) {
    throw new Error(`Generated feed is out of date. Run: npm run content:build`);
  }
  console.log(`Content valid; ${OUTPUT_FILE} matches deterministic generated output.`);
}

function validFixture(overrides = {}) {
  return {
    id: "fixture-story",
    status: "published",
    content_type: "sample",
    category: "Local",
    headline: "Fixture headline",
    summary: "Fixture summary",
    fml_kicker: "Fixture kicker",
    severity: 3,
    topic_tags: ["fixture"],
    sources: [{ name: "Fixture source", url: null }],
    published_at: "2026-08-18T12:00:00Z",
    ...overrides,
  };
}

function expectInvalid(story, expectedMessage) {
  const errors = validateStory(story, "fixture.json");
  if (!errors.some((error) => error.includes(expectedMessage))) {
    throw new Error(`Expected validation failure containing "${expectedMessage}", got: ${errors.join("; ")}`);
  }
}

async function test() {
  expectInvalid({ ...validFixture(), headline: undefined }, '"headline" must be a non-empty string');
  const missingRequired = validFixture();
  delete missingRequired.summary;
  expectInvalid(missingRequired, 'missing required field "summary"');
  expectInvalid(validFixture({ status: "review" }), '"status" must be "draft" or "published"');
  expectInvalid(validFixture({ content_type: "article" }), '"content_type" must be "sample" or "reporting"');
  expectInvalid(validFixture({ category: "Regional" }), '"category" must be International, National, or Local');
  expectInvalid(validFixture({ severity: 6 }), '"severity" must be an integer from 1 through 5');
  expectInvalid(validFixture({ topic_tags: "fixture" }), '"topic_tags" must be an array of strings');
  expectInvalid(validFixture({ sources: "Fixture source" }), '"sources" must be an array');
  expectInvalid(validFixture({ published_at: "next Tuesday" }), '"published_at" must be null or a valid ISO-8601 timestamp');
  expectInvalid(validFixture({ published_at: null }), 'published stories require a valid "published_at" timestamp');
  expectInvalid(
    validFixture({ content_type: "reporting", sources: [] }),
    "published reporting stories require at least one source",
  );
  expectInvalid(
    validFixture({ content_type: "reporting", sources: [{ name: "Source", url: null }] }),
    "at least one valid http:// or https:// source URL",
  );

  const duplicateStories = [
    { filename: "one.json", story: validFixture() },
    { filename: "two.json", story: validFixture() },
  ];
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "sbns-content-"));
  try {
    await writeFile(join(temporaryDirectory, "invalid.json"), "{ not valid JSON }\n", "utf8");
    let invalidJsonFailed = false;
    try {
      await loadStories(temporaryDirectory);
    } catch (error) {
      invalidJsonFailed = error.message.includes("invalid JSON");
    }
    if (!invalidJsonFailed) throw new Error("Invalid JSON fixture did not fail validation");
    await rm(join(temporaryDirectory, "invalid.json"));

    await Promise.all(
      duplicateStories.map(({ filename, story }) =>
        writeFile(join(temporaryDirectory, filename), `${JSON.stringify(story)}\n`, "utf8"),
      ),
    );
    let duplicateFailed = false;
    try {
      await loadStories(temporaryDirectory);
    } catch (error) {
      duplicateFailed = error.message.includes("duplicate id");
    }
    if (!duplicateFailed) throw new Error("Duplicate ID fixture did not fail validation");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const draft = validFixture({ id: "draft-fixture", status: "draft", published_at: null });
  const published = validFixture({ id: "published-fixture" });
  const first = generateFeed([
    { filename: "draft.json", story: draft },
    { filename: "published.json", story: published },
  ]);
  const second = generateFeed([
    { filename: "published.json", story: published },
    { filename: "draft.json", story: draft },
  ]);
  if (first !== second) throw new Error("Generated feed is not deterministic");
  const parsed = JSON.parse(first);
  if (parsed.length !== 1 || parsed[0].id !== "published-fixture") {
    throw new Error("Draft fixture was not excluded from generated feed");
  }

  console.log("Content tests passed: schema failures, invalid JSON, duplicate IDs, reporting sources, drafts, determinism.");
}

const command = process.argv[2];
if (!COMMANDS.has(command)) {
  console.error("Usage: node scripts/content.mjs <build|check|test>");
  process.exitCode = 1;
} else {
  try {
    await { build, check, test }[command]();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
