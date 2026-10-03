import publishedFeed from "../public/stories.json" with { type: "json" };
import { WATCHDESK_SOURCES, validateSourceRegistry } from "../watchdesk/source-registry.js";
import { fetchRegistrySource } from "./watchdesk-adapters.js";
import { findMonitoringMatch, findWatchdeskEventMatches, listApprovedDynamicWatchdeskSources, markAnalysisJobQueued, storeDiscoveryCandidate } from "./persistence.js";
import { clusterWatchdeskItems, OPEN_SWEEP_TOTAL_RESULT_LIMIT, runOpenSweep, triageOpenSweepCluster } from "./watchdesk-open-discovery.js";

export const WATCHDESK_VERSION = "1.2";
export const MAX_SUBMISSIONS_PER_RUN = 5;
const OPEN_SWEEP_SOURCE = Object.freeze({
  id: "open-sweep-public-news",
  name: "Open Sweep public-news lead",
  source_class: "unverified_public_news",
  jurisdiction: "Public-news discovery",
  discovery_url: null,
  adapter: "open_sweep",
  enabled: true,
  primary_record: false,
  topic: "Open Sweep reporting lead",
  open_sweep: true,
});
const REVIEW_STATES = new Set(["NOT REVIEWED", "PARTIALLY REVIEWED", "REVIEWED"]);
const FACTUAL_SIGNAL = /\b(found|identified|documented|observed|reported|determined|estimated|recommended|required|requires|prohibits|exceeded|failed|missing|incomplete|declined|increased|decreased|did not|has not|have not)\b|\b\d+(?:[,.]\d+)?\s*(?:percent|%|million|billion|hours|days)\b/i;
const TRACKING_PARAMETERS = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src"]);
const RECORD_TERMS = /\b(audit|evaluation|investigation|inspection|review|report|finding|recommendation|court|decision|enforcement|financial statement|corrective action)\b/i;
const GAP_TERMS = /\b(should|needs?|needed|improv|risk|failure|failed|delay|incomplete|concern|problem|over budget|overrun|lack|without|not |hinder|disrupt|declin|gap|misconduct|noncompliance|compliance|controls?|weakness|vacan|untimely|deficien|violation|waste|wasteful|burden|backlog|shortage|inefficien|duplicat|disparit|inequit|barrier|exclude|denied|recurr|repeat|foresee|avoidable|externaliz|workaround|wait|cost)\b/i;
const ACCOUNTABILITY_APERTURE_TERMS = /\b(?:waste\w*|burden\w*|backlog\w*|shortage\w*|inefficien\w*|duplicat\w*|disparit\w*|inequit\w*|barrier\w*|exclud\w*|deni\w*|recurr\w*|repeat\w*|foresee\w*|avoid\w*|externaliz\w*|workaround\w*|delay\w*|risk\w*|cost\w*|overrun\w*|underperform\w*|weakness\w*|gap\w*|lack\w*|without|fail\w*|incomplete\w*|declin\w*|untimely|deficien\w*|violation\w*|noncompliance)\b|\bover budget\b/i;
const NO_ACCOUNTABILITY_CONDITION = /\b(?:no (?:remaining )?(?:violation|finding|deficiency|gap|problem|issue)|did not identify (?:a |any )?(?:remaining )?(?:violation|finding|deficiency|gap|problem|issue)|no material (?:finding|deficiency|gap|problem|issue))\b/i;
const OPINION_TERMS = /\b(opinion|editorial|endorsement|vote for|vote against|campaign strategy|horoscope|sponsored content)\b/i;
const GENERIC_TOKENS = new Set(["audit", "report", "review", "oversight", "federal", "state", "city", "public", "government", "office", "department", "program", "should", "the", "and", "for", "with", "from", "into"]);
const ACTOR_NAME = /\b((?:(?:[A-Z][A-Za-z’'-]+|of|the|and|for)\s+){1,7}(?:Administration|Agency|Department|Office|Service|Board|Commission|Authority|Bureau|Corporation))\b(?:\s*\(([A-Z][A-Z0-9]{1,7})\))?/g;
const RESOLVED_GAP = /\b(?:gap (?:was|has been) resolved|issue (?:was|has been) corrected|recommendation (?:was|has been) implemented|has since (?:completed|implemented|corrected|resolved))\b/i;
const ACTION_STOPWORDS = new Set(["about", "after", "agency", "before", "could", "federal", "found", "government", "official", "program", "public", "recommended", "required", "responsible", "reported", "report", "should", "stated", "their", "there", "these", "those", "which"]);
const MATERIAL_DEVELOPMENT_TITLE = /\b(new report|new finding|new evidence|new response|another failure|failed remediation|corrective action|expanded population|additional finding|settlement|lawsuit|court ruling|follow[- ]up report|appeal denied)\b/i;

function concise(value, max = 1_000) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text ? text.slice(0, max) : null;
}

function iso(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : null;
}

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeDiscoveryUrl(value) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) throw new Error("Discovery URL must be credential-free HTTP or HTTPS.");
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMETERS.has(lower)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

function significantTokens(value) {
  return new Set((String(value || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((token) => !GENERIC_TOKENS.has(token)));
}

function titleSubject(title, source) {
  const value = concise(title, 300);
  if (!value) return null;
  const colon = value.indexOf(":");
  if (colon >= 3 && colon <= 100) return value.slice(0, colon).trim();
  const audit = value.match(/^(?:audit|review|evaluation|inspection) of (?:the )?(.+?)(?:['’]s\b|\s+(?:controls?|contract|program|compliance|grant|operations?)\b)/i);
  if (audit?.[1]) return audit[1].replace(/[’']s?$/i, "").trim();
  if (source.source_class === "local_regional" || source.id === "iowa-auditor-reports") return value;
  return null;
}

function actorNames(text) {
  const actors = new Map();
  for (const match of String(text || "").matchAll(ACTOR_NAME)) {
    const name = match[1].replace(/^the\s+/i, "").trim();
    if (!actors.has(name.toLowerCase())) actors.set(name.toLowerCase(), { name, acronym: match[2] || null });
    else if (match[2]) actors.get(name.toLowerCase()).acronym = match[2];
  }
  return [...actors.values()];
}

function actorReference(actor) {
  const name = actor.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const acronym = actor.acronym ? `|\\b${actor.acronym}\\b` : "";
  return `(?:\\b${name}\\b${acronym})`;
}

function isActorExpectation(sentence, actor) {
  const reference = actorReference(actor);
  return new RegExp(`${reference}\\s+(?:(?:is|are|was|were)\\s+(?:required|responsible|expected)\\s+(?:to|for)|must|should)\\b|\\brecommended(?: that)?\\s+${reference}\\s+`, "i").test(sentence);
}

function isActorUnmetCondition(sentence, actor) {
  return new RegExp(`${actorReference(actor)}\\s+(?:did not|has not|have not|had not|failed to|lacks?|was not|were not)\\b`, "i").test(sentence);
}

function actionVerb(sentence, actor, expectation) {
  const reference = actorReference(actor);
  const expression = expectation
    ? new RegExp(`${reference}\\s+(?:(?:(?:is|are|was|were)\\s+(?:required|expected)\\s+to|(?:is|are|was|were)\\s+responsible\\s+for|must|should)\\s+([a-z]+))|\\brecommended(?: that)?\\s+${reference}\\s+([a-z]+)`, "i")
    : new RegExp(`${reference}\\s+(?:did not|has not|have not|had not|failed to|was not|were not)\\s+([a-z]+)`, "i");
  const verb = sentence.match(expression)?.slice(1).find(Boolean)?.toLowerCase();
  return verb?.replace(/(?:ed|ing|s)$/, "").replace(/e$/, "") || null;
}

function actionTokens(sentence, actor) {
  let text = sentence.toLowerCase().replace(actor.name.toLowerCase(), " ");
  if (actor.acronym) text = text.replace(new RegExp(`\\b${actor.acronym}\\b`, "gi"), " ");
  return new Set((text.match(/[a-z]{5,}/g) || [])
    .filter((token) => !ACTION_STOPWORDS.has(token))
    .map((token) => (token.length > 5 && token.endsWith("s") ? token.slice(0, -1) : token).slice(0, 6)));
}

function accountabilityFromReviewedText(recordSummary, actorHint) {
  const inspected = String(recordSummary || "").replace(/^The official report feed abstract states:\s*What GAO Found\s+/i, "");
  const sentences = inspected.split(/(?<=[.!?])\s+(?=[A-Z])/).map((part) => part.trim()).filter((part) => /[.!?]$/.test(part));
  const actors = actorNames(inspected);
  const supported = actors.map((actor) => {
    const expectations = sentences.filter((sentence) => isActorExpectation(sentence, actor));
    const conditions = sentences.filter((sentence) => isActorUnmetCondition(sentence, actor));
    const pair = expectations.flatMap((expectation) => conditions.map((condition) => ({ expectation, condition })))
      .find(({ expectation, condition }) => {
        if (expectation === condition) return false;
        const expectedVerb = actionVerb(expectation, actor, true);
        if (!expectedVerb || expectedVerb !== actionVerb(condition, actor, false)) return false;
        const expected = actionTokens(expectation, actor);
        const observed = actionTokens(condition, actor);
        return [...expected].filter((token) => observed.has(token) && token !== expectedVerb.slice(0, 6)).length >= 2;
      });
    return { actor, expectation: pair?.expectation || expectations[0] || null, condition: pair?.condition || conditions[0] || null, pair };
  });
  const hinted = actorHint ? supported.find(({ actor }) => actor.name.toLowerCase() === actorHint.toLowerCase()) : null;
  const matching = supported.filter(({ pair }) => pair);
  const selected = hinted || (matching.length === 1 ? matching[0] : supported.length === 1 ? supported[0] : null);
  if (!selected) return { actor: null, expectation: null, condition: null, gap: null, question: null };
  const { actor, expectation, condition, pair } = selected;
  return {
    actor: actor.name,
    expectation,
    condition,
    gap: pair ? `The reviewed material contrasts “${expectation}” with “${condition}”` : null,
    question: pair ? `What explains the documented difference for ${actor.name} between “${expectation}” and “${condition}”?` : null,
  };
}

export function deterministicFilter(item, source) {
  const text = `${item.title || ""} ${item.summary || ""} ${item.record_summary || ""}`;
  if (!item.title || !item.url) return { passes: false, reason: "missing_identity" };
  if (OPINION_TERMS.test(text) || item.content_kind === "opinion") return { passes: false, reason: "opinion_or_partisan_commentary" };
  if (!RECORD_TERMS.test(text) && !item.record_summary && !item.primary_source_url) return { passes: false, reason: "no_documentary_record_signal" };
  if (!GAP_TERMS.test(text) && !item.accountability_question && !item.fit_signal) return { passes: false, reason: "no_accountability_gap_signal" };
  if (item.routine === true) return { passes: false, reason: "routine_activity" };
  return { passes: true, reason: "accountability_record_signal" };
}

function publishedRelationship(item, normalizedUrl) {
  const reporting = publishedFeed.filter((story) => story.status === "published" && story.content_type === "reporting");
  for (const story of reporting) {
    if ((story.sources || []).some((source) => source.url && normalizeDiscoveryUrl(source.url) === normalizedUrl)) return { type: "published_exact", story_id: story.id };
    if (item.related_story_id === story.id) return { type: "published_development", story_id: story.id };
  }
  const itemTokens = significantTokens(`${item.title || ""} ${(item.topics || []).join(" ")}`);
  let best = null;
  for (const story of reporting) {
    const storyTokens = significantTokens(`${story.headline} ${(story.topic_tags || []).join(" ")}`);
    const overlap = [...itemTokens].filter((token) => storyTokens.has(token)).length;
    if (overlap >= 2 && (!best || overlap > best.overlap)) best = { type: "published_development", story_id: story.id, overlap };
  }
  return best;
}

function burdenFor(item, source, hasPrimary) {
  if (new Set(["LOW", "MODERATE", "HIGH"]).has(item.research_burden)) return item.research_burden;
  if (hasPrimary && item.apparent_job && item.record_summary) return "LOW";
  if (hasPrimary || source.primary_record) return "MODERATE";
  return "HIGH";
}

export async function buildCandidate(item, source, discoveredAt, runId) {
  const originalUrl = new URL(item.url, source.discovery_url || undefined).href;
  const normalizedUrl = normalizeDiscoveryUrl(originalUrl);
  const primaryUrl = item.primary_source_url ? normalizeDiscoveryUrl(item.primary_source_url) : null;
  const hasPrimary = Boolean(primaryUrl || source.primary_record);
  const reviewedMaterial = concise(item.reviewed_material, 300);
  const reviewState = hasPrimary && REVIEW_STATES.has(item.evidence_review_state) && item.evidence_review_state !== "NOT REVIEWED"
    && reviewedMaterial && concise(item.record_summary) ? item.evidence_review_state : "NOT REVIEWED";
  const inspectedText = typeof item.record_summary === "string" ? item.record_summary.replace(/\s+/g, " ").trim() : "";
  const recordSummaryTruncated = reviewState !== "NOT REVIEWED" && inspectedText.length > 20_000;
  const recordSummary = (reviewState !== "NOT REVIEWED" && concise(item.record_summary, 20_000)) || (source.open_sweep
    ? `An Open Sweep provider indexed this public reporting URL under a bounded discovery query. The article was not retrieved or reviewed; this is a discovery lead only.` : source.primary_record
    ? `${source.name} publicly listed “${concise(item.title, 500)}”${item.published_at ? ` with a release date of ${iso(item.published_at)}` : ""}. The underlying record has not yet been reviewed by Watchdesk.`
    : `${source.name} published “${concise(item.title, 500)}.” This is a discovery signal; the underlying primary record has not yet been established.`);
  const evidence = reviewState === "NOT REVIEWED" ? null : accountabilityFromReviewedText(recordSummary, concise(item.institution, 300));
  const fingerprintEvidence = reviewState === "NOT REVIEWED" ? null : accountabilityFromReviewedText(concise(item.record_summary, 1_500), concise(item.institution, 300));
  const keySources = [{ url: normalizedUrl, role: source.primary_record ? "located primary record URL; contents not necessarily reviewed" : "discovery signal" }];
  if (primaryUrl && primaryUrl !== normalizedUrl) keySources.push({ url: primaryUrl, role: "identified primary record" });
  const titleFingerprint = await digest(`${source.id}\n${concise(item.title, 500)?.toLowerCase()}\n${item.document_id || ""}`);
  // Keep the established dedupe identity stable. Changing this fingerprint
  // solely to expose longer Discovery text would replay old Watchdesk intakes.
  const contentFingerprint = await digest(JSON.stringify({ normalizedUrl, title: concise(item.title, 500), published_at: iso(item.published_at), summary: concise(item.summary, 2_000), record: concise(item.record_summary, 1_500), primaryUrl, reviewState, reviewedMaterial, evidence: fingerprintEvidence }));
  return {
    schema_version: WATCHDESK_VERSION,
    discovered_title: concise(item.title, 500),
    source: { id: source.id, name: source.name, source_class: source.source_class },
    publication_date: iso(item.published_at),
    original_url: originalUrl,
    normalized_url: normalizedUrl,
    discovered_at: discoveredAt,
    institution_or_system: evidence?.actor || null,
    jurisdiction: concise(item.jurisdiction || source.jurisdiction, 200),
    topic: concise(item.topic || titleSubject(item.title, source) || source.topic, 200),
    why_this_may_belong: concise(item.why_this_may_belong, 1_000) || (source.open_sweep
      ? "This metadata-only public-news lead passed a bounded human-impact / concrete-condition and editorial-opportunity triage. The institution, responsibility, or accountability nexus may still require verification during ordinary analysis. It is not a finding by SBNS."
      : `This ${source.jurisdiction} discovery signal may warrant human inspection. It is not a finding by SBNS.`),
    apparent_job: concise(evidence?.expectation, 1_000),
    record_summary: recordSummary,
    record_summary_truncated: recordSummaryTruncated,
    observed_condition: concise(evidence?.condition, 1_000),
    accountability_gap: concise(evidence?.gap, 1_000),
    accountability_question: concise(evidence?.question, 1_000),
    research_prompt: evidence?.question ? null : concise(item.accountability_question, 1_000),
    primary_record_url: hasPrimary ? (primaryUrl || normalizedUrl) : null,
    evidence_review_state: reviewState,
    reviewed_material: reviewState === "NOT REVIEWED" ? (source.open_sweep ? "Provider title, URL, domain, and discovery metadata only; linked article and original records not retrieved or reviewed" : "Listing or discovery metadata only; underlying primary record not reviewed") : reviewedMaterial,
    primary_record_status: !hasPrimary ? "SECONDARY SIGNAL — PRIMARY RECORD NEEDED" : reviewState === "REVIEWED" ? "PRIMARY RECORD REVIEWED" : reviewState === "PARTIALLY REVIEWED" ? "PRIMARY RECORD PARTIALLY REVIEWED" : "PRIMARY RECORD LOCATED",
    key_sources: keySources,
    material_qualification: concise(item.material_qualification, 1_000) || (source.open_sweep ? "Search metadata is not article verification; source quality, context, accuracy, causation, and any institutional response remain unestablished." : reviewState === "REVIEWED" ? "The reviewed record still requires human verification of scope and any institutional response." : reviewState === "PARTIALLY REVIEWED" ? "Only bounded first-party material was examined; the full record and any institutional response require human verification." : "Watchdesk reviewed listing metadata only; the record, scope, and any institutional response require human verification."),
    institutional_response: concise(item.institutional_response, 1_000),
    remains_unproven: concise(item.remains_unproven, 1_000) || "The underlying facts, governing standard, material consequences, and any institutional response have not been independently established by SBNS.",
    research_burden: burdenFor(item, source, hasPrimary),
    title_fingerprint: titleFingerprint,
    content_fingerprint: contentFingerprint,
    provenance: { system: "SBNS Watchdesk", run_id: runId, source_id: source.id, automated: true, discovered_at: discoveredAt },
    discovery: { lane: source.open_sweep ? "open_sweep" : "trusted_source", source_trust: source.open_sweep ? "unknown_lead_only" : "governed_source", lens_ids: [], event_cluster: null },
    published_story_relationship: publishedRelationship(item, normalizedUrl),
    monitoring_relationship: null,
    triage: null,
    submission_readiness: null,
  };
}

export function fitGate(candidate, item) {
  const reasons = [];
  if (!candidate.record_summary) reasons.push("record_not_identified");
  if (item.public_relevance === false) reasons.push("public_relevance_not_established");
  if (item.evidence_sufficient === false) reasons.push("insufficient_evidence_to_begin_bounded_research");
  const researchWorthy = reasons.length === 0;
  const evidenceText = concise(item.record_summary, 1_500)?.replace(/^The official report feed abstract states:\s*What GAO Found\b/i, "").trim();
  const substantiveEvidence = candidate.evidence_review_state !== "NOT REVIEWED"
    && Boolean(concise(item.reviewed_material)) && (evidenceText?.length || 0) >= 45
    && FACTUAL_SIGNAL.test(evidenceText);
  const accountabilitySignal = Boolean(substantiveEvidence
    && ACCOUNTABILITY_APERTURE_TERMS.test(evidenceText || "")
    && !NO_ACCOUNTABILITY_CONDITION.test(evidenceText || ""));
  if (!substantiveEvidence) reasons.push("candidate_specific_substantive_evidence_not_established");
  return {
    passes: reasons.length === 0,
    reasons,
    research_worthy: researchWorthy,
    substantive_evidence: substantiveEvidence,
    accountability_signal: accountabilitySignal,
    job_supported: Boolean(candidate.apparent_job),
  };
}

export function submissionReadiness(candidate, item, fit) {
  const blockers = [];
  if (!fit.passes) blockers.push("substantive_fit_not_established");
  if (!candidate.institution_or_system) blockers.push("accountable_actor_not_established");
  if (candidate.evidence_review_state === "NOT REVIEWED") blockers.push("substantive_material_not_reviewed");
  if (item.gap_defeated === true || RESOLVED_GAP.test(item.material_qualification || "") || RESOLVED_GAP.test(item.record_summary || "")) blockers.push("material_qualification_defeats_gap");
  if (!["EXPLORE", "DEVELOP"].includes(candidate.triage?.recommendation)) blockers.push("rabbit_hole_does_not_support_submission");

  const developmentGaps = [];
  if (!candidate.apparent_job) developmentGaps.push("job_or_expectation_not_established");
  if (!candidate.observed_condition) developmentGaps.push("observed_condition_not_established");
  if (!candidate.accountability_gap) developmentGaps.push("accountability_gap_not_demonstrated");
  if (!candidate.accountability_question) developmentGaps.push("evidence_derived_question_not_established");

  const gapReady = blockers.length === 0 && developmentGaps.length === 0;
  const apertureReady = blockers.length === 0 && fit.accountability_signal === true;
  const ready = gapReady || apertureReady;
  return {
    ready,
    mode: gapReady ? "gap" : apertureReady ? "editorial_aperture" : null,
    reasons: ready ? [] : [...blockers, ...developmentGaps],
    development_gaps: developmentGaps,
    gap_ready: gapReady,
    aperture_ready: apertureReady,
  };
}

export function triageCandidate(candidate, item, fit) {
  if (!fit.passes && fit.research_worthy && !fit.substantive_evidence) return { recommendation: "EXPLORE", rationale: "Discovery lead only: inspect the underlying record for candidate-specific evidence before any Newsroom submission." };
  if (!fit.passes) return { recommendation: "STOP / NO ACTION", rationale: `Lightweight fit gate failed: ${fit.reasons.join(", ")}.` };
  if (item.route === true) return { recommendation: "ROUTE", rationale: "The item has a documentary signal but is better suited to another explicitly identified workflow or destination." };
  if (item.novelty === false) return { recommendation: "STOP / NO ACTION", rationale: "No material novelty or current accountability development is established." };
  if (candidate.evidence_review_state === "REVIEWED" && candidate.accountability_gap) return { recommendation: "DEVELOP", rationale: "A reviewed primary record contains a supported actor, expectation, observed condition, and gap for human development review." };
  if (fit.accountability_signal && candidate.institution_or_system) return { recommendation: "EXPLORE", rationale: "Reviewed substantive material contains an accountability-aperture signal tied to an institution or system. Human editorial review should determine the supported frame; a discrete failure is not required." };
  if (candidate.primary_record_url) return { recommendation: "EXPLORE", rationale: "Bounded substantive material warrants human inspection; the full primary record may still need review." };
  return { recommendation: "EXPLORE", rationale: "The secondary signal appears relevant, but a primary record and governing Job still need to be established." };
}

function candidateMetadata(row) {
  try { return JSON.parse(row.discovery_metadata_json || "{}").candidate || null; } catch { return null; }
}

function existingDisposition(candidate, rows) {
  for (const row of rows || []) {
    const prior = candidateMetadata(row);
    if (!prior) return { duplicate: true, reason: "known_discovery_url", related_intake_id: row.id };
    if (prior.content_fingerprint === candidate.content_fingerprint) return { duplicate: true, reason: "unchanged_discovery", related_intake_id: row.id };
    const currentCoverage = new Set(candidate.discovery?.event_cluster?.coverage_urls || []);
    const priorCoverage = prior.discovery?.event_cluster?.coverage_urls || [];
    const sameOpenEvent = candidate.discovery?.lane === "open_sweep" && prior.discovery?.lane === "open_sweep" && priorCoverage.some((url) => currentCoverage.has(url));
    if (sameOpenEvent) return candidate.discovery?.material_development_signal
      ? { duplicate: false, reason: "materially_new_event_development", related_intake_id: row.id }
      : { duplicate: true, reason: "known_open_event_cluster", related_intake_id: row.id };
    if (row.submitted_url === candidate.normalized_url || prior.title_fingerprint === candidate.title_fingerprint) return { duplicate: false, reason: "materially_new_development", related_intake_id: row.id };
  }
  return { duplicate: false, reason: null, related_intake_id: null };
}

async function defaultSubmit(env, candidate, requestedBy, runId, leaseNow) {
  const timestamp = candidate.discovered_at;
  const intake = {
    id: `intake_discovery_${candidate.content_fingerprint.slice(0, 32)}`,
    origin: "discovery",
    submitted_url: candidate.normalized_url,
    submitted_at: timestamp,
    submitter_note: `DISCOVERY CANDIDATE · ${candidate.triage.recommendation} · ${candidate.research_burden} · ${candidate.discovered_title}`.slice(0, 2_000),
    status: "submitted",
    analysis_status: "not_started",
    created_at: timestamp,
    updated_at: timestamp,
  };
  const audit = {
    id: `audit_watchdesk_${candidate.content_fingerprint.slice(0, 32)}`,
    actor_type: "system",
    actor_id: null,
    action: "watchdesk.candidate_submitted",
    entity_type: "intake",
    entity_id: intake.id,
    metadata_json: JSON.stringify({ candidate, requested_by: requestedBy || null, authority_note: "Automated Watchdesk triage is not an editorial decision." }),
    created_at: timestamp,
  };
  const job = { id: `job_watchdesk_${candidate.content_fingerprint.slice(0, 32)}`, intake_id: intake.id, created_at: timestamp, updated_at: timestamp };
  const checkedAt = leaseNow ? leaseNow() : null;
  const writes = await storeDiscoveryCandidate(env, intake, audit, runId, checkedAt, job);
  if (writes[0]?.meta?.changes === 1) {
    if (writes[1]?.meta?.changes !== 1 || writes[2]?.meta?.changes !== 1 || writes[3]?.meta?.changes !== 1) throw new Error("WATCHDESK_SUBMISSION_STATE_CONFLICT");
    try {
      await env.ANALYSIS_QUEUE.send({ schema_version: "1", job_id: job.id, intake_id: intake.id });
      await markAnalysisJobQueued(env, job.id, intake.id, new Date().toISOString());
    } catch {
      // The durable pending_enqueue job remains available to the editor's retry control.
    }
    return intake;
  }
  const holder = await env.SBNS_DB.prepare(`SELECT lock.run_id, lock.expires_at, run.status, run.submitted_count
    FROM watchdesk_run_lock AS lock JOIN watchdesk_runs AS run ON run.id = lock.run_id
    WHERE lock.name = 'watchdesk'`).first();
  if (holder?.run_id !== runId || holder.expires_at <= (leaseNow ? leaseNow() : new Date().toISOString()) || holder.status !== "running") throw new Error("WATCHDESK_LEASE_LOST");
  if (holder.submitted_count >= MAX_SUBMISSIONS_PER_RUN) throw new Error("WATCHDESK_SUBMISSION_LIMIT");
  return null;
}

export async function runWatchdeskScan(env, options = {}) {
  const dynamicSources = options.registry || !env?.SBNS_DB ? [] : await listApprovedDynamicWatchdeskSources(env);
  const registry = validateSourceRegistry([...(options.registry || WATCHDESK_SOURCES), ...dynamicSources]).filter((source) => source.enabled);
  const clock = options.now || (() => new Date().toISOString());
  const discoveredAt = iso(clock());
  if (!discoveredAt) throw new Error("Watchdesk clock must return a valid date.");
  const runId = options.runId || `watchdesk_${(await digest(`${discoveredAt}\n${registry.map((source) => source.id).join(",")}`)).slice(0, 24)}`;
  const discover = options.discoverSource || ((source) => fetchRegistrySource(source, options.fetchImpl || fetch));
  const lookupDiscovery = options.lookupDiscovery || ((candidate) => env?.SBNS_DB
    ? findWatchdeskEventMatches(env, candidate.normalized_url, candidate.title_fingerprint, candidate.discovery?.event_cluster?.cluster_id || null, candidate.discovery?.event_cluster?.coverage_urls || [])
    : Promise.resolve([]));
  const lookupMonitoring = options.lookupMonitoring || ((candidate) => findMonitoringMatch(env, candidate.normalized_url));
  const submit = options.submitCandidate || ((candidate) => defaultSubmit(env, candidate, options.requestedBy, runId, options.leaseNow));
  const shouldRunOpenSweep = options.openSweep === true || (!options.registry && options.openSweep !== false);
  const metrics = {
    sources_checked: 0, sources_succeeded: 0, items_discovered: 0,
    deterministic_rejects: 0, duplicates_known: 0, fit_gate_survivors: 0,
    failed_fit_gate: 0, discovery_leads: 0, submission_ready: 0,
    submission_ready_gap: 0, submission_ready_aperture: 0,
    evidence_state_distribution: {}, rabbit_hole_stop: 0, routed: 0,
    deferred_by_ceiling: 0, would_submit: 0, submitted_to_newsroom: 0,
    trusted_scanned: 0, trusted_candidates: 0, trusted_failures: 0, trusted_submissions: 0,
    open_sweep_queries_attempted: 0, open_sweep_queries_failed: 0, open_sweep_raw_hits: 0, open_sweep_providers: null,
    open_sweep_normalized_urls: 0, open_sweep_deduped_hits: 0, open_sweep_event_clusters: 0,
    open_sweep_triaged_candidates: 0, open_sweep_eligible_leads: 0, open_sweep_open_leads: 0, open_sweep_strong_open_leads: 0, open_sweep_human_burden_candidates: 0,
    open_sweep_fml_candidates: 0, open_sweep_no_action_discarded: 0,
    open_sweep_would_submit: 0, open_sweep_submissions: 0,
    combined_total_submissions: 0, combined_duplicate_suppressions: 0, combined_source_cluster_overlap: 0,
  };
  const sourceFailures = [];
  const sourceHealth = [];
  const survivors = [];
  const discoveryLeads = [];
  const runUrls = new Set();
  const runContent = new Set();
  const entries = [];

  for (const source of registry) {
    metrics.sources_checked += 1;
    metrics.trusted_scanned += 1;
    let items;
    try {
      items = await discover(source);
      if (!Array.isArray(items)) throw new Error("SOURCE_ADAPTER_INVALID_OUTPUT");
      metrics.sources_succeeded += 1;
    }
    catch (error) {
      const reason = concise(error?.message || "SOURCE_FAILED", 120);
      sourceFailures.push({ source_id: source.id, error: reason });
      metrics.trusted_failures += 1;
      sourceHealth.push({ source_id: source.id, checked_at: iso(clock()), status: "failed", error: reason, items_parsed: 0 });
      continue;
    }
    sourceHealth.push({ source_id: source.id, checked_at: iso(clock()), status: "succeeded", error: null, items_parsed: items.length });
    metrics.items_discovered += items.length;
    metrics.trusted_candidates += items.length;
    for (const item of items) entries.push({ lane: "trusted_source", source, item });
  }

  if (shouldRunOpenSweep) {
    try {
      const sweep = options.discoverOpenSweep
        ? await options.discoverOpenSweep({ now: discoveredAt, fetchImpl: options.fetchImpl })
        : await runOpenSweep({ now: discoveredAt, fetchImpl: options.fetchImpl || fetch, mediaCloudToken: env?.MEDIA_CLOUD_API_TOKEN, searchMediaCloud: options.searchMediaCloud });
      if (!sweep || !Array.isArray(sweep.items) || !Array.isArray(sweep.source_health) || !Array.isArray(sweep.source_failures)) throw new Error("OPEN_SWEEP_INVALID_OUTPUT");
      metrics.open_sweep_queries_attempted = Number.isInteger(sweep.queries_attempted) ? sweep.queries_attempted : sweep.source_health.length;
      metrics.open_sweep_queries_failed = Number.isInteger(sweep.queries_failed) ? sweep.queries_failed : sweep.source_failures.length;
      metrics.open_sweep_raw_hits = Number.isInteger(sweep.raw_hits) ? sweep.raw_hits : sweep.items.length;
      metrics.open_sweep_providers = sweep.providers || null;
      metrics.items_discovered += sweep.items.length;
      sourceHealth.push(...sweep.source_health);
      sourceFailures.push(...sweep.source_failures);
      for (const item of sweep.items.slice(0, OPEN_SWEEP_TOTAL_RESULT_LIMIT)) entries.push({ lane: "open_sweep", source: OPEN_SWEEP_SOURCE, item });
    } catch (error) {
      const reason = concise(error?.message || "OPEN_SWEEP_FAILED", 120);
      metrics.open_sweep_queries_failed = 1;
      sourceFailures.push({ source_id: "open-sweep", lane: "open_sweep", error: reason });
      sourceHealth.push({ source_id: "open-sweep", provider_id: "unknown", lane: "open_sweep", checked_at: iso(clock()), status: "failed", error: reason, items_parsed: 0 });
    }
  }

  const openRows = entries.filter((entry) => entry.lane === "open_sweep");
  const openUrls = new Set(openRows.flatMap((entry) => { try { return [normalizeDiscoveryUrl(entry.item.url)]; } catch { return []; } }));
  metrics.open_sweep_normalized_urls = openUrls.size;
  metrics.open_sweep_deduped_hits = Math.max(0, metrics.open_sweep_raw_hits - openUrls.size);
  const clusters = await clusterWatchdeskItems(entries, { digest });
  metrics.open_sweep_event_clusters = clusters.filter((cluster) => cluster.lane_set.includes("open_sweep")).length;
  metrics.combined_source_cluster_overlap = clusters.filter((cluster) => cluster.source_cluster_overlap).length;

  for (const cluster of clusters) {
      const { lane, source, item } = cluster.representative;
      const isOpenSweep = lane === "open_sweep";
      let openTriage = null;
      if (isOpenSweep) {
        openTriage = triageOpenSweepCluster(cluster);
        metrics.open_sweep_triaged_candidates += 1;
        if (openTriage.human_burden) metrics.open_sweep_human_burden_candidates += 1;
        if (openTriage.fml_candidate) metrics.open_sweep_fml_candidates += 1;
        if (!openTriage.ready) { metrics.open_sweep_no_action_discarded += 1; metrics.deterministic_rejects += 1; continue; }
        metrics.open_sweep_eligible_leads += 1;
        if (openTriage.lead_level === "strong_open_lead") metrics.open_sweep_strong_open_leads += 1;
        else metrics.open_sweep_open_leads += 1;
      } else {
      const deterministic = deterministicFilter(item, source);
      if (!deterministic.passes) { metrics.deterministic_rejects += 1; continue; }
      }
      let candidate;
      try {
        candidate = await buildCandidate(item, source, discoveredAt, runId);
        const clusterMeta = {
          cluster_id: cluster.cluster_id,
          cluster_size: cluster.cluster_size,
          representative_url: cluster.representative.normalized_url,
          coverage_urls: cluster.coverage_urls,
          domains: cluster.domains,
          discovery_lens_ids: cluster.discovery_lens_ids,
          discovery_provider_ids: cluster.discovery_provider_ids,
          open_lead_level: isOpenSweep ? openTriage.lead_level : null,
          first_seen_at: cluster.first_seen_at,
          last_seen_at: cluster.last_seen_at,
          possible_institution_or_system: cluster.possible_institution_or_system,
          possible_affected_population: cluster.possible_affected_population,
          source_cluster_overlap: cluster.source_cluster_overlap,
          coverage_independence: cluster.coverage_independence,
        };
        candidate.discovery = {
          lane: isOpenSweep ? "open_sweep" : "trusted_source",
          source_trust: isOpenSweep ? "unknown_lead_only" : "governed_source",
          lens_ids: cluster.discovery_lens_ids,
          provider_ids: cluster.discovery_provider_ids,
          query_formulations: [...new Set(cluster.members.map((entry) => entry.item.discovery_query).filter(Boolean))].slice(0, 10),
          material_development_signal: isOpenSweep && MATERIAL_DEVELOPMENT_TITLE.test(item.title || ""),
          open_sweep_overlap: cluster.source_cluster_overlap,
          event_cluster: clusterMeta,
        };
      }
      catch { metrics.deterministic_rejects += 1; continue; }
      if (runUrls.has(candidate.normalized_url) || runContent.has(candidate.content_fingerprint)) { metrics.duplicates_known += 1; continue; }
      runUrls.add(candidate.normalized_url); runContent.add(candidate.content_fingerprint);
      if (candidate.published_story_relationship?.type === "published_exact"
        || (isOpenSweep && candidate.published_story_relationship?.type === "published_development" && !MATERIAL_DEVELOPMENT_TITLE.test(item.title || ""))) {
        metrics.duplicates_known += 1;
        continue;
      }
      const known = existingDisposition(candidate, await lookupDiscovery(candidate));
      if (known.duplicate) { metrics.duplicates_known += 1; continue; }
      if (known.related_intake_id) candidate.related_intake_id = known.related_intake_id;
      const monitor = await lookupMonitoring(candidate);
      if (monitor) { metrics.duplicates_known += 1; continue; }
      metrics.evidence_state_distribution[candidate.primary_record_status] = (metrics.evidence_state_distribution[candidate.primary_record_status] || 0) + 1;
      if (isOpenSweep) {
        candidate.triage = { recommendation: openTriage.recommendation, lead_level: openTriage.lead_level, rationale: openTriage.rationale, discovery_labels: openTriage.labels, checks: openTriage.checks, ranking_signals: openTriage.ranking_signals };
        candidate.submission_readiness = { ready: true, mode: "open_sweep_lead", reasons: ["admitted for ordinary full analysis as an unverified reporting lead"], development_gaps: [], evidence_verified: false };
        candidate.research_burden = "HIGH";
        candidate.institution_or_system = null;
        candidate.apparent_job = null;
        candidate.observed_condition = null;
        candidate.accountability_gap = null;
        candidate.accountability_question = null;
        candidate.remains_unproven = "The source article, underlying events, responsible institution, accuracy, causation, and any response have not been verified by SBNS.";
      }
      if (!isOpenSweep) {
      const fit = fitGate(candidate, item);
      if (!fit.passes) {
        metrics.failed_fit_gate += 1;
        if (fit.research_worthy && !fit.substantive_evidence) {
          candidate.triage = triageCandidate(candidate, item, fit);
          candidate.submission_readiness = submissionReadiness(candidate, item, fit);
          discoveryLeads.push(candidate);
          metrics.discovery_leads += 1;
        }
        continue;
      }
      metrics.fit_gate_survivors += 1;
      candidate.triage = triageCandidate(candidate, item, fit);
      candidate.submission_readiness = submissionReadiness(candidate, item, fit);
      if (candidate.triage.recommendation === "STOP / NO ACTION") { metrics.rabbit_hole_stop += 1; continue; }
      if (candidate.triage.recommendation === "ROUTE") { metrics.routed += 1; continue; }
      if (!candidate.submission_readiness.ready) { discoveryLeads.push(candidate); metrics.discovery_leads += 1; continue; }
      metrics.submission_ready += 1;
      if (candidate.submission_readiness.mode === "gap") metrics.submission_ready_gap += 1;
      if (candidate.submission_readiness.mode === "editorial_aperture") metrics.submission_ready_aperture += 1;
      } else {
        // Lead admission is not evidence readiness; keep the historical
        // submission_ready metric scoped to the trusted evidence-backed lane.
      }
      survivors.push(candidate);
  }

  survivors.sort((left, right) => {
    const priority = (candidate) => candidate.submission_readiness?.mode === "gap" ? 0
      : candidate.discovery?.lane === "open_sweep" && candidate.triage?.lead_level === "open_lead" ? 2 : 1;
    const qualitySignals = (candidate) => {
      const title = String(candidate.discovered_title || "");
      const diagnosis = candidate.triage?.ranking_signals || [];
      const evidenceStrength = candidate.evidence_review_state === "REVIEWED" ? 2
        : candidate.evidence_review_state === "PARTIALLY REVIEWED" ? 1 : 0;
      const identifiedInstitution = Boolean(candidate.institution_or_system || candidate.discovery?.event_cluster?.possible_institution_or_system);
      const specificScale = /\$\s?\d|\b\d+(?:[,.]\d+)?\s?(?:days?|weeks?|months?|years?|people|residents|claims|dollars?)\b/i.test(title);
      const warningOrRecourse = /\b(?:warn(?:ed|ing)|complaints?|appeals?|no response|no recourse|unable to appeal|despite prior)\b/i.test(title)
        || diagnosis.includes("explicit_warning_or_recourse_signal");
      const materialDevelopment = candidate.discovery?.material_development_signal === true || MATERIAL_DEVELOPMENT_TITLE.test(title);
      return evidenceStrength + Number(identifiedInstitution) + Number(specificScale) + Number(warningOrRecourse) + Number(materialDevelopment);
    };
    const recency = (candidate) => String(candidate.discovery?.event_cluster?.first_seen_at || candidate.publication_date || candidate.discovered_at || "");
    return priority(left) - priority(right)
      || qualitySignals(right) - qualitySignals(left)
      || recency(right).localeCompare(recency(left));
  });
  const selected = survivors.slice(0, MAX_SUBMISSIONS_PER_RUN);
  const deferred = survivors.slice(MAX_SUBMISSIONS_PER_RUN);
  metrics.deferred_by_ceiling = Math.max(0, survivors.length - selected.length);
  metrics.would_submit = selected.length;
  const submitted = [];
  if (!options.dryRun) {
    for (const candidate of selected) {
      if (options.beforeSubmit) await options.beforeSubmit(candidate);
      const intake = await submit(candidate);
      if (!intake) { metrics.duplicates_known += 1; continue; }
      submitted.push({ intake, candidate });
      if (candidate.discovery?.lane === "open_sweep") metrics.open_sweep_submissions += 1;
      else metrics.trusted_submissions += 1;
      if (options.onSubmitted) await options.onSubmitted(intake);
    }
    metrics.submitted_to_newsroom = submitted.length;
  }
  metrics.open_sweep_would_submit = selected.filter((candidate) => candidate.discovery?.lane === "open_sweep").length;
  metrics.combined_total_submissions = metrics.submitted_to_newsroom;
  metrics.combined_duplicate_suppressions = metrics.duplicates_known;
  return {
    ok: true,
    run_id: runId,
    status: sourceFailures.length ? "partial" : "complete",
    dry_run: Boolean(options.dryRun),
    metrics,
    source_failures: sourceFailures,
    source_health: sourceHealth,
    discovery_leads: discoveryLeads.slice(0, MAX_SUBMISSIONS_PER_RUN),
    candidates: selected,
    deferred_candidates: deferred.map((candidate) => ({ title: candidate.discovered_title, normalized_url: candidate.normalized_url, source_id: candidate.source.id, discovery_lane: candidate.discovery?.lane, cluster_id: candidate.discovery?.event_cluster?.cluster_id, triage: candidate.triage.recommendation, content_fingerprint: candidate.content_fingerprint })),
    submitted: submitted.map(({ intake, candidate }) => ({ intake_id: intake.id, title: candidate.discovered_title, triage: candidate.triage.recommendation, discovery_lane: candidate.discovery?.lane, cluster_id: candidate.discovery?.event_cluster?.cluster_id })),
    message: options.dryRun && selected.length ? `${selected.length} candidate${selected.length === 1 ? "" : "s"} would be submitted to Newsroom.` : submitted.length ? `${submitted.length} candidate${submitted.length === 1 ? "" : "s"} submitted to Newsroom.` : selected.length ? "No new discovery intakes; selected candidates were already known." : discoveryLeads.length ? "No submission-ready candidates; discovery leads require more evidence." : "No worthwhile SBNS discovery candidates this run.",
  };
}
