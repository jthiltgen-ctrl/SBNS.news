import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_STORY_VISUALS = 3;

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RECEIPT_PRESENTATIONS = new Set([
  "quote",
  "paraphrase",
  "finding",
  "provision",
  "response",
  "record",
]);
const NUMBER_KINDS = new Set([
  "count",
  "currency",
  "percentage",
  "ratio",
  "rate",
  "duration",
  "other",
]);
const NUMBER_PRECISIONS = new Set([
  "exact",
  "estimated",
  "projected",
  "budgeted",
  "sampled",
  "approximate",
]);
const TIMELINE_PRECISIONS = new Set(["year", "month", "day"]);
const RATIO_KINDS = new Set(["percentage", "ratio", "rate"]);
const NUMERIC_STRING = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const COMPONENT_LABELS = Object.freeze({
  receipt: "Receipt",
  number: "Number",
  timeline: "Timeline",
});
const PRESENTATION_LABELS = Object.freeze({
  quote: "Quoted source text",
  paraphrase: "Paraphrase",
  finding: "Finding",
  provision: "Provision",
  response: "Response",
  record: "Record detail",
});
const PRECISION_LABELS = Object.freeze({
  exact: "Exact",
  estimated: "Estimated",
  projected: "Projected",
  budgeted: "Budgeted",
  sampled: "Sampled",
  approximate: "Approximate",
});

const RECEIPT_KEYS = new Set([
  "id",
  "type",
  "label",
  "title",
  "body",
  "presentation",
  "source_id",
  "source_locator",
  "context",
]);
const NUMBER_KEYS = new Set([
  "id",
  "type",
  "label",
  "title",
  "kind",
  "value",
  "unit",
  "display_value",
  "description",
  "period",
  "denominator",
  "scope",
  "precision",
  "qualification",
  "source_id",
  "source_locator",
  "comparison",
]);
const COMPARISON_KEYS = new Set([
  "value",
  "display_value",
  "context",
  "source_id",
  "source_locator",
]);
const TIMELINE_KEYS = new Set(["id", "type", "label", "title", "events"]);
const TIMELINE_EVENT_KEYS = new Set([
  "id",
  "date",
  "date_precision",
  "display_date",
  "event",
  "source_id",
  "source_locator",
  "qualification",
  "approximate",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function checkKeys(value, allowed, location, issue) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issue(`${location} has unsupported field "${key}"`);
  }
}

function checkString(value, location, issue, { maximum } = {}) {
  if (!isNonEmptyString(value)) {
    issue(`${location} must be a non-empty string`);
    return;
  }
  if (maximum !== undefined && value.length > maximum) {
    issue(`${location} must be ${maximum} characters or fewer`);
  }
}

function checkOptionalString(value, location, issue, options) {
  if (value !== undefined) checkString(value, location, issue, options);
}

function checkId(value, location, issue) {
  if (!isNonEmptyString(value) || !ID_PATTERN.test(value) || value.length > 80) {
    issue(`${location} must be a lowercase story-local identifier`);
  }
}

function checkNumericString(value, location, issue) {
  if (typeof value !== "string" || !NUMERIC_STRING.test(value)) {
    issue(`${location} must be a finite decimal encoded as a string`);
  }
}

function sourceIdSet(story, issue) {
  const ids = new Set();
  if (!Array.isArray(story.sources)) return ids;
  story.sources.forEach((source, index) => {
    if (!isObject(source) || !Object.hasOwn(source, "id")) return;
    const location = `"sources[${index}].id"`;
    checkId(source.id, location, issue);
    if (ids.has(source.id)) issue(`${location} duplicates source id "${source.id}"`);
    ids.add(source.id);
  });
  return ids;
}

function checkSourceReference(sourceId, location, sourceIds, issue) {
  checkId(sourceId, location, issue);
  if (isNonEmptyString(sourceId) && !sourceIds.has(sourceId)) {
    issue(`${location} references nonexistent story source "${sourceId}"`);
  }
}

function dateParts(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (year < 1 || year > 9999) return null;
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null) {
    const candidate = new Date(Date.UTC(0, month - 1, day));
    candidate.setUTCFullYear(year);
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() + 1 !== month ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }
  }
  return { year, month, day };
}

function structuralDatePrecision(parts) {
  if (parts.day !== null) return "day";
  if (parts.month !== null) return "month";
  return "year";
}

function dateSortKey(parts) {
  return parts.year * 10_000 + (parts.month ?? 0) * 100 + (parts.day ?? 0);
}

function validateReceipt(visual, location, sourceIds, issue) {
  checkKeys(visual, RECEIPT_KEYS, location, issue);
  checkString(visual.body, `${location}.body`, issue, { maximum: 1_200 });
  if (!RECEIPT_PRESENTATIONS.has(visual.presentation)) {
    issue(`${location}.presentation must be quote, paraphrase, finding, provision, response, or record`);
  }
  if (visual.presentation === "quote" && isNonEmptyString(visual.body) && visual.body.length > 500) {
    issue(`${location}.body quoted source text must be 500 characters or fewer`);
  }
  checkSourceReference(visual.source_id, `${location}.source_id`, sourceIds, issue);
  checkOptionalString(visual.title, `${location}.title`, issue, { maximum: 140 });
  checkOptionalString(visual.source_locator, `${location}.source_locator`, issue, { maximum: 300 });
  checkOptionalString(visual.context, `${location}.context`, issue, { maximum: 700 });
}

function validateComparison(comparison, location, sourceIds, issue) {
  if (!isObject(comparison)) {
    issue(`${location} must be an object`);
    return;
  }
  checkKeys(comparison, COMPARISON_KEYS, location, issue);
  checkNumericString(comparison.value, `${location}.value`, issue);
  checkString(comparison.display_value, `${location}.display_value`, issue, { maximum: 80 });
  checkString(comparison.context, `${location}.context`, issue, { maximum: 500 });
  checkSourceReference(comparison.source_id, `${location}.source_id`, sourceIds, issue);
  checkOptionalString(comparison.source_locator, `${location}.source_locator`, issue, { maximum: 300 });
}

function validateNumber(visual, location, sourceIds, issue) {
  checkKeys(visual, NUMBER_KEYS, location, issue);
  if (!NUMBER_KINDS.has(visual.kind)) {
    issue(`${location}.kind must be count, currency, percentage, ratio, rate, duration, or other`);
  }
  checkNumericString(visual.value, `${location}.value`, issue);
  checkString(visual.unit, `${location}.unit`, issue, { maximum: 100 });
  checkString(visual.display_value, `${location}.display_value`, issue, { maximum: 80 });
  checkString(visual.description, `${location}.description`, issue, { maximum: 700 });
  checkString(visual.scope, `${location}.scope`, issue, { maximum: 500 });
  if (!NUMBER_PRECISIONS.has(visual.precision)) {
    issue(`${location}.precision must describe whether the value is exact, estimated, projected, budgeted, sampled, or approximate`);
  }
  if (RATIO_KINDS.has(visual.kind) && !isNonEmptyString(visual.denominator)) {
    issue(`${location}.denominator is required for percentage, ratio, and rate values`);
  }
  checkSourceReference(visual.source_id, `${location}.source_id`, sourceIds, issue);
  checkOptionalString(visual.title, `${location}.title`, issue, { maximum: 140 });
  checkOptionalString(visual.period, `${location}.period`, issue, { maximum: 300 });
  checkOptionalString(visual.denominator, `${location}.denominator`, issue, { maximum: 500 });
  checkOptionalString(visual.qualification, `${location}.qualification`, issue, { maximum: 700 });
  checkOptionalString(visual.source_locator, `${location}.source_locator`, issue, { maximum: 300 });
  if (Object.hasOwn(visual, "comparison")) {
    validateComparison(visual.comparison, `${location}.comparison`, sourceIds, issue);
  }
}

function validateTimeline(visual, location, sourceIds, issue) {
  checkKeys(visual, TIMELINE_KEYS, location, issue);
  checkOptionalString(visual.title, `${location}.title`, issue, { maximum: 140 });
  if (!Array.isArray(visual.events) || visual.events.length === 0) {
    issue(`${location}.events must contain at least one event`);
    return;
  }
  const eventIds = new Set();
  let previousSortKey = -Infinity;
  visual.events.forEach((event, index) => {
    const eventLocation = `${location}.events[${index}]`;
    if (!isObject(event)) {
      issue(`${eventLocation} must be an object`);
      return;
    }
    checkKeys(event, TIMELINE_EVENT_KEYS, eventLocation, issue);
    checkId(event.id, `${eventLocation}.id`, issue);
    if (eventIds.has(event.id)) issue(`${eventLocation}.id duplicates timeline event id "${event.id}"`);
    eventIds.add(event.id);
    const parts = dateParts(event.date);
    if (!parts) {
      issue(`${eventLocation}.date must be a possible ISO year, month, or day`);
    } else {
      const actualPrecision = structuralDatePrecision(parts);
      if (!TIMELINE_PRECISIONS.has(event.date_precision)) {
        issue(`${eventLocation}.date_precision must be year, month, or day`);
      } else if (actualPrecision !== event.date_precision) {
        issue(`${eventLocation}.date precision does not match date_precision "${event.date_precision}"`);
      }
      const sortKey = dateSortKey(parts);
      if (sortKey < previousSortKey) {
        issue(`${location}.events must be in deterministic chronological order`);
      }
      previousSortKey = Math.max(previousSortKey, sortKey);
    }
    checkString(event.display_date, `${eventLocation}.display_date`, issue, { maximum: 100 });
    checkString(event.event, `${eventLocation}.event`, issue, { maximum: 800 });
    checkSourceReference(event.source_id, `${eventLocation}.source_id`, sourceIds, issue);
    checkOptionalString(event.source_locator, `${eventLocation}.source_locator`, issue, { maximum: 300 });
    checkOptionalString(event.qualification, `${eventLocation}.qualification`, issue, { maximum: 700 });
    if (event.approximate !== undefined && typeof event.approximate !== "boolean") {
      issue(`${eventLocation}.approximate must be boolean when present`);
    }
  });
}

export function validateStoryEvidence(story) {
  const errors = [];
  const issue = (message) => errors.push(message);
  const sourceIds = sourceIdSet(story, issue);
  if (!Object.hasOwn(story, "visuals")) return errors;
  if (!Array.isArray(story.visuals)) {
    issue('"visuals" must be an array');
    return errors;
  }
  if (story.visuals.length > MAX_STORY_VISUALS) {
    issue(`"visuals" may contain no more than ${MAX_STORY_VISUALS} evidence components`);
  }
  const visualIds = new Set();
  story.visuals.forEach((visual, index) => {
    const location = `"visuals[${index}]"`;
    if (!isObject(visual)) {
      issue(`${location} must be an object`);
      return;
    }
    checkId(visual.id, `${location}.id`, issue);
    if (visualIds.has(visual.id)) issue(`${location}.id duplicates visual id "${visual.id}"`);
    visualIds.add(visual.id);
    if (!Object.hasOwn(COMPONENT_LABELS, visual.type)) {
      issue(`${location}.type must be receipt, number, or timeline`);
      return;
    }
    if (visual.label !== COMPONENT_LABELS[visual.type]) {
      issue(`${location}.label must be "${COMPONENT_LABELS[visual.type]}"`);
    }
    if (visual.type === "receipt") validateReceipt(visual, location, sourceIds, issue);
    if (visual.type === "number") validateNumber(visual, location, sourceIds, issue);
    if (visual.type === "timeline") validateTimeline(visual, location, sourceIds, issue);
  });
  return errors;
}

function copyOptional(target, source, keys) {
  for (const key of keys) {
    if (Object.hasOwn(source, key)) target[key] = source[key];
  }
  return target;
}

export function normalizeSource(source) {
  const normalized = {};
  if (Object.hasOwn(source, "id")) normalized.id = source.id;
  normalized.name = source.name;
  normalized.url = source.url;
  return normalized;
}

function normalizeComparison(comparison) {
  return copyOptional(
    {
      value: comparison.value,
      display_value: comparison.display_value,
      context: comparison.context,
      source_id: comparison.source_id,
    },
    comparison,
    ["source_locator"],
  );
}

function normalizeVisual(visual) {
  if (visual.type === "receipt") {
    return copyOptional(
      {
        id: visual.id,
        type: visual.type,
        label: visual.label,
        body: visual.body,
        presentation: visual.presentation,
        source_id: visual.source_id,
      },
      visual,
      ["title", "source_locator", "context"],
    );
  }
  if (visual.type === "number") {
    const normalized = copyOptional(
      {
        id: visual.id,
        type: visual.type,
        label: visual.label,
        kind: visual.kind,
        value: visual.value,
        unit: visual.unit,
        display_value: visual.display_value,
        description: visual.description,
        scope: visual.scope,
        precision: visual.precision,
        source_id: visual.source_id,
      },
      visual,
      ["title", "period", "denominator", "qualification", "source_locator"],
    );
    if (Object.hasOwn(visual, "comparison")) normalized.comparison = normalizeComparison(visual.comparison);
    return normalized;
  }
  return copyOptional(
    {
      id: visual.id,
      type: visual.type,
      label: visual.label,
      events: visual.events.map((event) =>
        copyOptional(
          {
            id: event.id,
            date: event.date,
            date_precision: event.date_precision,
            display_date: event.display_date,
            event: event.event,
            source_id: event.source_id,
          },
          event,
          ["source_locator", "qualification", "approximate"],
        ),
      ),
    },
    visual,
    ["title"],
  );
}

export function normalizeVisuals(visuals) {
  return visuals.map(normalizeVisual);
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sourceMarkup(source, locator, label = "Source") {
  const name = escapeHtml(source.name);
  const identity = typeof source.url === "string" && /^https?:\/\//.test(source.url)
    ? `<a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${name}</a>`
    : `<span>${name}</span>`;
  const locatorMarkup = locator
    ? `\n              <span class="evidence-source-locator"><span>Locator:</span> ${escapeHtml(locator)}</span>`
    : "";
  return `            <footer class="evidence-source">
              <span class="evidence-source-label">${label}</span>
              ${identity}${locatorMarkup}
            </footer>`;
}

function optionalTitle(visual) {
  return visual.title ? `\n            <h3>${escapeHtml(visual.title)}</h3>` : "";
}

function renderReceipt(visual, sources) {
  const body = visual.presentation === "quote"
    ? `            <blockquote><p>${escapeHtml(visual.body)}</p></blockquote>`
    : `            <p class="evidence-body">${escapeHtml(visual.body)}</p>`;
  const context = visual.context
    ? `\n            <div class="evidence-qualification"><h3>Context</h3><p>${escapeHtml(visual.context)}</p></div>`
    : "";
  return `          <article class="evidence-component evidence-receipt" id="${visual.id}">
            <header class="evidence-header">
              <h2 class="evidence-label">${visual.label}</h2>${optionalTitle(visual)}
              <p class="evidence-presentation">${PRESENTATION_LABELS[visual.presentation]}</p>
            </header>
${body}${context}
${sourceMarkup(sources.get(visual.source_id), visual.source_locator)}
          </article>`;
}

function detail(label, value) {
  return value === undefined ? "" : `\n              <dt>${label}</dt><dd>${escapeHtml(value)}</dd>`;
}

function renderNumber(visual, sources) {
  const comparison = visual.comparison
    ? `\n            <section class="evidence-comparison" aria-label="Comparison">
              <h3>Comparison</h3>
              <p><strong>${escapeHtml(visual.comparison.display_value)}</strong> — ${escapeHtml(visual.comparison.context)}</p>
${sourceMarkup(sources.get(visual.comparison.source_id), visual.comparison.source_locator, "Comparison source")}
            </section>`
    : "";
  const qualification = visual.qualification
    ? `\n            <div class="evidence-qualification"><h3>Qualification</h3><p>${escapeHtml(visual.qualification)}</p></div>`
    : "";
  return `          <article class="evidence-component evidence-number" id="${visual.id}">
            <header class="evidence-header">
              <h2 class="evidence-label">${visual.label}</h2>${optionalTitle(visual)}
            </header>
            <p class="evidence-number-value"><span class="visually-hidden">Highlighted value: </span><span class="evidence-number-display">${escapeHtml(visual.display_value)}</span></p>
            <p class="evidence-number-unit">${escapeHtml(visual.unit)}</p>
            <p class="evidence-body">${escapeHtml(visual.description)}</p>
            <dl class="evidence-details">${detail("Period", visual.period)}${detail("Scope", visual.scope)}${detail("Denominator / base", visual.denominator)}${detail("Precision", PRECISION_LABELS[visual.precision])}
            </dl>${qualification}${comparison}
${sourceMarkup(sources.get(visual.source_id), visual.source_locator)}
          </article>`;
}

function renderTimeline(visual, sources) {
  const events = visual.events.map((event) => {
    const approximation = event.approximate
      ? '\n                <span class="timeline-date-qualification">Approximate date</span>'
      : "";
    const qualification = event.qualification
      ? `\n              <div class="evidence-qualification"><h4>Qualification</h4><p>${escapeHtml(event.qualification)}</p></div>`
      : "";
    return `            <li class="evidence-timeline-event" id="${visual.id}-${event.id}">
              <div class="evidence-timeline-date">
                <h3><time datetime="${escapeHtml(event.date)}">${escapeHtml(event.display_date)}</time></h3>${approximation}
              </div>
              <div class="evidence-timeline-detail">
                <p class="timeline-event">${escapeHtml(event.event)}</p>${qualification}
${sourceMarkup(sources.get(event.source_id), event.source_locator)}
              </div>
            </li>`;
  }).join("\n");
  return `          <article class="evidence-component evidence-timeline" id="${visual.id}">
            <header class="evidence-header">
              <h2 class="evidence-label">${visual.label}</h2>${optionalTitle(visual)}
            </header>
            <ol class="evidence-timeline-list">
${events}
            </ol>
          </article>`;
}

export function renderStoryEvidence(story) {
  if (!Array.isArray(story.visuals) || story.visuals.length === 0) return "";
  const errors = validateStoryEvidence(story);
  if (errors.length > 0) throw new Error(`Cannot render invalid story evidence: ${errors.join("; ")}`);
  const sources = new Map(story.sources.filter((source) => source.id).map((source) => [source.id, source]));
  const rendered = story.visuals.map((visual) => {
    if (visual.type === "receipt") return renderReceipt(visual, sources);
    if (visual.type === "number") return renderNumber(visual, sources);
    return renderTimeline(visual, sources);
  }).join("\n");
  return `\n        <section class="story-evidence" aria-label="Evidence">\n${rendered}\n        </section>\n`;
}

export function syntheticEvidenceVisuals() {
  return [
    {
      id: "receipt-1",
      type: "receipt",
      label: "Receipt",
      title: "Synthetic audit finding",
      body: "The synthetic review found that the demonstration program lacked a documented approval step.",
      presentation: "paraphrase",
      source_id: "source-1",
      source_locator: "Synthetic finding 2, page 7",
      context: "Synthetic fixture only. The finding applies only to the demonstration sample reviewed.",
    },
    {
      id: "number-1",
      type: "number",
      label: "Number",
      title: "Synthetic reviewed sample",
      kind: "percentage",
      value: "25",
      unit: "percent of reviewed synthetic records",
      display_value: "25%",
      description: "Five of 20 synthetic records in the demonstration sample lacked the required field.",
      period: "Synthetic review period: January–March 2026",
      denominator: "20 synthetic records reviewed",
      scope: "Demonstration program fixture only",
      precision: "sampled",
      qualification: "The sample does not establish a rate outside the synthetic records reviewed.",
      source_id: "source-1",
      source_locator: "Synthetic table 3",
    },
    {
      id: "timeline-1",
      type: "timeline",
      label: "Timeline",
      title: "Synthetic documented sequence",
      events: [
        {
          id: "event-1",
          date: "2025",
          date_precision: "year",
          display_date: "2025",
          event: "A synthetic requirement was established for the demonstration program.",
          source_id: "source-2",
          source_locator: "Synthetic provision 4",
        },
        {
          id: "event-2",
          date: "2026-03",
          date_precision: "month",
          display_date: "March 2026",
          event: "A synthetic review documented the demonstration result.",
          source_id: "source-1",
          source_locator: "Synthetic report date",
          qualification: "Chronology alone does not establish that the earlier event caused the later result.",
          approximate: true,
        },
      ],
    },
  ];
}

function fixtureStory(overrides = {}) {
  return {
    sources: [
      { id: "source-1", name: "Synthetic inspector report", url: "https://example.com/synthetic-report" },
      { id: "source-2", name: "Synthetic policy record", url: "https://example.com/synthetic-policy" },
    ],
    visuals: syntheticEvidenceVisuals(),
    ...overrides,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectInvalid(story, expected) {
  const errors = validateStoryEvidence(story);
  assert(errors.some((error) => error.includes(expected)), `Expected "${expected}", got: ${errors.join("; ")}`);
}

function runTests() {
  assert(validateStoryEvidence({ sources: [] }).length === 0, "A story without visuals did not pass");
  assert(validateStoryEvidence({ sources: [], visuals: [] }).length === 0, "An empty visuals array did not pass");
  const valid = fixtureStory();
  assert(validateStoryEvidence(valid).length === 0, "The mixed three-component fixture is invalid");
  for (const count of [1, 2, 3]) {
    assert(validateStoryEvidence(fixtureStory({ visuals: syntheticEvidenceVisuals().slice(0, count) })).length === 0, `${count} visual(s) did not pass`);
  }
  expectInvalid(fixtureStory({ visuals: [...syntheticEvidenceVisuals(), syntheticEvidenceVisuals()[0]] }), "no more than 3");
  expectInvalid(fixtureStory({ visuals: [{ id: "chart-1", type: "chart", label: "Chart" }] }), ".type must be receipt, number, or timeline");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[0], body: "" }] }), ".body must be a non-empty string");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[0], body: "", presentation: "quote" }] }), ".body must be a non-empty string");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[0], presentation: "dramatic-quote" }] }), ".presentation must be quote");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[0], source_id: undefined }] }), ".source_id must be a lowercase story-local identifier");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[0], source_id: "missing-source" }] }), "references nonexistent story source");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[0], source_locator: "" }] }), ".source_locator must be a non-empty string");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[1], value: "twenty-five" }] }), ".value must be a finite decimal");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[1], value: undefined }] }), ".value must be a finite decimal");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[1], description: "" }] }), ".description must be a non-empty string");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[1], denominator: undefined }] }), ".denominator is required");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[1], display_value: "" }] }), ".display_value must be a non-empty string");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[1], comparison: { value: "30", display_value: "30%", source_id: "source-2" } }] }), ".comparison.context must be a non-empty string");
  expectInvalid(fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[2], events: [] }] }), ".events must contain at least one event");
  const timeline = syntheticEvidenceVisuals()[2];
  expectInvalid(fixtureStory({ visuals: [{ ...timeline, events: [{ ...timeline.events[0], event: "" }] }] }), ".event must be a non-empty string");
  expectInvalid(fixtureStory({ visuals: [{ ...timeline, events: [{ ...timeline.events[0], source_id: "missing-source" }] }] }), "references nonexistent story source");
  expectInvalid(fixtureStory({ visuals: [{ ...timeline, events: [{ ...timeline.events[0], date: "2026-02-30", date_precision: "day" }] }] }), ".date must be a possible ISO year, month, or day");
  expectInvalid(fixtureStory({ visuals: [{ ...timeline, events: [{ ...timeline.events[0], date: "2026-03", date_precision: "day" }] }] }), "date precision does not match");
  expectInvalid(fixtureStory({ visuals: [{ ...timeline, events: timeline.events.toReversed() }] }), "deterministic chronological order");
  const sharedSource = syntheticEvidenceVisuals().slice(0, 2).map((visual) => ({ ...visual, source_id: "source-1" }));
  assert(validateStoryEvidence(fixtureStory({ visuals: sharedSource })).length === 0, "Multiple components could not use one source");
  const rendered = renderStoryEvidence(valid);
  assert(rendered.indexOf('id="receipt-1"') < rendered.indexOf('id="number-1"') && rendered.indexOf('id="number-1"') < rendered.indexOf('id="timeline-1"'), "Explicit visual order was not preserved");
  assert(rendered.includes("Synthetic finding 2, page 7"), "Source locator was not retained");
  assert(rendered.includes("Qualification") && rendered.includes("sample does not establish"), "Material qualification was not retained");
  for (const requiredNumberText of [
    "25%",
    "percent of reviewed synthetic records",
    "January–March 2026",
    "20 synthetic records reviewed",
    "Demonstration program fixture only",
    "Synthetic table 3",
  ]) {
    assert(rendered.includes(requiredNumberText), `Number rendering lost required context: ${requiredNumberText}`);
  }
  assert(rendered.includes('<ol class="evidence-timeline-list">') && rendered.includes('<time datetime="2025">2025</time>'), "Timeline lacks semantic chronology");
  assert(rendered.includes("Approximate date"), "Timeline date approximation was not retained visibly");
  assert(
    rendered.includes("Synthetic policy record") && rendered.includes("Synthetic inspector report"),
    "Granular Timeline event provenance was not rendered",
  );
  assert(rendered === renderStoryEvidence(valid), "Evidence rendering is not deterministic");
  const quoted = fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[0], presentation: "quote" }] });
  assert(renderStoryEvidence(quoted).includes("<blockquote>"), "A quotation did not render with quotation semantics");
  assert(!rendered.includes("<blockquote>"), "A paraphrase rendered as a quotation");
  const unsafe = fixtureStory({ visuals: [{ ...syntheticEvidenceVisuals()[0], body: '<script>alert("visual")</script>' }] });
  const unsafeRendered = renderStoryEvidence(unsafe);
  assert(unsafeRendered.includes("&lt;script&gt;"), "Evidence text was not escaped");
  assert(!unsafeRendered.includes('<script>alert("visual")'), "Evidence text injected executable HTML");
  assert(renderStoryEvidence({ sources: [], visuals: [] }) === "", "Empty visuals emitted reader filler");
  console.log("Evidence grammar tests passed: schema, malformed input, provenance, 0/1/2/3/4 limits, Receipt, Number, Timeline, order, semantics, escaping, and determinism.");
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  if (process.argv[2] !== "test") {
    console.error("Usage: node scripts/evidence.mjs test");
    process.exitCode = 1;
  } else {
    try {
      runTests();
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
