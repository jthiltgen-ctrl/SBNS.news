import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] || "check";

async function check() {
  const migration = await readFile(path.join(ROOT, "migrations/0007_storyqueue_email_intake.sql"), "utf8");
  const relay = await readFile(path.join(ROOT, "integrations/storyqueue/greengeeks-pipe.php"), "utf8");
  const wrapper = await readFile(path.join(ROOT, "src/admin-entry.js"), "utf8");
  const wrangler = await readFile(path.join(ROOT, "wrangler.admin.jsonc"), "utf8");
  assert.match(migration, /CREATE TABLE storyqueue_messages/);
  assert.match(migration, /schema_version' AND value = '6'/);
  assert.match(relay, /No raw MIME or attachment bytes leave the mail host/);
  assert.match(relay, /MAX_URLS = 10/);
  assert.match(wrapper, /\/api\/internal\/storyqueue\/email/);
  assert.match(wrapper, /SENDER_NOT_AUTHORIZED/);
  assert.match(wrangler, /src\/admin-entry\.js/);
  console.log("Story Queue check passed: bounded email bridge, migration, relay, and admin wrapper present.");
}

async function test() {
  assert.equal(STORYQUEUE_ADDRESS, "storyqueue@shockedbutnotsurprised.news");
  assert.equal(normalizeStoryUrl("https://Example.com/a/?utm_source=x&b=2#section"), "https://example.com/a?b=2");
  assert.deepEqual(extractStoryUrls("See https://example.com/a?utm_medium=email and https://example.com/a."), ["https://example.com/a"]);
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
  console.log("Story Queue tests passed: normalization, tracking removal, sender policy, dedupe key, attachment exclusion metadata, and no-link handling.");
}

if (command === "check") await check();
else if (command === "test") await test();
else throw new Error(`Unknown Story Queue command: ${command}`);
