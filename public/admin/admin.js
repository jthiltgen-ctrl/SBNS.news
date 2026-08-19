"use strict";

const FIXTURE_BUNDLE_URL = "/admin/intake-fixtures.json";
const fixtureByRecommendation = new Map();
const fixtureByUrl = new Map();

const form = document.querySelector("#intake-form");
const urlInput = document.querySelector("#submitted-url");
const status = document.querySelector("#intake-status");
const result = document.querySelector("#intake-result");
const demoButtons = [...document.querySelectorAll("[data-demo]")];

function createElement(tagName, options = {}) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    node.setAttribute(name, value);
  }
  return node;
}

function displayValue(value, neutral = "—") {
  if (value === null || value === undefined || value === "") return neutral;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function titleCase(value) {
  if (value === null || value === undefined) return "—";
  return String(value)
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS source URLs are accepted.");
  }
  url.hash = "";
  return url.href;
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

function renderRecommendation(analysis) {
  const card = createElement("section", {
    className: `recommendation-card ${analysis.recommendation}`,
    attributes: { "aria-labelledby": "recommendation-title" }
  });
  card.append(
    createElement("p", { className: "card-label", text: "Editorial recommendation" }),
    createElement("h2", {
      className: "recommendation-title",
      text: recommendationHeading(analysis.recommendation),
      attributes: { id: "recommendation-title" }
    })
  );

  const metrics = [
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
  panel.append(createElement("p", { text: analysis.why_sbns }));

  panel.append(createElement("h3", { text: "Recommendation reasons" }));
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
      createElement("span", {
        className: `claim-state ${claim.verification_status}`,
        text: titleCase(claim.verification_status)
      }),
      createElement("span", {
        className: "claim-state",
        text: claim.material ? "Material" : "Non-material"
      })
    );
    card.append(meta, createElement("p", { text: claim.claim_text }));

    const qualification = createElement("p", { className: "qualification" });
    qualification.append(
      createElement("strong", { text: "Qualification: " }),
      document.createTextNode(displayValue(claim.qualification, "None recorded"))
    );
    card.append(qualification);

    const conflict = createElement("p");
    conflict.append(
      createElement("strong", { text: "Conflict: " }),
      document.createTextNode(claim.conflict ? "Recorded" : "None recorded")
    );
    card.append(conflict);

    const sourceRefs = claim.source_refs.map((sourceId) => sourcesById.get(sourceId) ?? sourceId);
    const supporting = createElement("p");
    supporting.append(
      createElement("strong", { text: "Supporting sources: " }),
      document.createTextNode(sourceRefs.join("; "))
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

    for (const [label, value] of [
      ["Authority", source.authority],
      ["Recency", source.recency],
      ["Claims supported", source.claims_supported.join(", ")]
    ]) {
      const item = createElement("p");
      item.append(createElement("strong", { text: `${label}: ` }), document.createTextNode(value));
      card.append(item);
    }

    card.append(
      createElement("a", {
        className: "source-link",
        text: "Open external source",
        attributes: {
          href: source.url,
          target: "_blank",
          rel: "noopener noreferrer"
        }
      })
    );
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

function hasProposedStory(analysis) {
  return Boolean(analysis.proposed_headline && analysis.proposed_summary && analysis.proposed_fml_kicker);
}

function renderProposedStory(analysis) {
  const panel = createPanel("Proposed story");
  if (!hasProposedStory(analysis)) {
    panel.append(createElement("p", { text: "No publication draft proposed at this stage." }));
    return panel;
  }

  panel.append(
    createElement("p", { className: "card-label", text: `${analysis.category} · Severity ${analysis.severity}` }),
    createElement("h3", { text: analysis.proposed_headline }),
    createElement("p", { text: analysis.proposed_summary }),
    createElement("p", { className: "proposed-kicker", text: analysis.proposed_fml_kicker })
  );

  const tagsHeading = createElement("h3", { text: "Topic tags" });
  const tags = createElement("ul", { className: "tag-list" });
  for (const tag of analysis.proposed_topic_tags) tags.append(createElement("li", { text: tag }));
  panel.append(tagsHeading, tags, createElement("h3", { text: "Proposed sources" }));

  const sourceList = createElement("div", { className: "source-list" });
  for (const source of analysis.proposed_sources) {
    const item = createElement("div", { className: "source" });
    item.append(
      createElement("p", { text: source.name }),
      createElement("a", {
        className: "source-link",
        text: "Open proposed source",
        attributes: {
          href: source.url,
          target: "_blank",
          rel: "noopener noreferrer"
        }
      })
    );
    sourceList.append(item);
  }
  panel.append(sourceList);
  return panel;
}

function renderDecisionControls() {
  const panel = createPanel("Decision actions");
  panel.append(
    createElement("p", {
      className: "decision-note",
      text: "Decision actions are disabled in the read-only Phase B prototype."
    })
  );
  const controls = createElement("div", { className: "decision-actions" });
  for (const label of ["Approve & Publish", "Hold", "Reject"]) {
    const button = createElement("button", { text: label, attributes: { type: "button" } });
    button.disabled = true;
    controls.append(button);
  }
  panel.append(controls);
  return panel;
}

function renderFixture(fixture) {
  const { analysis } = fixture;
  result.replaceChildren(
    renderRecommendation(analysis),
    renderReasons(analysis),
    renderDoNotClaim(analysis),
    renderClaims(analysis),
    renderSources(analysis),
    renderConflicts(analysis),
    renderCausation(analysis),
    renderProposedStory(analysis),
    renderDecisionControls()
  );
  setStatus(`Loaded validated ${analysis.recommendation.toUpperCase()} demonstration fixture.`);
}

function renderUnconnectedState() {
  const panel = createElement("section", { className: "panel neutral-state" });
  panel.append(
    createElement("strong", { text: "LIVE ANALYZER NOT CONNECTED" }),
    createElement("p", {
      text: "The URL was accepted, but Phase B does not perform live research. No editorial recommendation has been generated for this URL."
    })
  );
  result.replaceChildren(panel);
  setStatus("Valid URL accepted. No analysis was performed.");
}

function handleUrl(value) {
  let normalized;
  try {
    normalized = normalizeUrl(value);
  } catch (error) {
    result.replaceChildren();
    setStatus(error.message);
    return;
  }

  const fixture = fixtureByUrl.get(normalized);
  if (fixture) renderFixture(fixture);
  else renderUnconnectedState();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!urlInput.checkValidity()) {
    result.replaceChildren();
    setStatus("Enter a valid HTTP or HTTPS URL.");
    return;
  }
  handleUrl(urlInput.value);
});

urlInput.addEventListener("invalid", () => {
  setStatus("Enter a valid HTTP or HTTPS URL.");
});

for (const button of demoButtons) {
  button.disabled = true;
  button.addEventListener("click", () => {
    const fixture = fixtureByRecommendation.get(button.dataset.demo);
    if (!fixture) return;
    urlInput.value = fixture.request.submitted_url;
    renderFixture(fixture);
  });
}

async function loadFixtures() {
  try {
    const response = await fetch(FIXTURE_BUNDLE_URL, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Fixture bundle returned HTTP ${response.status}.`);
    const bundle = await response.json();
    if (bundle.schema_version !== "1.0" || !Array.isArray(bundle.fixtures)) {
      throw new Error("Fixture bundle format is invalid.");
    }

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
