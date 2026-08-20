import { verifyAccessRequest } from "./access-auth.js";
import {
  createDecisionWithAudit,
  createDraftWithAudit,
  createIntakeJobWithAudit,
  createRetryJobWithAudit,
  getActiveAnalysisJob,
  getDraft,
  getIdempotencyRecord,
  getIntake,
  getIntakeDetail,
  getLatestDraft,
  getLatestAnalysisJob,
  listIntakes,
  markAnalysisJobQueued,
  recordAnalysisRetryWithAudit,
  updateIdempotencyResponse,
} from "./persistence.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY = 16_384;
const MAX_NOTE = 2_000;
const CATEGORIES = new Set(["International", "National", "Local"]);

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorResponse(error) {
  if (error instanceof ApiError) return json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
  console.error(JSON.stringify({ event: "admin_api_error", message: error?.message ?? "Unknown error" }));
  return json({ ok: false, error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, 500);
}

function requiredString(value, name, max) {
  if (typeof value !== "string" || !value.trim()) throw new ApiError(400, "VALIDATION_ERROR", `${name} is required.`);
  const result = value.trim();
  if (result.length > max) throw new ApiError(400, "VALIDATION_ERROR", `${name} is too long.`);
  return result;
}

function optionalString(value, name, max) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new ApiError(400, "VALIDATION_ERROR", `${name} is invalid.`);
  return value.trim() || null;
}

function validateUrl(value) {
  const input = requiredString(value, "submitted_url", 2_048);
  let url;
  try { url = new URL(input); } catch { throw new ApiError(400, "INVALID_URL", "A valid HTTP or HTTPS URL is required."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new ApiError(400, "INVALID_URL", "A valid HTTP or HTTPS URL without credentials is required.");
  return url.href;
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large.");
  try { return JSON.parse(text); } catch { throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON."); }
}

async function hash(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function opaqueId(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }

async function idempotencyContext(request, env, actor, operation, body) {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length > 200) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required.");
  const requestHash = await hash(JSON.stringify(body));
  const existing = await getIdempotencyRecord(env, actor.actorId, operation, key);
  if (existing) {
    if (existing.request_hash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used with a different request.");
    return { replay: json(JSON.parse(existing.response_json), existing.response_status), key, requestHash };
  }
  return { key, requestHash };
}

function records(actor, operation, context, responseStatus, responseBody, createdAt) {
  return { key: context.key, actor_id: actor.actorId, operation, request_hash: context.requestHash, response_status: responseStatus, response_json: JSON.stringify(responseBody), created_at: createdAt };
}

function audit(actor, action, entityId, createdAt, metadata = {}) {
  return { id: opaqueId("audit"), actor_type: actor.actorType, actor_id: actor.actorId, action, entity_type: "intake", entity_id: entityId, metadata_json: JSON.stringify(metadata), created_at: createdAt };
}

async function createIntake(request, env, actor) {
  const body = await readJson(request);
  const submittedUrl = validateUrl(body.submitted_url);
  const submitterNote = optionalString(body.submitter_note, "submitter_note", MAX_NOTE);
  const context = await idempotencyContext(request, env, actor, "intake.create", { submitted_url: submittedUrl, submitter_note: submitterNote });
  if (context.replay) return context.replay;
  const createdAt = now();
  const intake = { id: opaqueId("intake"), origin: "editor", submitted_url: submittedUrl, submitted_at: createdAt, submitter_note: submitterNote, status: "submitted", analysis_status: "not_started", created_at: createdAt, updated_at: createdAt };
  const job = { id: opaqueId("job"), intake_id: intake.id, job_type: "intake_analysis", state: "pending_enqueue", attempt: 0, created_at: createdAt, updated_at: createdAt };
  const pendingBody = { ok: true, intake, analysis_job: job, queued: false, message: "Intake saved, but analysis has not been queued yet." };
  await createIntakeJobWithAudit(env, intake, job, audit(actor, "intake.created", intake.id, createdAt, { analysis_job_id: job.id }), records(actor, "intake.create", context, 201, pendingBody, createdAt));
  const responseBody = await enqueueJob(env, intake, job, actor, "intake.create", context.key, pendingBody);
  return json(responseBody, 201);
}

async function enqueueJob(env, intake, job, actor, operation, idempotencyKey, fallbackBody) {
  try {
    await env.ANALYSIS_QUEUE.send({ schema_version: "1", job_id: job.id, intake_id: intake.id });
    const queuedAt = now(); await markAnalysisJobQueued(env, job.id, intake.id, queuedAt);
    const responseBody = { ok: true, intake: { ...intake, status: "queued", analysis_status: "queued", updated_at: queuedAt }, analysis_job: { ...job, state: "queued", enqueued_at: queuedAt, updated_at: queuedAt }, queued: true };
    await updateIdempotencyResponse(env, actor.actorId, operation, idempotencyKey, 201, responseBody); return responseBody;
  } catch {
    await updateIdempotencyResponse(env, actor.actorId, operation, idempotencyKey, 201, fallbackBody);
    return { ...fallbackBody, message: "Intake saved, but analysis could not be queued. Retry analysis." };
  }
}

async function retryAnalysis(request, env, actor, intakeId) {
  const intake = await getIntake(env, intakeId); if (!intake) throw new ApiError(404, "NOT_FOUND", "Intake not found.");
  const body = await readJson(request); if (Object.keys(body).length) throw new ApiError(400, "VALIDATION_ERROR", "Retry request body must be empty.");
  const operation = `analysis.retry:${intakeId}`; const context = await idempotencyContext(request, env, actor, operation, {}); if (context.replay) return context.replay;
  const active = await getActiveAnalysisJob(env, intakeId);
  if (active && active.state !== "pending_enqueue") {
    const responseBody = { ok: true, intake, analysis_job: active, queued: active.state !== "pending_enqueue" };
    const createdAt = now(); await recordAnalysisRetryWithAudit(env, audit(actor, "analysis.retry_requested", intakeId, createdAt, { job_id: active.id, active: true }), records(actor, operation, context, 200, responseBody, createdAt)); return json(responseBody);
  }
  const latest = active?.state === "pending_enqueue" ? active : await getLatestAnalysisJob(env, intakeId);
  if (latest?.state === "complete") throw new ApiError(409, "ANALYSIS_COMPLETE", "Completed analysis cannot be rerun in Phase 3.");
  const createdAt = now();
  const job = latest?.state === "pending_enqueue" ? latest : { id: opaqueId("job"), intake_id: intakeId, job_type: "intake_analysis", state: "pending_enqueue", attempt: 0, created_at: createdAt, updated_at: createdAt };
  const pendingBody = { ok: true, intake, analysis_job: job, queued: false, message: "Analysis could not be queued. Try again." };
  if (job === latest) await recordAnalysisRetryWithAudit(env, audit(actor, "analysis.retry_requested", intakeId, createdAt, { job_id: job.id }), records(actor, operation, context, 201, pendingBody, createdAt));
  else await createRetryJobWithAudit(env, job, audit(actor, "analysis.retry_requested", intakeId, createdAt, { job_id: job.id }), records(actor, operation, context, 201, pendingBody, createdAt));
  return json(await enqueueJob(env, intake, job, actor, operation, context.key, pendingBody), 201);
}

function validateDraft(body) {
  const category = requiredString(body.category, "category", 32);
  if (!CATEGORIES.has(category)) throw new ApiError(400, "VALIDATION_ERROR", "category is invalid.");
  if (!Number.isInteger(body.severity) || body.severity < 1 || body.severity > 5) throw new ApiError(400, "VALIDATION_ERROR", "severity must be an integer from 1 to 5.");
  if (!Array.isArray(body.topic_tags) || !body.topic_tags.length || body.topic_tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.length > 80)) throw new ApiError(400, "VALIDATION_ERROR", "topic_tags must contain valid tags.");
  return { story_id: optionalString(body.story_id, "story_id", 120), headline: requiredString(body.headline, "headline", 300), summary: requiredString(body.summary, "summary", 5_000), fml_kicker: requiredString(body.fml_kicker, "fml_kicker", 500), category, severity: body.severity, topic_tags: [...new Set(body.topic_tags.map((tag) => tag.trim()))] };
}

async function createDraft(request, env, actor, intakeId) {
  if (!await getIntake(env, intakeId)) throw new ApiError(404, "NOT_FOUND", "Intake not found.");
  const validated = validateDraft(await readJson(request));
  const context = await idempotencyContext(request, env, actor, `draft.create:${intakeId}`, validated);
  if (context.replay) return context.replay;
  const latest = await getLatestDraft(env, intakeId);
  const createdAt = now();
  const draft = { id: opaqueId("draft"), intake_id: intakeId, revision: (latest?.revision ?? 0) + 1, ...validated, topic_tags_json: JSON.stringify(validated.topic_tags), created_at: createdAt, created_by: actor.actorId };
  delete draft.topic_tags;
  const responseBody = { ok: true, draft: { ...draft, topic_tags: validated.topic_tags } };
  try {
    await createDraftWithAudit(env, draft, audit(actor, "draft.created", intakeId, createdAt, { draft_id: draft.id, revision: draft.revision }), records(actor, `draft.create:${intakeId}`, context, 201, responseBody, createdAt));
  } catch (error) {
    if (/UNIQUE constraint failed: editorial_drafts\.intake_id, editorial_drafts\.revision/i.test(error?.message ?? "")) throw new ApiError(409, "REVISION_CONFLICT", "A concurrent draft revision was created. Reload and try again.");
    throw error;
  }
  return json(responseBody, 201);
}

async function createDecision(request, env, actor, intakeId) {
  if (!await getIntake(env, intakeId)) throw new ApiError(404, "NOT_FOUND", "Intake not found.");
  const body = await readJson(request);
  if (!new Set(["hold", "reject", "approve"]).has(body.decision)) throw new ApiError(400, "VALIDATION_ERROR", "decision is invalid.");
  const draftId = optionalString(body.draft_id, "draft_id", 200);
  if (body.decision === "approve" && !draftId) throw new ApiError(400, "DRAFT_REQUIRED", "Approval requires an exact saved draft.");
  if (draftId) {
    const draft = await getDraft(env, draftId);
    if (!draft || draft.intake_id !== intakeId) throw new ApiError(400, "INVALID_DRAFT", "The selected draft does not belong to this intake.");
  }
  const normalized = { decision: body.decision, draft_id: draftId, notes: optionalString(body.notes, "notes", 2_000) };
  const context = await idempotencyContext(request, env, actor, `decision.create:${intakeId}`, normalized);
  if (context.replay) return context.replay;
  const decidedAt = now();
  const decision = { id: opaqueId("decision"), intake_id: intakeId, ...normalized, decided_by: actor.actorId, decided_at: decidedAt };
  const responseBody = { ok: true, decision };
  const status = { hold: "held", reject: "rejected", approve: "approved" }[body.decision];
  await createDecisionWithAudit(env, decision, status, audit(actor, `decision.${body.decision}`, intakeId, decidedAt, { decision_id: decision.id, draft_id: draftId }), records(actor, `decision.create:${intakeId}`, context, 201, responseBody, decidedAt));
  return json(responseBody, 201);
}

async function route(request, env, actor) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/admin/session") return json({ ok: true, actor: { role: "editor", email: actor.email } });
  if (url.pathname === "/api/admin/intakes" && request.method === "GET") {
    const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50));
    const status = url.searchParams.get("status"); const origin = url.searchParams.get("origin");
    return json({ ok: true, intakes: await listIntakes(env, { status, origin, limit }) });
  }
  if (url.pathname === "/api/admin/intakes" && request.method === "POST") return createIntake(request, env, actor);
  const match = url.pathname.match(/^\/api\/admin\/intakes\/([^/]+)(?:\/(drafts|decisions|analyze))?$/);
  if (match && request.method === "GET" && !match[2]) {
    const detail = await getIntakeDetail(env, decodeURIComponent(match[1]));
    if (!detail) throw new ApiError(404, "NOT_FOUND", "Intake not found.");
    return json({ ok: true, ...detail });
  }
  if (match && request.method === "POST" && match[2] === "drafts") return createDraft(request, env, actor, decodeURIComponent(match[1]));
  if (match && request.method === "POST" && match[2] === "decisions") return createDecision(request, env, actor, decodeURIComponent(match[1]));
  if (match && request.method === "POST" && match[2] === "analyze") return retryAnalysis(request, env, actor, decodeURIComponent(match[1]));
  throw new ApiError(404, "NOT_FOUND", "Not Found");
}

export function createAdminHandler({ authenticate = verifyAccessRequest } = {}) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ADMIN_ASSETS.fetch(request);
    if (!url.pathname.startsWith("/api/admin/")) return json({ ok: false, error: { code: "NOT_FOUND", message: "Not Found" } }, 404);
    try {
      const actor = await authenticate(request, env);
      return await route(request, env, actor);
    } catch (error) {
      if (error?.message === "AUTH_REQUIRED") return json({ ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required." } }, 401);
      return errorResponse(error);
    }
  };
}

const handle = createAdminHandler();
export default { fetch: handle };
