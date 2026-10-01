// PR B: deterministic, supplied-input research packet assembly. No fetch, model,
// queue, route, publication, or human-decision capability lives in this module.
import {
  createEchoPacket, createEchoJob, transitionEchoJob, createEchoCandidate,
  createEchoAssessment, createEchoSource, createEchoRightsAssessment,
  markEchoCandidateReady, rejectEchoCandidateByGate, completeEchoPacket,
  getEchoPacket, getEchoIssueSnapshot, getEchoPacketProgress,
} from "./echo-persistence.js";

export const BRIEF_SCHEMA = "echo-brief-v1";
export const CANDIDATE_SCHEMA = "echo-candidate-v1";
export const PROCESSOR_VERSION = "echo-synthetic-v1";
const HEX = /^[0-9a-f]{64}$/;
const ROLES = new Set(["primary", "supporting"]);
const CONFIDENCE = new Set(["primary_record", "corroborated", "limited"]);
const SOURCE_ROLES = new Set(["original_work", "historical_context", "contemporary_evidence", "rights"]);
const SUPPORTS = new Set(["original_context", "creator_intent", "what_echoes", "comparison_breaks", "remains_uncertain", "tempted_overclaim", "present_day_evidence", "editorial_value", "rights"]);
const RIGHTS = new Set(["public_domain", "open_license", "licensed", "embed_allowed", "link_metadata_only", "fair_use_review_required", "unknown", "do_not_reproduce"]);
const ASSETS = new Set(["text", "lyrics", "artwork", "photograph", "film_still", "audio", "video", "cover_art", "manuscript_image", "other"]);
const INTENTS = new Set(["documented", "contested", "unknown", "not_claimed"]);
const BURDENS = new Set(["low", "moderate", "high", "disproportionate"]);
const PRIOR_USE = new Set(["never_seen", "previously_considered", "previously_rejected", "previously_featured", "recently_featured", "overused_pattern"]);

export class EchoInputError extends Error {
  constructor(code, message) { super(message); this.name = "EchoInputError"; this.code = code; }
}
function fail(code, message) { throw new EchoInputError(code, message); }
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_SHAPE", `${label} must be an object`);
  return value;
}
function keys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("UNKNOWN_FIELD", `${label}.${key} is unsupported`);
}
function list(value, label) {
  if (!Array.isArray(value)) fail("INVALID_LIST", `${label} must be a list`);
  return value;
}
function boundedList(value, label, maximum) {
  const items = list(value, label);
  if (items.length > maximum) fail("LIST_TOO_LONG", `${label} exceeds the synthetic bound of ${maximum}`);
  return items;
}
function string(value, label, required = true) {
  if (value == null && !required) return null;
  if (typeof value !== "string") fail("INVALID_TEXT", `${label} must be text`);
  const normalized = value.replace(/\r\n?/g, "\n").trim();
  if (required && !normalized) fail("MISSING_FIELD", `${label} is required`);
  if (normalized.length > 4000) fail("FIELD_TOO_LONG", `${label} is too long`);
  return normalized || null;
}
function choice(value, allowed, label) {
  if (!allowed.has(value)) fail("INVALID_ENUM", `${label} has an unsupported value`);
  return value;
}
function hashText(value, label) {
  const text = string(value, label);
  if (!HEX.test(text)) fail("INVALID_HASH", `${label} must be lowercase SHA-256 hex`);
  return text;
}
function unique(items, key, label) {
  if (new Set(items.map(key)).size !== items.length) fail("DUPLICATE", `${label} contains duplicates`);
  return items;
}
const ordered = (values, selector) => values.toSorted((a, b) => selector(a).localeCompare(selector(b)));

// Canonical JSON omits absent object fields, rejects absent array positions and
// non-JSON numbers, and preserves all array order unless a contract explicitly
// sorts that array before serialization. It never rewrites semantic text.
export function canonicalJson(value) {
  const seen = new WeakSet();
  function visit(current) {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number" && Number.isFinite(current)) return current;
    if (Array.isArray(current)) {
      if (seen.has(current)) fail("INVALID_JSON", "Cyclic canonical input");
      seen.add(current);
      const result = current.map((item) => {
        if (item === undefined) fail("INVALID_JSON", "Undefined list item");
        return visit(item);
      });
      seen.delete(current);
      return result;
    }
    if (current && typeof current === "object" && Object.getPrototypeOf(current) === Object.prototype) {
      if (seen.has(current)) fail("INVALID_JSON", "Cyclic canonical input");
      seen.add(current);
      const result = {};
      for (const key of Object.keys(current).sort()) if (current[key] !== undefined) result[key] = visit(current[key]);
      seen.delete(current);
      return result;
    }
    fail("INVALID_JSON", "Unsupported canonical value");
  }
  return JSON.stringify(visit(value));
}
export async function sha256(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function textSet(raw, label) {
  return unique(list(raw, label).map((entry) => string(entry, label)), (entry) => entry, label).sort();
}
export function canonicalBrief(raw) {
  object(raw, "brief");
  keys(raw, ["schema", "issueKey", "title", "institution", "jurisdiction", "condition", "institutionalExpectation", "verifiedFacts", "unresolvedFacts", "materialQualifications", "accountabilityQuestion", "affectedInterests", "mechanism", "mustNotClaim", "intakes", "evidenceSources", "provenanceSummary", "runtimeAt"], "brief");
  if (raw.schema !== BRIEF_SCHEMA) fail("INVALID_SCHEMA", `Brief schema must be ${BRIEF_SCHEMA}`);
  const issueKey = string(raw.issueKey, "issueKey");
  if (!/^[a-z0-9][a-z0-9:_-]{0,199}$/.test(issueKey)) fail("INVALID_ISSUE_KEY", "Issue key must be a stable lowercase identity");
  const intakes = unique(boundedList(raw.intakes, "intakes", 20).map((entry) => {
    object(entry, "intake"); keys(entry, ["intakeId", "role"], "intake");
    return { intakeId: string(entry.intakeId, "intakeId"), role: choice(entry.role, ROLES, "intake role") };
  }), (entry) => entry.intakeId, "intakes");
  if (intakes.filter((entry) => entry.role === "primary").length !== 1) fail("PRIMARY_INTAKE_REQUIRED", "Exactly one primary intake is required");
  const intakeIds = new Set(intakes.map((entry) => entry.intakeId));
  const evidenceSources = unique(boundedList(raw.evidenceSources, "evidenceSources", 100).map((entry) => {
    object(entry, "evidence source"); keys(entry, ["id", "intakeId", "canonicalId", "contentHash", "confidence", "provenance"], "evidence source");
    const intakeId = string(entry.intakeId, "evidence source intakeId");
    if (!intakeIds.has(intakeId)) fail("SOURCE_INTAKE_MISMATCH", "Evidence source intake is not linked to the issue");
    return { id: string(entry.id, "evidence source id"), intakeId, canonicalId: string(entry.canonicalId, "canonical source id"),
      contentHash: entry.contentHash == null ? null : hashText(entry.contentHash, "evidence content hash"),
      confidence: choice(entry.confidence, CONFIDENCE, "source confidence"), provenance: string(entry.provenance, "source provenance") };
  }), (entry) => entry.id, "evidence sources");
  const sourceIds = new Set(evidenceSources.map((entry) => entry.id));
  const verifiedFacts = unique(boundedList(raw.verifiedFacts, "verifiedFacts", 100).map((entry) => {
    object(entry, "verified fact"); keys(entry, ["id", "text", "sourceIds"], "verified fact");
    const references = unique(list(entry.sourceIds, "fact sourceIds").map((id) => string(id, "fact source ID")), (id) => id, "fact sources").sort();
    if (!references.length || references.some((id) => !sourceIds.has(id))) fail("FACT_SOURCE_REQUIRED", "Verified fact requires linked evidence sources");
    return { id: string(entry.id, "fact id"), text: string(entry.text, "fact text"), sourceIds: references };
  }), (entry) => entry.id, "verified facts");
  if (!verifiedFacts.length) fail("VERIFIED_FACT_REQUIRED", "At least one verified fact is required");
  const provenanceSummary = object(raw.provenanceSummary, "provenanceSummary");
  keys(provenanceSummary, ["confidence", "basis"], "provenanceSummary");
  return {
    schema: BRIEF_SCHEMA, issueKey, title: string(raw.title, "title"), institution: string(raw.institution, "institution"),
    jurisdiction: string(raw.jurisdiction, "jurisdiction"), condition: string(raw.condition, "condition"),
    institutionalExpectation: string(raw.institutionalExpectation, "institutionalExpectation"),
    verifiedFacts: ordered(verifiedFacts, (entry) => entry.id), unresolvedFacts: textSet(raw.unresolvedFacts, "unresolvedFacts"),
    materialQualifications: textSet(raw.materialQualifications, "materialQualifications"),
    accountabilityQuestion: string(raw.accountabilityQuestion, "accountabilityQuestion"),
    affectedInterests: textSet(raw.affectedInterests, "affectedInterests"), mechanism: string(raw.mechanism, "mechanism"),
    mustNotClaim: textSet(raw.mustNotClaim, "mustNotClaim"), intakes: ordered(intakes, (entry) => entry.intakeId),
    evidenceSources: ordered(evidenceSources, (entry) => entry.id),
    provenanceSummary: { confidence: choice(provenanceSummary.confidence, CONFIDENCE, "summary confidence"), basis: string(provenanceSummary.basis, "summary basis") },
  };
}
export async function evidenceSnapshotHash(brief) {
  return sha256(evidenceContent(canonicalBrief(brief)));
}
function evidenceContent(brief) { const { title, ...evidence } = brief; return evidence; }

function canonicalUrl(value) {
  if (value == null) return null;
  const input = string(value, "source URL");
  let url;
  try { url = new URL(input); } catch { fail("INVALID_URL", "Source URL is invalid"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) fail("INVALID_URL", "Source URL must be public HTTP(S) without credentials");
  url.hash = "";
  return url.toString();
}
export function normalizeEchoSource(raw) {
  object(raw, "source");
  keys(raw, ["sourceRole", "supportsField", "intakeSourceId", "sourceIntakeId", "url", "canonicalIdentifier", "title", "authorityRationale", "publishedAt", "retrievedAt", "contentHash"], "source");
  const sourceRole = choice(raw.sourceRole, SOURCE_ROLES, "source role");
  const supportsField = choice(raw.supportsField, SUPPORTS, "supported field");
  if ((sourceRole === "rights") !== (supportsField === "rights")) fail("ROLE_FIELD_MISMATCH", "Rights role and supported field must match");
  const intakeSourceId = string(raw.intakeSourceId, "intake source ID", false);
  const sourceIntakeId = string(raw.sourceIntakeId, "source intake ID", false);
  if (Boolean(intakeSourceId) !== Boolean(sourceIntakeId) || (intakeSourceId && sourceRole !== "contemporary_evidence")) fail("INVALID_INTAKE_REFERENCE", "Only contemporary evidence may reference an intake source");
  const url = canonicalUrl(raw.url);
  const canonicalIdentifier = string(raw.canonicalIdentifier, "canonical identifier", false);
  if (!intakeSourceId && !url && !canonicalIdentifier) fail("SOURCE_IDENTITY_REQUIRED", "Independent source needs a URL or canonical identifier");
  return { sourceRole, supportsField, intakeSourceId, sourceIntakeId, url, canonicalIdentifier,
    title: string(raw.title, "source title", false), authorityRationale: string(raw.authorityRationale, "authority rationale"),
    publishedAt: string(raw.publishedAt, "publishedAt", false), retrievedAt: string(raw.retrievedAt, "retrievedAt", false),
    contentHash: raw.contentHash == null ? null : hashText(raw.contentHash, "source content hash") };
}
export function sourceIdentity(source) {
  return { sourceRole: source.sourceRole, supportsField: source.supportsField,
    intakeSourceId: source.intakeSourceId, sourceIntakeId: source.sourceIntakeId,
    canonicalIdentifier: source.canonicalIdentifier, url: source.url, contentHash: source.contentHash };
}
export async function sourceSetHash(rawSources) {
  const sources = list(rawSources, "sources").map(normalizeEchoSource).filter((entry) => entry.sourceRole !== "rights");
  const identities = unique(sources.map((entry) => sourceIdentity(entry)), canonicalJson, "analogy sources");
  return sha256(ordered(identities, canonicalJson));
}

export function canonicalCandidate(raw) {
  object(raw, "candidate");
  keys(raw, ["schema", "canonicalArtifactId", "artifactType", "title", "creator", "creationDate", "assessment", "sources", "rights", "gate", "priorUse"], "candidate");
  if (raw.schema !== CANDIDATE_SCHEMA) fail("INVALID_SCHEMA", `Candidate schema must be ${CANDIDATE_SCHEMA}`);
  const assessment = object(raw.assessment, "assessment");
  const assessmentFields = ["originalContext", "creatorIntentStatus", "whatEchoes", "comparisonBreaks", "remainsUncertain", "temptedOverclaim", "presentDayEvidence", "editorialValue", "researchBurden"];
  keys(assessment, assessmentFields, "assessment");
  const normalizedAssessment = {};
  for (const field of assessmentFields) normalizedAssessment[field] = field === "creatorIntentStatus" ? choice(assessment[field], INTENTS, field)
    : field === "researchBurden" ? choice(assessment[field], BURDENS, field) : string(assessment[field], field);
  const sources = unique(boundedList(raw.sources, "candidate sources", 32).map(normalizeEchoSource), (entry) => canonicalJson(sourceIdentity(entry)), "candidate sources");
  const rights = unique(boundedList(raw.rights, "rights", 12).map((entry) => {
    object(entry, "rights review");
    keys(entry, ["assetType", "assetIdentifier", "proposedUse", "status", "basis", "permittedUse", "attribution", "jurisdiction", "rightsSource", "reviewedBy", "reviewedAt", "recheckAt"], "rights review");
    const rightsSource = entry.rightsSource == null ? null : normalizeEchoSource(entry.rightsSource);
    if (rightsSource && !sources.some((source) => canonicalJson(sourceIdentity(source)) === canonicalJson(sourceIdentity(rightsSource)))) fail("RIGHTS_SOURCE_MISSING", "Rights source must be in candidate source list");
    return { assetType: choice(entry.assetType, ASSETS, "asset type"), assetIdentifier: string(entry.assetIdentifier, "asset identifier"),
      proposedUse: string(entry.proposedUse, "proposed use"), status: choice(entry.status, RIGHTS, "rights status"),
      basis: string(entry.basis, "rights basis"), permittedUse: string(entry.permittedUse, "permitted use"),
      attribution: string(entry.attribution, "attribution", false), jurisdiction: string(entry.jurisdiction, "rights jurisdiction", false),
      rightsSource, reviewedBy: string(entry.reviewedBy, "rights reviewer"), reviewedAt: string(entry.reviewedAt, "reviewedAt"),
      recheckAt: string(entry.recheckAt, "recheckAt", false) };
  }), (entry) => `${entry.assetType}|${entry.assetIdentifier}|${entry.proposedUse}`, "rights asset/use");
  const gate = object(raw.gate, "gate");
  keys(gate, ["context", "presentEvidence", "mechanismMatch", "editorialValue", "culturalProtocol", "authority"], "gate");
  const priorUse = object(raw.priorUse, "priorUse");
  keys(priorUse, ["status", "justification"], "priorUse");
  return { schema: CANDIDATE_SCHEMA, canonicalArtifactId: string(raw.canonicalArtifactId, "artifact ID"),
    artifactType: string(raw.artifactType, "artifact type"), title: string(raw.title, "artifact title"),
    creator: string(raw.creator, "creator", false), creationDate: string(raw.creationDate, "creation date", false),
    assessment: normalizedAssessment, sources: ordered(sources, (entry) => canonicalJson(sourceIdentity(entry))),
    rights: ordered(rights, (entry) => `${entry.assetType}|${entry.assetIdentifier}|${entry.proposedUse}`),
    gate: { context: choice(gate.context, new Set(["verified", "insufficient"]), "context gate"),
      presentEvidence: choice(gate.presentEvidence, new Set(["sufficient", "insufficient"]), "present evidence gate"),
      mechanismMatch: choice(gate.mechanismMatch, new Set(["direct", "qualified", "topic_only", "misleading"]), "mechanism gate"),
      editorialValue: choice(gate.editorialValue, new Set(["adds", "none"]), "value gate"),
      culturalProtocol: choice(gate.culturalProtocol, new Set(["clear", "unresolved"]), "cultural protocol"),
      authority: choice(gate.authority, new Set(["primary", "scholarly", "limited"]), "authority gate") },
    priorUse: { status: choice(priorUse.status, PRIOR_USE, "prior use"), justification: string(priorUse.justification, "prior-use justification", false) } };
}

export function evaluateEchoGate(candidate) {
  const sourceRoles = new Set(candidate.sources.map((source) => source.sourceRole));
  if (candidate.gate.context === "insufficient" || !(sourceRoles.has("original_work") || sourceRoles.has("historical_context"))) return "ORIGINAL_CONTEXT_INSUFFICIENT";
  if (candidate.gate.presentEvidence === "insufficient" || !sourceRoles.has("contemporary_evidence")) return "PRESENT_EVIDENCE_INSUFFICIENT";
  if (candidate.gate.mechanismMatch === "misleading") return "ANALOGY_MISLEADING";
  if (candidate.gate.mechanismMatch === "topic_only") return "ANALOGY_TOO_WEAK";
  if (candidate.gate.editorialValue === "none") return "NO_EDITORIAL_VALUE";
  if (candidate.gate.culturalProtocol === "unresolved") return "CULTURAL_PROTOCOL_UNRESOLVED";
  if (candidate.assessment.researchBurden === "disproportionate") return "RESEARCH_BURDEN_DISPROPORTIONATE";
  if (!candidate.rights.length) return "RIGHTS_REVIEW_MISSING";
  if (candidate.priorUse.status !== "never_seen" && !candidate.priorUse.justification) return "PRIOR_USE_JUSTIFICATION_REQUIRED";
  return null;
}
const tier = (value, order) => order.indexOf(value);
export function orderEchoCandidates(candidates) {
  return candidates.toSorted((a, b) => {
    for (const [field, order] of [
      [(item) => item.gate.authority, ["primary", "scholarly", "limited"]],
      [(item) => item.gate.mechanismMatch, ["direct", "qualified"]],
      [(item) => item.assessment.researchBurden, ["low", "moderate", "high"]],
      [(item) => item.priorUse.status, ["never_seen", "previously_considered", "previously_rejected", "previously_featured", "recently_featured", "overused_pattern"]],
    ]) { const difference = tier(field(a), order) - tier(field(b), order); if (difference) return difference; }
    return a.canonicalArtifactId.localeCompare(b.canonicalArtifactId);
  });
}
export function noEchoReason(candidates, reasons) {
  if (!candidates.length) return "NO_CANDIDATES";
  if (reasons.every((reason) => reason === "ORIGINAL_CONTEXT_INSUFFICIENT")) return "ALL_CONTEXT_FAILED";
  if (reasons.every((reason) => reason === "PRESENT_EVIDENCE_INSUFFICIENT")) return "ALL_PRESENT_EVIDENCE_FAILED";
  if (reasons.every((reason) => reason === "RESEARCH_BURDEN_DISPROPORTIONATE")) return "RESEARCH_BURDEN_EXCEEDED";
  if (reasons.every((reason) => reason?.startsWith("ANALOGY_") || reason === "NO_EDITORIAL_VALUE")) return "ALL_ANALOGY_FAILED";
  return "NO_ELIGIBLE_CANDIDATE";
}

async function stableId(prefix, ...parts) { return `${prefix}_${(await sha256(parts)).slice(0, 32)}`; }
function expectedRow(row, actual, fields) {
  if (!actual || fields.some((field) => actual[field] !== row[field])) fail("REPLAY_CONFLICT", "Existing partial packet does not match supplied candidate package");
}
async function assertCurrent(env, packetId) {
  const packet = await getEchoPacket(env, packetId);
  if (!packet || packet.state !== "open" || packet.superseded_at) fail("STALE_PACKET", "Packet was completed or superseded before assembly");
}
async function ensureCandidate(env, progress, row, actorId) {
  const existing = progress.candidates.find((item) => item.id === row.id);
  if (existing) expectedRow(row, existing, ["packet_id", "canonical_artifact_id", "artifact_type", "title", "creator", "creation_date"]);
  else await createEchoCandidate(env, { id: row.id, packetId: row.packet_id, canonicalArtifactId: row.canonical_artifact_id,
    artifactType: row.artifact_type, title: row.title, creator: row.creator, creationDate: row.creation_date }, actorId);
}

export async function orchestrateSyntheticEcho(env, input, { onStep } = {}) {
  object(input, "orchestration input");
  keys(input, ["brief", "candidates", "runKey", "requestedBy", "triggerType", "at"], "orchestration input");
  const brief = canonicalBrief(input.brief);
  const candidates = unique(boundedList(input.candidates, "candidates", 24).map(canonicalCandidate), (entry) => entry.canonicalArtifactId, "candidate artifacts");
  for (const candidate of candidates) for (const source of candidate.sources) if (source.intakeSourceId) {
    if (!brief.evidenceSources.some((entry) => entry.id === source.intakeSourceId && entry.intakeId === source.sourceIntakeId))
      fail("SOURCE_INTAKE_MISMATCH", "Candidate contemporary source must belong to the issue evidence snapshot");
  }
  const runKey = string(input.runKey, "runKey");
  const requestedBy = string(input.requestedBy, "requestedBy");
  const at = string(input.at, "at");
  const triggerType = choice(input.triggerType, new Set(["manual", "review_ready", "scheduled"]), "trigger type");
  const hash = await evidenceSnapshotHash(brief);
  const packetId = await stableId("echo_packet", brief.issueKey, hash);
  let packet = await getEchoIssueSnapshot(env, brief.issueKey, hash);
  if (packet && (packet.id !== packetId || canonicalJson(evidenceContent(JSON.parse(packet.brief_json))) !== canonicalJson(evidenceContent(brief))))
    fail("REPLAY_CONFLICT", "Existing evidence snapshot has a different evidence brief");
  if (packet?.superseded_at) fail("STALE_PACKET", "This evidence snapshot has been superseded");
  if (packet && packet.state !== "open") return { status: "ALREADY_PROCESSED", packetId, packetRevision: packet.revision, packetState: packet.state, evidenceSnapshotHash: hash };
  if (!packet) {
    try { packet = await createEchoPacket(env, { id: packetId, issueKey: brief.issueKey, evidenceSnapshotHash: hash,
      brief, intakes: brief.intakes, createdBy: requestedBy, createdAt: at }); }
    catch (error) {
      // A concurrent identical request may win the unique issue/snapshot key.
      // Never mask unrelated FK or schema failures.
      packet = await getEchoIssueSnapshot(env, brief.issueKey, hash);
      if (!packet) throw error;
    }
  }
  if (packet.superseded_at) fail("STALE_PACKET", "This evidence snapshot has been superseded");
  if (packet.state !== "open") return { status: "ALREADY_PROCESSED", packetId, packetRevision: packet.revision, packetState: packet.state, evidenceSnapshotHash: hash };
  let progress = await getEchoPacketProgress(env, packetId);
  const idempotencyKey = `${PROCESSOR_VERSION}:${runKey}`;
  const existingJob = progress.jobs.find((entry) => entry.idempotency_key === idempotencyKey);
  if (existingJob) return { status: "ALREADY_STARTED", packetId, packetRevision: packet.revision, jobId: existingJob.id, jobState: existingJob.state, evidenceSnapshotHash: hash };
  if (progress.jobs.some((entry) => !["failed", "ready", "no_echo"].includes(entry.state))) fail("ACTIVE_JOB", "A packet job is already active");
  const jobId = await stableId("echo_job", packetId, idempotencyKey);
  let job;
  try { job = await createEchoJob(env, { id: jobId, packetId, idempotencyKey, triggerType, requestedBy, processorVersion: PROCESSOR_VERSION, createdAt: at }); }
  catch (error) {
    progress = await getEchoPacketProgress(env, packetId);
    const same = progress.jobs.find((entry) => entry.idempotency_key === idempotencyKey);
    if (same) return { status: "ALREADY_STARTED", packetId, packetRevision: packet.revision, jobId: same.id, jobState: same.state, evidenceSnapshotHash: hash };
    if (progress.jobs.some((entry) => !["failed", "ready", "no_echo"].includes(entry.state))) fail("ACTIVE_JOB", "A packet job is already active");
    throw error;
  }
  const step = async (point) => { if (onStep) await onStep(point, { packetId, jobId, env }); await assertCurrent(env, packetId); };
  try {
    await step("after_packet_creation");
    job = await transitionEchoJob(env, { jobId, from: "pending", to: "researching", actorId: requestedBy, at });
    await step("researching");
    const evaluated = candidates.map((candidate) => ({ candidate, reason: evaluateEchoGate(candidate) }));
    const chosen = orderEchoCandidates(evaluated.filter((entry) => !entry.reason).map((entry) => entry.candidate)).slice(0, 3);
    const chosenSlots = new Map(chosen.map((candidate, index) => [candidate.canonicalArtifactId, index + 1]));
    // Candidate identity is deterministic for the packet and artifact, independent
    // of fixture ordering. Failed attempts can replay without duplicate rows.
    for (const { candidate, reason } of ordered(evaluated, (entry) => entry.candidate.canonicalArtifactId)) {
      await step("before_candidate");
      progress = await getEchoPacketProgress(env, packetId);
      const candidateId = await stableId("echo_candidate", packetId, candidate.canonicalArtifactId);
      await ensureCandidate(env, progress, { id: candidateId, packet_id: packetId, canonical_artifact_id: candidate.canonicalArtifactId,
        artifact_type: candidate.artifactType, title: candidate.title, creator: candidate.creator, creation_date: candidate.creationDate }, requestedBy);
      await step("during_candidate");
      const gateReason = reason ?? (chosenSlots.has(candidate.canonicalArtifactId) ? null : "NOT_IN_TOP_THREE");
      const candidateRow = progress.candidates.find((entry) => entry.id === candidateId);
      if (gateReason) {
        if (candidateRow && candidateRow.state !== "found") expectedRow({ state: "rejected_by_gate", gate_reason_code: gateReason }, candidateRow, ["state", "gate_reason_code"]);
        else await rejectEchoCandidateByGate(env, { candidateId, reasonCode: gateReason, actorId: requestedBy, at });
        continue;
      }
      if (candidateRow?.state === "editor_ready") {
        expectedRow({ editor_ready_slot: chosenSlots.get(candidate.canonicalArtifactId) }, candidateRow, ["editor_ready_slot"]);
        continue;
      }
      const assessmentId = await stableId("echo_assessment", candidateId, await sourceSetHash(candidate.sources));
      const sourceHash = await sourceSetHash(candidate.sources);
      const fields = candidate.assessment;
      const oldAssessment = progress.assessments.find((entry) => entry.id === assessmentId);
      if (oldAssessment) expectedRow({ source_set_hash: sourceHash, original_context: fields.originalContext,
        what_echoes: fields.whatEchoes, comparison_breaks: fields.comparisonBreaks, remains_uncertain: fields.remainsUncertain,
        tempted_overclaim: fields.temptedOverclaim, present_day_evidence: fields.presentDayEvidence,
        editorial_value: fields.editorialValue, research_burden: fields.researchBurden,
        creator_intent_status: fields.creatorIntentStatus }, oldAssessment,
      ["source_set_hash", "original_context", "what_echoes", "comparison_breaks", "remains_uncertain", "tempted_overclaim", "present_day_evidence", "editorial_value", "research_burden", "creator_intent_status"]);
      else await createEchoAssessment(env, { id: assessmentId, packetId, candidateId, ...fields, sourceSetHash: sourceHash,
        generatorType: "system", generatorVersion: PROCESSOR_VERSION, createdBy: requestedBy, createdAt: at });
      await step("during_verification");
      for (const source of candidate.sources) {
        const sourceId = await stableId("echo_source", assessmentId, sourceIdentity(source));
        if (!progress.sources.some((entry) => entry.id === sourceId)) await createEchoSource(env, { ...source, id: sourceId,
          packetId, candidateId, assessmentId, createdAt: at }, requestedBy);
      }
      for (const rights of candidate.rights) {
        const rightsId = await stableId("echo_rights", candidateId, rights.assetType, rights.assetIdentifier, rights.proposedUse);
        const oldRights = progress.rights.find((entry) => entry.id === rightsId);
        if (oldRights) expectedRow({ status: rights.status, basis: rights.basis, permitted_use: rights.permittedUse,
          attribution: rights.attribution, jurisdiction: rights.jurisdiction }, oldRights,
        ["status", "basis", "permitted_use", "attribution", "jurisdiction"]);
        else await createEchoRightsAssessment(env, { ...rights,
          id: rightsId, packetId, candidateId,
          rightsSourceId: rights.rightsSource ? await stableId("echo_source", assessmentId, sourceIdentity(rights.rightsSource)) : null,
          createdAt: at });
      }
      await step("during_rights");
      await markEchoCandidateReady(env, { candidateId, assessmentId, slot: chosenSlots.get(candidate.canonicalArtifactId), actorId: requestedBy, at });
    }
    await step("before_assembly");
    if (chosen.length) {
      job = await transitionEchoJob(env, { jobId, from: "researching", to: "verifying", actorId: requestedBy, at });
      job = await transitionEchoJob(env, { jobId, from: "verifying", to: "rights_check", actorId: requestedBy, at });
      job = await transitionEchoJob(env, { jobId, from: "rights_check", to: "assembling", actorId: requestedBy, at });
    }
    const result = chosen.length ? "ready" : "no_echo";
    const reasons = evaluated.map((entry) => entry.reason);
    const reasonCode = result === "no_echo" ? noEchoReason(candidates, reasons) : null;
    await completeEchoPacket(env, { packetId, jobId, result, actorId: requestedBy, at, reasonCode });
    return { status: result === "ready" ? "READY" : "NO_CULTURAL_ECHO_WARRANTED", packetId,
      packetRevision: packet.revision, jobId, packetState: result, evidenceSnapshotHash: hash,
      readyCount: chosen.length, gateSummary: evaluated.map((entry) => ({ artifactId: entry.candidate.canonicalArtifactId,
        outcome: entry.reason ?? (chosenSlots.has(entry.candidate.canonicalArtifactId) ? "PASS" : "NOT_IN_TOP_THREE") })), reasonCode };
  } catch (error) {
    const latest = (await getEchoPacketProgress(env, packetId)).jobs.find((entry) => entry.id === jobId);
    if (latest && !["failed", "ready", "no_echo"].includes(latest.state)) {
      await transitionEchoJob(env, { jobId, from: latest.state, to: "failed", actorId: requestedBy, at,
        failureCode: error.code ?? "SYNTHETIC_STEP_FAILED", failureMessage: String(error.message).slice(0, 500) });
    }
    throw error;
  }
}
