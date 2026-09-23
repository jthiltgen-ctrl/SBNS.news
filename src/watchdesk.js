import publishedFeed from "../public/stories.json" with { type: "json" };
import { WATCHDESK_SOURCES, validateSourceRegistry } from "../watchdesk/source-registry.js";
import { fetchRegistrySource } from "./watchdesk-adapters.js";
import { findDiscoveryMatches, findMonitoringMatch, storeDiscoveryCandidate } from "./persistence.js";

export const WATCHDESK_VERSION = "1.0";
export const MAX_SUBMISSIONS_PER_RUN = 5;
const TRACKING_PARAMETERS = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src"]);
const RECORD_TERMS = /\b(audit|evaluation|investigation|inspection|review|report|finding|recommendation|court|decision|enforcement|financial statement|corrective action)\b/i;
const GAP_TERMS = /\b(should|needs?|needed|improv|risk|failure|failed|delay|incomplete|concern|problem|over budget|overrun|lack|without|not |hinder|disrupt|declin|gap|misconduct|noncompliance|compliance|controls?|weakness|vacan|untimely|deficien|violation)\b/i;
const OPINION_TERMS = /\b(opinion|editorial|endorsement|vote for|vote against|campaign strategy|horoscope|sponsored content)\b/i;
const GENERIC_TOKENS = new Set(["audit", "report", "review", "oversight", "federal", "state", "city", "public", "government", "office", "department", "program", "should", "the", "and", "for", "with", "from", "into"]);

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

export function deterministicFilter(item, source) {
  const text = `${item.title || ""} ${item.summary || ""}`;
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
  const originalUrl = new URL(item.url, source.discovery_url).href;
  const normalizedUrl = normalizeDiscoveryUrl(originalUrl);
  const institution = concise(item.institution || titleSubject(item.title, source), 300);
  const primaryUrl = item.primary_source_url ? normalizeDiscoveryUrl(item.primary_source_url) : null;
  const hasPrimary = Boolean(primaryUrl || source.primary_record);
  const recordSummary = concise(item.record_summary, 1_500) || (source.primary_record
    ? `${source.name} publicly listed “${concise(item.title, 500)}”${item.published_at ? ` with a release date of ${iso(item.published_at)}` : ""}. The underlying record has not yet been reviewed by Watchdesk.`
    : `${source.name} published “${concise(item.title, 500)}.” This is a discovery signal; the underlying primary record has not yet been established.`);
  const keySources = [{ url: normalizedUrl, role: source.primary_record ? "discovered primary listing or record" : "discovery signal" }];
  if (primaryUrl && primaryUrl !== normalizedUrl) keySources.push({ url: primaryUrl, role: "identified primary record" });
  const titleFingerprint = await digest(`${source.id}\n${concise(item.title, 500)?.toLowerCase()}\n${item.document_id || ""}`);
  const contentFingerprint = await digest(JSON.stringify({ normalizedUrl, title: concise(item.title, 500), published_at: iso(item.published_at), summary: concise(item.summary, 2_000), record: concise(item.record_summary, 1_500), primaryUrl }));
  return {
    schema_version: WATCHDESK_VERSION,
    discovered_title: concise(item.title, 500),
    source: { id: source.id, name: source.name, source_class: source.source_class },
    publication_date: iso(item.published_at),
    original_url: originalUrl,
    normalized_url: normalizedUrl,
    discovered_at: discoveredAt,
    institution_or_system: institution,
    jurisdiction: concise(item.jurisdiction || source.jurisdiction, 200),
    topic: concise(item.topic || source.topic, 200),
    why_this_may_belong: concise(item.why_this_may_belong, 1_000) || `The listing combines a documentary record signal with a bounded accountability question in ${source.jurisdiction}. It is a candidate for human review, not a finding by SBNS.`,
    apparent_job: concise(item.apparent_job, 1_000),
    record_summary: recordSummary,
    accountability_question: concise(item.accountability_question, 1_000) || (institution ? `What governing requirement applies to ${institution}, what gap does the underlying record document, and what remains unresolved?` : null),
    primary_record_status: hasPrimary ? "PRIMARY RECORD FOUND" : "SECONDARY SIGNAL — PRIMARY RECORD NEEDED",
    key_sources: keySources,
    material_qualification: concise(item.material_qualification, 1_000) || "Watchdesk reviewed listing metadata only; the record, scope, and any institutional response require human verification.",
    institutional_response: concise(item.institutional_response, 1_000),
    remains_unproven: concise(item.remains_unproven, 1_000) || "The underlying facts, governing standard, material consequences, and any institutional response have not been independently established by SBNS.",
    research_burden: burdenFor(item, source, hasPrimary),
    title_fingerprint: titleFingerprint,
    content_fingerprint: contentFingerprint,
    provenance: { system: "SBNS Watchdesk", run_id: runId, source_id: source.id, automated: true, discovered_at: discoveredAt },
    published_story_relationship: publishedRelationship(item, normalizedUrl),
    monitoring_relationship: null,
    triage: null,
  };
}

export function fitGate(candidate, item) {
  const reasons = [];
  if (!candidate.institution_or_system) reasons.push("institution_or_system_not_identified");
  if (!candidate.record_summary) reasons.push("record_not_identified");
  if (!candidate.accountability_question) reasons.push("accountability_question_not_identified");
  if (item.public_relevance === false) reasons.push("public_relevance_not_established");
  if (item.evidence_sufficient === false) reasons.push("insufficient_evidence_to_begin_bounded_research");
  return { passes: reasons.length === 0, reasons, job_supported: Boolean(candidate.apparent_job) };
}

export function triageCandidate(candidate, item, fit) {
  if (!fit.passes) return { recommendation: "STOP / NO ACTION", rationale: `Lightweight fit gate failed: ${fit.reasons.join(", ")}.` };
  if (item.route === true) return { recommendation: "ROUTE", rationale: "The item has a documentary signal but is better suited to another explicitly identified workflow or destination." };
  if (item.novelty === false) return { recommendation: "STOP / NO ACTION", rationale: "No material novelty or current accountability development is established." };
  if (candidate.primary_record_status === "PRIMARY RECORD FOUND" && candidate.apparent_job && item.record_summary) return { recommendation: "DEVELOP", rationale: "A primary record, supported governing Job, bounded record summary, and accountability question are present for human development review." };
  if (candidate.primary_record_status === "PRIMARY RECORD FOUND") return { recommendation: "EXPLORE", rationale: "A primary record signal and bounded accountability question justify limited human inspection before deeper research." };
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
    if (row.submitted_url === candidate.normalized_url || prior.title_fingerprint === candidate.title_fingerprint) return { duplicate: false, reason: "materially_new_development", related_intake_id: row.id };
  }
  return { duplicate: false, reason: null, related_intake_id: null };
}

async function defaultSubmit(env, candidate, requestedBy) {
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
  await storeDiscoveryCandidate(env, intake, audit);
  return intake;
}

export async function runWatchdeskScan(env, options = {}) {
  const registry = validateSourceRegistry(options.registry || WATCHDESK_SOURCES).filter((source) => source.enabled);
  const clock = options.now || (() => new Date().toISOString());
  const discoveredAt = iso(clock());
  if (!discoveredAt) throw new Error("Watchdesk clock must return a valid date.");
  const runId = options.runId || `watchdesk_${(await digest(`${discoveredAt}\n${registry.map((source) => source.id).join(",")}`)).slice(0, 24)}`;
  const discover = options.discoverSource || ((source) => fetchRegistrySource(source, options.fetchImpl || fetch));
  const lookupDiscovery = options.lookupDiscovery || ((candidate) => findDiscoveryMatches(env, candidate.normalized_url, candidate.title_fingerprint));
  const lookupMonitoring = options.lookupMonitoring || ((candidate) => findMonitoringMatch(env, candidate.normalized_url));
  const submit = options.submitCandidate || ((candidate) => defaultSubmit(env, candidate, options.requestedBy));
  const metrics = { sources_checked: 0, sources_succeeded: 0, items_discovered: 0, deterministic_rejects: 0, duplicates_known: 0, fit_gate_survivors: 0, failed_fit_gate: 0, rabbit_hole_stop: 0, routed: 0, deferred_by_ceiling: 0, would_submit: 0, submitted_to_newsroom: 0 };
  const sourceFailures = [];
  const survivors = [];
  const runUrls = new Set();
  const runContent = new Set();

  for (const source of registry) {
    metrics.sources_checked += 1;
    let items;
    try {
      items = await discover(source);
      if (!Array.isArray(items)) throw new Error("SOURCE_ADAPTER_INVALID_OUTPUT");
      metrics.sources_succeeded += 1;
    }
    catch (error) { sourceFailures.push({ source_id: source.id, error: concise(error?.message || "SOURCE_FAILED", 120) }); continue; }
    metrics.items_discovered += items.length;
    for (const item of items) {
      const deterministic = deterministicFilter(item, source);
      if (!deterministic.passes) { metrics.deterministic_rejects += 1; continue; }
      let candidate;
      try { candidate = await buildCandidate(item, source, discoveredAt, runId); }
      catch { metrics.deterministic_rejects += 1; continue; }
      if (runUrls.has(candidate.normalized_url) || runContent.has(candidate.content_fingerprint)) { metrics.duplicates_known += 1; continue; }
      runUrls.add(candidate.normalized_url); runContent.add(candidate.content_fingerprint);
      if (candidate.published_story_relationship?.type === "published_exact") { metrics.duplicates_known += 1; continue; }
      const known = existingDisposition(candidate, await lookupDiscovery(candidate));
      if (known.duplicate) { metrics.duplicates_known += 1; continue; }
      if (known.related_intake_id) candidate.related_intake_id = known.related_intake_id;
      const monitor = await lookupMonitoring(candidate);
      if (monitor) { metrics.duplicates_known += 1; continue; }
      const fit = fitGate(candidate, item);
      if (!fit.passes) { metrics.failed_fit_gate += 1; continue; }
      metrics.fit_gate_survivors += 1;
      candidate.triage = triageCandidate(candidate, item, fit);
      if (candidate.triage.recommendation === "STOP / NO ACTION") { metrics.rabbit_hole_stop += 1; continue; }
      if (candidate.triage.recommendation === "ROUTE") { metrics.routed += 1; continue; }
      survivors.push(candidate);
    }
  }

  const selected = survivors.slice(0, MAX_SUBMISSIONS_PER_RUN);
  const deferred = survivors.slice(MAX_SUBMISSIONS_PER_RUN);
  metrics.deferred_by_ceiling = Math.max(0, survivors.length - selected.length);
  metrics.would_submit = selected.length;
  const submitted = [];
  if (!options.dryRun) {
    for (const candidate of selected) submitted.push({ intake: await submit(candidate), candidate });
    metrics.submitted_to_newsroom = submitted.length;
  }
  return {
    ok: true,
    run_id: runId,
    status: sourceFailures.length ? "partial" : "complete",
    dry_run: Boolean(options.dryRun),
    metrics,
    source_failures: sourceFailures,
    candidates: selected,
    deferred_candidates: deferred.map((candidate) => ({ title: candidate.discovered_title, normalized_url: candidate.normalized_url, source_id: candidate.source.id, triage: candidate.triage.recommendation, content_fingerprint: candidate.content_fingerprint })),
    submitted: submitted.map(({ intake, candidate }) => ({ intake_id: intake.id, title: candidate.discovered_title, triage: candidate.triage.recommendation })),
    message: selected.length ? (options.dryRun ? `${selected.length} candidate${selected.length === 1 ? "" : "s"} would be submitted to Newsroom.` : `${selected.length} candidate${selected.length === 1 ? "" : "s"} submitted to Newsroom.`) : "No worthwhile SBNS discovery candidates this run.",
  };
}
