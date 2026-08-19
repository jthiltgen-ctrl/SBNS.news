"use strict";

const BUNDLE_URL = "/admin/monitoring-fixtures.json";
const RECOMMENDATION_LABELS = {
  no_action: "NO ACTION",
  update_review: "UPDATE REVIEW",
  correction_review: "CORRECTION REVIEW",
  follow_up: "FOLLOW-UP"
};
const DECISIONS = [
  ["No Action", "no_action"], ["Update Review", "update_review"],
  ["Correction Review", "correction_review"], ["Follow-Up", "follow_up"], ["Hold", "hold"]
];
const fixtureByRecommendation = new Map();
const fixtureByUrl = new Map();
let current = null;

const form = document.querySelector("#monitor-form");
const urlInput = document.querySelector("#development-url");
const status = document.querySelector("#monitor-status");
const result = document.querySelector("#monitor-result");
const demoButtons = [...document.querySelectorAll("[data-monitor-demo]")];

function el(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attributes ?? {})) node.setAttribute(name, value);
  return node;
}
function panel(title, className = "") {
  const node = el("section", { className: `panel ${className}`.trim() });
  node.append(el("h2", { text: title }));
  return node;
}
function list(parent, items, className = "panel-list") {
  const ul = el("ul", { className });
  for (const item of items) ul.append(el("li", { text: item }));
  parent.append(ul);
  return ul;
}
function titleCase(value) { return String(value).split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" "); }
function yesNo(value) { return value === "uncertain" ? "Uncertain" : value ? "Yes" : "No"; }
function setStatus(message) { status.textContent = message; }
function normalizeUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS development URLs are accepted.");
  url.hash = "";
  return url.href;
}
function normalizeTags(value) {
  const seen = new Set();
  return value.split(",").map((tag) => tag.trim()).filter((tag) => tag && !seen.has(tag) && seen.add(tag));
}
function hasState() { return Boolean(current && (current.humanDecision || current.proposalChanged)); }
function confirmDiscard() { return !hasState() || window.confirm("Discard the current monitoring review and load another example?"); }

function safeLink(name, url, label = "Open synthetic source") {
  const item = el("div", { className: "source" });
  item.append(el("p", { text: name }), el("a", { className: "source-link", text: label, attributes: { href: url, target: "_blank", rel: "noopener noreferrer" } }));
  return item;
}

function renderRecommendation(analysis) {
  const card = el("section", { className: `recommendation-card monitoring-${analysis.recommendation}` });
  card.append(el("p", { className: "card-label", text: "MONITORING RECOMMENDATION" }), el("h2", { className: "recommendation-title", text: RECOMMENDATION_LABELS[analysis.recommendation] }));
  const metrics = [
    ["Confidence", titleCase(analysis.recommendation_confidence)],
    ["Original story accurate?", yesNo(analysis.original_story_accurate)],
    ["Material change?", yesNo(analysis.material_change)],
    ["Development type", titleCase(analysis.development_type)],
    ["Checked", analysis.checked_at]
  ];
  const dl = el("dl", { className: "metric-grid" });
  for (const [name, value] of metrics) { const row = el("div", { className: "metric" }); row.append(el("dt", { text: name }), el("dd", { text: value })); dl.append(row); }
  card.append(dl);
  return card;
}

function renderBaseline(baseline) {
  const section = panel("ORIGINAL SBNS STORY", "chronology-original");
  section.append(
    el("p", { className: "preview-label", text: `Published ${baseline.published_at}` }),
    el("h3", { text: baseline.headline }), el("p", { text: baseline.summary }),
    el("p", { className: "proposed-kicker", text: baseline.fml_kicker })
  );
  const tags = el("ul", { className: "tag-list" });
  for (const tag of baseline.topic_tags) tags.append(el("li", { text: tag }));
  section.append(tags, el("h3", { text: "Original sources" }));
  const sources = el("div", { className: "source-list" });
  for (const source of baseline.sources) {
    if (source.url) sources.append(safeLink(source.name, source.url));
    else sources.append(el("p", { className: "source", text: source.name }));
  }
  section.append(sources);
  return section;
}

function renderDevelopment(analysis) {
  const section = panel("NEW DEVELOPMENT", "chronology-new");
  section.append(el("p", { className: "synthetic-inline", text: "SYNTHETIC MONITORING EXAMPLE" }), el("p", { text: analysis.development_summary }), el("h3", { text: "New sources" }));
  const sources = el("div", { className: "source-list" });
  for (const source of analysis.sources) sources.append(safeLink(source.name, source.url));
  section.append(sources, el("h3", { text: "Claim ledger" }));
  const ledger = el("div", { className: "ledger" });
  for (const claim of analysis.claims) {
    const claimCard = el("article", { className: "claim" });
    claimCard.append(el("span", { className: `claim-state ${claim.verification_status}`, text: titleCase(claim.verification_status) }), el("p", { text: claim.claim_text }));
    const qualification = el("p", { className: "qualification" }); qualification.append(el("strong", { text: "Qualification: " }), document.createTextNode(claim.qualification || "None recorded")); claimCard.append(qualification); ledger.append(claimCard);
  }
  section.append(ledger, el("h3", { text: "Source conflicts" }));
  if (analysis.source_conflicts.length === 0) section.append(el("p", { text: "No material source conflicts recorded." }));
  else list(section, analysis.source_conflicts.map((conflict) => `${conflict.description} ${conflict.resolved ? "Resolved." : "Unresolved."}`));
  return section;
}

function renderChanged(analysis) {
  const section = panel("WHAT CHANGED?", "what-changed");
  section.append(el("p", { className: "materiality-rationale", text: analysis.materiality_rationale }), el("h3", { text: "Affected original claims" }));
  if (analysis.affected_original_claims.length === 0) section.append(el("p", { text: "No original claim is materially implicated." }));
  else {
    const cards = el("div", { className: "impact-list" });
    for (const item of analysis.affected_original_claims) {
      const card = el("article", { className: `impact ${item.impact}` });
      card.append(el("span", { className: "claim-state", text: `${titleCase(item.field)} · ${titleCase(item.impact)}` }), el("p", { text: item.original_text })); cards.append(card);
    }
    section.append(cards);
  }
  section.append(el("h3", { text: "Superseded facts" }));
  if (analysis.superseded_facts.length === 0) section.append(el("p", { text: "No facts recorded as accurate-then but later superseded." }));
  else list(section, analysis.superseded_facts.map((fact) => `${fact.original_fact} → ${fact.current_fact} Original was accurate: ${yesNo(fact.original_was_accurate)}.`));
  return section;
}

function renderWarnings(analysis) {
  const section = panel("DO NOT CLAIM", "do-not-claim");
  list(section, analysis.do_not_claim);
  return section;
}

function invalidateDecision() {
  if (current.humanDecision !== null) current.decisionInvalidated = true;
  current.humanDecision = null;
  current.proposalChanged = true;
}

function bind(control, object, field, rerender, transform = (value) => value) {
  control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
    object[field] = transform(control.value);
    invalidateDecision();
    rerender();
    setStatus("Proposed editorial content changed locally. Record the human decision again.");
  });
}

function field(label, control) { const wrap = el("div", { className: "editorial-field" }); wrap.append(el("label", { text: label, attributes: { for: control.id } }), control); return wrap; }
function input(id, value, multiline = false) { const node = el(multiline ? "textarea" : "input", { attributes: { id } }); if (!multiline) node.type = "text"; node.value = value; return node; }
function select(id, values, selected) { const node = el("select", { attributes: { id } }); for (const value of values) { const option = el("option", { text: value, attributes: { value: String(value) } }); if (value === selected) option.selected = true; node.append(option); } return node; }

function renderFollowUp(analysis) {
  const section = panel("FOLLOW-UP DRAFT — NOT PUBLISHED", "proposal-panel");
  const proposal = current.workingProposal;
  const formNode = el("form", { className: "editorial-form", attributes: { "aria-label": "Editable follow-up draft" } }); formNode.addEventListener("submit", (event) => event.preventDefault());
  const controls = {
    id: input("follow-id", proposal.id), headline: input("follow-headline", proposal.headline), summary: input("follow-summary", proposal.summary, true),
    fml_kicker: input("follow-kicker", proposal.fml_kicker, true), category: select("follow-category", ["International", "National", "Local"], proposal.category),
    severity: select("follow-severity", [1, 2, 3, 4, 5], proposal.severity), tags: input("follow-tags", proposal.topic_tags.join(", "))
  };
  const rerender = () => renderCurrent();
  bind(controls.id, proposal, "id", rerender); bind(controls.headline, proposal, "headline", rerender); bind(controls.summary, proposal, "summary", rerender);
  bind(controls.fml_kicker, proposal, "fml_kicker", rerender); bind(controls.category, proposal, "category", rerender); bind(controls.severity, proposal, "severity", rerender, Number);
  bind(controls.tags, proposal, "topic_tags", rerender, normalizeTags);
  for (const [key, label] of [["id", "Story ID"], ["headline", "Headline"], ["summary", "Summary"], ["fml_kicker", "Kicker"], ["category", "Category"], ["severity", "Severity"], ["tags", "Tags"]]) formNode.append(field(label, controls[key]));
  section.append(formNode, el("h3", { text: "Read-only sources" }));
  const sources = el("div", { className: "source-list" }); for (const source of proposal.sources) sources.append(safeLink(source.name, source.url)); section.append(sources);
  return section;
}

function renderCorrection(analysis) {
  const correction = current.workingProposal;
  const section = panel("PROPOSED CORRECTION — REVIEW ONLY", "proposal-panel correction-proposal");
  const compare = el("div", { className: "before-after" });
  const before = el("section", { className: "comparison before" }); before.append(el("h3", { text: "BEFORE" }), el("p", { text: correction.original_fact }));
  const after = el("section", { className: "comparison after" }); after.append(el("h3", { text: "AFTER" }), el("p", { text: correction.corrected_fact })); compare.append(before, after);
  section.append(compare, el("h3", { text: "Why correction is required" }), el("p", { text: correction.correction_reason }));
  const note = input("correction-note", correction.correction_note, true);
  section.append(field("Proposed correction note", note));
  bind(note, correction, "correction_note", () => renderCurrent());
  section.append(el("h3", { text: "Proposed revised fields" }));
  for (const [name, value] of Object.entries(correction.revised_fields)) {
    const control = input(`correction-${name}`, value, true); section.append(field(titleCase(name), control));
    bind(control, correction.revised_fields, name, () => renderCurrent());
  }
  section.append(el("h3", { text: "Supporting sources" }));
  list(section, correction.source_refs.map((ref) => analysis.sources.find((source) => source.source_id === ref)?.name ?? ref));
  return section;
}

function renderUpdate() {
  const update = current.workingProposal;
  const section = panel("PROPOSED UPDATE — REVIEW ONLY", "proposal-panel");
  section.append(el("p", { className: "ephemeral-note", text: "The original reporting remains materially accurate. This proposal adds later context." }));
  const note = input("update-note", update.update_note, true); const changes = input("update-changes", update.suggested_changes, true);
  section.append(field("Update note", note), field("Suggested changes", changes)); bind(note, update, "update_note", () => renderCurrent()); bind(changes, update, "suggested_changes", () => renderCurrent());
  return section;
}

function renderProposal(analysis) {
  if (analysis.proposed_follow_up) return renderFollowUp(analysis);
  if (analysis.proposed_correction) return renderCorrection(analysis);
  if (analysis.proposed_update) return renderUpdate(analysis);
  const section = panel("NO PROPOSED MUTATION", "no-action-proposal");
  section.append(el("strong", { text: "No change to the published SBNS story is proposed." }));
  return section;
}

function renderDecision(analysis) {
  const section = panel("Human editorial decision", "monitoring-decision");
  section.append(el("p", { className: "ephemeral-note", text: "This decision is temporary browser state. It does not mutate, publish, or republish anything." }));
  const state = el("p", { className: `decision-state ${current.humanDecision ? "" : "none"}`.trim(), text: current.humanDecision ? `HUMAN DECISION: ${RECOMMENDATION_LABELS[current.humanDecision] ?? current.humanDecision.toUpperCase()}` : "HUMAN DECISION: NOT SET" }); section.append(state);
  if (current.decisionInvalidated) section.append(el("p", { className: "approval-invalidation", text: "Proposed editorial content changed. Record the human decision again." }));
  if (current.humanDecision && current.humanDecision !== analysis.recommendation) section.append(el("p", { className: "disagreement-state", text: "Human decision differs from monitoring recommendation." }));
  const actions = el("div", { className: "monitor-decision-actions", attributes: { role: "group", "aria-label": "Monitoring human decision" } });
  for (const [label, value] of DECISIONS) {
    const button = el("button", { text: label, attributes: { type: "button", "aria-pressed": String(current.humanDecision === value) } });
    button.addEventListener("click", () => { current.humanDecision = value; current.decisionInvalidated = false; renderCurrent(); setStatus(`Temporary monitoring decision recorded: ${label}. Nothing was changed or published.`); }); actions.append(button);
  }
  const clear = el("button", { className: "clear-decision", text: "Clear decision", attributes: { type: "button" } }); clear.addEventListener("click", () => { current.humanDecision = null; current.decisionInvalidated = false; renderCurrent(); setStatus("Temporary monitoring decision cleared."); }); actions.append(clear); section.append(actions);
  return section;
}

function renderCurrent() {
  const analysis = current.fixture.analysis;
  result.replaceChildren(renderRecommendation(analysis), renderBaseline(current.fixture.baseline_story), renderDevelopment(analysis), renderChanged(analysis), renderWarnings(analysis), renderProposal(analysis), renderDecision(analysis));
}

function loadFixture(fixture) {
  if (!confirmDiscard()) return;
  const copy = structuredClone(fixture);
  const proposal = copy.analysis.proposed_follow_up ?? copy.analysis.proposed_correction ?? copy.analysis.proposed_update;
  current = { fixture: copy, workingProposal: proposal ? structuredClone(proposal) : null, humanDecision: null, proposalChanged: false, decisionInvalidated: false };
  urlInput.value = copy.analysis.development_url; renderCurrent();
  setStatus(`Loaded validated synthetic ${RECOMMENDATION_LABELS[copy.analysis.recommendation]} fixture. Human decision is not set.`);
}

function renderUnconnected() {
  current = null;
  const section = panel("LIVE MONITORING NOT CONNECTED", "neutral-state");
  section.append(el("p", { text: "The URL was accepted, but Phase E performs no live monitoring, crawling, or analysis. No recommendation was generated." }));
  result.replaceChildren(section); setStatus("Valid URL accepted. No external URL was fetched and no monitoring analysis was performed.");
}

function handleUrl(value) {
  let normalized;
  try { normalized = normalizeUrl(value); } catch (error) { setStatus(error.message); return; }
  const fixture = fixtureByUrl.get(normalized);
  if (fixture) loadFixture(fixture); else if (confirmDiscard()) renderUnconnected();
}

form.addEventListener("submit", (event) => { event.preventDefault(); if (!urlInput.checkValidity()) { setStatus("Enter a valid HTTP or HTTPS development URL."); return; } handleUrl(urlInput.value); });
urlInput.addEventListener("invalid", () => setStatus("Enter a valid HTTP or HTTPS development URL."));
for (const button of demoButtons) { button.disabled = true; button.addEventListener("click", () => { const fixture = fixtureByRecommendation.get(button.dataset.monitorDemo); if (fixture) loadFixture(fixture); }); }

async function loadFixtures() {
  try {
    const response = await fetch(BUNDLE_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Monitoring fixture bundle returned HTTP ${response.status}.`);
    const bundle = await response.json();
    if (bundle.schema_version !== "1.0" || !Array.isArray(bundle.fixtures)) throw new Error("Monitoring fixture bundle format is invalid.");
    for (const fixture of bundle.fixtures) { fixtureByRecommendation.set(fixture.analysis.recommendation, fixture); fixtureByUrl.set(normalizeUrl(fixture.analysis.development_url), fixture); }
    for (const button of demoButtons) button.disabled = false;
    setStatus("Validated synthetic monitoring fixtures are ready. No live monitoring is connected.");
  } catch (error) { setStatus(`Unable to load monitoring fixtures: ${error.message}`); }
}

loadFixtures();
