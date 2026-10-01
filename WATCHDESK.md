# SBNS Watchdesk

Watchdesk is a bounded internal discovery pipeline. It scans a small registry of public accountability sources, removes obvious non-fits and known items, applies a lightweight evidence gate, recommends Rabbit Hole Triage, and may create an `origin=discovery` Newsroom intake. It does not decide what SBNS publishes.

The governing distinctions remain:

- discovery is not reporting;
- a candidate is not a story;
- automated triage is not an editorial decision;
- editorial approval is not publication;
- publication is not verified deployment.

## Pipeline and cost controls

The stages run in this order:

1. curated public-source discovery;
2. URL and listing normalization;
3. deterministic filtering;
4. deterministic deduplication against the run, D1 discovery history, published reporting, and monitoring;
5. lightweight SBNS-fit gate for substantive material actually inspected;
6. Rabbit Hole Triage and a separate actor/Job/condition/gap submission-readiness gate;
7. non-persistent discovery leads for research-worthy items that are not submission-ready;
8. at most five submission-ready `origin=discovery` Newsroom intakes.

No model, vector database, screenshot service, multimodal processor, deep-research chain, or publication automation is part of the routine scan. Zero candidates is a valid successful run. The limit of five is a ceiling, not a quota; additional survivors are reported as deferred rather than discarded.

Each source is fetched independently with a ten-second timeout, a 768 KiB response ceiling, a 40-item parser ceiling, explicit allowed hosts and paths, and HTML/XML content-type restrictions. One source failure produces a visible partial-run result and does not erase results from other sources. Every run reports per-source check time, success/failure, error class, and parsed count; only this bounded operational summary is retained in the run ledger. Watchdesk never circumvents authentication, paywalls, CAPTCHAs, robots protections, or access controls.

## Curated source registry

`watchdesk/source-registry.js` is the only initial source registry. It contains no secrets and records source name, class, jurisdiction, discovery URL, adapter, enabled state, allowed hosts and paths, primary/secondary status, topic, and operating notes.

The representative first set is:

- U.S. Government Accountability Office reports — primary oversight, using GAO's official reports RSS feed;
- U.S. Department of Justice OIG reports — primary oversight;
- Iowa Auditor of State audit reports — primary oversight and regional;
- City of Dubuque public notices — local/regional official institutional signal;
- ProPublica reporting archive — secondary investigative-reporting signal.

The adapters are bounded HTML-list parsing and RSS/Atom parsing. The original GAO `/widgets/reports` HTML endpoint returned HTTP 403 to ordinary server-side retrieval in the first production dry run and a follow-up diagnostic GET. GAO's own [feed directory](https://www.gao.gov/about/stay-connected) advertises `https://www.gao.gov/rss/reports.xml`; an ordinary GET returned HTTP 200, and the existing RSS adapter parsed it. No client disguise or access-control bypass is used. HTML-list configuration must restrict both host and path. Secondary reporting is a discovery signal; when an underlying record is not present, the candidate says `SECONDARY SIGNAL — PRIMARY RECORD NEEDED`.

To add a source safely:

1. confirm the listing is public, stable, and permits ordinary access;
2. prefer RSS/Atom, a documented public API, or a stable listing page;
3. add one registry entry with explicit allowed hosts and path prefixes;
4. add synthetic adapter and fit-gate fixtures before enabling it;
5. run `npm run watchdesk:check`, `npm run watchdesk:test`, and the full `npm run check`;
6. review a dry-run summary before authorizing live queue insertion.

Disable a source by setting its registry `enabled` value to `false`. A registry change reaches a deployed Worker only through the separately governed review and deployment process.

## Candidate contract and persistence

Candidate submission needs no separate candidate schema. A submitted candidate reuses `intakes` with `origin=discovery`, `status=submitted`, and `analysis_status=not_started`. Watchdesk does not create or enqueue a formal analysis job. The normalized source URL is stored in `intakes.submitted_url`; the original discovered URL remains in the audit metadata. Migration `0004_watchdesk_runs.sql` adds only operational run history and a singleton lease; it does not duplicate candidate evidence.

The existing `audit_events.metadata_json` stores the full candidate contract (version 1.2); no table or migration changes are needed:

- schema version;
- discovered title;
- source ID, name, and class;
- publication/release date, when established;
- original and normalized URL;
- discovery timestamp;
- accountable institution or system, or `null` when source material does not support one;
- jurisdiction and separate topic (which may come from the report title);
- `Why this may belong at SBNS`;
- the apparent Job, or `null` when unsupported;
- what the material actually inspected establishes, attributed to its source;
- the observed condition, accountability gap, and evidence-derived question, each nullable;
- a separately labeled research prompt, if present;
- submission readiness, pathway (`gap` or `editorial_aperture` when ready), unresolved classic-gap elements, and reasons when withheld;
- source class (provenance), primary-record URL/location, evidence review state, and inspected material as separate concepts;
- key sources and their roles;
- material qualification or counterevidence;
- any already-present institutional response;
- what remains unproven;
- qualitative research burden (`LOW`, `MODERATE`, or `HIGH`);
- title and content fingerprints;
- automation provenance and run ID;
- published-story or related-intake relationship, when found;
- Rabbit Hole recommendation and rationale.

The audit action is `watchdesk.candidate_submitted`. The Newsroom displays the contract as `DISCOVERY CANDIDATE — AUTOMATED TRIAGE, NOT AN EDITORIAL DECISION`.

`PRIMARY RECORD LOCATED` means a primary URL is known, not that its contents were read. `PRIMARY RECORD PARTIALLY REVIEWED` means bounded substantive first-party material, such as a GAO report abstract, was inspected but the full report was not. `PRIMARY RECORD REVIEWED` requires an inspected underlying record. `SECONDARY SIGNAL — PRIMARY RECORD NEEDED` means no primary location is known. The separate `evidence_review_state` is `NOT REVIEWED`, `PARTIALLY REVIEWED`, or `REVIEWED`; `reviewed_material` names what was examined. A legacy `PRIMARY RECORD FOUND` intake is displayed as review-unverified rather than silently upgraded. Source class remains provenance, not a claim of review.

## Dedupe, memory, and relationships

Tracking parameters are removed, fragments and default ports are normalized, meaningful query parameters are preserved, and the original URL is retained. Watchdesk checks normalized URL, deterministic title/content fingerprints, existing published story source URLs, prior discovery audit metadata, and exact monitoring development URLs before submission.

The same unchanged item creates one intake. A previously held, rejected, or otherwise closed item is still suppressed when its fingerprint is unchanged. A changed date, record summary, primary record, or other material input changes the content fingerprint and can create a new intake related to the earlier one. This is bounded disposition memory, not an eternal blacklist.

An exact source already used by published reporting is removed as known. A likely new development may retain a `published_development` relationship for human review. Watchdesk never edits a story or creates monitoring machinery. Monitoring remains the process for watching known stories or conditions; Watchdesk remains the process for discovering potentially relevant new material.

## Fit gate and Rabbit Hole Triage

Deterministic filtering requires a documentary-record signal and a bounded accountability signal. The signal vocabulary intentionally includes not only explicit failure/gap language but evidence of waste, repeated or foreseeable problems, burden, delay, inefficiency, disparity, barriers, avoidable cost, and related accountability conditions. Routine announcements, unsupported outrage, campaign advocacy, and ordinary record churn still stop before the fit gate.

The substantive-fit gate checks a bounded record summary, public relevance, and candidate-specific material actually inspected. It is **not** the submission gate. An official title, source reputation, inferred topic, numbers, a generic question, or a `What GAO Found` heading do not establish an accountability gap. A GAO feed abstract may provide bounded first-party evidence, but is explicitly marked partial, not full-report review.

Submission readiness now has two bounded pathways.

The **gap pathway** preserves the original conservative contract: a named accountable actor, reviewed substantive material, an expectation or Job, an observed condition, a defensible gap between them, an evidence-derived question, no defeating material qualification, and an `EXPLORE` or `DEVELOP` recommendation. The deterministic extractor still requires a matching expectation/negative-condition pair before it claims that gap.

The **editorial-aperture pathway** exists so discovery does not silently discard a potentially worthy story merely because the inspected record does not express a classic Job/failure pair. It requires reviewed substantive material, a supported institution/system, a bounded accountability signal in the inspected material, no defeating qualification, and an `EXPLORE` or `DEVELOP` recommendation. Missing Job, observed-condition, gap, or evidence-derived-question fields remain explicitly recorded as development gaps; Watchdesk does not invent them. These candidates enter Newsroom as exploratory editorial opportunities for human judgment, not as proven failures or publication recommendations.

Neither pathway requires misconduct, intent, illegality, or specific-harm causation. The editorial-aperture pathway does not lower the later evidence or publication standard.

A plausibly relevant listing that lacks candidate-specific reviewed evidence can still appear as a non-persistent `discovery_lead` with an `EXPLORE` recommendation. A substantive reviewed or partially reviewed record may instead become an editorial-aperture Newsroom intake when it satisfies that bounded pathway. Leads remain bounded in the run response and may be rediscovered later.

The run distinguishes `fit_gate_survivors`, `discovery_leads`, `submission_ready`, `submission_ready_gap`, `submission_ready_aperture`, `would_submit`, and `deferred_by_ceiling`. The five-item ceiling applies to all submission-ready candidates, with classic gap-ready candidates ordered ahead of editorial-aperture candidates when the ceiling is reached. This priority protects the strongest deterministic evidence path without suppressing broader editorial opportunities.

The first final-head read-only probe returned zero `STOP` recommendations. That was not a target or quota: routine and weak items were removed before triage, while promising but unready items were `EXPLORE` leads. Explicit novelty failures still `STOP`, and routed items still `ROUTE`; no artificial STOP count is generated.

Recurring or unsurprising conditions are not automatically treated as non-novel. A repeat occurrence still needs a meaningful new development, evidence increment, failed-remediation signal, cumulative-burden insight, or other current accountability implication.

Allowed recommendations are `STOP / NO ACTION`, `EXPLORE`, `DEVELOP`, and `ROUTE`. These recommendations describe whether limited human attention appears warranted. They never populate `editorial_decisions`, never produce the formal analysis recommendation values `publish`, `hold`, or `reject`, and never trigger publication.

## Operator guide

Run the synthetic, non-writing proof locally:

```sh
npm run watchdesk:dry-run
```

Run all Watchdesk validation:

```sh
npm run watchdesk:check
npm run watchdesk:test
```

A separate, read-only public-source probe is available as `node scripts/watchdesk.mjs probe`. It uses the configured registry but stubs production D1 lookups and submissions; its duplicate and would-submit counts therefore are not production queue counts. Do not repeat it to seek a more interesting result.

The authenticated admin Worker supports manual runs at:

```text
POST /api/admin/watchdesk/runs
{}
```

Use `{"dry_run":true}` to scan and return candidates without writing Newsroom intakes. A successful result reports sources checked, items discovered, deterministic rejects, known duplicates, fit-gate survivors/failures, non-submittable discovery leads, submission-ready candidates, evidence-state distribution, Rabbit Hole stops, routed candidates, deferred candidates, candidates that would be submitted, and candidates actually submitted. Source failures and per-source health are listed separately. Zero submissions, including a run with only discovery leads, is a valid successful result.

The signed-in Editorial Desk has a Watchdesk status section and explicit **Run dry Watchdesk** and **Run live Watchdesk** controls. Live execution requires a confirmation that up to five discovery intakes may be created. The page shows returned metrics, sanitized per-source operational health, and recent durable run history; it does not require a pre-run or post-run private queue enumeration.

`GET /api/admin/watchdesk/status` is a human-editor-only operational view. `GET /api/admin/watchdesk/health` is a separate service-token-only read-only aggregate for deployment/monitoring. The machine response contains Worker revision, configured cron, and latest run ID/time/status and counts; it contains no candidate, intake, editor, or queue contents. The service token remains denied from `/api/admin/session`, `/api/admin/watchdesk/status`, and `POST /api/admin/watchdesk/runs`.

In the Newsroom queue, filter origin to `discovery`, open a `DISCOVERY CANDIDATE`, and review the retained trigger, source, institution, accountability pathway, preliminary Job/observed condition/gap when established, qualification, missing evidence, triage recommendation, burden, and relationships. An `editorial_aperture` intake means only that reviewed evidence warrants human editorial consideration beyond a narrow failure gate. Opening a candidate does not launch research.

## Scheduling and authority boundary

The admin Worker configuration declares `0 14,23 * * *` UTC: approximately 09:00 and 18:00 Central during daylight saving time, and 08:00 and 17:00 Central during standard time. Cloudflare Cron Triggers use UTC and can take up to 15 minutes to propagate after deployment. The scheduled handler calls the same bounded live Watchdesk pipeline as the manual endpoint, with `system:watchdesk-schedule` provenance, and never requests an editor session. A PR containing this configuration does **not** activate the schedule; an explicitly approved merge triggers the existing automatic admin deployment.

The D1 ledger records every attempted invocation as `running`, `success`, `partial`, `failed`, or `skipped-overlap`, including successful zero-result runs. It stores high-level pipeline metrics, bounded per-source health, a short error class/message, and at most five submitted intake IDs for count reconciliation. Each qualifying intake insert is conditioned on the same run still holding an unexpired lease with a running ledger row and room below the five-item ceiling. That insert, its discovery audit, and the count/ID update execute in one D1 transactional batch, with database-time lease checks at insertion and ledger update; a failed statement rolls back the candidate write. An ignored duplicate changes none of those rows. A later run failure does not hide an earlier committed submission. Full candidate evidence remains solely in the existing discovery intake/audit path. A single atomic D1 lease prevents concurrent manual and scheduled scans. A second invocation is recorded and skipped. The lease expires after 30 minutes; the next invocation can take it over and marks the old run failed as `STALE_LOCK_RECOVERED`. If a run fails, the ledger marks it failed and releases only its own lock. Existing candidate-level dedupe remains a second safeguard.

For local scheduled-handler proof, deterministic synthetic tests call the same handler and pipeline with a local SQLite/D1-shaped binding. A local Wrangler scheduled event may also be invoked with `wrangler dev --test-scheduled` and `/cdn-cgi/local/scheduled?format=json`, but it must use local D1 and must not be pointed at production for testing. Production acceptance after an approved deploy is: verify the protected revision and machine-only health; have the human editor run one dry scan and review aggregate/source-health results; then, only if safe, run one live scan. Reconcile its returned submitted count and IDs against the durable run record. No automated private queue browser read is required. A scheduled run can be observed at the next cron time; a synthetic scheduled invocation must never create production duplicates.

Discovery cadence, manual execution, Newsroom review, editorial analysis, and publication are distinct authorities. Scheduled discovery does not equal automated journalism. Newsroom candidates are for human examination; formal analysis and publication remain separately human-authorized.

Watchdesk uses public material only. It does not ingest Secure Source or confidential material, contact institutions or people, request records or comment, send email, create a publication PR, mutate public content, or deploy. Human editorial controls remain responsible for all consequential state changes.
