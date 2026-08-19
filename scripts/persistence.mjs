import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "migrations");
const DATABASE = "SBNS_DB";
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const COMMANDS = new Set(["check", "test"]);
const TABLES = ["analyses", "audit_events", "claim_sources", "claims", "editorial_decisions", "editorial_drafts", "intakes", "monitoring_events", "publication_attempts", "sbns_meta", "sources"];
const INDEXES = ["idx_analyses_intake_created", "idx_audit_events_entity_created", "idx_claims_analysis", "idx_claims_intake", "idx_editorial_decisions_intake_decided", "idx_editorial_drafts_intake_revision", "idx_intakes_origin_submitted", "idx_intakes_status_updated", "idx_monitoring_events_status_checked", "idx_monitoring_events_story_checked", "idx_publication_attempts_intake_started", "idx_sources_intake", "idx_sources_normalized_url"];

function fail(message) { throw new Error(message); }

async function wrangler(args, options = {}) {
  try {
    return await execFileAsync(process.execPath, [WRANGLER, ...args], { cwd: ROOT, windowsHide: true, maxBuffer: 4 * 1024 * 1024, ...options });
  } catch (error) {
    const detail = error.stderr?.trim() || error.stdout?.trim() || error.message;
    throw new Error(detail);
  }
}

async function withLocalDatabase(action) {
  const persist = await mkdtemp(path.join(tmpdir(), "sbns-d1-test-"));
  try {
    await wrangler(["d1", "migrations", "apply", DATABASE, "--local", "--persist-to", persist]);
    return await action(persist);
  } finally {
    await rm(persist, { recursive: true, force: true });
  }
}

async function execute(persist, sql) {
  const { stdout } = await wrangler(["d1", "execute", DATABASE, "--local", "--persist-to", persist, "--command", sql, "--json"]);
  const value = JSON.parse(stdout);
  if (!Array.isArray(value) || value.some((entry) => entry.success !== true)) fail(`Local D1 command failed: ${sql}`);
  return value.at(-1)?.results ?? [];
}

async function expectSqlFailure(label, persist, sql) {
  try { await execute(persist, sql); }
  catch { return; }
  fail(`${label}: expected local D1 failure`);
}

function expect(condition, message) { if (!condition) fail(message); }
function names(rows) { return rows.map((row) => row.name).sort(); }
function same(actual, expected) { return actual.length === expected.length && actual.every((value, index) => value === expected[index]); }

async function schemaState(persist) {
  const tables = await execute(persist, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name");
  const indexes = await execute(persist, "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name");
  const version = await execute(persist, "SELECT value FROM sbns_meta WHERE key='schema_version'");
  return { tables: names(tables), indexes: names(indexes), version: version[0]?.value };
}

async function check() {
  const files = (await readdir(MIGRATIONS)).filter((file) => file.endsWith(".sql")).sort();
  expect(same(files, ["0001_editorial_foundation.sql"]), "Migration directory must contain only 0001_editorial_foundation.sql");
  const migration = await readFile(path.join(MIGRATIONS, files[0]), "utf8");
  expect(migration.includes("PRAGMA foreign_keys = ON;"), "Migration must enable foreign keys");
  expect(!migration.includes("submission_contacts"), "Phase 1 must not create submission_contacts");
  await withLocalDatabase(async (persist) => {
    const state = await schemaState(persist);
    expect(same(state.tables, TABLES), `Unexpected tables: ${state.tables.join(", ")}`);
    expect(same(state.indexes, INDEXES), `Unexpected indexes: ${state.indexes.join(", ")}`);
    expect(state.version === "1", "schema_version must be 1");
  });
  console.log(`Persistence schema valid: 1 migration, ${TABLES.length} tables, ${INDEXES.length} indexes, schema_version 1.`);
}

async function test() {
  await withLocalDatabase(async (persist) => {
    let count = 0;
    const pass = (condition, message) => { expect(condition, message); count += 1; };
    const now = "2026-08-19T21:30:00.000Z";

    const version = await execute(persist, "SELECT value FROM sbns_meta WHERE key='schema_version'");
    pass(version[0]?.value === "1", "schema_version test failed");

    await execute(persist, `INSERT INTO intakes VALUES ('intake-1','editor','https://example.com/source','${now}',NULL,'submitted','not_started','${now}','${now}')`);
    const intake = await execute(persist, "SELECT * FROM intakes WHERE id='intake-1'");
    pass(intake[0]?.origin === "editor", "create/read intake failed");

    await expectSqlFailure("duplicate intake", persist, `INSERT INTO intakes VALUES ('intake-1','editor','https://example.com/other','${now}',NULL,'submitted','not_started','${now}','${now}')`);
    count += 1;

    await execute(persist, `INSERT INTO intakes VALUES ('intake-visitor','visitor','https://example.com/visitor','${now}',NULL,'submitted','not_started','${now}','${now}'),('intake-monitor','monitor','https://example.com/monitor','${now}',NULL,'submitted','not_started','${now}','${now}'),('intake-discovery','discovery','https://example.com/discovery','${now}',NULL,'submitted','not_started','${now}','${now}')`);
    const origins = await execute(persist, "SELECT COUNT(*) AS count FROM intakes WHERE origin IN ('editor','visitor','monitor','discovery')");
    pass(origins[0]?.count === 4, "valid origins failed");

    await expectSqlFailure("invalid origin", persist, `INSERT INTO intakes VALUES ('bad-origin','robot','https://example.com','${now}',NULL,'submitted','not_started','${now}','${now}')`);
    count += 1;

    await expectSqlFailure("analysis FK", persist, `INSERT INTO analyses VALUES ('analysis-orphan','missing','1.0','hold','low','Local',NULL,0,'{}','${now}',NULL)`);
    count += 1;

    await execute(persist, `INSERT INTO analyses VALUES ('analysis-1','intake-1','1.0','hold','medium','Local',2,1,'{"schema_version":"1.0"}','${now}',NULL)`);
    const latest = await execute(persist, "SELECT id, severity FROM analyses WHERE intake_id='intake-1' ORDER BY created_at DESC, id DESC LIMIT 1");
    pass(latest[0]?.id === "analysis-1" && latest[0]?.severity === 2, "latest analysis failed");

    await expectSqlFailure("severity", persist, `INSERT INTO analyses VALUES ('analysis-bad','intake-1','1.0','hold','low','Local',6,0,'{}','${now}',NULL)`);
    count += 1;

    await execute(persist, `INSERT INTO sources (id,intake_id,url,normalized_url,name,source_type,verification_status,extracted_text,extraction_format,created_at) VALUES ('source-1','intake-1','https://example.com/report','https://example.com/report','Synthetic report','audit','verified','Bounded evidence text','text','${now}')`);
    await execute(persist, `INSERT INTO claims VALUES ('claim-1','intake-1','analysis-1','A synthetic material claim',1,'verified',NULL,'${now}')`);
    await execute(persist, "INSERT INTO claim_sources VALUES ('claim-1','source-1')");
    const links = await execute(persist, "SELECT COUNT(*) AS count FROM claim_sources WHERE claim_id='claim-1' AND source_id='source-1'");
    pass(links[0]?.count === 1, "source/claim relationship failed");

    await expectSqlFailure("unresolved relationship", persist, "INSERT INTO claim_sources VALUES ('claim-1','missing-source')");
    count += 1;

    await execute(persist, `INSERT INTO editorial_drafts VALUES ('draft-1','intake-1',1,'story-1','Headline one','Summary one','Kicker one','Local',2,'["audit"]','${now}','editor@example.com')`);
    const draft1 = await execute(persist, "SELECT revision, headline FROM editorial_drafts WHERE id='draft-1'");
    pass(draft1[0]?.revision === 1, "draft revision 1 failed");

    await expectSqlFailure("duplicate revision", persist, `INSERT INTO editorial_drafts VALUES ('draft-duplicate','intake-1',1,NULL,'Other','Other','Other','Local',2,'[]','${now}','editor@example.com')`);
    count += 1;

    await execute(persist, `INSERT INTO editorial_drafts VALUES ('draft-2','intake-1',2,'story-1','Headline two','Summary two','Kicker two','Local',2,'["audit"]','${now}','editor@example.com')`);
    const revisions = await execute(persist, "SELECT revision, headline FROM editorial_drafts WHERE intake_id='intake-1' ORDER BY revision");
    pass(revisions.length === 2 && revisions[0].headline === "Headline one" && revisions[1].headline === "Headline two", "immutable draft revisions failed");

    await execute(persist, `INSERT INTO editorial_decisions VALUES ('decision-hold','intake-1',NULL,'hold','editor@example.com','${now}',NULL)`);
    pass((await execute(persist, "SELECT decision FROM editorial_decisions WHERE id='decision-hold'"))[0]?.decision === "hold", "hold without draft failed");

    await execute(persist, `INSERT INTO editorial_decisions VALUES ('decision-reject','intake-1',NULL,'reject','editor@example.com','${now}',NULL)`);
    pass((await execute(persist, "SELECT decision FROM editorial_decisions WHERE id='decision-reject'"))[0]?.decision === "reject", "reject without draft failed");

    await expectSqlFailure("approve without draft", persist, `INSERT INTO editorial_decisions VALUES ('decision-bad','intake-1',NULL,'approve','editor@example.com','${now}',NULL)`);
    count += 1;

    await execute(persist, `INSERT INTO editorial_decisions VALUES ('decision-approve','intake-1','draft-2','approve','editor@example.com','${now}',NULL)`);
    pass((await execute(persist, "SELECT draft_id FROM editorial_decisions WHERE id='decision-approve'"))[0]?.draft_id === "draft-2", "approve with draft failed");

    await expectSqlFailure("publication draft FK", persist, `INSERT INTO publication_attempts (id,intake_id,draft_id,state,started_at) VALUES ('publication-bad','intake-1','missing-draft','queued','${now}')`);
    count += 1;

    await execute(persist, `INSERT INTO monitoring_events VALUES ('monitor-1','git-story-id','https://example.com/development','status_change','${now}','no_action','true',0,'{}','review_ready','${now}','${now}')`);
    pass((await execute(persist, "SELECT story_id FROM monitoring_events WHERE id='monitor-1'"))[0]?.story_id === "git-story-id", "Git story ID monitoring failed");

    await execute(persist, `INSERT INTO audit_events VALUES ('audit-1','editor','editor@example.com','intake.created','intake','intake-1','{}','${now}')`);
    pass((await execute(persist, "SELECT action FROM audit_events WHERE id='audit-1'"))[0]?.action === "intake.created", "audit insert/read failed");

    const persistence = await import("../src/persistence.js");
    const auditExports = Object.keys(persistence).filter((name) => /Audit/.test(name));
    pass(same(auditExports.sort(), ["insertAuditEvent", "listAuditEvents"]), "audit helpers must be insert/read only");

    const state = await schemaState(persist);
    pass(same(state.indexes, INDEXES), "expected indexes missing");
    pass(same(state.tables, TABLES) && !state.tables.includes("submission_contacts"), "expected tables failed");

    const foreignKeys = await execute(persist, "PRAGMA foreign_keys");
    const violations = await execute(persist, "PRAGMA foreign_key_check");
    pass(foreignKeys[0]?.foreign_keys === 1 && violations.length === 0, "foreign keys not enabled/enforced");

    const bounded = await execute(persist, "SELECT extracted_text, extraction_format, content_hash, source_title FROM sources WHERE id='source-1'");
    pass(bounded[0]?.extracted_text === "Bounded evidence text" && bounded[0]?.extraction_format === "text", "bounded source fields failed");

    expect(count === 25, `Expected 25 persistence scenarios, got ${count}`);
    console.log(`Persistence tests passed: ${count} local D1 scenarios, including constraints, relationships, immutable revisions, and audit safety.`);
  });
}

const command = process.argv[2];
if (!COMMANDS.has(command)) {
  console.error("Usage: node scripts/persistence.mjs <check|test>");
  process.exitCode = 1;
} else {
  try {
    if (command === "check") await check();
    if (command === "test") await test();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
