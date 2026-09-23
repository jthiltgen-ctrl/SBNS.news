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
5. lightweight SBNS-fit gate, including candidate-specific substantive evidence;
6. Rabbit Hole Triage for qualified candidates and non-submittable discovery leads;
7. at most five submission-ready `origin=discovery` Newsroom intakes.

No model, vector database, screenshot service, multimodal processor, deep-research chain, or publication automation is part of the routine scan. Zero candidates is a valid successful run. The limit of five is a ceiling, not a quota; additional survivors are reported as deferred rather than discarded.

Each source is fetched independently with a ten-second timeout, a 768 KiB response ceiling, a 40-item parser ceiling, explicit allowed hosts and paths, and HTML/XML content-type restrictions. One source failure produces a visible partial-run result and does not erase results from other sources. Every run reports per-source check time, success/failure, error class, and parsed count; this is run output, not a new analytics store. Watchdesk never circumvents authentication, paywalls, CAPTCHAs, robots protections, or access controls.

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

No schema migration is needed. A submitted candidate reuses `intakes` with `origin=discovery`, `status=submitted`, and `analysis_status=not_started`. Watchdesk does not create or enqueue a formal analysis job. The normalized source URL is stored in `intakes.submitted_url`; the original discovered URL remains in the audit metadata.

The existing `audit_events.metadata_json` stores the full candidate contract (version 1.1); no table or migration changes are needed:

- schema version;
- discovered title;
- source ID, name, and class;
- publication/release date, when established;
- original and normalized URL;
- discovery timestamp;
- institution or system;
- jurisdiction and topic;
- `Why this may belong at SBNS`;
- the apparent Job, or `null` when unsupported;
- what the material actually inspected establishes, attributed to its source;
- the accountability question;
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

Deterministic filtering requires a documentary-record signal and an accountability-gap signal. Routine announcements, unsupported outrage, campaign advocacy, and ordinary record churn stop before the fit gate.

The fit gate requires an identifiable institution/system, a bounded record summary, an accountability question, public relevance, and candidate-specific substantive material actually inspected. Generated Job/Record/Gap prompts, an official title, source reputation, and inferred topic do not themselves satisfy that evidentiary threshold. The Job is retained only when inspected material supports it; the system never invents one. A GAO feed abstract may provide bounded first-party evidence, but is explicitly marked partial, not full-report review.

A plausibly relevant listing without that evidence can appear as a non-persistent `discovery_lead` with an `EXPLORE` research recommendation. This is research-worthiness, **not** submission-readiness: it cannot enter Newsroom automatically. Leads are bounded in the run response and may be rediscovered later; Watchdesk does not persist them or create a new D1 workflow. `would_submit` and the five-item ceiling apply only after the substantive fit gate and Rabbit Hole Triage.

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

Use `{"dry_run":true}` to scan and return candidates without writing Newsroom intakes. A successful result reports sources checked, items discovered, deterministic rejects, known duplicates, fit-gate survivors/failures, non-submittable discovery leads, evidence-state distribution, Rabbit Hole stops, routed candidates, deferred candidates, candidates that would be submitted, and candidates actually submitted. Source failures and per-source health are listed separately. Zero submissions, including a run with only discovery leads, is a valid successful result.

In the Newsroom queue, filter origin to `discovery`, open a `DISCOVERY CANDIDATE`, and review the retained trigger, source, institution, preliminary Job and Record, accountability question, qualification, missing evidence, triage recommendation, burden, and relationships. Opening a candidate does not launch research.

## Scheduling and authority boundary

This milestone activates no schedule and changes no Worker configuration. The proposed future cadence is approximately twice daily plus authenticated manual/on-demand runs. Any production cron, infrastructure, secret, or deployment change requires separate authorization.

Watchdesk uses public material only. It does not ingest Secure Source or confidential material, contact institutions or people, request records or comment, send email, create a publication PR, mutate public content, or deploy. Human editorial controls remain responsible for all consequential state changes.
