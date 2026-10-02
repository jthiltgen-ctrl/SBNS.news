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
  senderAllowed,
  storyqueueMessageKey,
} from "./storyqueue.js";
import { parseStoryqueueEmail } from "./storyqueue-email.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function opaqueId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }

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
    email_worker_configured: true,
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

async function ingestStoryqueueEmail(normalized, env) {
  if (!senderAllowed(normalized.sender, env.STORYQUEUE_ALLOWED_SENDERS)) {
    return { ignored: "SENDER_NOT_AUTHORIZED" };
  }

  const messageKey = await storyqueueMessageKey(normalized);
  const existingMessage = await getStoryqueueMessageByKey(env, messageKey);
  if (existingMessage) {
    return { duplicate: true, message_id: existingMessage.id, intake_ids: JSON.parse(existingMessage.intake_ids_json || "[]") };
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
      id: opaqueId("audit"), actor_type: "system", actor_id: "storyqueue-email-worker", action: "storyqueue.email_intake_created",
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
    envelope_sender: normalized.envelope_sender, received_at: normalized.received_at, note_excerpt: normalized.note_excerpt,
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

  return {
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
  };
}

async function handleEmailMessage(message, env) {
  let normalized;
  try { normalized = await parseStoryqueueEmail(message); }
  catch (error) {
    // Do not log message content, sender, subject, or attachment data.
    const knownCodes = new Set(["UNEXPECTED_RECIPIENT", "MESSAGE_TOO_LARGE", "MESSAGE_UNAVAILABLE", "SENDER_UNAVAILABLE"]);
    const code = knownCodes.has(error?.message) ? error.message : "PARSE_FAILED";
    console.warn(JSON.stringify({ event: "storyqueue_email_ignored", code }));
    return;
  }
  try { await ingestStoryqueueEmail(normalized, env); }
  catch (error) {
    // The GreenGeeks mailbox retains the original message for manual recovery.
    console.error(JSON.stringify({ event: "storyqueue_email_failed", error_class: error?.name || "Error" }));
    throw error;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/admin/storyqueue/status") return storyqueueStatus(request, env);
    return adminWorker.fetch(request, env, ctx);
  },
  async email(message, env) {
    return handleEmailMessage(message, env);
  },
  async scheduled(controller, env, ctx) {
    return adminWorker.scheduled(controller, env, ctx);
  },
};
