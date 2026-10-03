import { searchPublicDiscovery } from "./editorial-search.js";
import { MEDIA_CLOUD_PROVIDER_ID, MEDIA_CLOUD_RESULTS_LIMIT, searchMediaCloudDiscovery } from "./mediacloud-search.js";

export const OPEN_SWEEP_QUERY_LIMIT = 10;
export const OPEN_SWEEP_RESULTS_PER_QUERY = 6;
export const OPEN_SWEEP_TOTAL_RESULT_LIMIT = 60;
export const OPEN_SWEEP_TIMEOUT_MS = 15_000;
export const OPEN_SWEEP_TIMESPAN = "7d";
// GDELT's own response asks clients to limit DOC requests to one every five seconds.
export const OPEN_SWEEP_QUERY_PACING_MS = 5_000;
export const OPEN_SWEEP_CIRCUIT_FAILURE_LIMIT = 3;
export const MEDIA_CLOUD_QUERY_LIMIT = 1;

const LENSES = Object.freeze([
  { id: "human_burden", label: "Human Burden", formulations: ["benefits wrongly denied", "residents still waiting", "families billed after"] },
  { id: "bureaucratic_absurdity", label: "Bureaucratic Absurdity", formulations: ["administrative error appeal", "bureaucratic process failed", "computer system error"] },
  { id: "ignored_warning", label: "Ignored Warnings", formulations: ["repeated complaints warning", "despite prior complaints", "known hazard ignored"] },
  { id: "no_one_owns_problem", label: "No One Owns the Problem", formulations: ["agency responsibility dispute", "contractor agency responsibility", "department says not responsible"] },
  { id: "little_guy_pays", label: "Little Guy Pays", formulations: ["residents forced to pay", "charged despite agency error", "families pay system mistake"] },
  { id: "technical_compliance_failure", label: "Technical Compliance / Real-World Failure", formulations: ["compliant system residents harmed", "technical compliance service failed", "rules followed outcome failed"] },
  { id: "waste_broken_delivery", label: "Waste / Broken Delivery", formulations: ["program spending failed delivery", "contract cost overrun service", "funds spent service delayed"] },
  { id: "no_recourse", label: "No Recourse", formulations: ["appeal denied no response", "unable to appeal benefits", "no recourse denied service"] },
  { id: "fml_discovery", label: "FML / You Cannot Make This Up", formulations: ["residents say agency refused", "family says still waiting", "city rule impossible residents"] },
]);

const IMPACT = /\b(resident|family|families|patient|worker|veteran|student|tenant|customer|consumer|people|person|household|benefit|benefits|disabled|disability|caregiver|small business|taxpayer|child|children|elderly|rural|low income)\b/i;
const INSTITUTION = /\b(agency|department|city|county|state|federal|school|school district|hospital|insurer|insurance company|utility|bank|government|office|service|board|commission|authority|bureau|administrator|contractor|vendor|company|corporation|court|police|sheriff|prison|public housing|medicaid|medicare|social security|transit|water district|landlord)\b|\b(?:computer|benefits|claims|eligibility|payment|transit|water|insurance|administrative) system\b/i;
const CONDITION = /\b(denied|refused|rejected|charged|billed|lost|missing|error|mistake|failed|delay|delayed|waiting|waited|months|years|overpaid|underpaid|cut off|shut off|evicted|appeal|complaint|warning|unsafe|unusable|could not|cannot|unable|forced to pay|no response|not repaired|still waiting|backlog|wrongly|despite|after repeated)\b|\b\d+(?:\.\d+)?\s*(?:days?|weeks?|months?|years?|dollars?|\$)/i;
const APERTURE = /\b(complaint|complaints|warning|warned|appeal|denied|error|mistake|delay|delayed|failed|failure|no response|not responsible|forced to pay|despite|repeated|still waiting|backlog|refused|could not|unable|no recourse|cost|overrun|unfixed|ignored|technicality|computer glitch|wrongly)\b/i;
const VIVID = /\b(absurd|ridiculous|impossible|computer glitch|technicality|still waiting|forced to|charged despite|denied|mistake|evicted|shut off|months|years|refused|no response)\b/i;
const STRONG_HUMAN_BURDEN = /\b(?:waited|waiting|still waiting|owes|owed|billed|billing|charged|forced to pay|benefits denied|denied benefits|claim denied|claims denied|cut off|shut off|evicted|appeal denied|no response|no recourse)\b|\$\s?\d/i;
const GENERIC = new Set(["after", "agency", "city", "county", "department", "families", "family", "government", "people", "residents", "state", "system", "the", "their", "with"]);

function tokens(title) {
  return new Set((String(title || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((token) => !GENERIC.has(token)));
}

function canonicalTitle(title) {
  return [...tokens(title)].sort().join(" ");
}

function normalizeClusterUrl(value) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) throw new Error("invalid url");
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_") || ["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src"].includes(key.toLowerCase())) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

function hostname(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function similarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size < 3 || b.size < 3) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return { shared, ratio: shared / (a.size + b.size - shared) };
}

function timestamp(value) {
  if (!value) return Number.NaN;
  const compact = String(value).match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  return Date.parse(compact ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z` : value);
}

function closeInTime(left, right) {
  const a = timestamp(left);
  const b = timestamp(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 7 * 24 * 60 * 60 * 1000;
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function findRoot(parent, index) {
  let at = index;
  while (parent[at] !== at) {
    parent[at] = parent[parent[at]];
    at = parent[at];
  }
  return at;
}

export function generateOpenSweepQueries(now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.valueOf())) throw new Error("Open Sweep requires a valid rotation time.");
  const day = Math.floor(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()) / 86_400_000);
  // The existing cron runs at 14:00 and 23:00 UTC. Give those two runs
  // different rotations while keeping repeated execution of one slot stable.
  const slot = instant.getUTCHours() < 18 ? 0 : 1;
  const rotation = day * 2 + slot;
  const queries = LENSES.map((lens, index) => ({
    lens_id: lens.id,
    lens_label: lens.label,
    formulation: lens.formulations[(rotation + index) % lens.formulations.length],
    tone_abs_threshold: null,
  }));
  queries.push({
    lens_id: "emotional_intensity",
    lens_label: "Emotional-intensity discovery",
    formulation: ["residents say agency", "family says denied service", "workers say system error"][rotation % 3],
    tone_abs_threshold: 10,
  });
  return queries.slice(0, OPEN_SWEEP_QUERY_LIMIT);
}

export function selectMediaCloudQueryIndex(now = new Date(), queryCount = OPEN_SWEEP_QUERY_LIMIT) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.valueOf()) || !Number.isInteger(queryCount) || queryCount < 1) throw new Error("Media Cloud query rotation requires a valid time and query count.");
  const day = Math.floor(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()) / 86_400_000);
  const slot = instant.getUTCHours() < 18 ? 0 : 1;
  // Media Cloud complements nine of the ten formulations over a deterministic
  // rotation. Its one query is kept inside the documented low-volume budget.
  return ((day * 2 + slot) % Math.max(1, queryCount - 1));
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function runOpenSweep({ search = searchPublicDiscovery, searchMediaCloud = searchMediaCloudDiscovery, mediaCloudToken = null, now = new Date(), fetchImpl, delay = wait, pacingMs = OPEN_SWEEP_QUERY_PACING_MS, clockMs = () => Date.now() } = {}) {
  const queries = generateOpenSweepQueries(now);
  const items = [];
  const health = [];
  const failures = [];
  const providerStats = {
    gdelt: { provider_id: "gdelt", configured: true, status: "healthy", queries_attempted: 0, queries_succeeded: 0, queries_failed: 0, raw_results: 0, latency_ms: 0, circuit_open: false },
    mediacloud: { provider_id: MEDIA_CLOUD_PROVIDER_ID, configured: typeof mediaCloudToken === "string" && Boolean(mediaCloudToken.trim()), status: "not_configured", queries_attempted: 0, queries_succeeded: 0, queries_failed: 0, raw_results: 0, latency_ms: 0, circuit_open: false },
  };
  let attempted = 0;
  let failed = 0;
  let consecutiveTransportFailures = 0;
  let circuitOpen = false;
  let gdeltRequests = 0;
  const checkedAt = instantIso(now);

  if (!providerStats.mediacloud.configured) {
    health.push({ source_id: "mediacloud-search", provider_id: MEDIA_CLOUD_PROVIDER_ID, lane: "open_sweep", checked_at: checkedAt, status: "not_configured", outcome: "not_configured", items_parsed: 0, attempts: 0, retry_count: 0, duration_ms: 0, http_status: null, error_code: null, error: null });
  }

  const appendItems = (providerId, query, results) => {
    const bounded = results.slice(0, providerId === "mediacloud" ? MEDIA_CLOUD_RESULTS_LIMIT : OPEN_SWEEP_RESULTS_PER_QUERY);
    const stats = providerStats[providerId];
    stats.raw_results += bounded.length;
    for (const result of bounded) {
      if (items.length >= OPEN_SWEEP_TOTAL_RESULT_LIMIT) break;
      items.push({ ...result, provider_id: providerId, discovery_lens_id: query.lens_id, discovery_lens_label: query.lens_label, discovery_query: query.formulation, emotional_intensity_query: providerId === "gdelt" && query.tone_abs_threshold != null });
    }
    return bounded.length;
  };

  const recordFailure = (providerId, query, error, queryStartedAt) => {
    const providerSourceId = providerId === "gdelt" ? "gdelt-doc" : "mediacloud-search";
    const providerPrefix = providerId === "gdelt" ? "DISCOVERY_" : "MEDIA_CLOUD_";
    const reason = String(error?.message || `${providerPrefix}QUERY_FAILED`).replace(/[\r\n\t]+/g, " ").slice(0, 120);
    const code = new RegExp(`^${providerPrefix}[A-Z0-9_]{0,39}$`).test(String(error?.code || "")) ? error.code : `${providerPrefix}QUERY_FAILED`;
    const attempts = Number.isInteger(error?.attempts) && error.attempts >= 1 ? Math.min(error.attempts, 2) : 1;
    const httpStatus = Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? error.httpStatus : null;
    const durationMs = Math.max(0, Math.min(60_000, Number.isFinite(error?.durationMs) ? error.durationMs : clockMs() - queryStartedAt));
    failures.push({ source_id: providerSourceId, provider_id: providerId, lane: "open_sweep", lens_id: query.lens_id, error: reason });
    failed += 1;
    providerStats[providerId].queries_failed += 1;
    providerStats[providerId].latency_ms += durationMs;
    health.push({
      source_id: providerSourceId, provider_id: providerId, lane: "open_sweep", lens_id: query.lens_id,
      checked_at: checkedAt, status: "failed", outcome: code.toLowerCase().replace(/^(?:discovery|media_cloud)_/, ""),
      items_parsed: 0, attempts, retry_count: Math.max(0, attempts - 1), duration_ms: durationMs,
      http_status: httpStatus, error_code: code, error: reason,
    });
    return code;
  };

  const runGdelt = async (query) => {
    if (circuitOpen) {
      health.push({ source_id: "gdelt-doc", provider_id: "gdelt", lane: "open_sweep", lens_id: query.lens_id, checked_at: checkedAt, status: "skipped", outcome: "circuit_open", items_parsed: 0, attempts: 0, retry_count: 0, duration_ms: 0, http_status: null, error_code: null, error: "Skipped after the GDELT transport circuit opened." });
      return false;
    }
    if (gdeltRequests > 0 && pacingMs > 0) await delay(pacingMs);
    gdeltRequests += 1;
    attempted += 1;
    providerStats.gdelt.queries_attempted += 1;
    const queryStartedAt = clockMs();
    try {
      const results = await search(query.formulation, {
        fetchImpl,
        timeoutMs: OPEN_SWEEP_TIMEOUT_MS,
        maxRecords: OPEN_SWEEP_RESULTS_PER_QUERY,
        toneAbsThreshold: query.tone_abs_threshold,
        timespan: OPEN_SWEEP_TIMESPAN,
        retryRateLimit: true,
        retryTimeout: true,
        retryBackoffMs: OPEN_SWEEP_QUERY_PACING_MS,
        rateLimitBackoffMs: OPEN_SWEEP_QUERY_PACING_MS,
      });
      if (!Array.isArray(results)) throw Object.assign(new Error("GDELT returned an invalid result shape."), { code: "DISCOVERY_UNEXPECTED_RESPONSE" });
      const bounded = results.slice(0, OPEN_SWEEP_RESULTS_PER_QUERY);
      const transport = results.transport || {};
      const duration = Math.max(0, Number.isFinite(transport.duration_ms) ? transport.duration_ms : clockMs() - queryStartedAt);
      providerStats.gdelt.queries_succeeded += 1;
      providerStats.gdelt.latency_ms += duration;
      providerStats.gdelt.raw_results += bounded.length;
      health.push({
        source_id: "gdelt-doc", provider_id: "gdelt", lane: "open_sweep", lens_id: query.lens_id,
        checked_at: checkedAt, status: "succeeded", outcome: "success", items_parsed: bounded.length,
        attempts: Number.isInteger(transport.attempts) ? transport.attempts : 1,
        retry_count: Math.max(0, (Number.isInteger(transport.attempts) ? transport.attempts : 1) - 1),
        duration_ms: duration, http_status: Number.isInteger(transport.http_status) ? transport.http_status : null,
        error_code: null, error: null,
      });
      consecutiveTransportFailures = 0;
      for (const result of bounded) {
        if (items.length >= OPEN_SWEEP_TOTAL_RESULT_LIMIT) break;
        items.push({ ...result, provider_id: "gdelt", discovery_lens_id: query.lens_id, discovery_lens_label: query.lens_label, discovery_query: query.formulation, emotional_intensity_query: query.tone_abs_threshold != null });
      }
      return true;
    } catch (error) {
      const code = recordFailure("gdelt", query, error, queryStartedAt);
      if (code === "DISCOVERY_TIMEOUT" || code === "DISCOVERY_NETWORK_ERROR") consecutiveTransportFailures += 1;
      else consecutiveTransportFailures = 0;
      if (consecutiveTransportFailures >= OPEN_SWEEP_CIRCUIT_FAILURE_LIMIT) {
        circuitOpen = true;
        providerStats.gdelt.circuit_open = true;
        providerStats.gdelt.status = "circuit_open";
      }
      return false;
    }
  };

  const runMediaCloud = async (query) => {
    attempted += 1;
    providerStats.mediacloud.queries_attempted += 1;
    const queryStartedAt = clockMs();
    try {
      const results = await searchMediaCloud(query.formulation, { token: mediaCloudToken, now, fetchImpl, maxResults: MEDIA_CLOUD_RESULTS_LIMIT, timeoutMs: 15_000, clockMs });
      if (!Array.isArray(results)) throw Object.assign(new Error("Media Cloud returned an invalid result shape."), { code: "MEDIA_CLOUD_UNEXPECTED_RESPONSE" });
      const count = appendItems("mediacloud", query, results);
      const transport = results.transport || {};
      const duration = Math.max(0, Number.isFinite(transport.duration_ms) ? transport.duration_ms : clockMs() - queryStartedAt);
      providerStats.mediacloud.queries_succeeded += 1;
      providerStats.mediacloud.latency_ms += duration;
      providerStats.mediacloud.status = "healthy";
      health.push({ source_id: "mediacloud-search", provider_id: MEDIA_CLOUD_PROVIDER_ID, lane: "open_sweep", lens_id: query.lens_id, checked_at: checkedAt, status: "succeeded", outcome: "success", items_parsed: count, attempts: 1, retry_count: 0, duration_ms: duration, http_status: Number.isInteger(transport.http_status) ? transport.http_status : null, error_code: null, error: null });
      return true;
    } catch (error) {
      recordFailure("mediacloud", query, error, queryStartedAt);
      providerStats.mediacloud.status = "unavailable";
      return false;
    }
  };

  const mediaCloudIndex = providerStats.mediacloud.configured && MEDIA_CLOUD_QUERY_LIMIT > 0
    ? selectMediaCloudQueryIndex(now, queries.length)
    : -1;
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index];
    if (index === mediaCloudIndex) {
      const mediaCloudSucceeded = await runMediaCloud(query);
      // A failed optional provider does not consume or discard its hypothesis:
      // GDELT gets the single bounded fallback unless its own circuit is open.
      if (!mediaCloudSucceeded) await runGdelt(query);
    } else {
      await runGdelt(query);
    }
  }
  if (providerStats.gdelt.queries_failed && providerStats.gdelt.queries_succeeded) providerStats.gdelt.status = circuitOpen ? "circuit_open" : "partial";
  else if (providerStats.gdelt.queries_failed) providerStats.gdelt.status = circuitOpen ? "circuit_open" : "unavailable";
  else providerStats.gdelt.status = "healthy";
  return { queries_attempted: attempted, queries_failed: failed, raw_hits: items.length, items, source_health: health, source_failures: failures, circuit_open: circuitOpen, providers: providerStats };
}

function instantIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

export async function clusterWatchdeskItems(entries, { digest = sha256 } = {}) {
  const normalized = entries.flatMap((entry) => {
    try {
      return [{ ...entry, normalized_url: normalizeClusterUrl(entry.item.url) }];
    } catch { return []; }
  });
  const parent = normalized.map((_, index) => index);
  const urlOwner = new Map();
  for (let i = 0; i < normalized.length; i += 1) {
    const url = normalized[i].normalized_url;
    if (urlOwner.has(url)) parent[findRoot(parent, i)] = findRoot(parent, urlOwner.get(url));
    else urlOwner.set(url, i);
    for (let j = 0; j < i; j += 1) {
      // Similar-title clustering is reserved for cross-publisher coverage. A
      // single publisher may publish separate stories using similar templates.
      if (hostname(normalized[i].normalized_url) === hostname(normalized[j].normalized_url)) continue;
      if (!closeInTime(normalized[i].item.published_at || normalized[i].item.seen_at, normalized[j].item.published_at || normalized[j].item.seen_at)) continue;
      const match = similarity(normalized[i].item.title, normalized[j].item.title);
      if (match && match.shared >= 3 && match.ratio >= 0.72) parent[findRoot(parent, i)] = findRoot(parent, j);
    }
  }
  const grouped = new Map();
  normalized.forEach((entry, index) => {
    const root = findRoot(parent, index);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(entry);
  });
  const clusters = [];
  for (const members of grouped.values()) {
    members.sort((a, b) => {
      const aAuthority = a.lane === "trusted_source" ? (a.source.primary_record ? 0 : 1) : 2;
      const bAuthority = b.lane === "trusted_source" ? (b.source.primary_record ? 0 : 1) : 2;
      const detail = tokens(b.item.title).size - tokens(a.item.title).size;
      return aAuthority - bAuthority || detail || String(b.item.published_at || b.item.seen_at || "").localeCompare(String(a.item.published_at || a.item.seen_at || "")) || a.normalized_url.localeCompare(b.normalized_url);
    });
    const representative = members[0];
    const lenses = [...new Set(members.map((entry) => entry.item.discovery_lens_id).filter(Boolean))].sort();
    const urls = [...new Set(members.map((entry) => entry.normalized_url))].sort();
    const domains = [...new Set(members.map((entry) => hostname(entry.normalized_url)).filter(Boolean))].sort();
    const seenTimes = members.map((entry) => timestamp(entry.item.seen_at || entry.item.published_at)).filter(Number.isFinite).sort((a, b) => a - b);
    const firstSeen = seenTimes.length ? new Date(seenTimes[0]).toISOString() : null;
    const lastSeen = seenTimes.length ? new Date(seenTimes.at(-1)).toISOString() : null;
    const titleKey = canonicalTitle(representative.item.title);
    const eventWeek = seenTimes.length ? Math.floor(seenTimes[0] / (7 * 24 * 60 * 60 * 1000)) : null;
    const idMaterial = tokens(representative.item.title).size >= 3 && eventWeek !== null
      ? `title:${titleKey}:week:${eventWeek}`
      : `url:${representative.normalized_url}`;
    const clusterId = `event_${(await digest(idMaterial)).slice(0, 24)}`;
    const affected = String(representative.item.title || "").match(/\b(residents|families|family|patients|workers|veterans|students|tenants|customers|consumers|households|beneficiaries|taxpayers|children|caregivers|small businesses)\b/i)?.[1] || null;
    clusters.push({
      cluster_id: clusterId,
      representative,
      members,
      cluster_size: members.length,
      representative_domain: hostname(representative.normalized_url),
      lane_set: [...new Set(members.map((entry) => entry.lane))].sort(),
      discovery_lens_ids: lenses,
      coverage_urls: [representative.normalized_url, ...urls.filter((url) => url !== representative.normalized_url)].slice(0, 8),
      domains: domains.slice(0, 10),
      discovery_provider_ids: [...new Set(members.map((entry) => entry.item.provider_id).filter((providerId) => providerId === "gdelt" || providerId === MEDIA_CLOUD_PROVIDER_ID))].sort(),
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      possible_institution_or_system: representative.item.title?.match(/\b([A-Z][\w’'-]+(?:\s+[A-Z][\w’'-]+){0,5}\s+(?:Agency|Department|Office|Service|Board|Commission|Authority|Bureau|Corporation|Hospital|School District|City|County|Utility))\b/)?.[1] || null,
      possible_affected_population: affected ? `${affected} (title signal only)` : null,
      source_cluster_overlap: new Set(members.map((entry) => entry.lane)).size > 1,
      coverage_independence: "Not assessed; repeated coverage is not independent corroboration.",
    });
  }
  return clusters;
}

export function triageOpenSweepCluster(cluster) {
  const item = cluster.representative.item;
  const title = String(item.title || "").slice(0, 500);
  const impact = IMPACT.test(title);
  const institutionalNexus = INSTITUTION.test(title) || Boolean(cluster.possible_institution_or_system);
  const concreteCondition = CONDITION.test(title);
  const accountabilityAperture = APERTURE.test(title);
  const researchable = title.trim().length >= 30 && Boolean(cluster.representative.normalized_url);
  const distinctiveValue = new Set(cluster.discovery_lens_ids).size > 0 && tokens(title).size >= 4 && impact && institutionalNexus && concreteCondition && accountabilityAperture;
  const strongHumanBurden = impact && concreteCondition && STRONG_HUMAN_BURDEN.test(title);
  const labels = new Set(cluster.discovery_lens_ids.filter((label) => label !== "fml_discovery" && label !== "emotional_intensity"));
  if (/\b(gap|shortfall|missing|deficiency|failure)\b/i.test(title)) labels.add("gap");
  if (strongHumanBurden) labels.add("human_burden");
  if (accountabilityAperture && institutionalNexus) labels.add("editorial_aperture");
  if (/\b(warned|warning|complaint|complaints|hazard|ignored|despite prior)\b/i.test(title)) labels.add("ignored_warning");
  if (/\b(appeal|no recourse|no response|unable to appeal|cannot appeal)\b/i.test(title)) labels.add("no_recourse");
  if (/\b(technically|compliant|compliance|computer system|technicality|administrative error)\b/i.test(title) && concreteCondition) labels.add("bureaucratic_absurdity");
  if (/\b(forced to pay|charged despite|billed after|benefits lost|cut off)\b/i.test(title)) labels.add("little_guy_pays");
  const fmlCandidate = impact && concreteCondition && accountabilityAperture && VIVID.test(title);
  if (fmlCandidate) labels.add("fml_candidate");
  const checks = { human_impact: impact, institutional_nexus: institutionalNexus, concrete_condition: concreteCondition, accountability_aperture: accountabilityAperture, distinctive_sbns_value: distinctiveValue, researchability: researchable };
  // Open Sweep sees only bounded metadata. It may admit a concrete, researchable
  // lead before the headline identifies who owns the problem; ordinary analysis
  // must verify that nexus before any evidence or accountability conclusion.
  const hasConcreteSignal = impact || concreteCondition;
  const hasOpportunitySignal = institutionalNexus || accountabilityAperture || fmlCandidate || strongHumanBurden;
  const ready = researchable && hasConcreteSignal && hasOpportunitySignal;
  const strongOpenLead = ready && impact && institutionalNexus && concreteCondition && accountabilityAperture;
  const leadLevel = !ready ? null : strongOpenLead ? "strong_open_lead" : "open_lead";
  const reasons = [
    ...(!researchable ? ["researchability"] : []),
    ...(!hasConcreteSignal ? ["human_impact_or_concrete_condition"] : []),
    ...(!hasOpportunitySignal ? ["editorial_opportunity"] : []),
  ];
  const diagnosticGaps = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
  const rankingSignals = [
    cluster.possible_institution_or_system ? "named_institution_in_title" : null,
    /\b(?:\d+|\$\s?\d+|\d+\s?(?:days?|weeks?|months?|years?))\b/i.test(title) ? "specific_scale_or_duration" : null,
    /\b(?:warning|warned|complaint|complaints|appeal|no response|no recourse)\b/i.test(title) ? "explicit_warning_or_recourse_signal" : null,
    /\b(?:new report|new finding|new evidence|new response|another failure|failed remediation|corrective action|expanded population|additional finding|settlement|lawsuit|court ruling|follow[- ]up report)\b/i.test(title) ? "possible_material_development" : null,
  ].filter(Boolean);
  return {
    ready,
    lead_level: leadLevel,
    checks,
    labels: [...labels].sort(),
    human_burden: strongHumanBurden,
    fml_candidate: fmlCandidate,
    ranking_signals: rankingSignals,
    reasons,
    diagnostic_gaps: diagnosticGaps,
    recommendation: ready ? "EXPLORE" : "STOP / NO ACTION",
    rationale: ready
      ? strongOpenLead
        ? "Strong Open Lead: metadata suggests a concrete human consequence, identifiable institution, and accountability aperture. No fact, fault, motive, causation, or accuracy has been established; ordinary analysis must verify the story."
        : "Open Lead: metadata suggests a concrete, researchable human/accountability situation worth retrieval. The institution, responsibility, or accountability nexus still requires verification during ordinary analysis. This is not an established finding."
      : `Metadata-only lead did not clear bounded intake triage: ${reasons.join(", ")}. Emotional intensity alone is not an admission signal.`,
    source_trust: "unknown — lead source only; not a trusted monitor or evidence authority",
  };
}

export const OPEN_SWEEP_LENS_IDS = Object.freeze(LENSES.map(({ id }) => id));
