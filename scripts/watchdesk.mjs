import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminHandler } from "../src/admin-index.js";
import { parseHtmlLinks, parseRssAtom } from "../src/watchdesk-adapters.js";
import { buildCandidate, deterministicFilter, fitGate, MAX_SUBMISSIONS_PER_RUN, normalizeDiscoveryUrl, runWatchdeskScan, triageCandidate } from "../src/watchdesk.js";
import { SOURCE_CLASSES, WATCHDESK_SOURCES, validateSourceRegistry } from "../watchdesk/source-registry.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "watchdesk", "fixtures");
const COMMANDS = new Set(["check", "test", "dry-run"]);
const FIXED_NOW = "2026-09-22T12:00:00.000Z";

async function fixtureData() { return JSON.parse(await readFile(path.join(FIXTURE_DIR, "synthetic-cases.json"), "utf8")); }
function source(id) { return WATCHDESK_SOURCES.find((entry) => entry.id === id); }
function fixture(data, id) { return data.cases.find((entry) => entry.id === id); }
function registryFor(id) { return [structuredClone(source(id))]; }
function discovery(item) { return async () => [structuredClone(item)]; }
function noKnown() { return []; }

async function check() {
  validateSourceRegistry();
  const data = await fixtureData();
  const expected = ["strong-gao-style-candidate", "duplicate-known-url", "existing-published-story-development", "generic-press-release-weak-fit", "partisan-opinion-no-primary-evidence", "secondary-with-primary-record", "secondary-primary-needed", "local-accountability-candidate", "unchanged-repeated-scan", "source-fetch-failure", "zero-qualifying-candidates"];
  assert.equal(data.notice.startsWith("SYNTHETIC-ONLY"), true);
  assert.deepEqual(data.cases.map((entry) => entry.id), expected);
  assert.equal(WATCHDESK_SOURCES.length, 5);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.source_class === "primary_oversight"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.source_class === "secondary_reporting_signal"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.source_class === "local_regional"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.jurisdiction === "Iowa"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.jurisdiction === "Dubuque, Iowa"), true);
  assert.equal([...SOURCE_CLASSES].length, 4);
  for (const entry of WATCHDESK_SOURCES) {
    assert.equal(new URL(entry.discovery_url).protocol, "https:");
    assert.equal(JSON.stringify(entry).match(/token|secret|password/i), null);
  }
  const config = await readFile(path.join(ROOT, "wrangler.admin.jsonc"), "utf8");
  assert.equal(/\bcrons?\b|scheduled\s*:/i.test(config), false);
  const migrations = (await readdir(path.join(ROOT, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(migrations, ["0001_editorial_foundation.sql", "0002_admin_queue.sql", "0003_live_analysis.sql"]);
  console.log("Watchdesk check passed: 5 curated sources, 11 synthetic fixture cases, no schedule, and no schema migration.");
}

async function test() {
  const data = await fixtureData();
  let count = 0;
  const pass = (condition, message) => { assert.ok(condition, message); count += 1; };
  const gao = source("gao-reports");
  const html = await readFile(path.join(FIXTURE_DIR, "synthetic-listing.html"), "utf8");
  const htmlItems = parseHtmlLinks(html, gao);
  pass(htmlItems.length === 1, "HTML adapter must produce one bounded item and ignore script content");
  pass(htmlItems[0].published_at === "2026-09-20T00:00:00.000Z", "HTML adapter must retain the release date");
  pass(!htmlItems[0].title.includes("script"), "HTML adapter must return text, not executable markup");
  const xml = await readFile(path.join(FIXTURE_DIR, "synthetic-feed.xml"), "utf8");
  const rssItems = parseRssAtom(xml, { ...gao, adapter: "rss_atom" });
  pass(rssItems.length === 1 && rssItems[0].published_at === "2026-09-20T12:00:00.000Z", "RSS/Atom adapter must normalize output and dates");
  pass(rssItems[0].summary === "A synthetic review summary.", "RSS adapter must reduce markup to plain text");
  pass(normalizeDiscoveryUrl("HTTPS://Example.COM:443/report/?utm_source=x&b=2&a=1#part") === "https://example.com/report?a=1&b=2", "URL normalization must remove tracking, default port, fragment, and obvious trailing slash");
  pass(normalizeDiscoveryUrl("https://example.com/report?case=7") === "https://example.com/report?case=7", "URL normalization must preserve meaningful query parameters");

  const strongCase = fixture(data, "strong-gao-style-candidate");
  const strong = await buildCandidate(strongCase.item, source(strongCase.source_id), FIXED_NOW, "run_test");
  pass(strong.publication_date === "2026-09-20T00:00:00.000Z", "candidate must retain publication date");
  pass(strong.original_url.includes("utm_source=test") && !strong.normalized_url.includes("utm_"), "candidate must retain original URL while storing a normalized URL");
  pass(fitGate(strong, strongCase.item).passes, "strong primary watchdog record must survive the fit gate");
  pass(triageCandidate(strong, strongCase.item, fitGate(strong, strongCase.item)).recommendation === "DEVELOP", "strong supported candidate may receive DEVELOP");
  const noJobItem = { ...strongCase.item, apparent_job: undefined, url: "https://www.gao.gov/products/gao-26-synthetic-no-job" };
  const noJob = await buildCandidate(noJobItem, gao, FIXED_NOW, "run_test");
  pass(noJob.apparent_job === null, "Watchdesk must not fabricate the Job");

  const weakCase = fixture(data, "generic-press-release-weak-fit");
  pass(!deterministicFilter(weakCase.item, source(weakCase.source_id)).passes, "generic press-release churn must stop deterministically");
  const opinionCase = fixture(data, "partisan-opinion-no-primary-evidence");
  pass(deterministicFilter(opinionCase.item, source(opinionCase.source_id)).reason === "opinion_or_partisan_commentary", "unsupported partisan opinion must stop");
  const secondaryCase = fixture(data, "secondary-with-primary-record");
  const secondary = await buildCandidate(secondaryCase.item, source(secondaryCase.source_id), FIXED_NOW, "run_test");
  pass(secondary.primary_record_status === "PRIMARY RECORD FOUND" && secondary.key_sources.length === 2, "secondary reporting must retain an identified primary record");
  const neededCase = fixture(data, "secondary-primary-needed");
  const needed = await buildCandidate(neededCase.item, source(neededCase.source_id), FIXED_NOW, "run_test");
  pass(needed.primary_record_status === "SECONDARY SIGNAL — PRIMARY RECORD NEEDED" && needed.research_burden === "HIGH", "missing primary record must remain explicit");
  pass(triageCandidate(needed, neededCase.item, fitGate(needed, neededCase.item)).recommendation === "EXPLORE", "bounded secondary signal may receive EXPLORE");
  const stop = triageCandidate(strong, { ...strongCase.item, novelty: false }, fitGate(strong, strongCase.item));
  pass(stop.recommendation === "STOP / NO ACTION", "Rabbit Hole STOP must remain valid");
  const route = triageCandidate(strong, { ...strongCase.item, route: true }, fitGate(strong, strongCase.item));
  pass(route.recommendation === "ROUTE", "Rabbit Hole ROUTE must remain valid");

  const stored = [];
  const lookupDiscovery = async (candidate) => stored.filter((row) => row.submitted_url === candidate.normalized_url || JSON.parse(row.discovery_metadata_json).candidate.title_fingerprint === candidate.title_fingerprint);
  const submitCandidate = async (candidate) => {
    const intake = { id: `synthetic-${stored.length + 1}`, origin: "discovery", submitted_url: candidate.normalized_url, status: "submitted", analysis_status: "not_started" };
    stored.push({ ...intake, discovery_metadata_json: JSON.stringify({ candidate }) });
    return intake;
  };
  const runOptions = { registry: registryFor(strongCase.source_id), discoverSource: discovery(strongCase.item), lookupDiscovery, lookupMonitoring: async () => null, submitCandidate, now: () => FIXED_NOW, runId: "synthetic_run" };
  const first = await runWatchdeskScan({}, runOptions);
  pass(first.metrics.submitted_to_newsroom === 1 && stored[0].origin === "discovery", "qualifying candidate must enter the existing discovery intake queue");
  const queued = stored[0];
  const queuedCandidate = JSON.parse(queued.discovery_metadata_json).candidate;
  pass(queued.submitted_url === strong.normalized_url, "queue insertion must retain the normalized source URL");
  pass(queuedCandidate.institution_or_system === "Synthetic Grant Administration" && queuedCandidate.jurisdiction === "United States", "queue insertion must retain institution and jurisdiction");
  pass(Boolean(queuedCandidate.apparent_job && queuedCandidate.record_summary && queuedCandidate.accountability_question), "queue insertion must retain Job, Record, and accountability question");
  pass(Boolean(queuedCandidate.material_qualification && queuedCandidate.remains_unproven), "queue insertion must retain qualifications and uncertainty");
  pass(queuedCandidate.research_burden === "LOW" && queuedCandidate.provenance.automated === true, "queue insertion must retain burden and automation provenance");
  pass(queuedCandidate.triage.recommendation === "DEVELOP" && !Object.hasOwn(queuedCandidate, "editorial_decision"), "automated triage must remain distinct from editorial decision");
  const repeated = await runWatchdeskScan({}, runOptions);
  pass(repeated.metrics.duplicates_known === 1 && repeated.metrics.submitted_to_newsroom === 0 && stored.length === 1, "unchanged repeated scan must be idempotent");
  const changedItem = { ...strongCase.item, published_at: "2026-09-22T00:00:00.000Z", record_summary: `${strongCase.item.record_summary} A later synthetic corrective-action notice was added.` };
  const changed = await runWatchdeskScan({}, { ...runOptions, discoverSource: discovery(changedItem), runId: "synthetic_changed" });
  pass(changed.metrics.submitted_to_newsroom === 1 && changed.candidates[0].related_intake_id === "synthetic-1", "materially new development may create a related intake");

  const exactPublishedItem = { ...strongCase.item, title: "Synthetic Air Traffic Control Audit Found Planning Still Incomplete", url: "https://www.gao.gov/products/gao-26-108468", institution: "Federal Aviation Administration" };
  const exactPublished = await runWatchdeskScan({}, { ...runOptions, discoverSource: discovery(exactPublishedItem), lookupDiscovery: async () => [], submitCandidate: async () => { throw new Error("must not submit"); }, dryRun: true });
  pass(exactPublished.metrics.duplicates_known === 1 && exactPublished.metrics.would_submit === 0, "published source URL must be identified before submission");
  const developmentCase = fixture(data, "existing-published-story-development");
  const development = await runWatchdeskScan({}, { ...runOptions, registry: registryFor(developmentCase.source_id), discoverSource: discovery(developmentCase.item), lookupDiscovery: async () => [], dryRun: true });
  pass(development.candidates[0].published_story_relationship?.story_id === "faa-bnatcs-gao-cost-schedule-review", "new published-story development must surface its relationship without mutating the story");
  const monitored = await runWatchdeskScan({}, { ...runOptions, discoverSource: discovery({ ...strongCase.item, url: "https://www.gao.gov/products/gao-26-synthetic-monitor" }), lookupDiscovery: async () => [], lookupMonitoring: async () => ({ id: "monitor-synthetic" }), dryRun: true });
  pass(monitored.metrics.duplicates_known === 1 && monitored.metrics.would_submit === 0, "existing monitor must suppress redundant discovery intake");

  const many = Array.from({ length: 7 }, (_, index) => ({ ...strongCase.item, title: `Synthetic Grant ${index}: Audit Found Controls Failed and Costs Overran Plan`, url: `https://www.gao.gov/products/gao-26-synthetic-cap-${index}`, institution: `Synthetic Grant Office ${index}` }));
  const capped = await runWatchdeskScan({}, { ...runOptions, discoverSource: async () => many, lookupDiscovery: async () => [], dryRun: true });
  pass(capped.metrics.would_submit === MAX_SUBMISSIONS_PER_RUN && capped.metrics.deferred_by_ceiling === 2 && capped.deferred_candidates.length === 2, "per-run ceiling must be five and preserve the remainder as deferred");
  const one = await runWatchdeskScan({}, { ...runOptions, lookupDiscovery: async () => [], dryRun: true });
  pass(one.metrics.would_submit === 1, "submission ceiling must not become a quota");
  const zeroCase = fixture(data, "zero-qualifying-candidates");
  const zero = await runWatchdeskScan({}, { ...runOptions, registry: registryFor(zeroCase.source_id), discoverSource: discovery(zeroCase.item), lookupDiscovery: async () => [], dryRun: true });
  pass(zero.metrics.would_submit === 0 && zero.message === "No worthwhile SBNS discovery candidates this run.", "zero submissions must be a successful result");
  const failureSource = registryFor("iowa-auditor-reports")[0];
  const partial = await runWatchdeskScan({}, { ...runOptions, registry: [failureSource, ...registryFor(strongCase.source_id)], discoverSource: async (entry) => { if (entry.id === failureSource.id) throw new Error("SYNTHETIC_SOURCE_UNAVAILABLE"); return [strongCase.item]; }, lookupDiscovery: async () => [], dryRun: true });
  pass(partial.status === "partial" && partial.source_failures.length === 1 && partial.metrics.would_submit === 1, "one source failure must be visible without aborting independent sources");

  let capturedOptions;
  const handler = createAdminHandler({ authenticate: async () => ({ actorType: "editor", actorId: "editor@example.com", email: "editor@example.com" }), executeWatchdesk: async (_env, options) => { capturedOptions = options; return { ok: true, dry_run: options.dryRun, metrics: {} }; } });
  const apiResponse = await handler(new Request("https://admin.example/api/admin/watchdesk/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dry_run: true }) }), {});
  pass(apiResponse.status === 200 && capturedOptions.dryRun === true && capturedOptions.requestedBy === "editor@example.com", "authenticated on-demand API must pass actor provenance and dry-run mode");
  const invalidResponse = await handler(new Request("https://admin.example/api/admin/watchdesk/runs", { method: "POST", body: JSON.stringify({ publish: true }) }), {});
  pass(invalidResponse.status === 400, "on-demand API must reject capabilities outside its bounded contract");

  const implementation = await readFile(path.join(ROOT, "src", "watchdesk.js"), "utf8");
  pass(!/ANALYSIS_QUEUE|insertPublicationAttempt|sendEmail|mailto:|content\/stories/.test(implementation), "Watchdesk must not queue formal analysis, publish, contact subjects, or write story source files");
  const adminConfig = await readFile(path.join(ROOT, "wrangler.admin.jsonc"), "utf8");
  pass(!/\bcrons?\b|scheduled\s*:/i.test(adminConfig), "Watchdesk must not activate a production schedule");
  pass(first.submitted.every((entry) => entry.intake_id.startsWith("synthetic-")), "test suite must use synthetic in-memory queue records only");

  console.log(`Watchdesk tests passed: ${count} deterministic scenarios covering adapters, dates, normalization, fit, triage, dedupe, idempotency, queue context, limits, failures, and safety.`);
}

async function dryRun() {
  const data = await fixtureData();
  const bySource = new Map(WATCHDESK_SOURCES.map((entry) => [entry.id, []]));
  for (const entry of data.cases) if (entry.item) bySource.get(entry.source_id).push(entry.item);
  const result = await runWatchdeskScan({}, {
    registry: WATCHDESK_SOURCES,
    discoverSource: async (entry) => {
      if (fixture(data, "source-fetch-failure").source_id === entry.id) throw new Error("SYNTHETIC_SOURCE_UNAVAILABLE");
      return structuredClone(bySource.get(entry.id));
    },
    lookupDiscovery: async (candidate) => candidate.normalized_url.includes("synthetic-duplicate") ? [{ id: "synthetic-existing", submitted_url: candidate.normalized_url, discovery_metadata_json: JSON.stringify({ candidate }) }] : [],
    lookupMonitoring: async () => null,
    submitCandidate: async () => { throw new Error("Synthetic dry run must never submit."); },
    dryRun: true,
    now: () => FIXED_NOW,
    runId: "synthetic_fixture_dry_run",
  });
  console.log(JSON.stringify({ notice: data.notice, ...result }, null, 2));
}

const command = process.argv[2];
if (!COMMANDS.has(command) || process.argv.length !== 3) {
  console.error("Usage: node scripts/watchdesk.mjs <check|test|dry-run>");
  process.exitCode = 1;
} else {
  try {
    if (command === "check") await check();
    if (command === "test") await test();
    if (command === "dry-run") await dryRun();
  } catch (error) {
    console.error(`Watchdesk ${command} failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
