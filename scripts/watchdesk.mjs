import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAdminHandler, createScheduledHandler } from "../src/admin-index.js";
import { fetchRegistrySource, parseHtmlLinks, parseRssAtom } from "../src/watchdesk-adapters.js";
import { discoverySearchUrl, searchPublicDiscovery } from "../src/editorial-search.js";
import { buildCandidate, deterministicFilter, fitGate, MAX_SUBMISSIONS_PER_RUN, normalizeDiscoveryUrl, runWatchdeskScan, submissionReadiness, triageCandidate } from "../src/watchdesk.js";
import { clusterWatchdeskItems, generateOpenSweepQueries, OPEN_SWEEP_QUERY_LIMIT, OPEN_SWEEP_RESULTS_PER_QUERY, OPEN_SWEEP_TIMEOUT_MS, OPEN_SWEEP_TOTAL_RESULT_LIMIT, runOpenSweep, triageOpenSweepCluster } from "../src/watchdesk-open-discovery.js";
import { getWatchdeskMachineHealth, getWatchdeskStatus, runWatchdeskOperation, WATCHDESK_CRON, WATCHDESK_LEASE_MS } from "../src/watchdesk-operations.js";
import { storeDiscoveryCandidate } from "../src/persistence.js";
import { SOURCE_CLASSES, WATCHDESK_SOURCES, validateSourceRegistry } from "../watchdesk/source-registry.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "watchdesk", "fixtures");
const COMMANDS = new Set(["check", "test", "dry-run", "probe"]);
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
  const expected = ["strong-gao-style-candidate", "duplicate-known-url", "existing-published-story-development", "generic-press-release-weak-fit", "partisan-opinion-no-primary-evidence", "secondary-with-primary-record", "secondary-primary-needed", "local-accountability-candidate", "unchanged-repeated-scan", "official-listing-only", "partially-reviewed-primary", "boilerplate-only", "telecom-compliance-without-gap", "tribal-water-explicit-gap", "gsa-accessibility-explicit-gap", "property-disposal-progress-only", "global-aging-implications-only", "aperture-waste-without-discrete-failure", "aperture-recurring-burden-development", "source-fetch-failure", "zero-qualifying-candidates"];
  assert.equal(data.notice.startsWith("SYNTHETIC-ONLY"), true);
  assert.deepEqual(data.cases.map((entry) => entry.id), expected);
  assert.equal(WATCHDESK_SOURCES.length, 12);
  assert.equal(WATCHDESK_SOURCES.filter((entry) => entry.enabled).length, 9);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.source_class === "primary_oversight"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.source_class === "secondary_reporting_signal"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.source_class === "local_regional"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.source_class === "public_whistleblower_signal"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.jurisdiction === "Iowa"), true);
  assert.equal(WATCHDESK_SOURCES.some((entry) => entry.jurisdiction === "Dubuque, Iowa"), true);
  assert.equal(source("gao-reports").discovery_url, "https://www.gao.gov/rss/reports.xml");
  assert.equal(source("gao-reports").adapter, "rss_atom");
  assert.equal([...SOURCE_CLASSES].length, 5);
  for (const entry of WATCHDESK_SOURCES) {
    assert.equal(new URL(entry.discovery_url).protocol, "https:");
    assert.equal(JSON.stringify(entry).match(/token|secret|password/i), null);
  }
  const openQueries = generateOpenSweepQueries(new Date(FIXED_NOW));
  assert.equal(openQueries.length, OPEN_SWEEP_QUERY_LIMIT);
  assert.deepEqual(openQueries.slice(0, 9).map((entry) => entry.lens_id), ["human_burden", "bureaucratic_absurdity", "ignored_warning", "no_one_owns_problem", "little_guy_pays", "technical_compliance_failure", "waste_broken_delivery", "no_recourse", "fml_discovery"]);
  assert.equal(openQueries.filter((entry) => entry.tone_abs_threshold != null).length, 1);
  assert.notDeepEqual(openQueries.map((entry) => entry.formulation), generateOpenSweepQueries(new Date("2026-09-23T14:00:00.000Z")).map((entry) => entry.formulation), "query formulation should rotate by scheduled run window");
  assert.notDeepEqual(generateOpenSweepQueries(new Date("2026-09-22T14:00:00.000Z")).map((entry) => entry.formulation), generateOpenSweepQueries(new Date("2026-09-22T23:00:00.000Z")).map((entry) => entry.formulation), "the two daily scheduled runs should use distinct query rotations");
  assert.notDeepEqual(generateOpenSweepQueries(new Date("2026-09-22T23:00:00.000Z")).map((entry) => entry.formulation), generateOpenSweepQueries(new Date("2026-09-23T14:00:00.000Z")).map((entry) => entry.formulation), "adjacent evening and next-morning scheduled runs should keep rotating");
  const toneUrl = new URL(discoverySearchUrl("residents say agency", { maxRecords: 6, toneAbsThreshold: 10 }));
  assert.equal(toneUrl.host, "api.gdeltproject.org");
  assert.equal(toneUrl.searchParams.get("maxrecords"), "6");
  assert.equal(toneUrl.searchParams.get("query"), "residents say agency toneabs>10");
  assert.throws(() => discoverySearchUrl("residents say agency toneabs>10"), /plain-text/);
  assert.throws(() => discoverySearchUrl("residents say agency", { maxRecords: 11 }), /result limit/);
  assert.throws(() => discoverySearchUrl("residents say agency", { toneAbsThreshold: 100 }), /toneabs thresholds/);
  assert.equal(OPEN_SWEEP_RESULTS_PER_QUERY, 6);
  assert.equal(OPEN_SWEEP_TOTAL_RESULT_LIMIT, 60);
  assert.equal(OPEN_SWEEP_TIMEOUT_MS, 8_000);
  const config = await readFile(path.join(ROOT, "wrangler.admin.jsonc"), "utf8");
  assert.deepEqual(JSON.parse(config).triggers.crons, [WATCHDESK_CRON]);
  const migrations = (await readdir(path.join(ROOT, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(migrations, ["0001_editorial_foundation.sql", "0002_admin_queue.sql", "0003_live_analysis.sql", "0004_watchdesk_runs.sql", "0005_echo_durable_contracts.sql", "0006_watchdesk_source_learning.sql"]);
  const workflow = await readFile(path.join(ROOT, "src", "watchdesk-open-discovery.js"), "utf8");
  assert.equal(/Cloudflare|Queue|scheduled\s*\(/i.test(workflow), false, "Open Sweep must remain inside the existing Watchdesk worker and cron");
  console.log("Watchdesk check passed: 12 governed sources (9 active), 21 synthetic fixture cases, 10 bounded rotating Open Sweep formulations, unchanged cron, and existing run ledger.");
}

async function localOperationalDb() {
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  for (const file of (await readdir(path.join(ROOT, "migrations"))).filter((name) => name.endsWith(".sql")).sort()) sqlite.exec(await readFile(path.join(ROOT, "migrations", file), "utf8"));
  return {
    sqlite,
    env: {
      SBNS_ADMIN_BUILD_SHA: "a".repeat(40),
      SBNS_DB: {
        async batch(statements) {
          sqlite.exec("BEGIN");
          try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
          catch (error) { sqlite.exec("ROLLBACK"); throw error; }
        },
        prepare(sql) {
          return {
            bind(...values) {
              const statement = sqlite.prepare(sql);
              return {
                async run() { const result = statement.run(...values); return { meta: { changes: Number(result.changes) } }; },
                async first() { return statement.get(...values) ?? null; },
                async all() { return { results: statement.all(...values) }; },
              };
            },
            async first() { return sqlite.prepare(sql).get() ?? null; },
            async all() { return { results: sqlite.prepare(sql).all() }; },
          };
        },
      },
    },
  };
}

async function operationalTests(pass, data, strongCase, zeroCase, failureSource) {
  const { sqlite, env } = await localOperationalDb();
  try {
    const zeroOptions = { registry: registryFor(zeroCase.source_id), discoverSource: discovery(zeroCase.item), lookupDiscovery: async () => [], lookupMonitoring: async () => null, submitCandidate: async () => { throw new Error("dry run submitted"); } };
    const zero = await runWatchdeskOperation(env, { runId: "ops_zero", triggerType: "manual", dryRun: true, requestedBy: "editor@example.com", now: () => FIXED_NOW, scanOptions: zeroOptions });
    pass(zero.status === "success" && zero.metrics.submitted_to_newsroom === 0, "zero-result dry run must succeed without submission");
    let status = await getWatchdeskStatus(env);
    pass(status.latest.run_id === "ops_zero" && status.last_completed.status === "success" && status.latest.metrics.would_submit === 0, "zero-result run must persist in durable ledger");
    pass(!JSON.stringify(status).includes("synthetic report summary"), "run ledger must not duplicate candidate evidence");

    const realD1Options = { registry: registryFor(strongCase.source_id), discoverSource: discovery(strongCase.item), now: () => FIXED_NOW };
    const realFirst = await runWatchdeskOperation(env, { runId: "ops_real_d1", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:00:10.000Z", scanOptions: realD1Options });
    pass(realFirst.metrics.submitted_to_newsroom === 1 && sqlite.prepare("SELECT COUNT(*) AS count FROM intakes WHERE origin = 'discovery'").get().count === 1, "live path must create exactly one discovery intake using D1");
    pass(sqlite.prepare("SELECT COUNT(*) AS count FROM analysis_jobs WHERE state = 'pending_enqueue'").get().count === 1, "a submission-ready Watchdesk intake durably creates an analysis job; an unavailable queue leaves it retryable");
    const openItem = { title: "Families waited months after City Housing Agency ignored repeated repair complaints", url: "https://localnews.example/city-housing-repairs", seen_at: "20260922T120000Z", discovery_lens_id: "human_burden", discovery_query: "families billed after" };
    const openOptions = {
      registry: registryFor(strongCase.source_id), discoverSource: async () => [], openSweep: true,
      discoverOpenSweep: async () => ({ queries_attempted: 10, queries_failed: 0, items: [openItem], source_health: [{ source_id: "gdelt-doc", lane: "open_sweep", lens_id: "human_burden", checked_at: "2026-09-22T12:00:15.000Z", status: "succeeded", items_parsed: 1, error: null }], source_failures: [] }),
    };
    const openFirst = await runWatchdeskOperation(env, { runId: "ops_open_sweep", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:00:15.000Z", scanOptions: openOptions });
    const openAudit = sqlite.prepare("SELECT metadata_json FROM audit_events WHERE entity_id = ? AND action = 'watchdesk.candidate_submitted'").get(openFirst.submitted[0]?.intake_id);
    const openCandidate = JSON.parse(openAudit.metadata_json).candidate;
    pass(openFirst.metrics.open_sweep_submissions === 1 && sqlite.prepare("SELECT COUNT(*) AS count FROM intakes WHERE submitted_url = ?").get(openItem.url).count === 1, "qualifying Open Sweep discovery enters the existing durable intake flow");
    pass(sqlite.prepare("SELECT state FROM analysis_jobs WHERE intake_id = ?").get(openFirst.submitted[0].intake_id)?.state === "pending_enqueue" && openCandidate.discovery.lane === "open_sweep" && openCandidate.evidence_review_state === "NOT REVIEWED", "Open Sweep admission creates the normal analysis job while preserving source as unverified metadata only");
    const openStatus = await getWatchdeskStatus(env);
    const persistedOpenHealth = openStatus.latest.source_health.find((source) => source.lane === "open_sweep");
    pass(openStatus.latest.metrics.open_sweep_queries_attempted === 10 && openStatus.latest.metrics.open_sweep_submissions === 1 && persistedOpenHealth?.lens_id === "human_burden", "bounded Open Sweep metrics and query/lens health persist in the existing run ledger");
    const openRepeat = await runWatchdeskOperation(env, { runId: "ops_open_sweep_repeat", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:00:20.000Z", scanOptions: openOptions });
    pass(openRepeat.metrics.submitted_to_newsroom === 0 && openRepeat.metrics.duplicates_known === 1 && sqlite.prepare("SELECT COUNT(*) AS count FROM intakes WHERE submitted_url = ?").get(openItem.url).count === 1 && sqlite.prepare("SELECT COUNT(*) AS count FROM analysis_jobs WHERE intake_id = ?").get(openFirst.submitted[0].intake_id).count === 1, "same Open Sweep event is suppressed against the existing Story File and cannot create a duplicate analysis job");
    const ignoredDuplicate = await runWatchdeskOperation(env, { runId: "ops_ignored_duplicate", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:00:20.000Z", scanOptions: { ...realD1Options, lookupDiscovery: async () => [] } });
    const ignoredLedger = sqlite.prepare("SELECT submitted_count, submitted_ids_json FROM watchdesk_runs WHERE id = 'ops_ignored_duplicate'").get();
    pass(ignoredDuplicate.metrics.submitted_to_newsroom === 0 && ignoredDuplicate.metrics.duplicates_known === 1 && ignoredLedger.submitted_count === 0 && ignoredLedger.submitted_ids_json === "[]" && sqlite.prepare("SELECT COUNT(*) AS count FROM intakes WHERE origin = 'discovery'").get().count === 2 && sqlite.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'watchdesk.candidate_submitted'").get().count === 2, "ignored duplicate insert must not create an intake or audit or change the ledger");

    const partial = await runWatchdeskOperation(env, { runId: "ops_partial", triggerType: "manual", dryRun: true, requestedBy: "editor@example.com", now: () => "2026-09-22T12:01:00.000Z", scanOptions: { registry: [failureSource, ...registryFor(strongCase.source_id)], discoverSource: async (entry) => { if (entry.id === failureSource.id) throw new Error("SYNTHETIC_SOURCE_UNAVAILABLE"); return [strongCase.item]; }, lookupDiscovery: async () => [], lookupMonitoring: async () => null } });
    status = await getWatchdeskStatus(env);
    pass(partial.status === "partial" && status.latest.status === "partial" && status.latest.source_failure_count === 1 && status.latest.metrics.would_submit === 1, "partial source failure must persist metrics and failure count");
    pass(JSON.parse(sqlite.prepare("SELECT source_health_json FROM watchdesk_runs WHERE id = 'ops_partial'").get().source_health_json).length === 2 && status.latest.source_health.length === 2 && status.latest.source_health[0].source_id === failureSource.id, "ledger and human status must preserve bounded per-source health");

    let startHeld;
    const started = new Promise((resolve) => { startHeld = resolve; });
    let releaseHeld;
    const held = new Promise((resolve) => { releaseHeld = resolve; });
    const heldResult = { ok: true, status: "complete", metrics: { ...zero.metrics }, source_failures: [], source_health: [], submitted: [] };
    const first = runWatchdeskOperation(env, { runId: "ops_held", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:02:00.000Z", executeScan: async () => { startHeld(); await held; return heldResult; } });
    await started;
    const overlapping = await runWatchdeskOperation(env, { runId: "ops_overlap", triggerType: "scheduled", requestedBy: "system:watchdesk-schedule", now: () => "2026-09-22T12:02:01.000Z", executeScan: async () => { throw new Error("overlap executed"); } });
    pass(overlapping.status === "skipped-overlap" && sqlite.prepare("SELECT status FROM watchdesk_runs WHERE id = 'ops_overlap'").get().status === "skipped-overlap", "overlap must be skipped and durably recorded");
    releaseHeld(); await first;

    sqlite.prepare("INSERT INTO watchdesk_runs (id, trigger_type, dry_run, requested_by, started_at, status) VALUES ('ops_stale', 'scheduled', 0, 'system:watchdesk-schedule', '2026-09-22T11:00:00.000Z', 'running')").run();
    sqlite.prepare("INSERT INTO watchdesk_run_lock VALUES ('watchdesk', 'ops_stale', '2026-09-22T11:00:00.000Z', '2026-09-22T11:30:00.000Z')").run();
    await runWatchdeskOperation(env, { runId: "ops_recovered", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:03:00.000Z", executeScan: async () => heldResult });
    pass(sqlite.prepare("SELECT status, error_class FROM watchdesk_runs WHERE id = 'ops_stale'").get().error_class === "STALE_LOCK_RECOVERED", "stale lock must recover and mark crashed run failed");
    pass(sqlite.prepare("SELECT COUNT(*) AS count FROM watchdesk_run_lock").get().count === 0, "completed run must release lock");

    const freshItem = (suffix) => ({ ...strongCase.item, title: `Synthetic ${suffix}: Audit Found Controls Failed and Costs Overran Plan`, url: `https://www.gao.gov/products/gao-26-ops-${suffix}` });
    const scheduledItem = freshItem("scheduled");
    const liveOptions = { registry: registryFor(strongCase.source_id), discoverSource: discovery(scheduledItem), lookupDiscovery: async () => [], lookupMonitoring: async () => null };
    const scheduled = createScheduledHandler({ executeWatchdesk: (runtime, opts) => runWatchdeskOperation(runtime, { ...opts, runId: "ops_scheduled", now: () => "2026-09-22T12:04:00.000Z", scanOptions: liveOptions }) });
    await scheduled({ cron: WATCHDESK_CRON }, env);
    const scheduledRow = sqlite.prepare("SELECT trigger_type, dry_run, requested_by, metrics_json FROM watchdesk_runs WHERE id = 'ops_scheduled'").get();
    pass(scheduledRow.trigger_type === "scheduled" && scheduledRow.dry_run === 0 && scheduledRow.requested_by === "system:watchdesk-schedule" && sqlite.prepare("SELECT COUNT(*) AS count FROM intakes WHERE origin = 'discovery'").get().count === 3, "scheduled handler must use the real lease-fenced D1 path and nonhuman provenance");
    pass(JSON.parse(scheduledRow.metrics_json).submitted_to_newsroom === 1, "scheduled submission count must reconcile with ledger");
    const scheduledIds = sqlite.prepare("SELECT submitted_count, submitted_ids_json FROM watchdesk_runs WHERE id = 'ops_scheduled'").get();
    pass(scheduledIds.submitted_count === 1 && sqlite.prepare("SELECT id FROM intakes WHERE id = ?").get(JSON.parse(scheduledIds.submitted_ids_json)[0])?.id, "ledger must retain the actual submitted intake ID and count");
    const manualRepeat = await runWatchdeskOperation(env, { runId: "ops_manual_repeat", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:05:00.000Z", scanOptions: liveOptions });
    pass(manualRepeat.metrics.duplicates_known === 1 && manualRepeat.metrics.submitted_to_newsroom === 0 && sqlite.prepare("SELECT COUNT(*) AS count FROM intakes WHERE origin = 'discovery'").get().count === 3, "manual and scheduled runs must share the same discovery dedupe");
    const many = Array.from({ length: 7 }, (_, index) => ({ ...strongCase.item, title: `Synthetic Grant ${index}: Audit Found Controls Failed and Costs Overran Plan`, url: `https://www.gao.gov/products/gao-26-operational-cap-${index}` }));
    const capped = await runWatchdeskOperation(env, { runId: "ops_capped", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:06:00.000Z", scanOptions: { ...liveOptions, discoverSource: async () => many, lookupDiscovery: async () => [] } });
    pass(capped.metrics.submission_ready === 7 && capped.metrics.submitted_to_newsroom === 5 && capped.metrics.deferred_by_ceiling === 2, "live operational run must submit no more than five candidates");
    pass(sqlite.prepare("SELECT submitted_count FROM watchdesk_runs WHERE id = 'ops_capped'").get().submitted_count === 5, "ledger must retain exact five-intake ceiling");
    const aggregate = await getWatchdeskMachineHealth(env);
    pass(aggregate.submitted_count === 5 && !JSON.stringify(aggregate).includes("synthetic-"), "machine health may expose the count but not submitted intake IDs");
    let attempted = 0;
    const originalBatch = env.SBNS_DB.batch.bind(env.SBNS_DB);
    env.SBNS_DB.batch = (statements) => ++attempted === 2 ? Promise.reject(new Error("SYNTHETIC_SECOND_SUBMISSION_FAILURE")) : originalBatch(statements);
    try {
      await assert.rejects(() => runWatchdeskOperation(env, { runId: "ops_partial_write", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:06:30.000Z", scanOptions: { ...liveOptions, discoverSource: async () => [freshItem("partial-1"), freshItem("partial-2")], lookupDiscovery: async () => [] } }), /SYNTHETIC_SECOND_SUBMISSION_FAILURE/);
    } finally { env.SBNS_DB.batch = originalBatch; }
    const partialWrite = sqlite.prepare("SELECT status, submitted_count, submitted_ids_json FROM watchdesk_runs WHERE id = 'ops_partial_write'").get();
    pass(partialWrite.status === "failed" && partialWrite.submitted_count === 1 && sqlite.prepare("SELECT id FROM intakes WHERE id = ?").get(JSON.parse(partialWrite.submitted_ids_json)[0])?.id, "failed run must retain its actual prior intake write for reconciliation");
    await assert.rejects(() => runWatchdeskOperation(env, { runId: "ops_failed", triggerType: "scheduled", now: () => "2026-09-22T12:07:00.000Z", executeScan: async () => { throw new Error("SYNTHETIC_PIPELINE_FAILURE"); } }), /SYNTHETIC_PIPELINE_FAILURE/);
    pass(sqlite.prepare("SELECT status, error_message FROM watchdesk_runs WHERE id = 'ops_failed'").get().status === "failed", "pipeline failure must be durably recorded");
    pass(sqlite.prepare("SELECT COUNT(*) AS count FROM watchdesk_run_lock").get().count === 0, "failed run must release lock");
    await assert.rejects(() => runWatchdeskOperation(env, { runId: "ops_lost_lease", triggerType: "manual", requestedBy: "editor@example.com", now: () => "2026-09-22T12:08:00.000Z", executeScan: async (_runtime, options) => { sqlite.prepare("UPDATE watchdesk_run_lock SET run_id = 'synthetic_other_holder'").run(); await options.beforeSubmit(); } }), /WATCHDESK_LEASE_LOST/);
    pass(sqlite.prepare("SELECT status FROM watchdesk_runs WHERE id = 'ops_lost_lease'").get().status === "failed", "lost lease must stop before a candidate write and record failure");
    sqlite.prepare("DELETE FROM watchdesk_run_lock WHERE run_id = 'synthetic_other_holder'").run();
    const health = await getWatchdeskMachineHealth(env);
    pass(health.worker === "sbns-admin" && health.cron_utc === WATCHDESK_CRON && health.latest_run_id === "ops_lost_lease" && health.latest_run_status === "failed", "machine health must expose only aggregate run state");
    pass(!JSON.stringify(health).includes("editor@example.com") && !JSON.stringify(health).includes("intake_discovery_"), "machine health must not reveal editor identity or intake ID");
    pass(WATCHDESK_LEASE_MS === 30 * 60 * 1000, "overlap lease must remain bounded at thirty minutes");
  } finally { sqlite.close(); }
}

async function atomicSubmissionTests(pass, strongCase) {
  const { sqlite, env } = await localOperationalDb();
  const sourceEntry = registryFor(strongCase.source_id);
  const scanOptions = (suffix) => ({
    registry: sourceEntry,
    discoverSource: discovery({ ...strongCase.item, title: `Synthetic ${suffix}: Audit Found Controls Failed and Costs Overran Plan`, url: `https://www.gao.gov/products/gao-26-atomic-${suffix}` }),
    lookupDiscovery: async () => [], lookupMonitoring: async () => null,
  });
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  const originalBatch = env.SBNS_DB.batch.bind(env.SBNS_DB);
  const emptyResult = { ok: true, status: "complete", metrics: { sources_checked: 0, sources_succeeded: 0, items_discovered: 0, discovery_leads: 0, would_submit: 0, submitted_to_newsroom: 0 }, source_failures: [], source_health: [], submitted: [] };
  try {
    // The first, non-atomic eligibility check passes. Take over the lease just
    // before the real persistence helper executes its D1 transaction.
    let currentTime = "2026-09-22T13:00:00.000Z";
    let releaseNewHolder;
    const holdNewHolder = new Promise((resolve) => { releaseNewHolder = resolve; });
    let signalNewHolder;
    const newHolderStarted = new Promise((resolve) => { signalNewHolder = resolve; });
    let newHolderRun;
    env.SBNS_DB.batch = async (statements) => {
      env.SBNS_DB.batch = originalBatch;
      currentTime = "2026-09-22T13:31:00.000Z";
      newHolderRun = runWatchdeskOperation(env, {
        runId: "atomic_takeover_B", triggerType: "scheduled", now: () => currentTime,
        executeScan: async () => { signalNewHolder(); await holdNewHolder; return emptyResult; },
      });
      await newHolderStarted;
      return originalBatch(statements);
    };
    try {
      await assert.rejects(() => runWatchdeskOperation(env, {
        runId: "atomic_takeover_A", triggerType: "manual", requestedBy: "editor@example.com",
        now: () => currentTime, scanOptions: scanOptions("takeover"),
      }), /WATCHDESK_LEASE_LOST/);
      const stale = sqlite.prepare("SELECT status, submitted_count, submitted_ids_json, error_class FROM watchdesk_runs WHERE id = 'atomic_takeover_A'").get();
      pass(count("intakes") === 0 && count("audit_events") === 0 && stale.status === "failed" && stale.error_class === "STALE_LOCK_RECOVERED" && stale.submitted_count === 0 && stale.submitted_ids_json === "[]" && sqlite.prepare("SELECT run_id FROM watchdesk_run_lock").get().run_id === "atomic_takeover_B", "lease takeover between eligibility and the real D1 write must create no unledgered intake or audit and preserve the new holder");
    } finally { releaseNewHolder(); await newHolderRun; }

    // Force a constraint error after intake and audit but before the ledger
    // statement. D1 batch must roll back the entire candidate transaction.
    env.SBNS_DB.batch = (statements) => originalBatch([
      statements[0], statements[1],
      env.SBNS_DB.prepare("INSERT INTO watchdesk_run_lock (name, run_id, acquired_at, expires_at) VALUES ('invalid', 'x', 'x', 'x')").bind(),
      statements[2],
    ]);
    try {
      await assert.rejects(() => runWatchdeskOperation(env, {
        runId: "atomic_rollback", triggerType: "manual", requestedBy: "editor@example.com",
        now: () => "2026-09-22T13:32:00.000Z", scanOptions: scanOptions("rollback"),
      }), /CHECK constraint failed/);
    } finally { env.SBNS_DB.batch = originalBatch; }
    const rolledBack = sqlite.prepare("SELECT status, submitted_count, submitted_ids_json FROM watchdesk_runs WHERE id = 'atomic_rollback'").get();
    pass(count("intakes") === 0 && count("audit_events") === 0 && rolledBack.status === "failed" && rolledBack.submitted_count === 0 && rolledBack.submitted_ids_json === "[]", "a failure between audit and ledger update must roll back the actual D1 intake and audit writes");

    const malformedScan = scanOptions("malformed-ledger");
    const discover = malformedScan.discoverSource;
    malformedScan.discoverSource = async (source) => {
      sqlite.prepare("UPDATE watchdesk_runs SET submitted_ids_json = 'invalid-json' WHERE id = 'atomic_bad_json'").run();
      return discover(source);
    };
    await assert.rejects(() => runWatchdeskOperation(env, {
      runId: "atomic_bad_json", triggerType: "manual", requestedBy: "editor@example.com",
      now: () => "2026-09-22T13:33:00.000Z", scanOptions: malformedScan,
    }), /malformed JSON/);
    const malformed = sqlite.prepare("SELECT status, submitted_count FROM watchdesk_runs WHERE id = 'atomic_bad_json'").get();
    pass(count("intakes") === 0 && count("audit_events") === 0 && malformed.status === "failed" && malformed.submitted_count === 0, "a real ledger JSON update failure must roll back the same D1 batch's intake and audit");

    // Test the SQL fence independently of the pipeline's five-item slice.
    sqlite.prepare("INSERT INTO watchdesk_runs (id, trigger_type, dry_run, requested_by, started_at, status, submitted_count, submitted_ids_json) VALUES ('atomic_ceiling', 'manual', 0, 'editor@example.com', '2026-09-22T14:00:00.000Z', 'running', 4, ?)")
      .run(JSON.stringify(["prior-1", "prior-2", "prior-3", "prior-4"]));
    sqlite.prepare("INSERT INTO watchdesk_run_lock (name, run_id, acquired_at, expires_at) VALUES ('watchdesk', 'atomic_ceiling', '2026-09-22T14:00:00.000Z', '2026-09-22T14:30:00.000Z')").run();
    const makeRows = (suffix) => {
      const id = `atomic_intake_${suffix}`;
      return {
        intake: { id, origin: "discovery", submitted_url: `https://www.gao.gov/products/gao-26-${suffix}`, submitted_at: "2026-09-22T14:00:01.000Z", status: "submitted", analysis_status: "not_started", created_at: "2026-09-22T14:00:01.000Z", updated_at: "2026-09-22T14:00:01.000Z" },
        audit: { id: `atomic_audit_${suffix}`, actor_type: "system", actor_id: null, action: "watchdesk.candidate_submitted", entity_type: "intake", entity_id: id, metadata_json: "{}", created_at: "2026-09-22T14:00:01.000Z" },
      };
    };
    const fifth = makeRows("fifth");
    const fifthWrite = await storeDiscoveryCandidate(env, fifth.intake, fifth.audit, "atomic_ceiling", "2026-09-22T14:00:01.000Z");
    const sixth = makeRows("sixth");
    const sixthWrite = await storeDiscoveryCandidate(env, sixth.intake, sixth.audit, "atomic_ceiling", "2026-09-22T14:00:02.000Z");
    const ceiling = sqlite.prepare("SELECT submitted_count, submitted_ids_json FROM watchdesk_runs WHERE id = 'atomic_ceiling'").get();
    pass(fifthWrite.every((result) => result.meta.changes === 1) && sixthWrite.every((result) => result.meta.changes === 0) && ceiling.submitted_count === 5 && JSON.parse(ceiling.submitted_ids_json).at(-1) === fifth.intake.id && sqlite.prepare("SELECT id FROM intakes WHERE id = ?").get(sixth.intake.id) == null && sqlite.prepare("SELECT id FROM audit_events WHERE id = ?").get(sixth.audit.id) == null, "the atomic D1 path must persist the fifth candidate and reject a sixth without an intake, audit, or ledger increment");

    sqlite.prepare("DELETE FROM watchdesk_run_lock WHERE name = 'watchdesk'").run();
    sqlite.prepare("INSERT INTO watchdesk_runs (id, trigger_type, dry_run, requested_by, started_at, status) VALUES ('atomic_expired', 'manual', 0, 'editor@example.com', '2026-09-22T15:00:00.000Z', 'running')").run();
    sqlite.prepare("INSERT INTO watchdesk_run_lock (name, run_id, acquired_at, expires_at) VALUES ('watchdesk', 'atomic_expired', '2026-09-22T15:00:00.000Z', '2026-09-22T15:30:00.000Z')").run();
    const expired = makeRows("expired");
    const expiredWrite = await storeDiscoveryCandidate(env, expired.intake, expired.audit, "atomic_expired");
    pass(expiredWrite.every((result) => result.meta.changes === 0) && sqlite.prepare("SELECT id FROM intakes WHERE id = ?").get(expired.intake.id) == null && sqlite.prepare("SELECT id FROM audit_events WHERE id = ?").get(expired.audit.id) == null && sqlite.prepare("SELECT submitted_count FROM watchdesk_runs WHERE id = 'atomic_expired'").get().submitted_count === 0, "database-time lease expiry must reject a candidate even without a competing takeover");
  } finally { env.SBNS_DB.batch = originalBatch; sqlite.close(); }
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
  pass(parseRssAtom(xml.replace(/<pubDate>[\s\S]*?<\/pubDate>/, ""), gao).length === 0, "GAO RSS adapter must enforce its required publication date");
  pass(!rssItems[0].evidence_review_state, "short feed boilerplate must not imply primary-record review");
  const abstractXml = await readFile(path.join(FIXTURE_DIR, "synthetic-gao-abstract.xml"), "utf8");
  const abstractItems = parseRssAtom(abstractXml, gao);
  pass(abstractItems.length === 1 && abstractItems[0].evidence_review_state === "PARTIALLY REVIEWED", "official GAO abstract may establish bounded partial review, not full-report review");
  pass(abstractItems[0].record_summary.includes("three required quarterly safety checks"), "official abstract must retain candidate-specific factual material");
  const fetched = await fetchRegistrySource(gao, async (url, options) => {
    pass(url === "https://www.gao.gov/rss/reports.xml" && options.headers.accept.includes("application/rss+xml"), "GAO adapter must request its advertised official RSS URL with ordinary headers");
    return new Response(abstractXml, { status: 200, headers: { "content-type": "application/rss+xml" } });
  });
  pass(fetched.length === 1 && fetched[0].url.endsWith("gao-26-synthetic-abstract"), "GAO RSS adapter must parse the official feed shape");
  pass(normalizeDiscoveryUrl("HTTPS://Example.COM:443/report/?utm_source=x&b=2&a=1#part") === "https://example.com/report?a=1&b=2", "URL normalization must remove tracking, default port, fragment, and obvious trailing slash");
  pass(normalizeDiscoveryUrl("https://example.com/report?case=7") === "https://example.com/report?case=7", "URL normalization must preserve meaningful query parameters");

  const strongCase = fixture(data, "strong-gao-style-candidate");
  const strong = await buildCandidate(strongCase.item, source(strongCase.source_id), FIXED_NOW, "run_test");
  const longPrefix = `${strongCase.item.record_summary} ${"Synthetic supporting detail. ".repeat(70)}`;
  const longerA = await buildCandidate({ ...strongCase.item, record_summary: `${longPrefix} First later note.` }, source(strongCase.source_id), FIXED_NOW, "run_test");
  const longerB = await buildCandidate({ ...strongCase.item, record_summary: `${longPrefix} Different later note.` }, source(strongCase.source_id), FIXED_NOW, "run_test");
  pass(longerA.content_fingerprint === longerB.content_fingerprint && longerA.record_summary !== longerB.record_summary,
    "longer Discovery display must not change established Watchdesk dedupe identity for trailing text");
  pass(strong.publication_date === "2026-09-20T00:00:00.000Z", "candidate must retain publication date");
  pass(strong.original_url.includes("utm_source=test") && !strong.normalized_url.includes("utm_"), "candidate must retain original URL while storing a normalized URL");
  pass(strong.primary_record_status === "PRIMARY RECORD REVIEWED" && strong.evidence_review_state === "REVIEWED" && Boolean(strong.primary_record_url), "reviewed record must have a distinct location and review state");
  pass(fitGate(strong, strongCase.item).passes, "strong primary watchdog record must survive the fit gate");
  pass(triageCandidate(strong, strongCase.item, fitGate(strong, strongCase.item)).recommendation === "DEVELOP", "strong supported candidate may receive DEVELOP");
  const noJobItem = { ...strongCase.item, apparent_job: undefined, record_summary: "The Synthetic Grant Administration reported that a quarterly review program exists and costs were estimated at ten million dollars.", url: "https://www.gao.gov/products/gao-26-synthetic-no-job" };
  const noJob = await buildCandidate(noJobItem, gao, FIXED_NOW, "run_test");
  pass(noJob.apparent_job === null, "Watchdesk must not fabricate the Job from a named actor and quantitative facts");

  const weakCase = fixture(data, "generic-press-release-weak-fit");
  pass(!deterministicFilter(weakCase.item, source(weakCase.source_id)).passes, "generic press-release churn must stop deterministically");
  const opinionCase = fixture(data, "partisan-opinion-no-primary-evidence");
  pass(deterministicFilter(opinionCase.item, source(opinionCase.source_id)).reason === "opinion_or_partisan_commentary", "unsupported partisan opinion must stop");
  const secondaryCase = fixture(data, "secondary-with-primary-record");
  const secondary = await buildCandidate(secondaryCase.item, source(secondaryCase.source_id), FIXED_NOW, "run_test");
  pass(secondary.primary_record_status === "PRIMARY RECORD LOCATED" && secondary.evidence_review_state === "NOT REVIEWED" && secondary.key_sources.length === 2, "secondary reporting must retain a located but unreviewed primary record");
  const neededCase = fixture(data, "secondary-primary-needed");
  const needed = await buildCandidate(neededCase.item, source(neededCase.source_id), FIXED_NOW, "run_test");
  pass(needed.primary_record_status === "SECONDARY SIGNAL — PRIMARY RECORD NEEDED" && needed.research_burden === "HIGH", "missing primary record must remain explicit");
  pass(triageCandidate(needed, neededCase.item, fitGate(needed, neededCase.item)).recommendation === "EXPLORE", "bounded secondary signal may receive EXPLORE");
  const listingCase = fixture(data, "official-listing-only");
  const listing = await buildCandidate(listingCase.item, source(listingCase.source_id), FIXED_NOW, "run_listing");
  const listingFit = fitGate(listing, listingCase.item);
  pass(listing.primary_record_status === "PRIMARY RECORD LOCATED" && listing.evidence_review_state === "NOT REVIEWED" && listing.reviewed_material.includes("Listing"), "official listing must show location without claiming record review");
  pass(!listingFit.passes && listingFit.research_worthy && !listingFit.substantive_evidence, "listing title, date, and generic fallback text cannot satisfy substantive fit");
  pass(triageCandidate(listing, listingCase.item, listingFit).recommendation === "EXPLORE", "unqualified discovery lead may retain EXPLORE without becoming submission-ready");
  const partialCase = fixture(data, "partially-reviewed-primary");
  const partialCandidate = await buildCandidate(partialCase.item, source(partialCase.source_id), FIXED_NOW, "run_partial");
  pass(partialCandidate.primary_record_status === "PRIMARY RECORD PARTIALLY REVIEWED" && partialCandidate.reviewed_material.includes("abstract") && fitGate(partialCandidate, partialCase.item).passes, "bounded substantive material must remain visibly partial and may pass fit");
  pass(triageCandidate(partialCandidate, partialCase.item, fitGate(partialCandidate, partialCase.item)).recommendation === "EXPLORE", "partial review must not be promoted to DEVELOP solely by primary provenance");
  const boilerplateCase = fixture(data, "boilerplate-only");
  const boilerplate = await buildCandidate(boilerplateCase.item, source(boilerplateCase.source_id), FIXED_NOW, "run_boilerplate");
  pass(!fitGate(boilerplate, boilerplateCase.item).passes, "boilerplate record text cannot satisfy candidate-specific evidence threshold even with a review claim");
  const headingOnlyItem = { ...boilerplateCase.item, record_summary: "The official report feed abstract states: What GAO Found This synthetic report describes a public program and provides general background.", evidence_review_state: "PARTIALLY REVIEWED" };
  const headingOnly = await buildCandidate(headingOnlyItem, gao, FIXED_NOW, "run_heading_only");
  pass(!fitGate(headingOnly, headingOnlyItem).passes, "What GAO Found heading must not itself count as a factual finding");
  const assess = async (entry, item = entry.item) => {
    const candidate = await buildCandidate(item, source(entry.source_id), FIXED_NOW, "run_gap_fixture");
    const fit = fitGate(candidate, item);
    candidate.triage = triageCandidate(candidate, item, fit);
    candidate.submission_readiness = submissionReadiness(candidate, item, fit);
    return { candidate, fit };
  };
  const abstractCandidate = await assess({ source_id: "gao-reports", item: abstractItems[0] });
  pass(abstractCandidate.candidate.institution_or_system === "Synthetic Transit Authority" && abstractCandidate.candidate.submission_readiness.ready, "official abstract with a named actor, criterion, observed condition, and gap may be submission-ready without full-report retrieval");
  pass(abstractCandidate.candidate.accountability_question.includes("quarterly safety checks"), "automatic accountability question must use inspected source facts");
  const telecom = await assess(fixture(data, "telecom-compliance-without-gap"));
  pass(telecom.fit.passes && !telecom.candidate.submission_readiness.ready && telecom.candidate.observed_condition === null && telecom.candidate.accountability_gap === null, "Section 889-style compliance context without an actor-attributed unmet condition must stay a lead");
  const tribal = await assess(fixture(data, "tribal-water-explicit-gap"));
  pass(tribal.candidate.institution_or_system === "Synthetic Indian Health Service" && tribal.candidate.submission_readiness.ready, "explicit IHS-style actor, program expectation, observed exclusion, and gap may support intake");
  const tribalWithoutJob = await assess(fixture(data, "tribal-water-explicit-gap"), { ...fixture(data, "tribal-water-explicit-gap").item, record_summary: "The Synthetic Indian Health Service reported that three tribal water assistance requests were not evaluated under its eligibility interpretation." });
  pass(!tribalWithoutJob.candidate.submission_readiness.ready && tribalWithoutJob.candidate.apparent_job === null, "the same topic without a supported Job must not auto-submit");
  const accessibility = await assess(fixture(data, "gsa-accessibility-explicit-gap"));
  pass(accessibility.candidate.topic === "Synthetic Federal Real Property" && accessibility.candidate.institution_or_system === "Synthetic General Services Administration", "topic heading must remain separate from the explicit accountable agency");
  pass(accessibility.candidate.submission_readiness.ready && accessibility.candidate.accountability_question.includes("accessibility complaint process"), "specific recommendation and unfulfilled condition may support an evidence-derived GSA-style question");
  const differentAction = await assess(fixture(data, "gsa-accessibility-explicit-gap"), { ...fixture(data, "gsa-accessibility-explicit-gap").item, record_summary: "The Synthetic General Services Administration was required to publish the accessibility complaint process. The Synthetic General Services Administration did not review the accessibility complaint process." });
  pass(!differentAction.candidate.submission_readiness.ready && differentAction.candidate.accountability_gap === null, "shared topic words cannot manufacture a gap when the expected and observed actions differ");
  const differentObject = await assess(fixture(data, "gsa-accessibility-explicit-gap"), { ...fixture(data, "gsa-accessibility-explicit-gap").item, record_summary: "The Synthetic General Services Administration was required to publish the accessibility complaint process. The Synthetic General Services Administration did not publish the annual procurement process." });
  pass(!differentObject.candidate.submission_readiness.ready && differentObject.candidate.accountability_gap === null, "matching verbs and one generic object word cannot conflate different institutional processes");
  const disposal = await assess(fixture(data, "property-disposal-progress-only"));
  pass(disposal.fit.passes && !disposal.candidate.submission_readiness.ready && !disposal.candidate.apparent_job, "quantified disposal progress without an applicable target must stay a lead");
  const aging = await assess(fixture(data, "global-aging-implications-only"));
  pass(aging.fit.passes && aging.candidate.institution_or_system === null && !aging.candidate.submission_readiness.ready, "broad policy implications without an accountable actor or gap must not auto-submit");
  const apertureWaste = await assess(fixture(data, "aperture-waste-without-discrete-failure"));
  pass(apertureWaste.fit.passes && apertureWaste.fit.accountability_signal, "documented waste or repeated administrative burden may satisfy the broader accountability aperture without a discrete failure");
  pass(apertureWaste.candidate.submission_readiness.ready && apertureWaste.candidate.submission_readiness.mode === "editorial_aperture", "reviewed aperture candidate may persist to Newsroom without a fabricated Job or gap");
  pass(apertureWaste.candidate.triage.recommendation === "EXPLORE" && apertureWaste.candidate.apparent_job === null && apertureWaste.candidate.accountability_gap === null, "aperture intake must remain exploratory and preserve missing classic gap elements");

  const apertureRecurring = await assess(fixture(data, "aperture-recurring-burden-development"));
  pass(apertureRecurring.fit.passes && apertureRecurring.fit.accountability_signal, "recurring delay and stakeholder burden may remain accountability-relevant even without a mandatory deadline");
  pass(apertureRecurring.candidate.submission_readiness.ready && apertureRecurring.candidate.submission_readiness.mode === "editorial_aperture", "recurrence after warning may reach Newsroom for human editorial judgment without being mislabeled as proven failure");

  const genericQuestion = await assess(fixture(data, "global-aging-implications-only"), { ...fixture(data, "global-aging-implications-only").item, accountability_question: "What accountability issue does this report raise?" });
  pass(genericQuestion.candidate.accountability_question === null && Boolean(genericQuestion.candidate.research_prompt) && !genericQuestion.candidate.submission_readiness.ready, "generic research prompt cannot serve as evidence-derived accountability question or satisfy readiness");
  const ambiguous = await assess(fixture(data, "strong-gao-style-candidate"), { ...strongCase.item, institution: undefined, record_summary: "The Synthetic Water Authority was required to document quarterly controls. The Synthetic Water Authority did not document quarterly controls. The Synthetic Power Authority was required to document annual controls. The Synthetic Power Authority did not document annual controls." });
  pass(ambiguous.candidate.institution_or_system === null && !ambiguous.candidate.submission_readiness.ready, "two materially accountable actors without a justified selection must remain ambiguous and non-submittable");
  const resolved = await assess(fixture(data, "strong-gao-style-candidate"), { ...strongCase.item, material_qualification: "The issue has been corrected and the gap was resolved." });
  pass(!resolved.candidate.submission_readiness.ready && resolved.candidate.submission_readiness.reasons.includes("material_qualification_defeats_gap"), "material resolution qualification must defeat apparent readiness");
  pass(listing.institution_or_system === null && listing.topic === "justice oversight", "listing metadata and a supplied institution hint cannot establish a reviewed accountable actor");
  pass(strong.institution_or_system === "Synthetic Grant Administration" && strong.apparent_job && strong.observed_condition && strong.accountability_gap, "reviewed synthetic record must retain distinct actor, Job, observation, and gap");
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
  pass(first.source_health.length === 1 && first.source_health[0].items_parsed === 1 && first.source_health[0].checked_at === FIXED_NOW, "source health must include check time, success, and parsed count");
  const queued = stored[0];
  const queuedCandidate = JSON.parse(queued.discovery_metadata_json).candidate;
  pass(queued.submitted_url === strong.normalized_url, "queue insertion must retain the normalized source URL");
  pass(queuedCandidate.institution_or_system === "Synthetic Grant Administration" && queuedCandidate.jurisdiction === "United States", "queue insertion must retain institution and jurisdiction");
  pass(Boolean(queuedCandidate.apparent_job && queuedCandidate.record_summary && queuedCandidate.accountability_question), "queue insertion must retain Job, Record, and accountability question");
  pass(Boolean(queuedCandidate.material_qualification && queuedCandidate.remains_unproven), "queue insertion must retain qualifications and uncertainty");
  pass(queuedCandidate.research_burden === "LOW" && queuedCandidate.provenance.automated === true, "queue insertion must retain burden and automation provenance");
  pass(queuedCandidate.triage.recommendation === "DEVELOP" && !Object.hasOwn(queuedCandidate, "editorial_decision"), "automated triage must remain distinct from editorial decision");
  const listingRun = await runWatchdeskScan({}, { ...runOptions, registry: registryFor(listingCase.source_id), discoverSource: discovery(listingCase.item), lookupDiscovery: async () => [], submitCandidate: async () => { throw new Error("listing must not submit"); }, runId: "synthetic_listing" });
  pass(listingRun.metrics.discovery_leads === 1 && listingRun.discovery_leads[0].triage.recommendation === "EXPLORE" && listingRun.metrics.would_submit === 0 && listingRun.metrics.submitted_to_newsroom === 0, "EXPLORE listing lead must not auto-submit, even in a local live-mode simulation");
  const abstractRun = await runWatchdeskScan({}, { ...runOptions, discoverSource: discovery(abstractItems[0]), lookupDiscovery: async () => [], dryRun: true, submitCandidate: async () => { throw new Error("dry run must not submit"); }, runId: "synthetic_abstract" });
  pass(abstractRun.metrics.submission_ready === 1 && abstractRun.metrics.would_submit === 1 && abstractRun.metrics.submitted_to_newsroom === 0 && abstractRun.candidates[0].evidence_review_state === "PARTIALLY REVIEWED", "specific official abstract may be submission-ready while true dry run performs no write");
  const funnel = await runWatchdeskScan({}, { ...runOptions, discoverSource: async () => [strongCase.item, fixture(data, "telecom-compliance-without-gap").item], lookupDiscovery: async () => [], dryRun: true });
  pass(funnel.metrics.fit_gate_survivors === 2 && funnel.metrics.discovery_leads === 1 && funnel.metrics.submission_ready === 1 && funnel.metrics.would_submit === 1 && funnel.metrics.submitted_to_newsroom === 0, "run funnel must distinguish substantive fit, non-submittable leads, and submission readiness");
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

  const many = Array.from({ length: 7 }, (_, index) => ({ ...strongCase.item, title: `Synthetic Grant ${index}: Audit Found Controls Failed and Costs Overran Plan`, url: `https://www.gao.gov/products/gao-26-synthetic-cap-${index}`, institution: "Synthetic Grant Administration" }));
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
  pass(partial.source_health[0].status === "failed" && partial.source_health[0].error === "SYNTHETIC_SOURCE_UNAVAILABLE" && partial.source_health[1].status === "succeeded", "partial run must name failed source and preserve successful-source health");

  const openTitle = "Families waited months after City Housing Agency ignored repeated repair complaints";
  let rateLimitCalls = 0;
  const rateLimited = await searchPublicDiscovery("residents say agency", {
    maxRecords: 6, toneAbsThreshold: 10, retryRateLimit: true,
    fetchImpl: async (url, request) => {
      rateLimitCalls += 1;
      pass(url.includes("toneabs%3E10") && request.redirect === "manual" && request.method === "GET", "emotional-intensity search must use the fixed GDELT query and refuse redirects");
      return rateLimitCalls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ articles: [{ url: "https://localnews.example/story-1", title: openTitle, seendate: "20260922T120000Z" }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  pass(rateLimitCalls === 2 && rateLimited.length === 1 && rateLimited[0].domain === "localnews.example", "Open Sweep may perform one bounded retry after a GDELT 429 and returns metadata only");

  let openSearchCalls = 0;
  const boundedSweep = await runOpenSweep({
    now: FIXED_NOW,
    search: async (formulation, options) => {
      openSearchCalls += 1;
      assert.ok(formulation.length >= 4 && formulation.length <= 120);
      assert.equal(options.maxRecords, OPEN_SWEEP_RESULTS_PER_QUERY);
      assert.equal(options.timeoutMs, OPEN_SWEEP_TIMEOUT_MS);
      assert.equal(options.retryRateLimit, true);
      if (openSearchCalls === 4) throw new Error("SYNTHETIC_QUERY_TIMEOUT");
      return Array.from({ length: 8 }, (_, index) => ({ title: `${formulation} synthetic item ${index}`, url: `https://outlet${openSearchCalls}-${index}.example/article`, domain: `outlet${openSearchCalls}-${index}.example`, seen_at: "20260922T120000Z" }));
    },
  });
  pass(openSearchCalls === OPEN_SWEEP_QUERY_LIMIT && boundedSweep.queries_attempted === 10 && boundedSweep.queries_failed === 1 && boundedSweep.source_health.length === 10, "Open Sweep continues all bounded hypotheses after one query failure");
  pass(boundedSweep.items.length === 54 && boundedSweep.raw_hits === 54 && boundedSweep.items.every((item) => item.discovery_lens_id && item.discovery_query), "Open Sweep caps every query and total results and preserves lens/query provenance");

  const openEntries = Array.from({ length: 5 }, (_, index) => ({
    lane: "open_sweep",
    source: { id: "gdelt-open-sweep", primary_record: false },
    item: { title: index % 2 ? "Residents waited months after City Housing Agency ignored repair complaints" : openTitle, url: `https://outlet${index}.example/story-${index}`, seen_at: `2026092${index + 1}T120000Z`, discovery_lens_id: index % 2 ? "ignored_warning" : "human_burden", discovery_query: "residents still waiting" },
  }));
  const eventClusters = await clusterWatchdeskItems(openEntries);
  pass(eventClusters.length === 1 && eventClusters[0].cluster_size === 5 && eventClusters[0].domains.length === 5, "strong cross-publisher title/time match forms one event cluster rather than five editor cards");
  pass(eventClusters[0].coverage_urls.length === 5 && eventClusters[0].discovery_lens_ids.length === 2 && eventClusters[0].coverage_independence.includes("not independent corroboration"), "event cluster retains bounded URLs/lenses while explicitly not claiming independent corroboration");
  const crossLane = await clusterWatchdeskItems([...openEntries, {
    lane: "trusted_source", source: { id: "synthetic-primary", primary_record: true },
    item: { title: openTitle, url: "https://records.example/story-1", seen_at: "20260922T120000Z" },
  }]);
  pass(crossLane.length === 1 && crossLane[0].source_cluster_overlap && crossLane[0].representative.lane === "trusted_source", "trusted primary material remains the representative when it overlaps Open Sweep coverage");
  const samePublisher = await clusterWatchdeskItems([
    { lane: "open_sweep", source: { primary_record: false }, item: { title: openTitle, url: "https://same.example/a", seen_at: "20260922T120000Z" } },
    { lane: "open_sweep", source: { primary_record: false }, item: { title: "Residents waited months after City Housing Agency ignored repair complaints again", url: "https://same.example/b", seen_at: "20260922T120000Z" } },
  ]);
  pass(samePublisher.length === 2, "similar headlines from one publisher are not merged without strong cross-publisher identity");
  const farApart = await clusterWatchdeskItems([
    { lane: "open_sweep", source: { primary_record: false }, item: { title: openTitle, url: "https://outlet-a.example/a", seen_at: "20260901T120000Z" } },
    { lane: "open_sweep", source: { primary_record: false }, item: { title: openTitle, url: "https://outlet-b.example/b", seen_at: "20260920T120000Z" } },
  ]);
  pass(farApart.length === 2, "matching titles outside the seven-day event window remain separate events");
  pass(farApart[0].cluster_id !== farApart[1].cluster_id, "the stable event key separates repeated headlines from different time windows");
  const unknownDate = await clusterWatchdeskItems([
    { lane: "open_sweep", source: { primary_record: false }, item: { title: openTitle, url: "https://outlet-a.example/a" } },
    { lane: "open_sweep", source: { primary_record: false }, item: { title: openTitle, url: "https://outlet-b.example/b" } },
  ]);
  pass(unknownDate.length === 2, "missing publication/seen time prevents title-only event clustering");
  const stableId = await clusterWatchdeskItems([openEntries[0]]);
  pass(stableId[0].cluster_id === eventClusters[0].cluster_id, "a repeated headline retains its deterministic event identity when coverage URL count changes");
  const boundedCoverage = await clusterWatchdeskItems(Array.from({ length: 10 }, (_, index) => ({ lane: "open_sweep", source: { primary_record: false }, item: { title: openTitle, url: `https://coverage${index}.example/story`, seen_at: "20260922T120000Z" } })));
  pass(boundedCoverage[0].coverage_urls.length === 8 && boundedCoverage[0].coverage_urls.includes(boundedCoverage[0].representative.normalized_url), "cluster audit retains the representative URL within its bounded coverage set");

  const strongOpenCluster = eventClusters[0];
  const openAssessment = triageOpenSweepCluster(strongOpenCluster);
  pass(openAssessment.ready && openAssessment.recommendation === "EXPLORE" && openAssessment.checks.human_impact && openAssessment.checks.institutional_nexus && openAssessment.checks.concrete_condition && openAssessment.checks.accountability_aperture && openAssessment.checks.researchability, "metadata-only Open Sweep intake requires all six lightweight human-impact/accountability/researchability checks");
  pass(openAssessment.fml_candidate && openAssessment.labels.includes("human_burden") && openAssessment.source_trust.startsWith("unknown"), "FML and human-burden are discovery labels only, and unknown publishers remain leads rather than trusted sources");
  pass(openAssessment.ranking_signals.includes("named_institution_in_title") && !openAssessment.ranking_signals.some((signal) => /emotion|tone/i.test(signal)), "Open Sweep ranking favors concrete reporting signals rather than emotional intensity");
  const emotionalJunk = await clusterWatchdeskItems([{ lane: "open_sweep", source: { id: "gdelt-open-sweep", primary_record: false }, item: { title: "A heartbreaking family lost everything in a devastating tragedy with no further details", url: "https://local.example/tragedy", discovery_lens_id: "emotional_intensity" } }]);
  const emotionalTriage = triageOpenSweepCluster(emotionalJunk[0]);
  pass(!emotionalTriage.ready && !emotionalTriage.fml_candidate && emotionalTriage.reasons.includes("institutional_nexus"), "highly emotional coverage without a plausible institutional/accountability nexus is discarded");
  const vagueSystemCluster = await clusterWatchdeskItems([{ lane: "open_sweep", source: { id: "gdelt-open-sweep", primary_record: false }, item: { title: "Families waited months after system error denied their benefits without recourse", url: "https://local.example/vague-system", discovery_lens_id: "human_burden" } }]);
  pass(!triageOpenSweepCluster(vagueSystemCluster[0]).checks.institutional_nexus, "a vague reference to a system alone is not an identifiable institutional nexus");

  const openItem = { title: openTitle, url: "https://localnews.example/story-1", seen_at: "20260922T120000Z", discovery_lens_id: "human_burden", discovery_lens_label: "Human Burden", discovery_query: "families billed after" };
  const sweepResult = { queries_attempted: 10, queries_failed: 0, items: [openItem], source_health: Array.from({ length: 10 }, (_, index) => ({ source_id: "gdelt-doc", lane: "open_sweep", lens_id: `lens-${index}`, checked_at: FIXED_NOW, status: "succeeded", items_parsed: 1, error: null })), source_failures: [] };
  const openRun = await runWatchdeskScan({}, {
    ...runOptions, discoverSource: async () => [], openSweep: true, discoverOpenSweep: async () => sweepResult,
    lookupDiscovery: async () => [], lookupMonitoring: async () => null, dryRun: false, runId: "synthetic_open_sweep",
  });
  const admittedOpen = stored.at(-1);
  const admittedCandidate = JSON.parse(admittedOpen.discovery_metadata_json).candidate;
  pass(openRun.status === "complete" && openRun.metrics.trusted_candidates === 0 && openRun.metrics.open_sweep_queries_attempted === 10 && openRun.metrics.open_sweep_submissions === 1, `Open-only lead may enter the same Watchdesk run and bounded submission cap (${JSON.stringify({ status: openRun.status, trusted: openRun.metrics.trusted_candidates, queries: openRun.metrics.open_sweep_queries_attempted, triaged: openRun.metrics.open_sweep_triaged_candidates, discarded: openRun.metrics.open_sweep_no_action_discarded, duplicate: openRun.metrics.duplicates_known, submitted: openRun.metrics.open_sweep_submissions, would: openRun.metrics.would_submit, leads: openRun.discovery_leads.length, failures: openRun.source_failures })})`);
  pass(admittedOpen.submitted_url === openItem.url && admittedCandidate.discovery.lane === "open_sweep" && admittedCandidate.discovery.source_trust === "unknown_lead_only", "admitted Open Sweep URL is normalized into the ordinary discovery intake with explicit unknown-source provenance");
  pass(admittedCandidate.evidence_review_state === "NOT REVIEWED" && admittedCandidate.institution_or_system === null && admittedCandidate.discovery.event_cluster.cluster_size === 1 && admittedCandidate.triage.recommendation === "EXPLORE", "Open Sweep does not manufacture reviewed evidence, an accountable actor, or a factual conclusion");
  pass(admittedCandidate.submission_readiness.mode === "open_sweep_lead" && admittedCandidate.submission_readiness.evidence_verified === false && admittedCandidate.remains_unproven.includes("not been verified"), "Open Sweep admission is explicitly a lead-only handoff to the unchanged normal analysis path");
  pass(admittedCandidate.triage.ranking_signals.includes("named_institution_in_title"), "the bounded lead ordering signals persist with the admitted discovery provenance");

  const publishedRelated = { ...openItem, related_story_id: "faa-bnatcs-gao-cost-schedule-review", url: "https://localnews.example/related-existing-story" };
  const publishedRepeat = await runWatchdeskScan({}, {
    ...runOptions, discoverSource: async () => [], openSweep: true,
    discoverOpenSweep: async () => ({ ...sweepResult, items: [publishedRelated] }), lookupDiscovery: async () => [], dryRun: true,
    submitCandidate: async () => { throw new Error("published-event repeat must not submit"); }, runId: "synthetic_open_published_repeat",
  });
  pass(publishedRepeat.metrics.duplicates_known === 1 && publishedRepeat.metrics.would_submit === 0, "Open Sweep lead related to an existing published Story File is suppressed absent a material-development signal");
  const publishedDevelopment = { ...publishedRelated, title: "New report: Families waited months after City Housing Agency ignored repeated repair complaints", url: "https://localnews.example/related-new-report" };
  const publishedUpdate = await runWatchdeskScan({}, {
    ...runOptions, discoverSource: async () => [], openSweep: true,
    discoverOpenSweep: async () => ({ ...sweepResult, items: [publishedDevelopment] }), lookupDiscovery: async () => [], dryRun: true,
    submitCandidate: async () => { throw new Error("dry run must not submit"); }, runId: "synthetic_open_published_development",
  });
  pass(publishedUpdate.metrics.would_submit === 1 && publishedUpdate.candidates[0].published_story_relationship.type === "published_development" && publishedUpdate.candidates[0].discovery.material_development_signal, "explicit follow-up/new-report wording may surface a related lead for normal analysis without declaring the development verified");

  const junkRun = await runWatchdeskScan({}, {
    ...runOptions, discoverSource: async () => [], openSweep: true,
    discoverOpenSweep: async () => ({ ...sweepResult, items: [{ title: "A heartbreaking family lost everything in a devastating tragedy with no further details", url: "https://localnews.example/tragedy", discovery_lens_id: "emotional_intensity", discovery_query: "family says denied service" }] }),
    lookupDiscovery: async () => [], dryRun: true, submitCandidate: async () => { throw new Error("emotional-only item must not submit"); }, runId: "synthetic_open_junk",
  });
  pass(junkRun.metrics.open_sweep_human_burden_candidates === 0 && junkRun.metrics.open_sweep_fml_candidates === 0 && junkRun.metrics.open_sweep_no_action_discarded === 1 && junkRun.metrics.would_submit === 0, "emotion alone never creates an Open Sweep candidate or fills the submission ceiling");

  const openFailure = await runWatchdeskScan({}, {
    ...runOptions, discoverSource: discovery(strongCase.item), openSweep: true,
    discoverOpenSweep: async () => { throw new Error("SYNTHETIC_GDELT_UNAVAILABLE"); },
    lookupDiscovery: async () => [], dryRun: true, runId: "synthetic_open_failure",
  });
  pass(openFailure.status === "partial" && openFailure.metrics.trusted_candidates === 1 && openFailure.metrics.would_submit === 1 && openFailure.source_failures.some((failure) => failure.lane === "open_sweep"), "Open Sweep failure is visible but does not break a successful Trusted Source lane");
  const zeroOpen = await runWatchdeskScan({}, {
    ...runOptions, discoverSource: async () => [], openSweep: true,
    discoverOpenSweep: async () => ({ queries_attempted: 10, queries_failed: 0, items: [], source_health: [], source_failures: [] }),
    lookupDiscovery: async () => [], dryRun: true, runId: "synthetic_open_zero",
  });
  pass(zeroOpen.status === "complete" && zeroOpen.metrics.would_submit === 0 && zeroOpen.metrics.submitted_to_newsroom === 0, "zero qualifying Open Sweep and Trusted Source results remain a successful zero-submission run");

  let capturedOptions;
  const handler = createAdminHandler({ authenticate: async () => ({ actorType: "editor", actorId: "editor@example.com", email: "editor@example.com" }), executeWatchdesk: async (_env, options) => { capturedOptions = options; return { ok: true, dry_run: options.dryRun, metrics: {} }; } });
  const apiResponse = await handler(new Request("https://admin.example/api/admin/watchdesk/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dry_run: true }) }), {});
  pass(apiResponse.status === 200 && capturedOptions.dryRun === true && capturedOptions.requestedBy === "editor@example.com", "authenticated on-demand API must pass actor provenance and dry-run mode");
  const invalidResponse = await handler(new Request("https://admin.example/api/admin/watchdesk/runs", { method: "POST", body: JSON.stringify({ publish: true }) }), {});
  pass(invalidResponse.status === 400, "on-demand API must reject capabilities outside its bounded contract");

  const implementation = await readFile(path.join(ROOT, "src", "watchdesk.js"), "utf8");
  pass(/ANALYSIS_QUEUE/.test(implementation) && !/insertPublicationAttempt|sendEmail|mailto:|content\/stories/.test(implementation), "only submitted Watchdesk intakes may enter formal analysis; Watchdesk must not publish, contact subjects, or write story files");
  const adminUi = await readFile(path.join(ROOT, "public", "admin-persistent", "admin.js"), "utf8");
  pass(["Evidence review state", "Primary-record location", "Topic", "Accountable institution", "Job / expectation", "Observed condition", "Accountability gap", "Submission readiness", "Accountability pathway", "accountableInstitution(candidate)"].every((label) => adminUi.includes(label)), "admin candidate view must expose evidence, actor, optional classic-gap elements, readiness, and accountability pathway separately");
  pass(adminUi.includes('candidate.schema_version==="1.2"') && adminUi.includes("Unverified (legacy candidate)"), "legacy topic-like institution metadata must not be relabeled as a verified accountable actor");
  const adminConfig = await readFile(path.join(ROOT, "wrangler.admin.jsonc"), "utf8");
  pass(JSON.parse(adminConfig).triggers.crons[0] === WATCHDESK_CRON, "Watchdesk schedule must match the bounded twice-daily cadence");
  pass(first.submitted.every((entry) => entry.intake_id.startsWith("synthetic-")), "test suite must use synthetic in-memory queue records only");

  await operationalTests(pass, data, strongCase, zeroCase, failureSource);
  await atomicSubmissionTests(pass, strongCase);

  console.log(`Watchdesk tests passed: ${count} deterministic scenarios covering adapters, dates, normalization, fit, triage, dedupe, run ledger, overlap, schedule, limits, failures, and safety.`);
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

async function probe() {
  const result = await runWatchdeskScan({}, {
    dryRun: true,
    lookupDiscovery: async () => [],
    lookupMonitoring: async () => null,
    submitCandidate: async () => { throw new Error("Read-only source probe must never submit."); },
  });
  console.log(JSON.stringify({
    note: "Read-only public-source probe; no production D1 duplicate lookup or queue write.",
    run_id: result.run_id,
    status: result.status,
    metrics: result.metrics,
    candidates_reaching_fit_review: result.metrics.failed_fit_gate + result.metrics.fit_gate_survivors,
    evidence_state_distribution: result.metrics.evidence_state_distribution,
    source_health: result.source_health,
    source_failures: result.source_failures,
    actual_submissions: result.submitted.length,
  }, null, 2));
}

const command = process.argv[2];
if (!COMMANDS.has(command) || process.argv.length !== 3) {
  console.error("Usage: node scripts/watchdesk.mjs <check|test|dry-run|probe>");
  process.exitCode = 1;
} else {
  try {
    if (command === "check") await check();
    if (command === "test") await test();
    if (command === "dry-run") await dryRun();
    if (command === "probe") await probe();
  } catch (error) {
    console.error(`Watchdesk ${command} failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}
