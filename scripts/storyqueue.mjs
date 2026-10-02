import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STORYQUEUE_ADDRESS,
  STORYQUEUE_ROUTING_ADDRESS,
  extractStoryUrls,
  normalizeStoryUrl,
  normalizeStoryqueuePayload,
  senderAllowed,
  storyqueueMessageKey,
} from "../src/storyqueue.js";
import { MAX_STORYQUEUE_RAW_BYTES, parseStoryqueueEmail } from "../src/storyqueue-email.js";
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
  const wrapper = await readFile(path.join(ROOT, "src/admin-entry.js"), "utf8");
  const persistence = await readFile(path.join(ROOT, "src/storyqueue-persistence.js"), "utf8");
  const wrangler = await readFile(path.join(ROOT, "wrangler.admin.jsonc"), "utf8");
  const ui = await readFile(path.join(ROOT, "public/admin-persistent/storyqueue-ui.js"), "utf8");
  await assert.rejects(() => readFile(path.join(ROOT, "integrations/storyqueue/greengeeks-pipe.php")));
  assert.match(wrapper, /async email\(message, env\)/);
  assert.doesNotMatch(wrapper, /api\/internal\/storyqueue\/email|STORYQUEUE_INGEST_TOKEN/);
  assert.match(wrangler, /"addresses": \["storyqueue@intake\.shockedbutnotsurprised\.news"\]/);
  assert.match(ui, /Email handler/);
  assert.match(persistence, /storyqueue\.email_received/);
  assert.match(persistence, /entity_type = 'storyqueue_message'/);
  assert.equal(MAX_STORYQUEUE_RAW_BYTES, 262_144);
  console.log("Story Queue check passed: bounded Email Worker, subdomain route, existing audit/intake persistence, and retired token relay.");
}

function syntheticEmail({ sender = "fixture@example.test", envelopeSender = "forwarder@greengeeks.example", subject = "Synthetic public leads", messageId = "<fixture-message@example.test>", date = "Thu, 01 Oct 2026 18:00:00 +0000", body, recipient = STORYQUEUE_ROUTING_ADDRESS, rawSize } = {}) {
  const raw = `From: Synthetic Editor <${sender}>\r\nTo: ${STORYQUEUE_ADDRESS}\r\nSubject: ${subject}\r\nDate: ${date}\r\nMessage-ID: ${messageId}\r\nMIME-Version: 1.0\r\n${body}`;
  const bytes = new TextEncoder().encode(raw);
  return {
    from: envelopeSender,
    to: recipient,
    rawSize: rawSize ?? bytes.byteLength,
    headers: new Headers({ from: sender, to: recipient, subject, date, "message-id": messageId }),
    raw: new Blob([bytes]).stream(),
  };
}

const MULTIPART_MESSAGE = `Content-Type: multipart/mixed; boundary="sbns-boundary"\r\n\r\n--sbns-boundary\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: 8bit\r\n\r\nPlease inspect https://example.test/report-a and https://example.test/report-b. These are invented records.\r\n--sbns-boundary\r\nContent-Type: application/octet-stream; name="harmless.txt"\r\nContent-Disposition: attachment; filename="harmless.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\nc3ludGhldGljIGF0dGFjaG1lbnQgYnl0ZXM=\r\n--sbns-boundary--\r\n`;

async function emailWorkerIntegration() {
  const db = new LocalD1();
  try {
    for (const file of ["0001_editorial_foundation.sql", "0002_admin_queue.sql", "0003_live_analysis.sql", "0004_watchdesk_runs.sql", "0005_echo_durable_contracts.sql", "0006_watchdesk_source_learning.sql"])
      db.sqlite.exec(await readFile(path.join(ROOT, "migrations", file), "utf8"));
    const sent = [];
    const env = { SBNS_DB: db, STORYQUEUE_ALLOWED_SENDERS: "fixture@example.test",
      ANALYSIS_QUEUE: { send: async (message) => sent.push(message) } };
    const make = () => syntheticEmail({ body: MULTIPART_MESSAGE });
    const parsed = await parseStoryqueueEmail(make());
    assert.equal(parsed.sender, "fixture@example.test", "Policy uses the RFC 5322 From header, not a rewritten envelope sender");
    assert.equal(parsed.envelope_sender, "forwarder@greengeeks.example", "Forwarder envelope provenance remains distinct");
    assert.equal(parsed.recipient, STORYQUEUE_ROUTING_ADDRESS);
    assert.deepEqual(parsed.urls, ["https://example.test/report-a", "https://example.test/report-b"]);
    assert.equal(parsed.attachment_count, 1);
    assert.doesNotMatch(parsed.plain_text, /synthetic attachment bytes/);

    await adminEntry.email(make(), env, {});
    const accepted = db.sqlite.prepare("SELECT * FROM intakes ORDER BY submitted_url").all();
    assert.equal(accepted.length, 2, "One qualifying forwarded email creates one intake per unique public URL");
    assert.equal(sent.length, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM intakes").get().n, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM analysis_jobs WHERE state='queued'").get().n, 2);
    const acceptedMessage = db.sqlite.prepare("SELECT metadata_json FROM audit_events WHERE action='storyqueue.email_received'").get();
    assert.equal(JSON.parse(acceptedMessage.metadata_json).envelope_sender, "forwarder@greengeeks.example");
    assert.equal(JSON.parse(acceptedMessage.metadata_json).recipient_email, STORYQUEUE_ROUTING_ADDRESS);
    const intakeAudit = db.sqlite.prepare("SELECT metadata_json FROM audit_events WHERE action='storyqueue.email_intake_created' LIMIT 1").get();
    assert.equal(JSON.parse(intakeAudit.metadata_json).attachment_count_ignored, 1);

    await adminEntry.email(make(), env, {});
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='storyqueue.email_received'").get().n, 1, "Duplicate Message-ID reuses the original message audit");
    assert.equal(sent.length, 2, "Duplicate message must not enqueue again");
    const repeatedUrl = syntheticEmail({ messageId: "<second-message@example.test>", date: "Thu, 01 Oct 2026 18:01:00 +0000",
      body: "Content-Type: text/plain; charset=utf-8\r\n\r\nA second note about https://example.test/report-a\r\n" });
    await adminEntry.email(repeatedUrl, env, {});
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM intakes").get().n, 2, "A second message about an existing URL must not create a duplicate intake");
    assert.equal(sent.length, 2, "A duplicate URL cannot create a parallel analysis job");
    const intake = db.sqlite.prepare("SELECT * FROM intakes ORDER BY submitted_url LIMIT 1").get();
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

    const beforeUnauthorized = db.sqlite.prepare("SELECT COUNT(*) AS n FROM intakes").get().n;
    await adminEntry.email(syntheticEmail({ sender: "outsider@example.net", messageId: "<unauthorized@example.test>",
      body: "Content-Type: text/plain; charset=utf-8\r\n\r\nhttps://example.test/unauthorized" }), env, {});
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM intakes").get().n, beforeUnauthorized, "Unauthorized From header cannot create an intake");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='storyqueue.email_received'").get().n, 2, "Unauthorized senders create no Story Queue message audit");

    await adminEntry.email(syntheticEmail({ messageId: "<no-url@example.test>", date: "Thu, 01 Oct 2026 18:02:00 +0000",
      body: "Content-Type: text/plain; charset=utf-8\r\n\r\nNo qualifying public URL in this ordinary email." }), env, {});
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM intakes").get().n, beforeUnauthorized, "Allowed no-URL email creates no intake");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM analysis_jobs").get().n, 2, "No-URL email creates no analysis job");

    await adminEntry.email(syntheticEmail({ messageId: "<no-policy@example.test>", body: MULTIPART_MESSAGE }), { ...env, STORYQUEUE_ALLOWED_SENDERS: undefined }, {});
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM intakes").get().n, beforeUnauthorized, "Missing sender policy denies ingestion");
    await adminEntry.email(syntheticEmail({ messageId: "<oversize@example.test>", rawSize: MAX_STORYQUEUE_RAW_BYTES + 1, body: MULTIPART_MESSAGE }), env, {});
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM intakes").get().n, beforeUnauthorized, "Oversized forwarded message is ignored before parsing or persistence");

    const oldEndpoint = await adminEntry.fetch(new Request("https://admin.example/api/internal/storyqueue/email", { method: "POST" }), env);
    assert.equal(oldEndpoint.status, 404, "The shared-token HTTP bridge is no longer an active ingress path");
    assert.equal(db.sqlite.prepare("PRAGMA foreign_key_check").all().length, 0);
    console.log("Story Queue Email Worker integration passed: forwarded MIME parsing, From-header allowlist, attachment exclusion, message/URL dedupe, analysis enqueue, no-URL/unauthorized denial, bounded size, retired HTTP bridge, completed Story File, zero FK violations.");
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
  const approvedPolicy = "*@shockedbutnotsurprised.news,jthiltgen@gmail.com,justin@jthiltgen.com";
  assert.equal(senderAllowed("editor@shockedbutnotsurprised.news", approvedPolicy), true);
  assert.equal(senderAllowed("jthiltgen@gmail.com", approvedPolicy), true);
  assert.equal(senderAllowed("justin@jthiltgen.com", approvedPolicy), true);
  assert.equal(senderAllowed("outsider@example.net", approvedPolicy), false);

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
  await emailWorkerIntegration();
  console.log("Story Queue tests passed: normalization, tracking removal, sender policy, dedupe key, attachment exclusion metadata, and no-link handling.");
}

if (command === "check") await check();
else if (command === "test") await test();
else throw new Error(`Unknown Story Queue command: ${command}`);
