function database(env) {
  if (!env?.SBNS_DB) throw new Error("SBNS_DB binding is required");
  return env.SBNS_DB;
}

function jobStatement(env, job) {
  return database(env).prepare(`INSERT INTO analysis_jobs
    (id, intake_id, job_type, state, attempt, source_id, analysis_id, enqueued_at, started_at, completed_at, last_error_code, last_error_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(job.id, job.intake_id, job.job_type, job.state, job.attempt ?? 0, job.source_id ?? null, job.analysis_id ?? null, job.enqueued_at ?? null, job.started_at ?? null, job.completed_at ?? null, job.last_error_code ?? null, job.last_error_message ?? null, job.created_at, job.updated_at);
}

function auditStatement(env, event) {
  return database(env).prepare(`INSERT INTO audit_events
    (id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(event.id, event.actor_type, event.actor_id ?? null, event.action, event.entity_type, event.entity_id, event.metadata_json, event.created_at);
}

function parseMessageRow(row) {
  if (!row) return null;
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json || "{}"); } catch { metadata = {}; }
  return {
    id: row.id,
    message_key: row.entity_id,
    message_id: metadata.message_id ?? null,
    sender_email: metadata.sender_email ?? null,
    recipient_email: metadata.recipient_email ?? null,
    subject: metadata.subject ?? null,
    received_at: metadata.received_at ?? row.created_at,
    url_count: Number(metadata.url_count || 0),
    intake_ids_json: JSON.stringify(metadata.intake_ids || []),
    created_at: row.created_at,
  };
}

export async function getStoryqueueMessageByKey(env, messageKey) {
  const row = await database(env).prepare(`SELECT * FROM audit_events
    WHERE entity_type = 'storyqueue_message' AND entity_id = ? AND action = 'storyqueue.email_received'
    ORDER BY created_at DESC, id DESC LIMIT 1`).bind(messageKey).first();
  return parseMessageRow(row);
}

export async function findLatestIntakeBySubmittedUrl(env, submittedUrl) {
  return database(env).prepare("SELECT * FROM intakes WHERE submitted_url = ? ORDER BY submitted_at DESC, id DESC LIMIT 1").bind(submittedUrl).first();
}

export async function storeStoryqueueEmailBatch(env, { message, newRecords }) {
  const db = database(env);
  const statements = [auditStatement(env, {
    id: message.id,
    actor_type: "system",
    actor_id: "storyqueue-email-bridge",
    action: "storyqueue.email_received",
    entity_type: "storyqueue_message",
    entity_id: message.message_key,
    metadata_json: JSON.stringify({
      message_id: message.message_id ?? null,
      sender_email: message.sender_email,
      recipient_email: message.recipient_email,
      subject: message.subject ?? null,
      received_at: message.received_at,
      note_excerpt: message.note_excerpt ?? null,
      url_count: message.url_count,
      intake_ids: message.intake_ids,
    }),
    created_at: message.created_at,
  })];
  for (const record of newRecords) {
    statements.push(
      db.prepare(`INSERT INTO intakes
        (id, origin, submitted_url, submitted_at, submitter_note, status, analysis_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(record.intake.id, record.intake.origin, record.intake.submitted_url, record.intake.submitted_at, record.intake.submitter_note ?? null,
          record.intake.status, record.intake.analysis_status, record.intake.created_at, record.intake.updated_at),
      jobStatement(env, record.job),
      auditStatement(env, record.audit),
    );
  }
  return db.batch(statements);
}

export async function listRecentStoryqueueMessages(env, limit = 20) {
  const result = await database(env).prepare(`SELECT * FROM audit_events
    WHERE entity_type = 'storyqueue_message' AND action = 'storyqueue.email_received'
    ORDER BY created_at DESC, id DESC LIMIT ?`).bind(limit).all();
  return result.results.map(parseMessageRow);
}

export async function storyqueueCounts(env) {
  const row = await database(env).prepare(`SELECT
    COUNT(*) AS message_count,
    COALESCE(SUM(CAST(json_extract(metadata_json, '$.url_count') AS INTEGER)), 0) AS url_count,
    MAX(COALESCE(json_extract(metadata_json, '$.received_at'), created_at)) AS last_received_at
    FROM audit_events
    WHERE entity_type = 'storyqueue_message' AND action = 'storyqueue.email_received'`).first();
  return {
    message_count: Number(row?.message_count || 0),
    url_count: Number(row?.url_count || 0),
    last_received_at: row?.last_received_at || null,
  };
}
