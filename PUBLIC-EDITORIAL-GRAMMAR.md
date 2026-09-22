# Public Editorial Grammar

Status: implemented infrastructure; first bounded real-story pilot in use

## Purpose and authority

Receipt, Number, and Timeline are optional, story-local ways to make approved
evidence easier to inspect. They are generated from the same
`content/stories/*.json` record as the rest of a published story. They do not
create a second public-content source, and D1 remains editorial workflow state
only.

**Receipt · Number · Timeline are evidence-presentation tools, not truth
scores.** Source authority remains claim-specific. **Chronology does not
establish causation.** **Visual prominence does not strengthen weak evidence.**
Signal Red marks a component label and a small inspection rule; it never means
truth, certainty, source quality, guilt, or institutional culpability.

Only a human-approved component included in approved story JSON is public:

```text
AI proposal != evidence
candidate != approved editorial object
approved object != publication
publication != verified deployment

conversation = reasoning provenance
sources / claims / records = evidence provenance
```

## Story-level contract

`visuals` is optional. Its explicit array order is the public order, regardless
of component type. The combined maximum is three components. An absent field or
an empty array emits no evidence section and requires no migration of an older
story.

Sources used by a component have a stable, lowercase story-local `id` in the
existing `sources` array:

```json
{
  "sources": [
    {
      "id": "source-1",
      "name": "Office of the Inspector General",
      "url": "https://example.gov/report"
    }
  ],
  "visuals": []
}
```

Source IDs are optional for stories with no visuals. Each visual reference must
match an ID in that story. Missing and nonexistent references fail the content
build; the generator never substitutes another source or drops the citation.
Where one visual makes independently material claims, the structure carries
granular provenance: Number comparisons have their own source, and every
Timeline event has its own source.

Every component requires a lowercase story-local `id`, one of the exact `type`
values `receipt`, `number`, or `timeline`, and the corresponding canonical
`label` (`Receipt`, `Number`, or `Timeline`). Unknown fields and unsupported
types fail validation.

## Receipt

```json
{
  "id": "receipt-1",
  "type": "receipt",
  "label": "Receipt",
  "title": "Optional concise title",
  "body": "A brief excerpt or accurate paraphrase",
  "presentation": "quote",
  "source_id": "source-1",
  "source_locator": "Finding 2, page 7",
  "context": "Material scope or qualification"
}
```

`body`, `presentation`, and `source_id` are required. `presentation` is exactly
one of `quote`, `paraphrase`, `finding`, `provision`, `response`, or `record`.
Only `quote` receives HTML quotation semantics; all other modes remain plainly
labeled prose. Bodies are limited to 1,200 characters and direct quotations to
500 characters, encouraging bounded inspection rather than republication.
`title`, `source_locator`, and `context` are optional, but supplied context is
always rendered.

## Number

```json
{
  "id": "number-1",
  "type": "number",
  "label": "Number",
  "title": "Optional concise title",
  "kind": "percentage",
  "value": "25",
  "unit": "percent of reviewed records",
  "display_value": "25%",
  "description": "Five of 20 reviewed records lacked the required field.",
  "period": "January–March 2026",
  "denominator": "20 records reviewed",
  "scope": "The reviewed program sample",
  "precision": "sampled",
  "qualification": "The sample does not establish a system-wide rate.",
  "source_id": "source-1",
  "source_locator": "Table 3"
}
```

`kind`, a finite decimal `value` encoded as a string, `unit`, `display_value`,
`description`, `scope`, `precision`, and `source_id` are required. Kinds are
`count`, `currency`, `percentage`, `ratio`, `rate`, `duration`, or `other`.
Precision is `exact`, `estimated`, `projected`, `budgeted`, `sampled`, or
`approximate`. Percentage, ratio, and rate require a denominator/base. Optional
period, qualification, and locator remain visibly attached to the highlighted
value rather than being hidden by its scale.

An optional `comparison` requires its own decimal `value`, `display_value`,
`context`, and `source_id`; `source_locator` is optional. This keeps the
comparison's provenance distinct and prevents incompatible comparisons from
borrowing the primary number's citation.

## Timeline

```json
{
  "id": "timeline-1",
  "type": "timeline",
  "label": "Timeline",
  "title": "Optional concise title",
  "events": [
    {
      "id": "event-1",
      "date": "2026-01",
      "date_precision": "month",
      "display_date": "January 2026",
      "event": "A bounded documented event.",
      "source_id": "source-1",
      "source_locator": "Section 4",
      "qualification": "Material context",
      "approximate": true
    }
  ]
}
```

At least one event is required. Every event requires its own stable ID, an ISO
year, month, or day, the matching `date_precision`, a reader-facing date,
bounded event text, and a valid source reference. Impossible dates, fabricated
precision, duplicate IDs, and descending dates fail validation. Equal dates
retain explicit source order without claiming a more precise sequence.
`approximate` and `qualification`, when supplied, are visible in text.

The public Timeline is a stacked semantic ordered list with ordinary `<time>`
elements and no causal connectors. Its order documents chronology only.

## Rendering and placement

The content build validates, normalizes, and renders components into the static
canonical story page. A single evidence sequence appears after the story deck
and before the complete Sources list. The current story model has no arbitrary
paragraph anchors, so this stable story-level position avoids raw HTML and
leaves paragraph-level placement for a separately governed future change.

All factual text, qualifications, provenance, and links are in initial semantic
HTML; JavaScript is not needed. Text and locators are escaped, external source
links use existing reader conventions, and identical input produces identical
output. The components remain readable without CSS, at 200% text, in forced
colors, at narrow mobile widths, and in ink-conscious print. Receipt wording
wraps, Number context never truncates, Timeline events stack, and large display
values may wrap rather than create horizontal scrolling. No essential meaning
is carried by color, pseudo-element text, font size, or backgrounds.

The treatment uses the production SBNS fonts and palette as an inspectable
records desk: restrained rules, precise labels, visible qualifications, and
normal source links. It deliberately avoids dashboard cards, KPI theater,
gamification, warning boxes, trust badges, and a competing certainty or
severity scale. It does not change the existing severity meter or SBNS Kicker.

## Editorial workflow and future compatibility

Future Newsroom Workbench tooling may propose candidate objects, but candidates
must pass human review and enter approved story JSON before publication. Public
rendering must never depend on a conversation transcript, D1 candidate state,
or an AI judgment.

Stable component and source IDs leave room for a deeper “Show Me the Receipts”
view, a Records Room record link, a Story History entry, or a targeted
“Challenge the Record” reference without changing today's public objects.
Those systems do not exist yet, and this milestone creates no speculative
public URLs. System Files would need a separately designed institution model;
no institution scores are smuggled into evidence components.

The same top-level architecture can later add distinct, governed objects for
The Shock / Why We're Not Surprised, The Job / The Record / The Gap,
Institutional Response, and Story History. None is represented by or inferred
from Receipt, Number, or Timeline today. In particular, a response is not
automatically a Receipt, silence is not evidence of wrongdoing, The Job must be
sourced, and background must not be reverse-engineered to fit the publication
name.

## Current pilot and deferred work

The FAA / BNATCS / GAO story is the first bounded real-story pilot. It uses a
Receipt and Number sourced to the story's approved GAO report; a Timeline was
not added because it did not materially improve reader understanding. No other
published story uses evidence components.

The following remain out of scope: The Shock / Why We're Not Surprised; The Job
/ The Record / The Gap; Institutional Response;
Story History; a Workbench contract or implementation; Records Room; System
Files; Challenge the Record; Brief / Show Me the Receipts modes; RSS / Follow
the System; subscriptions; and Secure Source.
