# SBNS Newsroom Control Plane

Status: living operational record
Effective branch state: draft PR #46, October 1, 2026
Purpose: preserve the current relationship among discovery, intake, semantics, source learning, analysis, and human editorial authority.

## 1. Governing model

The Newsroom should be easy to enter and difficult to publish from carelessly.

The preferred flow is:

`broad discovery / suggestion -> bounded intake -> evidence state -> semantic controls -> research -> human editorial judgment -> drafting -> approval -> intentional publication`

Discovery breadth and publication authority are intentionally asymmetric.

A potentially interesting item should not disappear merely because it does not already arrive packaged as a provable institutional failure. Conversely, reaching the Newsroom does not establish that any claim, failure, motive, misconduct, harm, injustice, or causal relationship is true.

## 2. Intake surfaces

The current architecture supports or prepares the following intake surfaces:

### Editor/manual URL intake

An authenticated editor can submit a public source URL directly in the Newsroom.

### Watchdesk discovery

Watchdesk scans a governed portfolio of public sources and can create up to five Newsroom discovery intakes per run.

It has two readiness pathways:

- `gap` — the classic actor + Job/expectation + observed condition + defensible accountability gap structure;
- `editorial_aperture` — substantive reviewed evidence tied to an institution/system that contains an accountability-relevant signal but does not establish the classic Job/failure pair.

The `gap` pathway retains priority within the five-item ceiling. Missing classic-gap elements in an `editorial_aperture` item remain missing; Watchdesk does not invent them.

### Story Queue email

Application support is prepared for:

`storyqueue@shockedbutnotsurprised.news`

Ordinary email from an allowed sender can carry public story links and a plain-text note through a bounded GreenGeeks mail-host relay into normal `visitor` Newsroom intakes and the existing analysis queue.

This application path is **prepared but not mail-host activated** on the draft branch. Activation requires separate post-merge/deploy GreenGeeks configuration and secret setup. No MX change is part of the design.

See `docs/STORYQUEUE-EMAIL-INTAKE.md`.

### Visitor/public web submission

The underlying intake schema already recognizes a `visitor` origin, but a generalized public web-submission surface should not be described as live unless separately deployed and verified.

### Secure Source

Secure Source / GlobaLeaks is a separate future system.

Confidential tips, anonymous-source communications, unpublished whistleblower material, protected documents, private email, or raw Secure Source material must not automatically enter Watchdesk, AI analysis, analytics, GitHub, or ordinary Story Queue email processing.

## 3. Semantics control

The controlling direction is:

`source meaning -> supported editorial meaning -> faithful search/discovery language`

The semantics control watches for two opposite errors:

1. **overstatement** — language becomes stronger than the reviewed evidence;
2. **semantic throttling** — worthy accountability material is discarded because the pipeline recognizes only a narrow definition of institutional failure.

The Newsroom story file therefore exposes a diagnostic **Semantics & Editorial Aperture** panel showing, where available:

- discovery/accountability pathway;
- evidence state;
- qualification control;
- observed condition;
- institutional nexus / attributable failure;
- specific-harm causation;
- monitored high-risk public-copy terminology;
- `DO NOT CLAIM` boundaries;
- material qualifications and unresolved questions.

This panel is advisory. It does not make PUBLISH / HOLD / REJECT decisions.

See `docs/SEMANTICS-CONTROL.md`.

## 4. Accountability aperture

A discrete institutional failure is one valid accountability frame, not a universal qualification gate.

Potentially valid evidence-supported frames include:

- persistent or repeated poor performance;
- foreseeable or accepted risk;
- waste, duplication, delay, or avoidable cost;
- displaced stakeholder burden;
- inequitable distribution of benefits, burdens, access, service, or recourse;
- documented rights, fairness, or justice concerns;
- contradictory or perverse incentives;
- inadequate transparency, accountability, or recourse;
- formal compliance paired with materially poor real-world performance;
- consequential problems produced by systems functioning as designed;
- recurrence after warning or failed remediation;
- normalization or cumulative burden.

The evidence standard is not lowered. The vocabulary of accountability is widened so discovery does not pre-decide the editorial question.

## 5. Watchdesk source portfolio

The static registry is a governed seed set, not the universe of acceptable sources.

As validated on October 1, 2026, the registry contains 12 governed sources, of which **9 are active and probe-compatible**.

Active cohort:

- U.S. Government Accountability Office reports;
- U.S. Department of Justice OIG reports;
- Iowa Auditor of State reports;
- City of Dubuque public notices;
- KCRG i9 Investigations;
- KFF Health News;
- The Marshall Project — Investigations;
- U.S. Office of Special Counsel public whistleblower/accountability releases;
- ProPublica reporting archive.

Vetted but disabled pending a compatible bounded adapter/feed:

- Iowa Capital Dispatch — category retrieval returned HTTP 403 and the ordinary feed exceeded the existing source-size ceiling;
- Investigate Midwest — ordinary retrieval succeeded but the generic HTML-list adapter yielded no eligible items;
- POGO Investigates — bounded Watchdesk retrieval returned HTTP 403.

No access, size, or anti-bypass safeguard should be weakened merely to force a desired outlet into scheduled monitoring.

The final no-write probe after those decisions reported:

- 9 sources checked;
- 9 sources succeeded;
- 166 public items discovered;
- 137 deterministic rejects;
- 29 candidates reaching fit review;
- 22 discovery leads;
- 7 submission-ready aperture candidates;
- 5 candidates that would be selected under the existing ceiling;
- 0 source failures;
- 0 production submissions.

This is a point-in-time validation result, not a publication quota or source ranking.

See `docs/WATCHDESK-SOURCE-PORTFOLIO.md`.

## 6. Source learning

Migration `0006_watchdesk_source_learning.sql` adds durable source-candidate state.

The purpose is to let the Newsroom learn naturally from editorial work rather than requiring every useful source to be anticipated in a static registry.

A source host can become an **eligible learned-source candidate** only after a submitted story is successfully analyzed and the result is stronger than a reject with an unverified source state.

A pasted URL alone cannot self-enroll its domain into scheduled monitoring.

The Newsroom source-portfolio control shows learned candidates and allows explicit human configuration/approval or rejection.

Promotion to monitoring requires bounded configuration including:

- stable source ID and display name;
- source class;
- jurisdiction;
- public discovery URL;
- supported adapter;
- exact allowed host;
- bounded allowed path prefixes;
- primary-record classification;
- human decision provenance.

Only approved and enabled learned sources are included in future Watchdesk scans.

## 7. Source authority

Source usefulness must not be confused with source authority.

For a source, distinguish:

- **discovery value** — whether it surfaces accountability opportunities early;
- **claim authority** — which exact propositions it is competent to establish;
- **independence** — whether it reports independently, speaks for an institution, advocates, represents a whistleblower, or publishes a formal finding;
- **maturity** — allegation, filed complaint, active investigation, preliminary finding, final finding, litigation result, audit, or retrospective;
- **proximity** — whether it captures local or stakeholder consequences that more formal national oversight can miss.

Strong independent reporting can be an excellent discovery signal while still requiring primary records or additional corroboration for material claims.

## 8. Public whistleblower signals

Public whistleblower disclosures can be legitimate discovery inputs.

The active initial channel is the U.S. Office of Special Counsel public release stream.

A public disclosure remains labeled according to its actual evidentiary state. The fact that a whistleblower, attorney, advocacy group, reporter, official, or government office states an allegation does not convert the underlying allegation into an independently verified fact.

Confidential/unpublished whistleblower material remains outside Watchdesk and Story Queue automation.

## 9. Story Queue authority boundary

Story Queue sender controls are routing/noise controls, not proof of identity or truth.

An allowed `From` address does not establish:

- that the apparent sender has been cryptographically authenticated by SBNS;
- that a linked story is accurate;
- that any allegation is true;
- that the linked outlet should become a monitored source;
- that the item is publishable.

Story Queue email can create queued editorial work. It cannot create an editorial decision.

Attachments are ignored by the automation. Raw MIME and attachment bytes do not leave the GreenGeeks mail host through the prepared relay.

## 10. Human editorial authority

The human editor may use project chat to interrogate rationale, framing, evidence sufficiency, research burden, semantic risk, and competing editorial interpretations.

That assistance does not replace the human decision.

The meaningful authority states remain separate:

- discovery;
- research;
- analysis/recommendation;
- human editorial decision;
- approved draft;
- repository publication;
- deployment;
- live verification.

No earlier state silently implies a later one.

## 11. Change and expansion rule

Do not turn this control plane into a source-collection or feature treadmill.

Broaden discovery when real editorial use shows that a source class, geography, topic, or intake path is missing meaningful opportunities.

Automate a recurring step when repeated production demonstrates consequential error risk or founder burden.

Do not add a source, scraper, model pass, schema, or service merely because it can be added.

The desired equilibrium is:

**broad enough to see the opportunity; disciplined enough to know what it proves; human enough to decide what matters.**
