import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORYQUEUE_ADDRESS,
  extractStoryUrls,
  normalizeStoryUrl,
  normalizeStoryqueuePayload,
  senderAllowed,
  storyqueueMessageKey,
} from "../src/storyqueue.js";
import adminEntry from "../src/admin-entry.js";
import { processAnalysisMessage } from "../src/analysis-index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "check";

class LocalD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    return { bind: (...values) => ({
      run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
      first: async (column) => { const row = statement.get(...values) ?? null; return column ? row?.[column] ?? null : row; },
      all: async () => ({ results: statement.all(...values) }),
    }) };
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
  close() { this.sqlite.close(); }
}

async function check() {
  const relay = await readFile(path.join(ROOT, "integrations/storyqueue/greengeeks-pipe.php"), "utf8");
  const wrapper = await readFile(path.join(ROOT, "src/admin-entry.js"), "utf8");
  const persistence = await readFile(path.join(ROOT, "src/storyqueue-persistence.js"), "utf8");
  const wrangler = await readFile(path.join(ROOT, "wrangler.admin.jsonc"), "utf8");
  assert.match(relay, /No raw MIME or attachment bytes leave the mail host/);
  assert.match(relay, /MAX_URLS = 10/);
  assert.match(wrapper, /\/api\/internal\/storyqueue\/email/);
  assert.match(wrapper, /SENDER_NOT_AUTHORIZED/);
  assert.match(persistence, /storyqueue\.email_received/);
  assert.match(persistence, /entity_type = 'storyqueue_message'/);
  assert.match(wrangler, /src\/admin-entry\.js/);
  console.log("Story Queue check passed: bounded email bridge, audit-ledger provenance, relay, and admin wrapper present.");
}

async function bridgeIntegration() {
  const db = new LocalD1();
  try {
    for (const file of ["0001_editorial_foundation.sql", "0002_admin_queue.sql", "0003_live_analysis.sql", "0004_watchdesk_runs.sql", "0005_echo_durable_contracts.sql", "0006_watchdesk_source_learning.sql"])
      db.sqlite.exec(await readFile(path.join(ROOT, "migrations", file), "utf8"));
    const sent = [];
    const env = { SBNS_DB: db, STORYQUEUE_INGEST_TOKEN: "synthetic-bridge-token", STORYQUEUE_ALLOWED_SENDERS: "fixture@example.test",
      ANALYSIS_QUEUE: { send: async (message) => sent.push(message) } };
    const payload = { schema_version: "1", recipient: STORYQUEUE_ADDRESS, sender: "fixture@example.test",
      subject: "Synthetic public leads", message_id: "<fixture-message@example.test>", received_at: "2026-10-01T18:00:00Z",
      plain_text: "Please inspect https://example.test/report-a and https://example.test/report-b. These are invented records.",
      attachment_count: 1 };
    const post = (runtime, input = payload, token = "synthetic-bridge-token") => adminEntry.fetch(new Request("https://admin.example/api/internal/storyqueue/email", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(input),
    }), runtime);
    assert.equal((await post({ ...env, STORYQUEUE_INGEST_TOKEN: undefined })).status, 401, "Missing bridge token must deny ingestion");
    assert.equal((await post({ ...env, STORYQUEUE_ALLOWED_SENDERS: undefined })).status, 403, "Missing sender policy must deny ingestion");
    const first = await post(env);
    assert.equal(first.status, 201);
    const accepted = await first.json();
    assert.equal(accepted.new_intake_ids.length, 2);
    assert.equal(accepted.attachments_ignored, 1);
    assert.equal(sent.length, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM intakes").get().n, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM analysis_jobs WHERE state='queued'").get().n, 2);
    assert.equal((await (await post(env)).json()).duplicate, true, "Duplicate message must replay its original intake IDs");
    assert.equal(sent.length, 2, "Duplicate message must not enqueue again");
    const repeatedUrl = await post(env, { ...payload, message_id: "<second-message@example.test>",
      plain_text: "A second note about https://example.test/report-a" });
    assert.equal((await repeatedUrl.json()).new_intake_ids.length, 0, "A second message about an existing URL must not create a new intake");
    const intake = db.sqlite.prepare("SELECT * FROM intakes WHERE id=?").get(accepted.new_intake_ids[0]);
    const fixture = JSON.parse(await readFile(path.join(ROOT, "intake", "fixtures", "publish-story-005.json"), "utf8"));
    const analysis = structuredClone(fixture.analysis);
    Object.assign(analysis, { intake_id: intake.id, submitted_url: intake.submitted_url, submitted_at: intake.submitted_at, intake_origin: intake.origin });
    analysis.sources = [{ ...analysis.sources[0], source_id: "source-1", url: intake.submitted_url,
      claims_supported: analysis.claims.map((claim) => claim.claim_id) }];
    analysis.claims.forEach((claim) => { claim.source_refs = ["source-1"]; });
    analysis.claim_source_relationships = analysis.claims.map((claim) => ({ claim_id: claim.claim_id, source_id: "source-1",
      relation: "supports", explanation: "Invented fixture source supports this synthetic claim." }));
    analysis.source_conflicts.forEach((conflict) => { conflict.source_refs = ["source-1"]; });
    analysis.proposed_sources = [{ name: "Invented source", url: intake.submitted_url }];
    const queued = sent.find((item) => item.intake_id === intake.id);
    const message = { body: queued, acked: false, ack() { this.acked = true; }, retry() { throw new Error("Synthetic Story Queue analysis must not retry"); } };
    const result = await processAnalysisMessage(message, env, {
      retrieveSource: async () => ({ finalUrl: intake.submitted_url, normalizedUrl: intake.submitted_url,
        text: "Synthetic public report", title: "Invented report", truncated: false, extractionFormat: "text" }),
      expandPrimaryRecords: async () => ({ attempted: 0, records: [], failures: [] }),
      analyzeIntake: async () => analysis,
    });
    assert.equal(result.outcome, "complete");
    assert.equal(db.sqlite.prepare("SELECT status FROM intakes WHERE id=?").get(intake.id).status, "review_ready");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM analyses WHERE intake_id=?").get(intake.id).n, 1);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM claim_sources WHERE intake_id=?").get(intake.id).n, analysis.claims.length);
    assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
    console.log("Story Queue bridge integration passed: deny-by-default, two admitted URLs, attachment exclusion, message/URL dedupe, queued analysis, completed Story File, zero FK violations.");
  } finally { db.close(); }
}

async function test() {
  assert.equal(STORYQUEUE_ADDRESS, "storyqueue@shockedbutnotsurprised.news");
  assert.equal(normalizeStoryUrl("https://Example.com/a/?utm_source=x&b=2#section"), "https://example.com/a?b=2");
  for (const unsafe of ["http://localhost/private", "http://127.0.0.1/private", "http://192.168.1.2/report", "http://[::1]/private", "https://host.local/report"]) {
    assert.throws(() => normalizeStoryUrl(unsafe), /not safe|blocked/);
  }
  assert.deepEqual(extractStoryUrls("See https://example.com/a?utm_medium=email and https://example.com/a."), ["https://example.com/a"]);
  assert.deepEqual(extractStoryUrls("https://example.com/a http://localhost/private https://example.org/b"), ["https://example.com/a", "https://example.org/b"]);
  assert.equal(senderAllowed("trusted@example.com", "trusted@example.com"), true);
  assert.equal(senderAllowed("reporter@news.org", "*@news.org"), true);
  assert.equal(senderAllowed("stranger@example.net", "trusted@example.com"), false);
  assert.equal(senderAllowed("anyone@example.net", ""), false);

  const payload = normalizeStoryqueuePayload({
    schema_version: "1",
    recipient: STORYQUEUE_ADDRESS,
    sender: "Trusted@Example.com",
    subject: "Possible story",
    message_id: "<story-1@example.com>",
    received_at: "2026-10-01T18:00:00Z",
    plain_text: "This may matter: https://example.com/report?utm_source=email",
    urls: ["https://example.com/report?utm_source=email"],
    attachment_count: 3,
  });
  assert.equal(payload.sender, "trusted@example.com");
  assert.deepEqual(payload.urls, ["https://example.com/report"]);
  assert.equal(payload.attachment_count, 3);
  const key1 = await storyqueueMessageKey(payload);
  const key2 = await storyqueueMessageKey(payload);
  assert.match(key1, /^[0-9a-f]{64}$/);
  assert.equal(key1, key2);

  const noLinks = normalizeStoryqueuePayload({
    schema_version: "1",
    recipient: STORYQUEUE_ADDRESS,
    sender: "trusted@example.com",
    received_at: "2026-10-01T18:01:00Z",
    plain_text: "No public link in this note.",
  });
  assert.deepEqual(noLinks.urls, []);
  await bridgeIntegration();
  console.log("Story Queue tests passed: normalization, tracking removal, sender policy, dedupe key, attachment exclusion metadata, and no-link handling.");
}

if (command === "check") await check();
else if (command === "test") await test();
else throw new Error(`Unknown Story Queue command: ${command}`);
