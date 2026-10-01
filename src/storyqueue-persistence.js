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

export async function getStoryqueueMessageByKey(env, messageKey) {
  return database(env).prepare("SELECT * FROM storyqueue_messages WHERE message_key = ?").bind(messageKey).first();
}

export async function findLatestIntakeBySubmittedUrl(env, submittedUrl) {
  return database(env).prepare("SELECT * FROM intakes WHERE submitted_url = ? ORDER BY submitted_at DESC, id DESC LIMIT 1").bind(submittedUrl).first();
}

export async function storeStoryqueueEmailBatch(env, { message, newRecords }) {
  const db = database(env);
  const statements = [
    db.prepare(`INSERT INTO storyqueue_messages
      (id, message_key, message_id, sender_email, recipient_email, subject, received_at, note_excerpt, url_count, intake_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(message.id, message.message_key, message.message_id ?? null, message.sender_email, message.recipient_email, message.subject ?? null,
        message.received_at, message.note_excerpt ?? null, message.url_count, JSON.stringify(message.intake_ids), message.created_at),
  ];
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
  const result = await database(env).prepare(`SELECT id, message_key, message_id, sender_email, recipient_email, subject, received_at,
    url_count, intake_ids_json, created_at FROM storyqueue_messages ORDER BY received_at DESC, id DESC LIMIT ?`).bind(limit).all();
  return result.results;
}

export async function storyqueueCounts(env) {
  const row = await database(env).prepare(`SELECT
    COUNT(*) AS message_count,
    COALESCE(SUM(url_count), 0) AS url_count,
    MAX(received_at) AS last_received_at
    FROM storyqueue_messages`).first();
  return {
    message_count: Number(row?.message_count || 0),
    url_count: Number(row?.url_count || 0),
    last_received_at: row?.last_received_at || null,
  };
}
