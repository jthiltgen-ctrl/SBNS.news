import { verifyAccessRequest, verifyAccessServiceRequest } from "./access-auth.js";
import { getWatchdeskMachineHealth, getWatchdeskStatus, runWatchdeskOperation, WATCHDESK_CRON } from "./watchdesk-operations.js";
import { DiscoveryQueryError, searchPublicDiscovery } from "./editorial-search.js";
import { normalizeStoryUrl } from "./storyqueue.js";
import { findLatestIntakeBySubmittedUrl } from "./storyqueue-persistence.js";
import { WATCHDESK_SOURCES } from "../watchdesk/source-registry.js";
import { createEchoDecision, getEchoStoryState } from "./echo-persistence.js";
import { echoEligible } from "./echo-runtime.js";
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
  listWatchdeskSourceCandidates,
  getWatchdeskSourceCandidate,
  decideWatchdeskSourceCandidate,
  markAnalysisJobQueued,
  recordAnalysisRetryWithAudit,
  recordEchoRequestWithAudit,
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
  const submittedUrl = normalizeStoryUrl(validateUrl(body.submitted_url));
  const submitterNote = optionalString(body.submitter_note, "submitter_note", MAX_NOTE);
  const context = await idempotencyContext(request, env, actor, "intake.create", { submitted_url: submittedUrl, submitter_note: submitterNote });
  if (context.replay) return context.replay;
  const existing = await findLatestIntakeBySubmittedUrl(env, submittedUrl);
  if (existing) return json({ ok: true, intake: existing, duplicate: true, queued: existing.analysis_status === "queued", message: "This URL already has a Story File. Open the existing record instead of creating a duplicate." });
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
  else await createRetryJobWithAudit(env, job, audit(actor, "analysis.retry_requested", intakeId, createdAt, { job_id: job.id, ...(latest ? { retry_of_job_id: latest.id } : {}) }), records(actor, operation, context, 201, pendingBody, createdAt));
  return json(await enqueueJob(env, intake, job, actor, operation, context.key, pendingBody), 201);
}

async function requestEchoResearch(request, env, actor, intakeId) {
  const detail = await getIntakeDetail(env, intakeId);
  if (!detail) throw new ApiError(404, "NOT_FOUND", "Story File not found.");
  const analysisRow = detail.analyses.at(-1);
  const analysis = analysisRow ? JSON.parse(analysisRow.raw_analysis_json) : null;
  if (detail.intake.status !== "review_ready" || !echoEligible(analysis)) throw new ApiError(409, "ECHO_NOT_ELIGIBLE", "A completed, evidence-backed, Echo-eligible analysis is required.");
  const currentEcho = await getEchoStoryState(env, intakeId);
  if (currentEcho?.packet.state === "ready" || currentEcho?.packet.state === "no_echo") throw new ApiError(409, "ECHO_ALREADY_COMPLETED", "The current Echo packet has a terminal result.");
  if (currentEcho?.packet.state === "open" && currentEcho.jobs.some((job) => job.state !== "failed")) throw new ApiError(409, "ECHO_ALREADY_RUNNING", "An Echo research job is already active.");
  if (currentEcho?.package_binding) throw new ApiError(409, "ECHO_BOUND_PACKAGE_RETRY", "A failed packet with a frozen candidate package needs forward repair, not a new live search.");
  const body = await readJson(request);
  if (Object.keys(body).length) throw new ApiError(400, "VALIDATION_ERROR", "Echo research request body must be empty.");
  const operation = `echo.research:${intakeId}:${analysisRow.id}`;
  const context = await idempotencyContext(request, env, actor, operation, {});
  if (context.replay) return context.replay;
  const runKey = `manual:${await hash(`${actor.actorId}:${context.key}`)}`;
  try { await env.ANALYSIS_QUEUE.send({ schema_version: "1", type: "echo_research", intake_id: intakeId,
    analysis_id: analysisRow.id, run_key: runKey, requested_by: actor.actorId, trigger_type: "manual" }); }
  catch { throw new ApiError(503, "ECHO_QUEUE_UNAVAILABLE", "Echo research could not be queued; the Story File remains available."); }
  const createdAt = now();
  const responseBody = { ok: true, queued: true, run_key: runKey };
  await recordEchoRequestWithAudit(env, audit(actor, "echo.research_requested", intakeId, createdAt, { analysis_id: analysisRow.id, run_key: runKey }),
    records(actor, operation, context, 202, responseBody, createdAt));
  return json(responseBody, 202);
}

async function decideEcho(request, env, actor, intakeId) {
  const body = await readJson(request);
  if (Object.keys(body).sort().join(",") !== "assessment_id,candidate_id,decision,rationale" ||
      !["feature", "hold", "reject"].includes(body.decision)) throw new ApiError(400, "VALIDATION_ERROR", "Echo decision must be FEATURE, HOLD, or REJECT with an exact candidate and assessment.");
  const candidateId = requiredString(body.candidate_id, "candidate_id", 160);
  const assessmentId = requiredString(body.assessment_id, "assessment_id", 160);
  const rationale = requiredString(body.rationale, "rationale", 500);
  const echo = await getEchoStoryState(env, intakeId);
  if (!echo || echo.packet.state !== "ready" || echo.packet.superseded_at) throw new ApiError(409, "ECHO_NOT_READY", "No current editor-ready Echo packet exists.");
  const candidate = echo.candidates.find((item) => item.id === candidateId && item.editor_ready_assessment_id === assessmentId);
  if (!candidate) throw new ApiError(409, "ECHO_ASSESSMENT_MISMATCH", "The candidate and reviewed assessment do not match.");
  const key = requiredString(request.headers.get("Idempotency-Key"), "Idempotency-Key", 200);
  const decisionId = `echo_decision_${(await hash(`${actor.actorId}:${key}:${candidateId}`)).slice(0, 32)}`;
  const existing = echo.decisions.find((item) => item.id === decisionId);
  if (existing) {
    if (existing.decision !== body.decision || existing.assessment_id !== assessmentId || existing.rationale !== rationale) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "This Echo decision key was used for different input.");
    return json({ ok: true, decision: existing, duplicate: true });
  }
  try {
    const decision = await createEchoDecision(env, { id: decisionId, packetId: echo.packet.id, candidateId,
      assessmentId, decision: body.decision, decidedBy: actor.actorId, rationale, decidedAt: now() });
    return json({ ok: true, decision }, 201);
  } catch (error) {
    if (/constraint|conflict/i.test(error?.message || "")) throw new ApiError(409, "ECHO_DECISION_CONFLICT", "Echo state changed; reload before deciding.");
    throw error;
  }
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

function canonicalHostname(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}

function publicStaticSource(source) {
  return {
    id: source.id, name: source.name, source_class: source.source_class,
    jurisdiction: source.jurisdiction, discovery_url: source.discovery_url,
    adapter: source.adapter, enabled: source.enabled, primary_record: source.primary_record,
    dynamic: false,
  };
}

async function listWatchdeskSources(env) {
  return {
    static_sources: WATCHDESK_SOURCES.map(publicStaticSource),
    learned_candidates: await listWatchdeskSourceCandidates(env, 100),
  };
}

async function decideWatchdeskSource(request, env, actor, hostname) {
  const candidate = await getWatchdeskSourceCandidate(env, hostname);
  if (!candidate) throw new ApiError(404, "NOT_FOUND", "Source candidate not found.");
  const body = await readJson(request);
  if (!["approve", "reject"].includes(body.decision)) throw new ApiError(400, "VALIDATION_ERROR", "decision must be approve or reject.");
  const decidedAt = now();
  let update;
  if (body.decision === "reject") {
    update = {
      hostname, status: "rejected", source_id: null, source_name: null, source_class: null,
      jurisdiction: null, discovery_url: null, adapter: null, allowed_hosts_json: null,
      allowed_path_prefixes_json: null, primary_record: null, enabled: false,
      decision_note: optionalString(body.note, "note", 1_000), decided_by: actor.actorId, decided_at: decidedAt,
    };
  } else {
    const sourceId = requiredString(body.source_id, "source_id", 80);
    if (!/^[a-z0-9-]+$/.test(sourceId) || WATCHDESK_SOURCES.some((source) => source.id === sourceId)) throw new ApiError(400, "VALIDATION_ERROR", "source_id must be unique lowercase letters, numbers, and hyphens.");
    const sourceName = requiredString(body.source_name, "source_name", 200);
    const sourceClass = requiredString(body.source_class, "source_class", 80);
    if (!new Set(["primary_oversight","primary_institutional","secondary_reporting_signal","local_regional","public_whistleblower_signal"]).has(sourceClass)) throw new ApiError(400, "VALIDATION_ERROR", "source_class is invalid.");
    const jurisdiction = requiredString(body.jurisdiction, "jurisdiction", 200);
    const discoveryUrl = validateUrl(body.discovery_url);
    if (canonicalHostname(discoveryUrl) !== hostname) throw new ApiError(400, "VALIDATION_ERROR", "Monitoring URL must use the same source hostname as the learned candidate.");
    const actualHost = new URL(discoveryUrl).hostname.toLowerCase();
    if (/^(?:localhost|127\.|0\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(actualHost) || actualHost.endsWith(".local")) throw new ApiError(400, "VALIDATION_ERROR", "Private or local hosts cannot be monitored.");
    const adapter = requiredString(body.adapter, "adapter", 32);
    if (!new Set(["html_links","rss_atom"]).has(adapter)) throw new ApiError(400, "VALIDATION_ERROR", "adapter is invalid.");
    if (!Array.isArray(body.allowed_path_prefixes) || !body.allowed_path_prefixes.length || body.allowed_path_prefixes.length > 20 || body.allowed_path_prefixes.some((value) => typeof value !== "string" || !value.startsWith("/") || value.length > 200)) throw new ApiError(400, "VALIDATION_ERROR", "allowed_path_prefixes must contain bounded URL path prefixes.");
    if (typeof body.primary_record !== "boolean") throw new ApiError(400, "VALIDATION_ERROR", "primary_record must be boolean.");
    update = {
      hostname, status: "approved", source_id: sourceId, source_name: sourceName, source_class: sourceClass,
      jurisdiction, discovery_url: discoveryUrl, adapter,
      allowed_hosts_json: JSON.stringify([actualHost]),
      allowed_path_prefixes_json: JSON.stringify(body.allowed_path_prefixes),
      primary_record: body.primary_record, enabled: body.enabled !== false,
      decision_note: optionalString(body.note, "note", 1_000), decided_by: actor.actorId, decided_at: decidedAt,
    };
  }
  await decideWatchdeskSourceCandidate(env, update, {
    id: opaqueId("audit"), actor_type: actor.actorType, actor_id: actor.actorId,
    action: body.decision === "approve" ? "watchdesk.source_approved" : "watchdesk.source_rejected", entity_type: "watchdesk_source",
    entity_id: hostname, metadata_json: JSON.stringify({ status: update.status, source_id: update.source_id, enabled: update.enabled }),
    created_at: decidedAt,
  });
  return json({ ok: true, source: await getWatchdeskSourceCandidate(env, hostname) }, 200);
}

async function runWatchdesk(request, env, actor, executeWatchdesk) {
  const body = await readJson(request);
  if (Object.keys(body).some((key) => key !== "dry_run") || (body.dry_run != null && typeof body.dry_run !== "boolean")) throw new ApiError(400, "VALIDATION_ERROR", "Watchdesk run accepts only an optional dry_run boolean.");
  return json(await executeWatchdesk(env, { triggerType: "manual", dryRun: body.dry_run === true, requestedBy: actor.actorId }), 200);
}

async function route(request, env, actor, executeWatchdesk) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/admin/session") return json({ ok: true, actor: { role: "editor", email: actor.email } });
  if (request.method === "GET" && url.pathname === "/api/admin/watchdesk/status") return json({ ok: true, schedule_configured: true, cron_utc: WATCHDESK_CRON, ...await getWatchdeskStatus(env) });
  if (request.method === "GET" && url.pathname === "/api/admin/watchdesk/sources") return json({ ok: true, ...await listWatchdeskSources(env) });
  if (request.method === "GET" && url.pathname === "/api/admin/discovery/search") {
    try { return json({ ok: true, authority: "discovery_lead_only", results: await searchPublicDiscovery(url.searchParams.get("q")) }); }
    catch (error) {
      if (error instanceof DiscoveryQueryError) throw new ApiError(400, "INVALID_DISCOVERY_QUERY", error.message);
      throw new ApiError(503, "DISCOVERY_UNAVAILABLE", "Public discovery search is unavailable; no intake was created.");
    }
  }
  if (request.method === "POST" && url.pathname === "/api/admin/watchdesk/runs") return runWatchdesk(request, env, actor, executeWatchdesk);
  const sourceDecision = url.pathname.match(/^\/api\/admin\/watchdesk\/source-candidates\/([^/]+)\/decision$/);
  if (sourceDecision && request.method === "POST") return decideWatchdeskSource(request, env, actor, decodeURIComponent(sourceDecision[1]));
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
    return json({ ok: true, ...detail, echo: await getEchoStoryState(env, detail.intake.id) });
  }
  const echoMatch = url.pathname.match(/^\/api\/admin\/intakes\/([^/]+)\/echo(?:\/(decision))?$/);
  if (echoMatch && request.method === "POST" && !echoMatch[2]) return requestEchoResearch(request, env, actor, decodeURIComponent(echoMatch[1]));
  if (echoMatch && request.method === "POST" && echoMatch[2] === "decision") return decideEcho(request, env, actor, decodeURIComponent(echoMatch[1]));
  if (match && request.method === "POST" && match[2] === "drafts") return createDraft(request, env, actor, decodeURIComponent(match[1]));
  if (match && request.method === "POST" && match[2] === "decisions") return createDecision(request, env, actor, decodeURIComponent(match[1]));
  if (match && request.method === "POST" && match[2] === "analyze") return retryAnalysis(request, env, actor, decodeURIComponent(match[1]));
  throw new ApiError(404, "NOT_FOUND", "Not Found");
}

export function createAdminHandler({ authenticate = verifyAccessRequest, authenticateMachine = verifyAccessServiceRequest, executeWatchdesk = runWatchdeskOperation } = {}) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ADMIN_ASSETS.fetch(request);
    if (!url.pathname.startsWith("/api/admin/")) return json({ ok: false, error: { code: "NOT_FOUND", message: "Not Found" } }, 404);
    try {
      if (request.method === "GET" && url.pathname === "/api/admin/health") {
        await authenticateMachine(request, env);
        if (!/^[0-9a-f]{40}$/.test(env?.SBNS_ADMIN_BUILD_SHA ?? "")) {
          throw new ApiError(503, "BUILD_IDENTITY_UNAVAILABLE", "Admin build identity unavailable.");
        }
        return new Response(JSON.stringify({
          ok: true,
          name: "Shocked But Not Surprised Admin",
          worker: "sbns-admin",
          revision: env.SBNS_ADMIN_BUILD_SHA,
        }), { headers: { ...JSON_HEADERS, "cache-control": "no-store" } });
      }
      if (request.method === "GET" && url.pathname === "/api/admin/watchdesk/health") {
        await authenticateMachine(request, env);
        if (!/^[0-9a-f]{40}$/.test(env?.SBNS_ADMIN_BUILD_SHA ?? "")) throw new ApiError(503, "BUILD_IDENTITY_UNAVAILABLE", "Admin build identity unavailable.");
        return new Response(JSON.stringify(await getWatchdeskMachineHealth(env)), { headers: { ...JSON_HEADERS, "cache-control": "no-store" } });
      }
      const actor = await authenticate(request, env);
      return await route(request, env, actor, executeWatchdesk);
    } catch (error) {
      if (error?.message === "AUTH_REQUIRED") return json({ ok: false, error: { code: "AUTH_REQUIRED", message: "Authentication required." } }, 401);
      return errorResponse(error);
    }
  };
}

const handle = createAdminHandler();
export function createScheduledHandler({ executeWatchdesk = runWatchdeskOperation } = {}) {
  return async function scheduled(controller, env) {
    if (controller.cron !== WATCHDESK_CRON) throw new Error("UNEXPECTED_WATCHDESK_CRON");
    try {
      const result = await executeWatchdesk(env, { triggerType: "scheduled", dryRun: false, requestedBy: "system:watchdesk-schedule" });
      console.log(JSON.stringify({ event: "watchdesk_scheduled_run", run_id: result.run_id, status: result.status, submitted: result.metrics?.submitted_to_newsroom ?? 0 }));
    } catch (error) {
      console.error(JSON.stringify({ event: "watchdesk_scheduled_failed", error_class: error?.name || "Error" }));
      throw error;
    }
  };
}

export default { fetch: handle, scheduled: createScheduledHandler() };
