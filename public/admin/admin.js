"use strict";

const FIXTURE_BUNDLE_URL = "/admin/intake-fixtures.json";
const CATEGORIES = ["International", "National", "Local"];
const STORY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const fixtureByRecommendation = new Map();
const fixtureByUrl = new Map();
let currentReview = null;

const form = document.querySelector("#intake-form");
const urlInput = document.querySelector("#submitted-url");
const status = document.querySelector("#intake-status");
const result = document.querySelector("#intake-result");
const demoButtons = [...document.querySelectorAll("[data-demo]")];

function createElement(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attributes ?? {})) node.setAttribute(name, value);
  return node;
}

function displayValue(value, neutral = "—") {
  if (value === null || value === undefined || value === "") return neutral;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function titleCase(value) {
  if (value === null || value === undefined) return "—";
  return String(value).split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function normalizeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS source URLs are accepted.");
  url.hash = "";
  return url.href;
}

function normalizeTags(value) {
  const seen = new Set();
  const tags = [];
  for (const part of value.split(",")) {
    const tag = part.trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function slugFromHeadline(value) {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72)
    .replace(/-$/g, "");
  return slug || "untitled-reporting-story";
}

function setStatus(message) {
  status.textContent = message;
}

function createPanel(title, className = "") {
  const panel = createElement("section", { className: `panel ${className}`.trim() });
  panel.append(createElement("h2", { text: title }));
  return panel;
}

function appendList(parent, items) {
  const list = createElement("ul", { className: "panel-list" });
  for (const item of items) list.append(createElement("li", { text: item }));
  parent.append(list);
}

function recommendationHeading(recommendation) {
  if (recommendation === "publish") return "RECOMMEND PUBLISH";
  if (recommendation === "hold") return "HOLD";
  return "REJECT";
}

function analysisHasDraft(analysis) {
  return Boolean(analysis.proposed_headline && analysis.proposed_summary && analysis.proposed_fml_kicker);
}

function draftFromAnalysis(analysis) {
  if (!analysisHasDraft(analysis)) return null;
  return {
    id: analysis.intake_id === "historical-story-005-dubuque-budget-audit"
      ? "phase-d-publication-demo"
      : slugFromHeadline(analysis.proposed_headline),
    headline: analysis.proposed_headline,
    summary: analysis.proposed_summary,
    kicker: analysis.proposed_fml_kicker,
    category: analysis.category,
    severity: analysis.severity,
    tags: [...analysis.proposed_topic_tags]
  };
}

function neutralDraft(analysis) {
  return { id: "", headline: "", summary: "", kicker: "", category: analysis.category, severity: analysis.severity, tags: [] };
}

function availableDraftSources(analysis) {
  if (analysis.proposed_sources.length > 0) return analysis.proposed_sources;
  return analysis.sources.map((source) => ({ name: source.name, url: source.url }));
}

function valuesEqual(first, second) {
  return JSON.stringify(first) === JSON.stringify(second);
}

function draftChanged() {
  return Boolean(currentReview && !valuesEqual(currentReview.originalDraft, currentReview.workingDraft));
}

function hasEditorialState() {
  return Boolean(currentReview && (draftChanged() || currentReview.humanDecision !== null || currentReview.guardrailsAcknowledged));
}

function confirmDiscard() {
  return !hasEditorialState() || window.confirm("Discard current editorial changes and load another intake?");
}

function renderRecommendation(analysis) {
  const card = createElement("section", {
    className: `recommendation-card ${analysis.recommendation}`,
    attributes: { "aria-labelledby": "recommendation-title" }
  });
  card.append(
    createElement("p", { className: "card-label", text: "Analyzer recommendation" }),
    createElement("h2", { className: "recommendation-title", text: recommendationHeading(analysis.recommendation), attributes: { id: "recommendation-title" } })
  );
  const metrics = [
    ["Intake origin", titleCase(analysis.intake_origin)],
    ["Confidence", titleCase(analysis.recommendation_confidence)],
    ["Category", analysis.category],
    ["Category confidence", titleCase(analysis.category_confidence)],
    ["Severity", analysis.severity === null ? "Not established" : analysis.severity],
    ["Systemic failure", displayValue(analysis.systemic_failure)],
    ["Primary source", displayValue(analysis.primary_source_available)],
    ["Independent source", displayValue(analysis.independent_source_available)],
    ["Authoritative source", displayValue(analysis.authoritative_source_available)],
    ["Institution response", displayValue(analysis.institution_response_present)],
    ["Qualification required", displayValue(analysis.qualification_required)],
    ["Factual risk", titleCase(analysis.factual_risk)],
    ["Legal risk", titleCase(analysis.legal_risk)],
    ["Duplicate risk", titleCase(analysis.duplication_risk)],
    ["Kicker safety", titleCase(analysis.kicker_safety)]
  ];
  const grid = createElement("dl", { className: "metric-grid" });
  for (const [label, value] of metrics) {
    const metric = createElement("div", { className: "metric" });
    metric.append(createElement("dt", { text: label }), createElement("dd", { text: value }));
    grid.append(metric);
  }
  card.append(grid);
  return card;
}

function renderReasons(analysis) {
  const panel = createPanel("Why SBNS");
  panel.append(createElement("p", { text: analysis.why_sbns }), createElement("h3", { text: "Recommendation reasons" }));
  appendList(panel, analysis.recommendation_reasons);
  if (analysis.hold_reasons.length > 0) {
    panel.append(createElement("h3", { text: "Hold reasons" }));
    appendList(panel, analysis.hold_reasons);
  }
  if (analysis.reject_reasons.length > 0) {
    panel.append(createElement("h3", { text: "Rejection reasons" }));
    appendList(panel, analysis.reject_reasons);
  }
  return panel;
}

function renderDoNotClaim(analysis) {
  const panel = createPanel("DO NOT CLAIM", "do-not-claim");
  appendList(panel, analysis.do_not_claim);
  return panel;
}

function renderClaims(analysis) {
  const panel = createPanel("Claim ledger");
  const sourcesById = new Map(analysis.sources.map((source) => [source.source_id, source.name]));
  const ledger = createElement("div", { className: "ledger" });
  for (const claim of analysis.claims) {
    const card = createElement("article", { className: "claim" });
    const meta = createElement("div", { className: "claim-meta" });
    meta.append(
      createElement("span", { className: `claim-state ${claim.verification_status}`, text: titleCase(claim.verification_status) }),
      createElement("span", { className: "claim-state", text: claim.material ? "Material" : "Non-material" })
    );
    card.append(meta, createElement("p", { text: claim.claim_text }));
    const qualification = createElement("p", { className: "qualification" });
    qualification.append(createElement("strong", { text: "Qualification: " }), document.createTextNode(displayValue(claim.qualification, "None recorded")));
    card.append(qualification);
    const conflict = createElement("p");
    conflict.append(createElement("strong", { text: "Conflict: " }), document.createTextNode(claim.conflict ? "Recorded" : "None recorded"));
    card.append(conflict);
    const supporting = createElement("p");
    supporting.append(
      createElement("strong", { text: "Supporting sources: " }),
      document.createTextNode(claim.source_refs.map((sourceId) => sourcesById.get(sourceId) ?? sourceId).join("; "))
    );
    card.append(supporting);
    ledger.append(card);
  }
  panel.append(ledger);
  return panel;
}

function renderSources(analysis) {
  const panel = createPanel("Sources");
  const sourceList = createElement("div", { className: "source-list" });
  for (const source of analysis.sources) {
    const card = createElement("article", { className: "source" });
    const meta = createElement("div", { className: "source-meta" });
    meta.append(createElement("span", { className: "source-type", text: titleCase(source.source_type) }));
    card.append(meta, createElement("h3", { text: source.name }));
    for (const [label, value] of [["Authority", source.authority], ["Recency", source.recency], ["Claims supported", source.claims_supported.join(", ")]]) {
      const item = createElement("p");
      item.append(createElement("strong", { text: `${label}: ` }), document.createTextNode(value));
      card.append(item);
    }
    card.append(createElement("a", { className: "source-link", text: "Open external source", attributes: { href: source.url, target: "_blank", rel: "noopener noreferrer" } }));
    sourceList.append(card);
  }
  panel.append(sourceList);
  return panel;
}

function renderConflicts(analysis) {
  const panel = createPanel("Source conflicts");
  if (analysis.source_conflicts.length === 0) {
    panel.append(createElement("p", { text: "No material source conflicts recorded." }));
    return panel;
  }
  const sourcesById = new Map(analysis.sources.map((source) => [source.source_id, source.name]));
  const list = createElement("div", { className: "conflict-list" });
  for (const conflict of analysis.source_conflicts) {
    const card = createElement("article", { className: "conflict" });
    card.append(createElement("h3", { text: `Conflict ${conflict.conflict_id}` }));
    appendList(card, conflict.statements);
    const details = [
      ["Sources involved", conflict.source_refs.map((id) => sourcesById.get(id) ?? id).join("; ")],
      ["Resolvable", displayValue(conflict.resolvable)],
      ["Affects publication", displayValue(conflict.affects_publication)],
      ["Proposed story avoids unresolved claim", displayValue(conflict.proposed_story_avoids_unresolved_claim)]
    ];
    for (const [label, value] of details) {
      const item = createElement("p");
      item.append(createElement("strong", { text: `${label}: ` }), document.createTextNode(value));
      card.append(item);
    }
    list.append(card);
  }
  panel.append(list);
  return panel;
}

function renderCausation(analysis) {
  const panel = createPanel("Attribution and causation");
  const grid = createElement("div", { className: "causation-grid" });
  const items = [
    ["Observed condition", displayValue(analysis.observed_condition, "Not established")],
    ["Attributable failure", displayValue(analysis.attributable_failure, "Not established")],
    ["Causation supported", displayValue(analysis.causation_supported)],
    ["Specific harm causation", displayValue(analysis.specific_harm_causation, "Not established")]
  ];
  for (const [label, value] of items) {
    const item = createElement("div", { className: "causation-item" });
    item.append(createElement("span", { className: "card-label", text: label }), createElement("p", { text: value }));
    grid.append(item);
  }
  panel.append(grid);
  return panel;
}

function createField(labelText, control, fieldName) {
  const wrapper = createElement("div", { className: "editorial-field" });
  const heading = createElement("div", { className: "field-heading" });
  heading.append(
    createElement("label", { text: labelText, attributes: { for: control.id } }),
    createElement("span", { className: "field-origin", text: "Analyzer proposal", attributes: { "data-field-marker": fieldName } })
  );
  wrapper.append(heading, control);
  return wrapper;
}

function createTextControl(id, value, multiline = false) {
  const control = createElement(multiline ? "textarea" : "input", { attributes: { id } });
  if (!multiline) control.type = "text";
  control.value = value;
  return control;
}

function createSelectControl(id, values, selectedValue, emptyLabel = null) {
  const select = createElement("select", { attributes: { id } });
  if (emptyLabel !== null) select.append(createElement("option", { text: emptyLabel, attributes: { value: "" } }));
  for (const value of values) {
    const option = createElement("option", { text: value, attributes: { value: String(value) } });
    if (value === selectedValue) option.selected = true;
    select.append(option);
  }
  return select;
}

function renderReadOnlyProposedSources(analysis) {
  const wrapper = createElement("div", { className: "read-only-sources" });
  wrapper.append(createElement("h3", { text: "Proposed sources — read only" }));
  const list = createElement("div", { className: "source-list" });
  for (const source of availableDraftSources(analysis)) {
    const item = createElement("div", { className: "source" });
    item.append(
      createElement("p", { text: source.name }),
      createElement("a", { className: "source-link", text: "Open proposed source", attributes: { href: source.url, target: "_blank", rel: "noopener noreferrer" } })
    );
    list.append(item);
  }
  wrapper.append(list);
  return wrapper;
}

function fieldChanged(fieldName) {
  if (!currentReview?.workingDraft) return false;
  if (!currentReview.originalDraft) return true;
  return !valuesEqual(currentReview.workingDraft[fieldName], currentReview.originalDraft[fieldName]);
}

function renderPreview(container) {
  container.replaceChildren(createElement("p", { className: "preview-label", text: "EDITORIAL PREVIEW — NOT PUBLISHED" }));
  const draft = currentReview?.workingDraft;
  if (!draft) {
    container.append(createElement("p", { className: "preview-empty", text: "No publication draft proposed at this stage." }));
    return;
  }
  const severity = draft.severity === null ? "Severity not established" : `Severity ${draft.severity}`;
  container.append(
    createElement("p", { className: "preview-meta", text: `${displayValue(draft.category, "Category not set")} · ${severity}` }),
    createElement("h3", { text: displayValue(draft.headline, "Headline not yet written") }),
    createElement("p", { text: displayValue(draft.summary, "Summary not yet written") }),
    createElement("p", { className: "proposed-kicker", text: displayValue(draft.kicker, "Kicker not yet written") })
  );
  const tags = createElement("ul", { className: "tag-list" });
  if (draft.tags.length === 0) tags.append(createElement("li", { text: "No tags yet" }));
  else for (const tag of draft.tags) tags.append(createElement("li", { text: tag }));
  container.append(tags);
}

function approvalFailures() {
  const draft = currentReview?.workingDraft;
  const failures = [];
  if (!draft) return ["Start an editorial draft before approving."];
  if (!STORY_ID_PATTERN.test(draft.id)) failures.push("Story ID must be a lowercase slug using letters, numbers, and single hyphens.");
  if (!draft.headline.trim()) failures.push("Headline is required.");
  if (!draft.summary.trim()) failures.push("Summary is required.");
  if (!draft.kicker.trim()) failures.push("Kicker is required.");
  if (!CATEGORIES.includes(draft.category)) failures.push("Choose a valid category.");
  if (!Number.isInteger(draft.severity) || draft.severity < 1 || draft.severity > 5) failures.push("Choose a severity from 1 through 5.");
  if (draft.tags.length === 0) failures.push("Add at least one topic tag.");
  const sources = availableDraftSources(currentReview.fixture.analysis);
  if (sources.length === 0) failures.push("At least one proposed source is required.");
  else if (sources.some((source) => {
    try {
      const url = new URL(source.url);
      return !source.name?.trim() || (url.protocol !== "http:" && url.protocol !== "https:");
    } catch {
      return true;
    }
  })) failures.push("Every proposed source requires a name and valid HTTP or HTTPS URL.");
  return failures;
}

function invalidateApproval(message = true) {
  const invalidated = currentReview.humanDecision === "approve" || currentReview.approvedAt !== null;
  currentReview.humanDecision = null;
  currentReview.approvedAt = null;
  currentReview.guardrailsAcknowledged = false;
  currentReview.publicationPackage = null;
  currentReview.approvalInvalidated = invalidated && message;
}

function buildPublicationPackage() {
  const analysis = currentReview.fixture.analysis;
  const draft = currentReview.workingDraft;
  return {
    schema_version: "1.0",
    approved_at: currentReview.approvedAt,
    human_decision: "approve",
    source_analysis: {
      intake_id: analysis.intake_id,
      intake_origin: analysis.intake_origin,
      submitted_url: analysis.submitted_url,
      recommendation: analysis.recommendation
    },
    story: {
      id: draft.id,
      content_type: "reporting",
      category: draft.category,
      headline: draft.headline.trim(),
      summary: draft.summary.trim(),
      fml_kicker: draft.kicker.trim(),
      severity: draft.severity,
      topic_tags: [...draft.tags],
      sources: availableDraftSources(analysis).map(({ name, url }) => ({ name, url }))
    },
    editorial_guardrails: {
      do_not_claim: [...analysis.do_not_claim],
      qualification_required: analysis.qualification_required
    }
  };
}

function canPreparePublication() {
  return currentReview.humanDecision === "approve"
    && currentReview.approvedAt !== null
    && currentReview.guardrailsAcknowledged
    && approvalFailures().length === 0;
}

function expectedDecision(recommendation) {
  return recommendation === "publish" ? "approve" : recommendation;
}

function syncEditorialUi(panel, clearErrors = false) {
  const changeState = panel.querySelector("[data-change-state]");
  const dirty = draftChanged();
  changeState.textContent = dirty ? "UNSAVED EDITORIAL CHANGES" : "NO EDITORIAL CHANGES";
  changeState.className = `change-state ${dirty ? "dirty" : "clean"}`;
  for (const marker of panel.querySelectorAll("[data-field-marker]")) {
    const edited = fieldChanged(marker.dataset.fieldMarker);
    marker.textContent = edited ? "Edited" : "Analyzer proposal";
    marker.className = `field-origin${edited ? " edited" : ""}`;
  }
  const decisionState = panel.querySelector("[data-decision-state]");
  if (currentReview.humanDecision === null) {
    decisionState.textContent = "HUMAN DECISION: NOT SET";
    decisionState.className = "decision-state none";
  } else {
    decisionState.textContent = `HUMAN DECISION: ${currentReview.humanDecision.toUpperCase()}`;
    decisionState.className = "decision-state";
  }
  const approvalTimestamp = panel.querySelector("[data-approval-timestamp]");
  approvalTimestamp.textContent = currentReview.approvedAt
    ? `Approval timestamp: ${currentReview.approvedAt}`
    : "Approval timestamp: Not recorded";
  const invalidation = panel.querySelector("[data-approval-invalidation]");
  invalidation.hidden = !currentReview.approvalInvalidated;
  invalidation.textContent = currentReview.approvalInvalidated
    ? "Editorial copy changed after approval. Approval must be recorded again."
    : "";
  for (const button of panel.querySelectorAll("[data-decision]")) {
    button.setAttribute("aria-pressed", String(button.dataset.decision === currentReview.humanDecision));
  }
  const disagreement = panel.querySelector("[data-disagreement]");
  if (currentReview.humanDecision !== null && currentReview.humanDecision !== expectedDecision(currentReview.fixture.analysis.recommendation)) {
    disagreement.hidden = false;
    disagreement.textContent = `ANALYZER: ${recommendationHeading(currentReview.fixture.analysis.recommendation)} · HUMAN: ${currentReview.humanDecision.toUpperCase()}. Human decision differs from analyzer recommendation.`;
  } else {
    disagreement.hidden = true;
    disagreement.textContent = "";
  }
  if (clearErrors) panel.querySelector("[data-approval-errors]").replaceChildren();
  renderPreview(panel.querySelector("[data-editorial-preview]"));
  syncPublicationUi(panel);
}

function renderApprovalErrors(container, failures) {
  container.replaceChildren();
  if (failures.length === 0) return;
  const box = createElement("div", { className: "approval-errors" });
  box.append(createElement("span", { text: "Approval is not ready:" }));
  appendList(box, failures);
  container.append(box);
}

function renderDecisionControls(panel) {
  panel.append(createElement("h3", { text: "Human editorial decision" }));
  panel.append(
    createElement("p", { className: "ephemeral-note", text: "This decision exists only in this browser session. It is not saved and does not publish anything." }),
    createElement("p", { className: "decision-state none", text: "HUMAN DECISION: NOT SET", attributes: { "data-decision-state": "" } }),
    createElement("p", { className: "approval-timestamp", text: "Approval timestamp: Not recorded", attributes: { "data-approval-timestamp": "" } }),
    createElement("p", { className: "approval-invalidation", attributes: { "data-approval-invalidation": "", hidden: "" } }),
    createElement("p", { className: "disagreement-state", attributes: { "data-disagreement": "", hidden: "" } }),
    createElement("div", { attributes: { "data-approval-errors": "", "aria-live": "polite" } })
  );
  const controls = createElement("div", { className: "decision-actions", attributes: { role: "group", "aria-label": "Human editorial decision" } });
  for (const [label, decision] of [["Approve", "approve"], ["Hold", "hold"], ["Reject", "reject"]]) {
    const button = createElement("button", { text: label, attributes: { type: "button", "data-decision": decision, "aria-pressed": "false" } });
    button.addEventListener("click", () => {
      if (decision === "approve") {
        const failures = approvalFailures();
        renderApprovalErrors(panel.querySelector("[data-approval-errors]"), failures);
        if (failures.length > 0) {
          setStatus("Approval was not recorded. Complete the required draft fields.");
          return;
        }
      } else panel.querySelector("[data-approval-errors]").replaceChildren();
      currentReview.humanDecision = decision;
      currentReview.approvedAt = decision === "approve" ? new Date().toISOString() : null;
      currentReview.guardrailsAcknowledged = false;
      currentReview.publicationPackage = null;
      currentReview.approvalInvalidated = false;
      syncEditorialUi(panel);
      setStatus(`Temporary human decision recorded: ${decision.toUpperCase()}. Nothing was saved or published.`);
    });
    controls.append(button);
  }
  const clear = createElement("button", { className: "clear-decision", text: "Clear decision", attributes: { type: "button" } });
  clear.addEventListener("click", () => {
    invalidateApproval(false);
    panel.querySelector("[data-approval-errors]").replaceChildren();
    syncEditorialUi(panel);
    setStatus("Temporary human decision cleared.");
  });
  controls.append(clear);
  panel.append(controls);
}

function renderPublicationPackagePreview(container, pkg) {
  container.replaceChildren(
    createElement("p", { className: "preview-label", text: "PUBLICATION PACKAGE — NOT YET PUBLISHED" }),
    createElement("p", { className: "preview-meta", text: `${pkg.story.id} · ${pkg.story.category} · Severity ${pkg.story.severity}` }),
    createElement("h3", { text: pkg.story.headline }),
    createElement("p", { text: pkg.story.summary }),
    createElement("p", { className: "proposed-kicker", text: pkg.story.fml_kicker }),
    createElement("p", { text: `Approval timestamp: ${pkg.approved_at}` }),
    createElement("p", { text: `Analyzer recommendation: ${recommendationHeading(pkg.source_analysis.recommendation)}` }),
    createElement("p", { text: `Intake origin: ${titleCase(pkg.source_analysis.intake_origin)}` }),
    createElement("p", { text: `Qualification required: ${displayValue(pkg.editorial_guardrails.qualification_required)}` })
  );
  const tags = createElement("ul", { className: "tag-list" });
  for (const tag of pkg.story.topic_tags) tags.append(createElement("li", { text: tag }));
  container.append(tags, createElement("h3", { text: "Sources" }));
  const sources = createElement("ul", { className: "panel-list" });
  for (const source of pkg.story.sources) {
    const item = createElement("li");
    item.append(createElement("a", { text: source.name, attributes: { href: source.url, target: "_blank", rel: "noopener noreferrer" } }));
    sources.append(item);
  }
  container.append(sources, createElement("h3", { text: "DO NOT CLAIM" }));
  appendList(container, pkg.editorial_guardrails.do_not_claim);
}

function downloadPublicationPackage(pkg) {
  const body = `${JSON.stringify(pkg, null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const link = createElement("a", { attributes: { href: url, download: `sbns-publication-${pkg.story.id}.json` } });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function syncPublicationUi(panel) {
  const acknowledgement = panel.querySelector("[data-guardrail-acknowledgement]");
  acknowledgement.checked = currentReview.guardrailsAcknowledged;
  acknowledgement.disabled = currentReview.humanDecision !== "approve";
  const prepare = panel.querySelector("[data-prepare-package]");
  prepare.disabled = !canPreparePublication();
  const download = panel.querySelector("[data-download-package]");
  download.hidden = currentReview.publicationPackage === null;
  panel.querySelector("[data-copy-package]").hidden = currentReview.publicationPackage === null;
  const preview = panel.querySelector("[data-publication-package-preview]");
  if (currentReview.publicationPackage) renderPublicationPackagePreview(preview, currentReview.publicationPackage);
  else preview.replaceChildren();
}

function renderPublicationControls(panel) {
  const section = createElement("section", { className: "publication-controls" });
  section.append(
    createElement("h3", { text: "Publication package" }),
    createElement("p", { className: "ephemeral-note", text: "A package is browser-generated only after human approval. It is not publication and is never sent to a server." })
  );
  const acknowledgementRow = createElement("label", { className: "guardrail-acknowledgement" });
  const acknowledgement = createElement("input", { attributes: { type: "checkbox", "data-guardrail-acknowledgement": "" } });
  acknowledgement.addEventListener("change", () => {
    currentReview.guardrailsAcknowledged = acknowledgement.checked;
    currentReview.publicationPackage = null;
    syncEditorialUi(panel);
  });
  acknowledgementRow.append(acknowledgement, document.createTextNode("I reviewed the DO NOT CLAIM warnings and qualifications for this draft."));
  const actions = createElement("div", { className: "publication-actions" });
  const prepare = createElement("button", { text: "Prepare publication package", attributes: { type: "button", "data-prepare-package": "" } });
  prepare.addEventListener("click", () => {
    if (!canPreparePublication()) return;
    currentReview.publicationPackage = buildPublicationPackage();
    syncPublicationUi(panel);
    setStatus("Publication package prepared locally. Nothing was published or sent to a server.");
  });
  const download = createElement("button", { text: "Download publication package", attributes: { type: "button", "data-download-package": "", hidden: "" } });
  download.addEventListener("click", () => {
    if (currentReview.publicationPackage) downloadPublicationPackage(currentReview.publicationPackage);
  });
  const copy = createElement("button", { text: "Copy publication package", attributes: { type: "button", "data-copy-package": "", hidden: "" } });
  copy.addEventListener("click", async () => {
    if (!currentReview.publicationPackage) return;
    try {
      await navigator.clipboard.writeText(`${JSON.stringify(currentReview.publicationPackage, null, 2)}\n`);
      setStatus("Publication package copied locally. Nothing was published or sent to a server.");
    } catch {
      setStatus("Clipboard access was unavailable. Use Download publication package instead.");
    }
  });
  actions.append(prepare, download, copy);
  section.append(acknowledgementRow, actions, createElement("section", { className: "publication-package-preview", attributes: { "data-publication-package-preview": "", "aria-live": "polite" } }));
  panel.append(section);
}

function bindDraftControl(control, fieldName, panel, transform = (value) => value) {
  control.addEventListener(control.tagName === "SELECT" ? "change" : "input", () => {
    const wasApproved = currentReview.humanDecision === "approve";
    currentReview.workingDraft[fieldName] = transform(control.value);
    if (wasApproved) invalidateApproval();
    else {
      currentReview.publicationPackage = null;
      currentReview.guardrailsAcknowledged = false;
    }
    syncEditorialUi(panel, true);
    setStatus("Editorial draft updated locally. Changes are not saved.");
  });
}

function renderEditorialWorkspace(analysis) {
  const panel = createPanel("Human editorial review", "editorial-workspace");
  panel.append(
    createElement("p", { className: "ephemeral-note", text: "All edits are temporary browser state and disappear on reload. Evidence and analyzer output remain read-only." }),
    createElement("p", { className: "change-state clean", text: "NO EDITORIAL CHANGES", attributes: { "data-change-state": "", "aria-live": "polite" } })
  );
  if (!currentReview.workingDraft) {
    const empty = createElement("div", { className: "draft-empty" });
    empty.append(createElement("p", { text: "No publication draft proposed at this stage." }));
    const start = createElement("button", { text: "Start editorial draft", attributes: { type: "button" } });
    start.addEventListener("click", () => {
      currentReview.workingDraft = neutralDraft(analysis);
      renderCurrentReview();
      setStatus("A temporary editorial draft was started. Analyzer output is unchanged.");
    });
    empty.append(start);
    panel.append(empty);
  } else {
    const draftForm = createElement("form", { className: "editorial-form", attributes: { "aria-label": "Editable proposed story" } });
    draftForm.addEventListener("submit", (event) => event.preventDefault());
    const storyId = createTextControl("editor-story-id", currentReview.workingDraft.id);
    storyId.setAttribute("pattern", "[a-z0-9]+(?:-[a-z0-9]+)*");
    const headline = createTextControl("editor-headline", currentReview.workingDraft.headline);
    const summary = createTextControl("editor-summary", currentReview.workingDraft.summary, true);
    const kicker = createTextControl("editor-kicker", currentReview.workingDraft.kicker, true);
    const category = createSelectControl("editor-category", CATEGORIES, currentReview.workingDraft.category);
    const severity = createSelectControl("editor-severity", [1, 2, 3, 4, 5], currentReview.workingDraft.severity, "Not selected");
    const tags = createTextControl("editor-tags", currentReview.workingDraft.tags.join(", "));
    tags.setAttribute("aria-describedby", "tag-help");
    draftForm.append(createField("Story ID", storyId, "id"), createField("Headline", headline, "headline"), createField("Summary", summary, "summary"), createField("Kicker", kicker, "kicker"));
    const grid = createElement("div", { className: "editorial-grid" });
    grid.append(createField("Category", category, "category"), createField("Severity", severity, "severity"));
    draftForm.append(grid, createField("Tags (comma-separated)", tags, "tags"));
    draftForm.append(createElement("p", { className: "decision-note", text: "Tags are trimmed, empty entries are discarded, and exact duplicates keep their first occurrence.", attributes: { id: "tag-help" } }));
    bindDraftControl(storyId, "id", panel, (value) => value.trim());
    bindDraftControl(headline, "headline", panel);
    bindDraftControl(summary, "summary", panel);
    bindDraftControl(kicker, "kicker", panel);
    bindDraftControl(category, "category", panel);
    bindDraftControl(severity, "severity", panel, (value) => value === "" ? null : Number(value));
    bindDraftControl(tags, "tags", panel, normalizeTags);
    const actions = createElement("div", { className: "editorial-actions" });
    const reset = createElement("button", { text: "Reset to analyzer proposal", attributes: { type: "button" } });
    reset.addEventListener("click", () => {
      invalidateApproval();
      currentReview.workingDraft = currentReview.originalDraft ? structuredClone(currentReview.originalDraft) : null;
      renderCurrentReview();
      setStatus("Editorial copy reset. Any prior approval and guardrail acknowledgement were cleared.");
    });
    actions.append(reset);
    draftForm.append(actions);
    panel.append(draftForm, renderReadOnlyProposedSources(analysis));
  }
  panel.append(createElement("section", { className: "editorial-preview", attributes: { "data-editorial-preview": "", "aria-live": "polite" } }));
  renderDecisionControls(panel);
  renderPublicationControls(panel);
  queueMicrotask(() => syncEditorialUi(panel));
  return panel;
}

function renderCurrentReview() {
  const analysis = currentReview.fixture.analysis;
  result.replaceChildren(
    renderRecommendation(analysis),
    renderReasons(analysis),
    renderDoNotClaim(analysis),
    renderEditorialWorkspace(analysis),
    renderClaims(analysis),
    renderSources(analysis),
    renderConflicts(analysis),
    renderCausation(analysis)
  );
}

function loadFixture(fixture) {
  if (!confirmDiscard()) return false;
  const fixtureCopy = structuredClone(fixture);
  const analyzerDraft = draftFromAnalysis(fixtureCopy.analysis);
  currentReview = {
    fixture: fixtureCopy,
    originalDraft: analyzerDraft ? structuredClone(analyzerDraft) : null,
    workingDraft: analyzerDraft ? structuredClone(analyzerDraft) : null,
    humanDecision: null,
    approvedAt: null,
    guardrailsAcknowledged: false,
    publicationPackage: null,
    approvalInvalidated: false
  };
  urlInput.value = fixtureCopy.request.submitted_url;
  renderCurrentReview();
  setStatus(`Loaded validated ${fixtureCopy.analysis.recommendation.toUpperCase()} demonstration fixture. Human decision is not set.`);
  return true;
}

function renderUnconnectedState() {
  const panel = createElement("section", { className: "panel neutral-state" });
  panel.append(
    createElement("strong", { text: "LIVE ANALYZER NOT CONNECTED" }),
    createElement("p", { text: "The URL was accepted, but Phase C does not perform live research. No editorial recommendation has been generated for this URL." })
  );
  currentReview = null;
  result.replaceChildren(panel);
  setStatus("Valid URL accepted. No analysis was performed and no draft was created.");
}

function handleUrl(value) {
  let normalized;
  try {
    normalized = normalizeUrl(value);
  } catch (error) {
    setStatus(error.message);
    return;
  }
  const fixture = fixtureByUrl.get(normalized);
  if (fixture) loadFixture(fixture);
  else if (confirmDiscard()) renderUnconnectedState();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!urlInput.checkValidity()) {
    setStatus("Enter a valid HTTP or HTTPS URL.");
    return;
  }
  handleUrl(urlInput.value);
});

urlInput.addEventListener("invalid", () => setStatus("Enter a valid HTTP or HTTPS URL."));

for (const button of demoButtons) {
  button.disabled = true;
  button.addEventListener("click", () => {
    const fixture = fixtureByRecommendation.get(button.dataset.demo);
    if (fixture) loadFixture(fixture);
  });
}

async function loadFixtures() {
  try {
    const response = await fetch(FIXTURE_BUNDLE_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Fixture bundle returned HTTP ${response.status}.`);
    const bundle = await response.json();
    if (bundle.schema_version !== "1.0" || !Array.isArray(bundle.fixtures)) throw new Error("Fixture bundle format is invalid.");
    for (const fixture of bundle.fixtures) {
      fixtureByRecommendation.set(fixture.analysis.recommendation, fixture);
      fixtureByUrl.set(normalizeUrl(fixture.request.submitted_url), fixture);
    }
    for (const button of demoButtons) button.disabled = false;
    setStatus("Validated demonstration fixtures are ready. Paste a matching URL or load an example.");
  } catch (error) {
    setStatus(`Unable to load demonstration fixtures: ${error.message}`);
  }
}

loadFixtures();
