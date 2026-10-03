import { filterAssignments, queueCounts } from "./desk-state.js";
import { draftZero, evidenceLedger } from "./editorial-production.js";
import { analysisFailureFields } from "./analysis-diagnostics.js";

const views = [...document.querySelectorAll("main > section")];
const queue = document.querySelector("#queue");
const queueStatus = document.querySelector("#queue-status");
const detail = document.querySelector("#detail");
const watchdeskStatus = document.querySelector("#watchdesk-status");
const watchdeskLatest = document.querySelector("#watchdesk-latest");
const watchdeskMetrics = document.querySelector("#watchdesk-metrics");
const watchdeskSources = document.querySelector("#watchdesk-sources");
const watchdeskResult = document.querySelector("#watchdesk-result");
const watchdeskHistory = document.querySelector("#watchdesk-history");
const watchdeskSourcePortfolio = document.querySelector("#watchdesk-source-portfolio");
const watchdeskDry = document.querySelector("#watchdesk-dry");
const watchdeskLive = document.querySelector("#watchdesk-live");
const discoverySearchForm = document.querySelector("#discovery-search-form");
const discoverySearchStatus = document.querySelector("#discovery-search-status");
const discoverySearchResults = document.querySelector("#discovery-search-results");
const jobLabels = {
  pending_enqueue: "Waiting to queue", queued: "Queued", running: "Analyzing evidence",
  retrying: "Retrying analysis", complete: "Review ready",
  failed: "Analysis failed", dead_letter: "Analysis failed"
};
let loadedAssignments = [];

function el(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined && value !== null) node.textContent = String(value);
  if (className) node.className = className;
  return node;
}
function show(id, heading) {
  views.forEach((view) => { view.hidden = view.id !== id; });
  if (heading) document.querySelector(heading)?.focus();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function key() { return crypto.randomUUID(); }
async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json", "Idempotency-Key": key() } : {}), ...options.headers };
  const response = await fetch(path, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "Request failed.");
  return body;
}
function safeJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}
function text(value) { return value === undefined || value === null || value === "" ? "—" : String(value); }
function date(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? String(value) : parsed.toLocaleString();
}
function panel(id, title, className = "") {
  const node = el("section", null, "panel " + className);
  node.id = id;
  node.append(el("p", id.toUpperCase().replace("STORY-", "").replaceAll("-", " / "), "section-label"), el("h2", title));
  return node;
}
function field(label, value, className = "") {
  const node = el("p", null, className);
  const display = value === "PRIMARY RECORD FOUND" ? "Legacy location claim; review state unverified" : text(value);
  node.append(el("strong", label + ": "), document.createTextNode(display));
  return node;
}
function fieldGrid(entries) {
  const grid = el("div", null, "field-grid");
  entries.forEach(([label, value, wide]) => grid.append(field(label, value, wide ? "wide" : "")));
  return grid;
}
function list(title, values) {
  const wrap = el("div");
  wrap.append(el("h3", title));
  const ul = el("ul");
  (values?.length ? values : ["None recorded."]).forEach((value) => ul.append(el("li", value)));
  wrap.append(ul);
  return wrap;
}
function safeLink(url, label) {
  const value = String(url || "");
  let parsed;
  try { parsed = new URL(value); } catch { return el("span", label || value || "—"); }
  if (!["http:", "https:"].includes(parsed.protocol)) return el("span", label || value);
  const link = el("a", label || value, "source-link");
  link.href = parsed.href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
function badge(value, kind) {
  const node = el("span", text(value).replaceAll("_", " "), kind + " " + kind + "-" + String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
  return node;
}
function candidateFromItem(item) { return safeJson(item.latest_discovery_metadata_json, {})?.candidate || null; }
function discoveryFromAudit(data) {
  const event = [...data.audit].reverse().find((item) => item.action === "watchdesk.candidate_submitted");
  return safeJson(event?.metadata_json, {})?.candidate || null;
}
function accountableInstitution(candidate) {
  return candidate.schema_version==="1.2" ? (candidate.institution_or_system || "Not yet established") : "Unverified (legacy candidate)";
}
function readiness(candidate) {
  if (candidate.submission_readiness?.ready && candidate.submission_readiness?.mode === "editorial_aperture") return "Newsroom intake — editorial aperture";
  if (candidate.submission_readiness?.ready && candidate.submission_readiness?.mode === "gap") return "Newsroom intake — evidence gap";
  return candidate.submission_readiness?.ready ? "Ready for Newsroom intake" : candidate.submission_readiness ? "Discovery lead — not submission-ready" : "Not recorded (legacy candidate)";
}
function updateQueueSummary() {
  const counts = queueCounts(loadedAssignments);
  document.querySelector("#desk-total").textContent = String(counts.total);
  document.querySelector("#desk-review").textContent = String(counts.reviewReady);
  const wrap = document.querySelector("#queue-counts");
  wrap.replaceChildren();
  [["Loaded", counts.total], ["Review ready", counts.reviewReady], ["Discovery", counts.discovery], ["Needs attention", counts.attention]].forEach(([label, value]) => wrap.append(el("span", label), el("strong", value)));
}
function assignmentCard(item) {
  const candidate = candidateFromItem(item);
  const card = el("article", null, "assignment-card" + (candidate ? " discovery" : "") + (["review_ready", "failed"].includes(item.status) ? " attention" : ""));
  const open = el("button");
  open.type = "button";
  open.setAttribute("aria-label", "Open " + (candidate?.discovered_title || item.submitted_url) + " story file");
  const top = el("span", null, "card-top");
  const laneLabel = candidate?.discovery?.lane === "open_sweep" ? "Open Sweep" : candidate ? "Trusted Source" : item.origin;
  top.append(badge(laneLabel, "origin"), badge(item.status, "status"));
  const title = el("strong", candidate?.discovered_title || item.submitted_url, "card-title");
  const meta = el("span", null, "card-meta");
  if (candidate) {
    [accountableInstitution(candidate), candidate.topic, ...(candidate.discovery?.lens_ids || []).slice(0, 2).map((lens) => "Lens: " + lens.replaceAll("_", " "))].forEach((value) => meta.append(el("span", value)));
  } else {
    ["AI read: " + text(item.latest_recommendation)].forEach((value) => meta.append(el("span", value)));
  }
  const bottom = el("span", null, "card-bottom");
  bottom.append(el("span", "Analysis: " + (jobLabels[item.latest_analysis_job_state] || text(item.analysis_status))), el("span", "Human decision: " + text(item.latest_decision)), el("span", "Last activity: " + date(item.updated_at)));
  open.append(top, title, meta);
  if (candidate) open.append(el("span", candidate.discovery?.lane === "open_sweep"
    ? (candidate.triage?.lead_level === "strong_open_lead" ? "Strong Open Lead" : "Open Lead") + " — unverified · " + (candidate.discovery.event_cluster?.cluster_size || 1) + " coverage URL(s) · admitted for normal analysis"
    : "Readiness: " + readiness(candidate) + " · Rabbit Hole: " + text(candidate.triage?.recommendation) + " · Burden: " + text(candidate.research_burden), "card-secondary"));
  open.append(bottom);
  open.addEventListener("click", () => loadDetail(item.id).catch((error) => { queueStatus.textContent = error.message; }));
  card.append(open);
  return card;
}
function renderQueue() {
  const visible = filterAssignments(loadedAssignments, {
    query: document.querySelector("#queue-search").value,
    status: document.querySelector("#status-filter").value,
    origin: document.querySelector("#origin-filter").value
  });
  queue.replaceChildren(...visible.map(assignmentCard));
  queueStatus.textContent = visible.length + " of " + loadedAssignments.length + " loaded assignments shown" + (loadedAssignments.length === 100 ? " · API limit is 100; older assignments may not be loaded." : ".");
  if (!visible.length) queue.append(el("p", loadedAssignments.length ? "No loaded assignments match these filters." : "The assignment desk is empty."));
}
async function loadQueue() {
  show("queue-view");
  queueStatus.textContent = "Loading queue…";
  const selectedStatus = document.querySelector("#status-filter").value;
  const data = await api("/api/admin/intakes?limit=100" + (selectedStatus ? "&status=" + encodeURIComponent(selectedStatus) : ""));
  loadedAssignments = data.intakes || [];
  updateQueueSummary();
  renderQueue();
}
function renderDiscovery(candidate) {
  if (!candidate) return null;
  const node = panel("story-discovery", "Discovery candidate", "discovery-panel");
  node.append(el("p", "Watchdesk surfaced this candidate for human attention. This discovery record is not itself approval or a formal human decision.", "warning"));
  if (candidate.discovery?.lane === "open_sweep") node.append(el("p", "OPEN SWEEP · LEAD ONLY. Search metadata and emotional language do not establish accuracy, evidence, fault, motive, causation, or institutional responsibility. The normal Story File analysis must verify the article and seek stronger records.", "warning"));
  node.append(fieldGrid([
    ["Discovery lane", candidate.discovery?.lane === "open_sweep" ? "Open Sweep — source trust unknown" : "Trusted Source — governed monitor"],
    ...(candidate.discovery?.lane === "open_sweep" ? [["Open Sweep lead level", candidate.triage?.lead_level === "strong_open_lead" ? "Strong Open Lead — metadata suggests the institution and accountability aperture" : "Open Lead — institutional/accountability nexus requires verification during analysis"]] : []),
    ["Discovery lenses", (candidate.discovery?.lens_ids || []).join(", ") || "Trusted-source monitoring"],
    ["Event / cluster ID", candidate.discovery?.event_cluster?.cluster_id],
    ["Cluster size", candidate.discovery?.event_cluster?.cluster_size || 1],
    ["Representative outlet", candidate.discovery?.event_cluster?.representative_domain || candidate.source?.name],
    ["Search formulations", (candidate.discovery?.query_formulations || []).join(" · ") || "Trusted-source listing"],
    ["Other coverage count", Math.max(0, (candidate.discovery?.event_cluster?.coverage_urls?.length || 1) - 1)],
    ["Possible institution/system (unverified)", candidate.discovery?.event_cluster?.possible_institution_or_system || "Not identified from metadata"],
    ["Possible affected population (unverified)", candidate.discovery?.event_cluster?.possible_affected_population || "Not identified from metadata"],
    ["Human-burden signal", candidate.triage?.discovery_labels?.includes("human_burden") ? "Possible — discovery label only" : "Not identified"],
    ["FML candidate", candidate.triage?.discovery_labels?.includes("fml_candidate") ? "Possible — discovery label only; not a conclusion" : "Not identified"],
    ["Institutional nexus state", candidate.triage?.checks?.institutional_nexus ? "Plausible from title metadata only" : "Not established"],
    ["Reason surfaced", candidate.triage?.rationale],
    ["Admitted to Story File", candidate.discovery?.lane === "open_sweep" ? "Yes — ordinary analysis required; no evidence finding" : "Yes"],
    ["Primary-record status", candidate.primary_record_status], ["Evidence review state", candidate.evidence_review_state || "Unverified (legacy candidate)"],
    ["Material examined", candidate.reviewed_material || "Not recorded"], ["Primary-record location", candidate.primary_record_url || "Not yet located"],
    ["Discovered title", candidate.discovered_title, true], ["Source", candidate.source?.name], ["Source class", candidate.source?.source_class],
    ["Publication / release date", candidate.publication_date], ["Discovered", candidate.discovered_at],
    ["Topic", candidate.topic], ["Accountable institution", accountableInstitution(candidate)],
    ["Jurisdiction", candidate.jurisdiction], ["Submission readiness", candidate.discovery?.lane === "open_sweep" ? "Lead admission only; evidence unverified" : readiness(candidate)],
    ["Accountability pathway", candidate.discovery?.lane === "open_sweep" ? "Open Sweep triage only" : candidate.submission_readiness?.mode || "Not established"],
    ["Why this may belong at SBNS", candidate.why_this_may_belong, true],
    ["Job / expectation (if established)", candidate.apparent_job || "Not yet established", true],
    ["Observed condition (if established)", candidate.observed_condition || "Not yet established", true],
    ["Accountability gap (if established)", candidate.accountability_gap || "Not yet established", true],
    ["Accountability question", candidate.accountability_question || "Not yet established", true],
    ["Research prompt (not evidence)", candidate.research_prompt, true],
    ["Material qualification / counterevidence", candidate.material_qualification, true],
    ["Institutional response", candidate.institutional_response, true],
    ["What remains unproven", candidate.remains_unproven, true],
    ["Rabbit Hole recommendation", candidate.triage?.recommendation],
    ["Triage rationale", candidate.triage?.rationale, true],
    ["Research burden", candidate.research_burden],
    ["Published-story relationship", candidate.published_story_relationship?.story_id],
    ["Related discovery intake", candidate.related_intake_id]
  ]));
  const inspected = el("div", null, "discovery-inspected");
  inspected.append(el("h3", "What the inspected material establishes"));
  if (candidate.record_summary?.length > 320) {
    inspected.append(el("p", candidate.record_summary.slice(0, 320) + "…", "inspected-preview"));
    const full = el("details");
    full.append(el("summary", "Read complete inspected-material analysis"), el("p", candidate.record_summary, "inspected-full"));
    inspected.append(full);
  } else inspected.append(el("p", candidate.record_summary || "Not yet established.", "inspected-full"));
  if (candidate.record_summary_truncated) inspected.append(el("p", "The source supplied more than the bounded 20,000-character Discovery record. Review the linked original before relying on omitted material.", "warning"));
  node.append(inspected);
  const editorial = el("section", null, "editorial-read");
  editorial.append(el("h3", "Editorial Read"), el("p", "Internal interpretation and research opportunity—not evidence established by the source.", "warning"));
  editorial.append(fieldGrid([
    ["Potential SBNS angle", candidate.why_this_may_belong || "Not yet assessed", true],
    ["Accountability pathway", candidate.submission_readiness?.mode || "Unresolved"],
    ["Research burden", candidate.research_burden],
    ["Stronger original record to inspect", candidate.primary_record_url && candidate.primary_record_url !== candidate.normalized_url ? candidate.primary_record_url : "Not identified", true],
    ["Framing to avoid", candidate.remains_unproven || "Do not assert unresolved claims as fact.", true],
    ["Missing context / counterevidence", candidate.material_qualification || "Not yet assessed", true],
    ["Triage rationale", candidate.triage?.rationale || "Not yet assessed", true]
  ]));
  node.append(editorial);
  node.append(el("h3", "Discovered source"), safeLink(candidate.normalized_url));
  const sources = el("div");
  sources.append(el("h3", "Key sources"));
  (candidate.key_sources || []).forEach((source) => sources.append(safeLink(source.url, source.role + ": " + source.url)));
  const clusteredUrls = (candidate.discovery?.event_cluster?.coverage_urls || []).filter((url) => url !== candidate.normalized_url);
  if (clusteredUrls.length) {
    sources.append(el("h3", "Other clustered reporting"), el("p", "Grouped for discovery only; independent corroboration has not been established."));
    clusteredUrls.forEach((url) => sources.append(safeLink(url, url)));
  }
  if (!candidate.key_sources?.length) sources.append(el("p", "None recorded."));
  node.append(sources);
  return node;
}

function renderSemanticControl(data, analysis, candidate) {
  const node = panel("story-semantics", "Editorial Frame", "semantics-panel");
  node.append(el("p", "This is an internal interpretation of the evidence, not a publication decision.", "warning"));
  const latestDraft = data.drafts.at(-1);
  const publicCopy = [latestDraft?.headline, latestDraft?.summary, analysis?.proposed_headline, analysis?.proposed_summary].filter(Boolean).join(" ");
  const highRisk = ["fraud","corruption","theft","illegal","illegality","cover-up","scandal","caused","discrimination","discriminatory"].filter((term) => new RegExp("\\b" + term.replace("-", "\\-") + "\\b","i").test(publicCopy));
  const sourceStates = data.sources.map((source) => source.verification_status);
  const unresolvedSources = sourceStates.filter((state) => !["verified","verified_with_qualification"].includes(state));
  const pathway = candidate?.submission_readiness?.mode === "gap" ? "Classic institutional gap" : candidate?.submission_readiness?.mode === "editorial_aperture" ? "Broader editorial aperture" : analysis ? (analysis.attributable_failure ? "Classic institutional gap" : "Broader accountability question or unresolved") : "Unresolved";
  node.append(fieldGrid([
    ["What kind of accountability story is this?", pathway],
    ["What is actually established?", analysis?.observed_condition || candidate?.observed_condition || "Not yet established", true],
    ["Who or what is connected?", candidate?.institution_or_system || analysis?.attributable_failure || "Institutional nexus not yet established", true],
    ["Are we claiming institutional failure?", analysis?.attributable_failure ? "Established only to the extent stated in analysis: " + analysis.attributable_failure : analysis ? "Not established; may not be necessary to this story" : "Unresolved", true],
    ["Are we claiming a specific harm was caused?", analysis?.causation_supported ? analysis.specific_harm_causation || "Review exact causal claim" : "Not established or unresolved", true],
    ["Source-evidence state", unresolvedSources.length ? "Clarify unresolved or disputed source state" : data.sources.length ? "Reviewed source records present" : "No normalized source recorded"],
    ["Public-copy risk terms", highRisk.length ? "Review: " + highRisk.join(", ") : "No monitored high-risk term detected", true]
  ]));
  node.append(list("DO NOT CLAIM boundaries", analysis?.do_not_claim));
  node.append(list("What remains unresolved? Qualifications and evidence gaps", [
    candidate?.material_qualification,
    candidate?.remains_unproven,
    ...(analysis?.hold_reasons || []),
    ...(analysis?.source_conflicts || []).map((x) => (x.statements || []).join(" / "))
  ].filter(Boolean)));
  return node;
}

async function decideLearnedSource(candidate, decision) {
  let body = { decision };
  if (decision === "approve") {
    const source_name = window.prompt("Source name", candidate.source_name || candidate.hostname);
    if (!source_name) return;
    const discovery_url = window.prompt("Public listing or RSS/Atom URL to monitor", candidate.discovery_url || candidate.representative_url);
    if (!discovery_url) return;
    const source_class = window.prompt("Source class: primary_oversight, primary_institutional, secondary_reporting_signal, local_regional, public_whistleblower_signal", candidate.source_class || "secondary_reporting_signal");
    if (!source_class) return;
    const jurisdiction = window.prompt("Jurisdiction", candidate.jurisdiction || "United States");
    if (!jurisdiction) return;
    const adapter = window.prompt("Adapter: rss_atom or html_links", candidate.adapter || "rss_atom");
    if (!adapter) return;
    const source_id = window.prompt("Stable source ID (lowercase letters/numbers/hyphens)", candidate.source_id || ("learned-" + candidate.hostname.replace(/[^a-z0-9]+/g,"-")));
    if (!source_id) return;
    const paths = window.prompt("Allowed path prefixes, comma-separated", "/");
    if (!paths) return;
    body = { decision, source_name, discovery_url, source_class, jurisdiction, adapter, source_id, allowed_path_prefixes: paths.split(",").map((x)=>x.trim()).filter(Boolean), primary_record: false, enabled: true };
  }
  await api("/api/admin/watchdesk/source-candidates/" + encodeURIComponent(candidate.hostname) + "/decision", { method:"POST", body:JSON.stringify(body) });
  await loadWatchdeskSources();
}

async function loadWatchdeskSources() {
  const data = await api("/api/admin/watchdesk/sources");
  watchdeskSourcePortfolio.replaceChildren();
  const active = data.static_sources.filter((source) => source.enabled);
  const disabled = data.static_sources.filter((source) => !source.enabled);
  watchdeskSourcePortfolio.append(field("Active governed sources", active.length), field("Registered / deferred sources", disabled.length));
  const candidates = data.learned_candidates || [];
  const useful = candidates.filter((candidate) => candidate.status !== "rejected").slice(0, 12);
  if (!useful.length) { watchdeskSourcePortfolio.append(el("p", "No learned source candidates yet.")); return; }
  useful.forEach((candidate) => {
    const card = el("div", null, "source-learning-card");
    card.append(el("strong", candidate.hostname), el("p", candidate.status + " · " + candidate.qualifying_intake_count + " qualifying / " + candidate.observation_count + " analyzed intake(s)"));
    card.append(safeLink(candidate.representative_url, "Representative story"));
    if (candidate.status === "eligible" || candidate.status === "observed") {
      const approve = el("button", "Configure monitoring");
      approve.type="button"; approve.addEventListener("click",()=>decideLearnedSource(candidate,"approve").catch((error)=>{watchdeskResult.textContent=error.message;}));
      const reject = el("button", "Do not monitor");
      reject.type="button"; reject.addEventListener("click",()=>decideLearnedSource(candidate,"reject").catch((error)=>{watchdeskResult.textContent=error.message;}));
      card.append(approve,reject);
    } else if (candidate.status === "approved") card.append(el("p", "Approved monitor: " + text(candidate.source_name)));
    watchdeskSourcePortfolio.append(card);
  });
}

function renderAnalysis(data) {
  const node = panel("story-analysis", "Analysis", "analysis-panel");
  const job = data.analysis_jobs.at(-1);
  node.append(field("Analysis state", jobLabels[job?.state] || data.intake.analysis_status));
  const failureFields = analysisFailureFields(job);
  if (failureFields.length) {
    const diagnostics = el("section", null, "analysis-block failure-diagnostics");
    diagnostics.append(el("h3", "Analysis failure diagnostics"), fieldGrid(failureFields));
    node.append(diagnostics);
  }
  const discoveryNeedsAnalysis = !job && data.intake.origin === "discovery";
  const retryable = discoveryNeedsAnalysis || ["pending_enqueue", "failed", "dead_letter"].includes(job?.state);
  if (retryable) {
    if (discoveryNeedsAnalysis) node.append(el("p", "This discovery intake has no analysis job. Start analysis only when selecting the lead for full Story File review.", "warning"));
    if (job?.last_error_message) node.append(el("p", job.last_error_message, "warning"));
    const retry = el("button", discoveryNeedsAnalysis ? "Analyze selected discovery" : "Retry analysis");
    retry.type = "button";
    retry.addEventListener("click", async () => {
      try { await api("/api/admin/intakes/" + data.intake.id + "/analyze", { method: "POST", body: "{}" }); await loadDetail(data.intake.id, "Analysis queued."); }
      catch (error) { retry.insertAdjacentElement("afterend", el("p", error.message, "warning")); }
    });
    node.append(retry);
  }
  const analysis = safeJson(data.analyses.at(-1)?.raw_analysis_json, null);
  if (!analysis) {
    node.append(el("p", "No completed analysis is available. Human review remains required."));
    return { analysis: node, evidence: renderEvidence(data, null), proposal: null, parsed: null };
  }
  const grid = el("div", null, "analysis-grid");
  const read = el("section", null, "analysis-block");
  read.append(el("h3", "Editorial read"), el("p", analysis.recommendation || "No recommendation", "recommendation " + (analysis.recommendation || "")));
  const disposition = analysis.recommendation === "publish" ? "REVIEW READY" : analysis.recommendation === "reject" ? "NO ACTION" : analysis.primary_source_available ? "DEVELOP" : "EXPLORE";
  read.append(fieldGrid([["Suggested disposition", disposition], ["Confidence", analysis.recommendation_confidence], ["Category", analysis.category], ["Severity", analysis.severity], ["Factual situation", analysis.observed_condition, true], ["Why SBNS", analysis.why_sbns, true], ["Consequence / significance", analysis.consequence_significance, true], ["Institutional response in supplied material", analysis.institution_response_present ? "Present; inspect claim-specific evidence below" : "Not found in supplied material"]]), list("Recommendation reasons", analysis.recommendation_reasons));
  if (analysis.source_expansion) {
    const expansion = el("section", null, "analysis-block");
    expansion.append(el("h3", "Underlying-source expansion"), fieldGrid([["Public-record links examined", analysis.source_expansion.attempted?.length || 0], ["Records retrieved", analysis.source_expansion.retrieved?.length || 0]]));
    (analysis.source_expansion.failures || []).forEach((failure) => expansion.append(field("Unresolved linked record", failure.url + " · " + failure.message)));
    read.append(expansion);
  }
  const truth = el("section", null, "analysis-block truth-test");
  truth.append(el("h3", "Truth test"), el("p", "Observed condition is not attributable failure; attributable failure is not proven specific-harm causation."));
  truth.append(fieldGrid([["Observed condition", analysis.observed_condition], ["Attributable failure", analysis.attributable_failure], ["Specific-harm causation", analysis.specific_harm_causation], ["Qualification required", analysis.qualification_required ? "Yes" : "No"]]));
  const risks = el("section", null, "analysis-block");
  risks.append(el("h3", "Risks"), fieldGrid([["Factual risk", analysis.factual_risk], ["Legal risk", analysis.legal_risk]]), list("Hold reasons", analysis.hold_reasons), list("Reject reasons", analysis.reject_reasons), list("DO NOT CLAIM", analysis.do_not_claim));
  grid.append(read, truth, risks);
  node.append(grid);
  const proposal = panel("story-proposal", "AI proposal — not saved / not approved", "proposal-panel");
  proposal.append(el("p", "Generated suggestions are not established evidence or a human editorial decision.", "warning"));
  proposal.append(fieldGrid([["Headline", analysis.proposed_headline], ["Summary", analysis.proposed_summary, true], ["SBNS Kicker", analysis.proposed_fml_kicker, true], ["Tags", analysis.proposed_topic_tags?.join(", ")]]));
  return { analysis: node, evidence: renderEvidence(data, analysis), proposal, parsed: analysis };
}
function renderEvidence(data, analysis) {
  const node = panel("story-evidence", "Evidence ledger");
  node.append(el("p", "Claims are linked to the specific supplied source and its stated authority. Repetition is not independent corroboration.", "warning"));
  if (!data.sources.length && !analysis?.claims?.length) node.append(el("p", "No extracted sources or claims recorded."));
  data.sources.forEach((source, index) => {
    const card = el("article", null, "source-card");
    card.append(el("p", "SOURCE " + String(index + 1).padStart(2, "0"), "revision-label"), el("h3", source.source_title || source.name || "Untitled source"));
    card.append(safeLink(source.url), fieldGrid([["Source type", source.source_type], ["Verification", source.verification_status], ["Format", source.extraction_format], ["Published", source.published_at]]));
    const disclosure = el("details");
    disclosure.append(el("summary", "View normalized evidence"), el("pre", source.extracted_text, "evidence-text"));
    card.append(disclosure);
    node.append(card);
  });
  evidenceLedger(analysis).forEach((claim) => {
    const card = el("article", null, "claim-card");
    card.append(el("p", "CLAIM " + text(claim.id), "revision-label"), el("h3", claim.text));
    card.append(fieldGrid([["Material", claim.material ? "Yes" : "No"], ["Evidence state", claim.status], ["Qualification", claim.qualification], ["Locator / section", claim.locator]]));
    if (!claim.sources.length) card.append(el("p", "No claim-specific supporting source is recorded.", "warning"));
    claim.sources.forEach((source) => {
      const provenance = el("p", null, "claim-provenance");
      provenance.append(safeLink(source.url, source.name), document.createTextNode(" · " + text(source.relation) + " — " + text(source.explanation) + " · " + text(source.role) + " · " + text(source.authority) + (source.locator ? " · " + source.locator : "")));
      card.append(provenance);
    });
    node.append(card);
  });
  node.append(list("Source conflicts", (analysis?.source_conflicts || []).map((conflict) => (conflict.statements || []).join(" / "))));
  return node;
}
function renderEcho(data, analysis) {
  const node = panel("story-echo", "Cultural Echo / We Were Warned", "echo-panel");
  node.append(el("p", "Internal cultural research only. A candidate is not a story decision or publication permission.", "warning"));
  const echo = data.echo;
  const eligible = analysis?.recommendation === "publish" && analysis.echo_eligible === true && analysis.echo_issue && analysis.echo_search_terms?.length;
  if (!eligible) { node.append(el("p", "Not yet eligible: complete an evidence-backed, review-ready analysis first.")); return node; }
  const latestAudit = [...data.audit].reverse().find((event) => event.action.startsWith("echo.research_"));
  if (!echo && latestAudit?.action === "echo.research_failed") node.append(el("p", "Echo research failed. The story analysis and Draft 0 remain available; retry is editor-initiated.", "warning"));
  else if (!echo && latestAudit) node.append(el("p", "Echo research queued or running."));
  else if (!echo) node.append(el("p", "No Echo research has been recorded for this Story File."));
  const failedBoundPacket = echo?.packet.state === "open" && echo.jobs.at(-1)?.state === "failed" && echo.package_binding;
  if (failedBoundPacket) node.append(el("p", "Research failed after its candidate package was frozen. A fresh live search cannot safely retry this packet with changed inputs; retain the reporting draft and request a forward repair.", "warning"));
  if (!echo || echo.packet.state === "open" && echo.jobs.at(-1)?.state === "failed" && !echo.package_binding) {
    const run = el("button", echo?.jobs.at(-1)?.state === "failed" ? "Retry Echo Research" : "Run Echo Research");
    run.type = "button";
    run.addEventListener("click", async () => {
      run.disabled = true;
      try { await api("/api/admin/intakes/" + data.intake.id + "/echo", { method: "POST", body: "{}" }); await loadDetail(data.intake.id, "Echo research requested."); }
      catch (error) { node.append(el("p", error.message, "warning")); run.disabled = false; }
    });
    node.append(run);
  }
  if (!echo) return node;
  node.append(fieldGrid([["Packet state", echo.packet.state === "no_echo" ? "NO CULTURAL ECHO WARRANTED" : echo.packet.state], ["Latest research job", echo.jobs.at(-1)?.state || "Pending"], ["No-Echo reason", echo.packet.no_echo_reason_code]]));
  if (echo.packet.state === "no_echo") { node.append(el("p", "No cultural comparison passed the current context, analogy, rights, and protocol gates. This is a successful outcome.")); return node; }
  for (const candidate of echo.candidates) {
    const card = el("article", null, "echo-candidate");
    card.append(el("h3", candidate.title), fieldGrid([["Creator / date", [candidate.creator, candidate.creation_date].filter(Boolean).join(" · ")], ["Research state", candidate.state], ["Gate result", candidate.gate_reason_code]]));
    const assessment = echo.assessments.find((item) => item.id === candidate.editor_ready_assessment_id) || echo.assessments.filter((item) => item.candidate_id === candidate.id).at(-1);
    if (assessment) card.append(fieldGrid([
      ["Original context", assessment.original_context, true], ["What echoes", assessment.what_echoes, true],
      ["Where comparison breaks", assessment.comparison_breaks, true], ["Uncertainty", assessment.remains_uncertain, true],
      ["Tempted overclaim", assessment.tempted_overclaim, true], ["Present-day evidence", assessment.present_day_evidence, true],
      ["Editorial value", assessment.editorial_value, true], ["Creator intent", assessment.creator_intent_status],
    ]));
    const evaluation = safeJson(echo.evaluations?.find((item) => item.entity_id === candidate.id)?.metadata_json, {});
    card.append(fieldGrid([["Cultural protocol", candidate.gate_reason_code === "CULTURAL_PROTOCOL_UNRESOLVED" ? "Unresolved — do not feature" : candidate.state === "editor_ready" ? "No flagged protocol in reviewed packet; editor must verify" : "Review required"], ["Prior SBNS use", evaluation.prior_use_status || "Not established"]]));
    const sourceList = el("div"); sourceList.append(el("h4", "Context and contemporary sources"));
    echo.sources.filter((source) => source.candidate_id === candidate.id).forEach((source) => sourceList.append(el("p", source.source_role + ": "), safeLink(source.url, source.title || source.canonical_identifier || source.intake_source_id)));
    card.append(sourceList);
    const rights = echo.rights.filter((item) => item.candidate_id === candidate.id).at(-1);
    card.append(field("Rights / proposed use", rights ? rights.status + " · " + rights.permitted_use : "No review recorded"));
    const latestDecision = echo.decisions.filter((item) => item.candidate_id === candidate.id).at(-1);
    if (latestDecision) card.append(field("Human Echo decision", latestDecision.decision.toUpperCase() + " · " + date(latestDecision.decided_at)));
    if (candidate.state === "editor_ready" && assessment?.id === candidate.editor_ready_assessment_id) {
      const controls = el("div", null, "decision-row");
      [["feature", "FEATURE THIS ECHO"], ["hold", "HOLD"], ["reject", "REJECT"]].forEach(([value, label]) => {
        const button = el("button", label, value); button.type = "button";
        button.addEventListener("click", async () => {
          const rationale = window.prompt("Human editorial rationale for " + label);
          if (!rationale?.trim()) return;
          button.disabled = true;
          try { await api("/api/admin/intakes/" + data.intake.id + "/echo/decision", { method: "POST",
            body: JSON.stringify({ candidate_id: candidate.id, assessment_id: assessment.id, decision: value, rationale: rationale.trim() }) });
            await loadDetail(data.intake.id, "Human Echo decision recorded. Story approval and publication remain separate."); }
          catch (error) { card.append(el("p", error.message, "warning")); button.disabled = false; }
        }); controls.append(button);
      }); card.append(controls);
    }
    node.append(card);
  }
  return node;
}
function draftForm(intakeId, latest, proposal) {
  const seed = latest || proposal || {};
  const node = panel("story-copy-editor", latest ? "Edit copy / save new revision" : proposal ? "Save AI proposal as revision 1" : "Create draft revision", "copy-editor");
  node.append(el("p", latest ? "Editing the latest saved revision. Saving creates a new revision; it does not change an existing approval." : proposal ? "This form is seeded from the unsaved AI proposal. Review every field before saving." : "Create a human-reviewed draft before approval."));
  const form = el("form");
  const fields = [["story_id", "Story ID", "input"], ["headline", "Headline", "input"], ["summary", "Summary", "textarea"], ["fml_kicker", "SBNS Kicker", "textarea"], ["topic_tags", "Tags, comma-separated", "input"]];
  fields.forEach(([name, labelText, tag]) => {
    const label = el("label", labelText, ["summary", "fml_kicker", "topic_tags"].includes(name) ? "wide" : "");
    const input = el(tag);
    input.name = name;
    input.value = name === "topic_tags" ? (seed.topic_tags || []).join(", ") : seed[name] || "";
    if (["headline", "summary", "fml_kicker"].includes(name)) input.required = true;
    label.append(input);
    form.append(label);
  });
  [["category", "Category", ["International", "National", "Local"]], ["severity", "Severity", [1, 2, 3, 4, 5]]].forEach(([name, labelText, options]) => {
    const label = el("label", labelText);
    const select = el("select");
    select.name = name;
    options.forEach((value) => {
      const option = el("option", value);
      option.value = String(value);
      option.selected = seed[name] === value;
      select.append(option);
    });
    label.append(select);
    form.append(label);
  });
  const save = el("button", latest ? "Save new revision" : "Save revision 1");
  save.type = "submit";
  const status = el("p");
  status.setAttribute("role", "status");
  form.append(save, status);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    values.severity = Number(values.severity);
    values.topic_tags = values.topic_tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    save.disabled = true;
    try {
      const saved = await api("/api/admin/intakes/" + intakeId + "/drafts", { method: "POST", body: JSON.stringify(values) });
      await loadDetail(intakeId, "Revision " + saved.draft.revision + " saved.");
    } catch (error) { status.textContent = error.message; save.disabled = false; }
  });
  node.append(form);
  return node;
}
function renderDrafts(data, analysis) {
  const node = panel("story-drafts", "Editorial drafts");
  const draft0 = draftZero(analysis);
  const generated = el("section", null, "draft-zero");
  generated.append(el("h3", "Draft 0 — AI Editorial Proposal"), el("p", "Generated from the evidence ledger; not a saved draft, human approval, or publication decision."));
  if (draft0.state === "withheld") {
    generated.append(el("strong", "DRAFT WITHHELD — EVIDENCE GAPS REMAIN"));
    generated.append(list("Minimum missing issues", draft0.missing));
  } else {
    generated.append(el("h4", draft0.headline), el("p", draft0.summary));
    draft0.paragraphs.forEach((paragraph) => {
      generated.append(el("p", paragraph.text + (paragraph.qualification ? " Qualification: " + paragraph.qualification : "")));
      const refs = el("p", null, "draft-citations");
      paragraph.sources.forEach((source) => refs.append(safeLink(source.url, source.name)));
      generated.append(refs);
    });
    generated.append(el("p", draft0.kicker, "kicker"), fieldGrid([["Category", draft0.category], ["Severity", draft0.severity], ["Tags", draft0.tags.join(", ")]]));
  }
  node.append(generated);
  const latest = data.drafts.at(-1);
  const lastApprovedDraftId = data.decisions.filter((item) => item.decision === "approve").at(-1)?.draft_id;
  if (!data.drafts.length) node.append(el("p", "No saved draft revision. AI proposals do not count as saved copy."));
  data.drafts.forEach((draft, index) => {
    const card = el("article", null, "draft-card" + (index === data.drafts.length - 1 ? " latest" : ""));
    card.append(el("p", "SAVED REVISION " + draft.revision + (index === data.drafts.length - 1 ? " / LATEST" : " / PRIOR") + (draft.id === lastApprovedDraftId ? " / LAST APPROVED" : ""), "revision-label"));
    card.append(el("h3", draft.headline), el("p", draft.summary), el("p", draft.fml_kicker, "kicker"));
    card.append(fieldGrid([["Story ID", draft.story_id], ["Category", draft.category], ["Severity", draft.severity], ["Tags", safeJson(draft.topic_tags_json, []).join(", ")]]));
    node.append(card);
  });
  const proposal = analysis?.proposed_headline ? {
    headline: analysis.proposed_headline, summary: analysis.proposed_summary, fml_kicker: analysis.proposed_fml_kicker,
    category: analysis.category, severity: analysis.severity, topic_tags: analysis.proposed_topic_tags
  } : null;
  node.append(draftForm(data.intake.id, latest ? { ...latest, topic_tags: safeJson(latest.topic_tags_json, []) } : null, proposal));
  return node;
}
function renderDecisions(data) {
  const node = panel("story-decision", "Human decision", "decision-panel");
  node.append(el("p", "AI assists. Human editor decides.", "decision-principle"));
  const latestDraft = data.drafts.at(-1);
  const approved = data.decisions.filter((item) => item.decision === "approve").at(-1);
  if (approved && latestDraft && approved.draft_id !== latestDraft.id) node.append(el("p", "Latest draft differs from approved revision. New approval required.", "warning"));
  if (!latestDraft) node.append(el("p", "Save a draft revision before approving."));
  data.decisions.forEach((item) => {
    const revision = data.drafts.find((draft) => draft.id === item.draft_id)?.revision;
    node.append(field(item.decision === "approve" && revision ? "APPROVED — REVISION " + revision : String(item.decision).toUpperCase(), date(item.decided_at), "decision-log"));
  });
  const row = el("div", null, "decision-row");
  [["approve", latestDraft ? "Approve revision " + latestDraft.revision : "Approve · draft required"], ["hold", "Hold"], ["reject", "Reject"]].forEach(([value, label]) => {
    const button = el("button", label, value);
    button.type = "button";
    button.disabled = value === "approve" && !latestDraft;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api("/api/admin/intakes/" + data.intake.id + "/decisions", { method: "POST", body: JSON.stringify({ decision: value, draft_id: value === "approve" ? latestDraft.id : null, notes: null }) });
        await loadDetail(data.intake.id, "Human decision recorded.");
      } catch (error) { node.append(el("p", error.message, "warning")); button.disabled = false; }
    });
    row.append(button);
  });
  node.append(row);
  return node;
}
function renderAudit(data) {
  const node = panel("story-audit", "Audit history");
  const log = el("ol", null, "audit-list");
  [...data.audit].reverse().forEach((item) => {
    const entry = el("li", null, "audit");
    entry.append(el("time", date(item.created_at)), el("span", item.actor_id || item.actor_type), el("span", item.action));
    log.append(entry);
  });
  if (!data.audit.length) log.append(el("li", "No activity recorded."));
  node.append(log);
  return node;
}
async function loadDetail(id, notice = "") {
  const data = await api("/api/admin/intakes/" + id);
  detail.replaceChildren();
  show("detail-view");
  if (notice) detail.append(el("p", notice, "warning"));
  const candidate = discoveryFromAudit(data);
  const latestAnalysis = safeJson(data.analyses.at(-1)?.raw_analysis_json, {});
  const header = el("header", null, "file-header");
  const fileTitle = el("h2", candidate?.discovered_title || data.drafts.at(-1)?.headline || data.intake.submitted_url);
  fileTitle.tabIndex = -1;
  header.append(el("p", "STORY FILE / " + data.intake.id, "file-overline"), fileTitle);
  const context = el("div", null, "file-context");
  context.append(badge(data.intake.status, "status"), badge(data.intake.origin, "origin"));
  [["Analysis", jobLabels[data.analysis_jobs.at(-1)?.state] || data.intake.analysis_status], ["AI read", latestAnalysis.recommendation], ["Human decision", data.decisions.at(-1)?.decision], ["Draft", data.drafts.at(-1) ? "Rev " + data.drafts.at(-1).revision : "None"], ["Last activity", date(data.intake.updated_at)]].forEach(([label, value]) => context.append(el("span", label + ": " + text(value))));
  header.append(context);
  const nav = el("nav", null, "file-nav");
  nav.setAttribute("aria-label", "Story file sections");
  const sections = [["story-intake", "Intake"], ["story-discovery", "Discovery"], ["story-semantics", "Editorial Frame"], ["story-analysis", "Analysis"], ["story-evidence", "Evidence"], ["story-echo", "Cultural Echo"], ["story-drafts", "Drafts"], ["story-decision", "Decision"], ["story-audit", "Audit"]];
  sections.filter(([section]) => section !== "story-discovery" || candidate).forEach(([section, label]) => {
    const link = el("a", label); link.href = "#" + section; nav.append(link);
  });
  const sticky = el("div", null, "file-sticky");
  sticky.append(header, nav);
  detail.append(sticky);
  const intake = panel("story-intake", "Intake");
  intake.append(fieldGrid([["URL", data.intake.submitted_url, true], ["Origin", data.intake.origin], ["Submitted", date(data.intake.submitted_at)], ["Workflow", data.intake.status], ["Note", data.intake.submitter_note, true]]));
  detail.append(intake);
  const discovery = renderDiscovery(candidate);
  if (discovery) detail.append(discovery);
  const rendered = renderAnalysis(data);
  detail.append(renderSemanticControl(data, rendered.parsed, candidate), rendered.analysis, rendered.evidence, renderEcho(data, rendered.parsed));
  if (rendered.proposal) detail.append(rendered.proposal);
  detail.append(renderDrafts(data, rendered.parsed), renderDecisions(data), renderAudit(data));
  fileTitle.focus({ preventScroll: true });
}
function metric(target, label, value) {
  const row = el("p", null, "metric-line");
  row.append(el("span", label), el("strong", text(value)));
  target.append(row);
}
function renderWatchdeskRun(run, target) {
  target.replaceChildren();
  if (!run) { target.append(el("p", "No Watchdesk runs recorded yet.")); return; }
  const metrics = run.metrics || {};
  [["Run ID", run.run_id], ["Status", run.status], ["Last completed", date(run.completed_at)], ["Run type", run.trigger_type], ["Mode", run.dry_run ? "Dry run" : "Live"], ["Sources checked", metrics.sources_checked ?? 0], ["Sources succeeded", metrics.sources_succeeded ?? 0], ["Source failures", run.source_failure_count ?? run.source_failures?.length ?? 0], ["Discovered items", metrics.items_discovered ?? 0], ["Discovery leads", metrics.discovery_leads ?? 0], ["Gap-ready", metrics.submission_ready_gap ?? 0], ["Aperture-ready", metrics.submission_ready_aperture ?? 0], ["Submission-ready", metrics.submission_ready ?? 0], ["Would submit", metrics.would_submit ?? 0], ["Submitted", run.submitted_count ?? metrics.submitted_to_newsroom ?? 0]].forEach(([label, value]) => metric(target, label, value));
  metric(target, "Trusted Source lane", `${metrics.trusted_scanned ?? 0} feeds · ${metrics.trusted_candidates ?? 0} hits · ${metrics.trusted_failures ?? 0} failures · ${metrics.trusted_submissions ?? 0} submitted`);
  metric(target, "Open Sweep lane", `${metrics.open_sweep_queries_attempted ?? 0} queries / ${metrics.open_sweep_queries_failed ?? 0} failed · ${metrics.open_sweep_raw_hits ?? 0} hits · ${metrics.open_sweep_event_clusters ?? 0} event clusters · ${metrics.open_sweep_eligible_leads ?? 0} eligible leads (${metrics.open_sweep_strong_open_leads ?? 0} strong / ${metrics.open_sweep_open_leads ?? 0} open) · ${metrics.open_sweep_submissions ?? 0} submitted`);
  metric(target, "Open Sweep triage", `${metrics.open_sweep_triaged_candidates ?? 0} triaged · ${metrics.open_sweep_human_burden_candidates ?? 0} human-burden · ${metrics.open_sweep_fml_candidates ?? 0} FML candidates · ${metrics.open_sweep_no_action_discarded ?? 0} no-action`);
  metric(target, "Combined dedupe / overlap", `${metrics.combined_duplicate_suppressions ?? 0} duplicate suppressions · ${metrics.combined_source_cluster_overlap ?? 0} cross-lane event overlaps`);
  if (run.submitted_intake_ids?.length) metric(target, "Submitted intake IDs", run.submitted_intake_ids.join(", "));
  if (run.error_class) metric(target, "Error", run.error_class + ": " + (run.error_message || "Unknown failure"));
}
function updateWatchdeskStrip(latest, run) {
  const metrics = run?.metrics || {};
  document.querySelector("#desk-watchdesk").textContent = latest?.status || "No runs";
  document.querySelector("#desk-failures").textContent = run ? String(run.source_failure_count ?? 0) : "—";
  document.querySelector("#desk-submitted").textContent = run ? String(run.submitted_count ?? metrics.submitted_to_newsroom ?? 0) : "—";
}
async function loadWatchdeskStatus() {
  const data = await api("/api/admin/watchdesk/status");
  const run = data.last_completed || data.latest;
  watchdeskStatus.textContent = data.latest ? "Latest run: " + data.latest.status + (run?.status === "success" && run.metrics?.would_submit === 0 ? " · zero qualifying submissions" : "") : "No Watchdesk runs recorded yet.";
  watchdeskStatus.classList.toggle("alert", ["failed", "partial"].includes(data.latest?.status) || (data.latest?.source_failure_count || 0) > 0);
  updateWatchdeskStrip(data.latest, run);
  watchdeskLatest.replaceChildren();
  if (run) {
    const summary = el("div", null, "wire-summary");
    [["Completed", date(run.completed_at)], ["Sources", run.metrics?.sources_checked ?? 0], ["Failures", run.source_failure_count ?? 0], ["Leads", run.metrics?.discovery_leads ?? 0], ["Submitted", run.submitted_count ?? 0]].forEach(([label, value]) => {
      const part = el("p"); part.append(el("span", label), el("strong", value)); summary.append(part);
    });
    watchdeskLatest.append(summary);
  } else watchdeskLatest.append(el("p", "No completed scan yet."));
  document.querySelector("#watchdesk-cadence").textContent = data.schedule_configured ? (data.cron_utc === "0 14,23 * * *" ? "14:00 & 23:00 UTC daily" : data.cron_utc) : "Not configured";
  renderWatchdeskRun(run, watchdeskMetrics);
  watchdeskSources.replaceChildren();
  if (run?.source_health?.length) {
    watchdeskSources.append(el("h3", "Source health"));
    run.source_health.forEach((source) => {
      const transport = source.lane === "open_sweep" && source.outcome
        ? " · " + source.outcome + " · " + (source.attempts ?? 0) + " attempt(s) · " + (source.duration_ms ?? 0) + " ms" + (source.http_status ? " · HTTP " + source.http_status : "")
        : "";
      watchdeskSources.append(el("p", (source.lane === "open_sweep" ? "Open Sweep" + (source.lens_id ? " / " + source.lens_id.replaceAll("_", " ") : "") : "Trusted Source") + " · " + source.source_id + ": " + source.status + " · " + source.items_parsed + " parsed" + transport + " · " + date(source.checked_at) + (source.error ? " · " + source.error : "")));
    });
  }
  watchdeskHistory.replaceChildren();
  (data.recent || []).forEach((item) => watchdeskHistory.append(el("p", date(item.started_at) + " · " + item.trigger_type + " · " + (item.dry_run ? "dry" : "live") + " · " + item.status + " · " + item.run_id)));
  if (!data.recent?.length) watchdeskHistory.append(el("p", "No runs recorded."));
}
async function runWatchdeskNow(dryRun) {
  if (!dryRun && !window.confirm("Run Watchdesk now? This may add up to five automated discovery candidates to the Newsroom queue. It cannot publish or make editorial decisions.")) return;
  watchdeskDry.disabled = true; watchdeskLive.disabled = true;
  watchdeskResult.textContent = dryRun ? "Running dry Watchdesk…" : "Running live Watchdesk…";
  try {
    const result = await api("/api/admin/watchdesk/runs", { method: "POST", body: JSON.stringify({ dry_run: dryRun }) });
    watchdeskResult.textContent = result.message || "Run " + result.status + ".";
    await Promise.all([loadWatchdeskStatus(), loadQueue()]);
  } catch (error) {
    watchdeskResult.textContent = "Watchdesk run failed: " + error.message;
    await loadWatchdeskStatus().catch(() => {});
  } finally { watchdeskDry.disabled = false; watchdeskLive.disabled = false; }
}

watchdeskDry.addEventListener("click", () => runWatchdeskNow(true));
watchdeskLive.addEventListener("click", () => runWatchdeskNow(false));
discoverySearchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = discoverySearchForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  const term = document.querySelector("#discovery-search-query").value.trim();
  discoverySearchStatus.textContent = "Searching bounded public metadata…";
  discoverySearchResults.replaceChildren();
  try {
    const result = await api("/api/admin/discovery/search?q=" + encodeURIComponent(term));
    discoverySearchStatus.textContent = result.results.length + " discovery leads. No source has been verified or enrolled for monitoring.";
    result.results.forEach((item) => {
      const card = el("article", null, "source-learning-card");
      card.append(el("strong", item.title), el("p", item.domain + (item.seen_at ? " · " + item.seen_at : "")), safeLink(item.url));
      const add = el("button", "Add URL to Story File");
      add.type = "button";
      add.addEventListener("click", async () => {
        add.disabled = true;
        try {
          const created = await api("/api/admin/intakes", { method: "POST", body: JSON.stringify({ submitted_url: item.url, submitter_note: "Editor selected this public-search discovery lead for ordinary intake. Search metadata is not evidence." }) });
          await loadDetail(created.intake.id, created.duplicate ? "Existing Story File opened; no duplicate intake created." : created.queued ? "Discovery URL saved and analysis queued." : created.message);
        } catch (error) { discoverySearchStatus.textContent = error.message; add.disabled = false; }
      });
      card.append(add); discoverySearchResults.append(card);
    });
  } catch (error) { discoverySearchStatus.textContent = error.message; }
  finally { submit.disabled = false; }
});
document.querySelector("#new-intake").addEventListener("click", () => show("new-view", "#new-heading"));
document.querySelectorAll(".back").forEach((button) => button.addEventListener("click", () => loadQueue().then(() => document.querySelector("#assignment-heading").focus()).catch((error) => { queueStatus.textContent = error.message; })));
document.querySelector("#queue-search").addEventListener("input", renderQueue);
document.querySelector("#origin-filter").addEventListener("change", renderQueue);
document.querySelector("#status-filter").addEventListener("change", () => loadQueue().catch((error) => { queueStatus.textContent = error.message; }));
document.querySelector("#new-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const submit = event.currentTarget.querySelector("button");
  submit.disabled = true;
  try {
    const data = await api("/api/admin/intakes", { method: "POST", body: JSON.stringify(values) });
    await loadDetail(data.intake.id, data.queued ? "Intake saved and analysis queued." : data.message);
  } catch (error) { document.querySelector("#new-status").textContent = error.message; }
  finally { submit.disabled = false; }
});
try {
  const session = await api("/api/admin/session");
  document.querySelector("#actor").textContent = session.actor.email;
  await Promise.all([loadQueue(), loadWatchdeskStatus().catch((error) => { watchdeskStatus.textContent = error.message; }), loadWatchdeskSources().catch((error) => { watchdeskResult.textContent = error.message; })]);
} catch (error) {
  document.querySelector("#actor").textContent = "Authentication required";
  queueStatus.textContent = error.message;
  watchdeskStatus.textContent = "Authentication required";
}
