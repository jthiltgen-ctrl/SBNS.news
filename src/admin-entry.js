import adminWorker from "./admin-index.js";
import { verifyAccessRequest } from "./access-auth.js";
import { markAnalysisJobQueued } from "./persistence.js";
import {
  findLatestIntakeBySubmittedUrl,
  getStoryqueueMessageByKey,
  listRecentStoryqueueMessages,
  storeStoryqueueEmailBatch,
  storyqueueCounts,
} from "./storyqueue-persistence.js";
import {
  STORYQUEUE_ADDRESS,
  bearerMatches,
  normalizeStoryqueuePayload,
  senderAllowed,
  storyqueueMessageKey,
} from "./storyqueue.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const MAX_BODY = 32_768;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function opaqueId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) throw new Error("BODY_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) throw new Error("BODY_TOO_LARGE");
  try { return JSON.parse(text); } catch { throw new Error("INVALID_JSON"); }
}

function senderPolicyCount(policy) {
  return String(policy || "").split(",").map((item) => item.trim()).filter(Boolean).length;
}

async function storyqueueStatus(request, env) {
  try { await verifyAccessRequest(request, env); }
  catch { return json({ ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required." } }, 401); }
  const [counts, recent] = await Promise.all([storyqueueCounts(env), listRecentStoryqueueMessages(env, 10)]);
  return json({
    ok: true,
    address: STORYQUEUE_ADDRESS,
    bridge_configured: Boolean(env.STORYQUEUE_INGEST_TOKEN),
    sender_policy_configured: senderPolicyCount(env.STORYQUEUE_ALLOWED_SENDERS) > 0,
    allowed_sender_rule_count: senderPolicyCount(env.STORYQUEUE_ALLOWED_SENDERS),
    attachments_processed: false,
    secure_source: false,
    ...counts,
    recent: recent.map((item) => ({
      id: item.id,
      subject: item.subject,
      sender_email: item.sender_email,
      received_at: item.received_at,
      url_count: item.url_count,
      intake_ids: JSON.parse(item.intake_ids_json || "[]"),
    })),
  });
}

async function ingestStoryqueueEmail(request, env) {
  if (!await bearerMatches(request.headers.get("authorization"), env.STORYQUEUE_INGEST_TOKEN)) {
    return json({ ok: false, error: { code: "AUTH_REQUIRED", message: "Story Queue bridge authentication failed." } }, 401);
  }
  let normalized;
  try { normalized = normalizeStoryqueuePayload(await readJson(request)); }
  catch (error) {
    const code = error?.message === "BODY_TOO_LARGE" ? "BODY_TOO_LARGE" : error?.message === "INVALID_JSON" ? "INVALID_JSON" : "VALIDATION_ERROR";
    return json({ ok: false, error: { code, message: code === "VALIDATION_ERROR" ? error.message : "Story Queue payload could not be accepted." } }, code === "BODY_TOO_LARGE" ? 413 : 400);
  }
  if (!senderAllowed(normalized.sender, env.STORYQUEUE_ALLOWED_SENDERS)) {
    return json({ ok: false, error: { code: "SENDER_NOT_AUTHORIZED", message: "Sender is not authorized for Story Queue ingestion." } }, 403);
  }

  const messageKey = await storyqueueMessageKey(normalized);
  const existingMessage = await getStoryqueueMessageByKey(env, messageKey);
  if (existingMessage) {
    return json({ ok: true, duplicate: true, message_id: existingMessage.id, intake_ids: JSON.parse(existingMessage.intake_ids_json || "[]") });
  }

  const createdAt = now();
  const intakeIds = [];
  const newRecords = [];
  const duplicates = [];
  const noteParts = [];
  if (normalized.subject) noteParts.push(`Email subject: ${normalized.subject}`);
  if (normalized.note_excerpt) noteParts.push(normalized.note_excerpt);
  const submitterNote = noteParts.join("\n\n").slice(0, 2_000) || "Submitted through SBNS Story Queue email.";

  for (const url of normalized.urls) {
    const existing = await findLatestIntakeBySubmittedUrl(env, url);
    if (existing) {
      intakeIds.push(existing.id);
      duplicates.push({ url, intake_id: existing.id });
      continue;
    }
    const intake = {
      id: opaqueId("intake"), origin: "visitor", submitted_url: url, submitted_at: normalized.received_at,
      submitter_note: submitterNote, status: "submitted", analysis_status: "not_started", created_at: createdAt, updated_at: createdAt,
    };
    const job = { id: opaqueId("job"), intake_id: intake.id, job_type: "intake_analysis", state: "pending_enqueue", attempt: 0, created_at: createdAt, updated_at: createdAt };
    const audit = {
      id: opaqueId("audit"), actor_type: "system", actor_id: "storyqueue-email-bridge", action: "storyqueue.email_intake_created",
      entity_type: "intake", entity_id: intake.id,
      metadata_json: JSON.stringify({ message_key: messageKey, message_id: normalized.message_id, sender_email: normalized.sender, subject: normalized.subject, attachment_count_ignored: normalized.attachment_count }),
      created_at: createdAt,
    };
    intakeIds.push(intake.id);
    newRecords.push({ intake, job, audit });
  }

  const message = {
    id: opaqueId("storyqueue"), message_key: messageKey, message_id: normalized.message_id,
    sender_email: normalized.sender, recipient_email: normalized.recipient, subject: normalized.subject,
    received_at: normalized.received_at, note_excerpt: normalized.note_excerpt,
    url_count: normalized.urls.length, intake_ids: intakeIds, created_at: createdAt,
  };
  await storeStoryqueueEmailBatch(env, { message, newRecords });

  const queued = [];
  const queueFailures = [];
  for (const record of newRecords) {
    try {
      await env.ANALYSIS_QUEUE.send({ schema_version: "1", job_id: record.job.id, intake_id: record.intake.id });
      const queuedAt = now();
      await markAnalysisJobQueued(env, record.job.id, record.intake.id, queuedAt);
      queued.push(record.intake.id);
    } catch {
      queueFailures.push(record.intake.id);
    }
  }

  return json({
    ok: true,
    duplicate: false,
    message_id: message.id,
    links_received: normalized.urls.length,
    attachments_ignored: normalized.attachment_count,
    intake_ids: intakeIds,
    new_intake_ids: newRecords.map((record) => record.intake.id),
    duplicate_intakes: duplicates,
    queued_intake_ids: queued,
    pending_enqueue_intake_ids: queueFailures,
    no_links: normalized.urls.length === 0,
  }, normalized.urls.length ? 201 : 202);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/internal/storyqueue/email") return ingestStoryqueueEmail(request, env);
    if (request.method === "GET" && url.pathname === "/api/admin/storyqueue/status") return storyqueueStatus(request, env);
    return adminWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return adminWorker.scheduled(controller, env, ctx);
  },
};
