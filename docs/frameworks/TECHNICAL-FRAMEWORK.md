# ShockedButNotSurprised.news Technical Framework

Status: Proposed canonical technical control framework
Lineage: April 2026 GreenGeeks deployment, v1 Worker baseline, v1.2 content pipeline, v1.4 intake/publication/monitoring prototypes, v1.5 architecture and implemented Phases 1–3, Phase 3.5 staging controls

## 1. Technical purpose

The technical system exists to make careful editorial work faster without making careless editorial work easier.

The architecture must enforce separation among:

- public reading;
- internal editorial workflow;
- evidence retrieval;
- machine analysis;
- human review;
- publication preparation;
- repository truth;
- deployment;
- monitoring and correction.

A capability is not authorization.

A successful machine recommendation is not publication.

A successful API call is not proof of publication.

## 2. Source-of-truth boundaries

The current governing boundary is:

- Cloudflare D1 stores durable editorial workflow state.
- content/stories stores the repository-managed public story source of truth.
- public/stories.json is deterministic generated output.
- Git history preserves public-content provenance.
- deployment state records whether repository truth actually reached an environment.

D1 approval does not prove a story was merged, deployed, or verified.

Generated public feed files must not be edited manually.

## 3. Current runtime separation

Current internal runtime identifiers retain the historical SBNS abbreviation.

### Public Worker

Name: sbns-news

Responsibilities:

- public reader experience;
- static assets;
- deterministic public story feed;
- GET /api/health.

It is publicly accessible and must not contain model credentials, editorial secrets, or privileged mutation authority.

### Admin Worker

Name: sbns-admin

Responsibilities:

- Cloudflare Access-protected editorial desk;
- persistent queue views;
- intake creation;
- saved draft revisions;
- editorial decisions;
- enqueueing analysis work.

It binds to the editorial D1 database and analysis queue.

### Analysis Worker

Name: sbns-analysis

Responsibilities:

- private queue consumption;
- bounded source retrieval;
- source normalization;
- AI analysis through Gateway;
- deterministic validation;
- atomic persistence of evidence, analysis, claims, job state, and audit history;
- dead-letter handling.

It is not a public browser-facing Worker.

### Editorial database

Name: sbns-editorial-staging
Binding: SBNS_DB

Current migration sequence:

- 0001_editorial_foundation.sql
- 0002_admin_queue.sql
- 0003_live_analysis.sql

Current expected schema version: 3.

### Queue resources

- analysis queue: sbns-analysis-staging
- dead-letter queue: sbns-analysis-dlq-staging

The analysis consumer currently processes one item per batch, retries up to five times, and uses a DLQ for exhausted work.

### AI Gateway

Gateway identifier: sbns-staging

Current committed token ceiling setting: 4096 default through AI_MAX_TOKENS.

Analysis caching is intentionally bypassed for editorial inference.

The deployed model remains runtime configuration, not a committed editorial fact.

## 4. Historical architecture evolution

### Stage 0 — GreenGeeks React/PHP deployment

Repository history records an April 2026 GitHub Actions workflow that built a React application and deployed the dist directory to GreenGeeks by FTP.

The frontend expected a PHP stories endpoint at the production domain.

This architecture is historical. It established:

- GreenGeeks as original production hosting;
- GitHub Actions as deployment machinery;
- separation between built frontend and server-side API.

The root deploy.yml remains a historical artifact.

### Stage 1 — Static-first Cloudflare Worker prototype

The August 2026 v1 baseline moved the public reader toward:

- dependency-light static HTML, CSS, and JavaScript;
- Cloudflare Worker static assets;
- a public health endpoint;
- clearly fictional prototype stories;
- no persistent database;
- no live analyzer.

The legacy hosting files were deliberately preserved during this transition.

### Stage 2 — Repository-managed editorial content

v1.2 introduced:

- one source-controlled JSON file per story;
- deterministic feed generation;
- draft exclusion;
- factual reporting versus fictional sample content types;
- source validation;
- pull-request-based editorial review.

This established the enduring repository/public-content boundary.

### Stage 3 — v1.4 executable editorial prototype

v1.4 introduced contracts and fixtures before live infrastructure.

Its sequence was:

- Phase A: machine-readable intake analysis contract;
- Phase B: read-only admin display;
- Phase C: editable human review;
- Phase D: explicit human-gated publication package;
- Phase E: monitoring and corrections review semantics.

The design deliberately proved decision behavior before adding persistence, authentication, or live model calls.

### Stage 4 — v1.5 persistence and authentication

Phase 1 added D1 and versioned migrations.

Phase 2 added:

- Cloudflare Access JWT verification;
- durable admin queue;
- idempotency records;
- persistent drafts and decisions.

### Stage 5 — v1.5 live editor analysis

Phase 3 added:

- persisted analysis jobs;
- Cloudflare Queues;
- DLQ handling;
- bounded source retrieval;
- Workers AI conversion and structured analysis;
- AI Gateway;
- shared schema and semantic validation;
- atomic persistence;
- safe retry and duplicate-delivery behavior.

Phase 3 repair then enforced canonical structured JSON Schema output and bounded token configuration.

### Stage 6 — reader stabilization and public staging

Phase 3.5 made the public reader reporting-first and isolated fictional samples as a prototype archive.

The repository then added:

- staging checklist;
- staging baseline;
- public Worker GitHub Actions deployment;
- propagation-aware health verification;
- mail-safe production DNS cutover runbook.

Production DNS cutover is not implied by the existence of the runbook.

## 5. Trust model

Treat the following as untrusted:

- visitor input;
- editor-submitted external URLs;
- fetched source content;
- source HTML or documents;
- redirects;
- AI output;
- browser-supplied mutation fields;
- retry-delivered queue messages.

Treat the following as trusted only after explicit controls:

- editor identity after Cloudflare Access JWT verification;
- model output after JSON parsing, schema validation, semantic validation, and source-reference validation;
- an editorial draft after persistence and revision identity;
- an approval only when tied to the exact reviewed draft;
- repository state only after deterministic build and validation;
- deployment only after live verification.

Authentication proves identity. It does not make evidence true.

## 6. Authentication and authorization

Cloudflare Access is the primary editor authentication boundary.

The Worker validates the Cf-Access-Jwt-Assertion against:

- the expected Cloudflare Access issuer;
- the configured audience;
- Cloudflare's remote signing keys.

The initial application role is editor.

Server-side authorization is authoritative. Hiding a button in browser JavaScript is not authorization.

Consequential mutations must record the actor.

## 7. Persistence model

Migration 0001 creates the editorial foundation:

- sbns_meta;
- intakes;
- analyses;
- sources;
- claims;
- claim_sources;
- editorial_drafts;
- editorial_decisions;
- publication_attempts;
- monitoring_events;
- audit_events.

Migration 0002 adds idempotency_records.

Migration 0003 adds analysis_jobs.

Persistence invariants include:

- opaque application-generated IDs;
- ISO-8601 UTC timestamps;
- foreign-key relationships;
- intake-scoped claims and sources;
- append-oriented draft revisions;
- approval tied to a specific draft;
- append-oriented audit events;
- constrained workflow and recommendation values.

JSON stored as text must be validated by application code before insertion.

## 8. Migration discipline

Ordinary development and tests use local D1 state only.

Remote migration apply is a separate explicit staging action.

Rules:

- never apply remote migrations from npm run check;
- list remote migrations before applying;
- do not automatically recreate a database;
- treat destructive recreation as exceptional manual recovery;
- once durable editorial data exists, forward migration is the normal path;
- preserve migration files in source control.

A migration passing locally is not proof it was applied remotely.

## 9. Intake and job lifecycle

Canonical intake workflow state is separate from analyzer recommendation.

Current intake lifecycle supports:

- submitted;
- queued;
- analyzing;
- review_ready;
- editing;
- held;
- rejected;
- approved;
- publication_pending;
- publication_pr_open;
- published;
- failed.

Analysis job state supports:

- pending_enqueue;
- queued;
- running;
- retrying;
- complete;
- failed;
- dead_letter.

Machine recommendation supports:

- publish;
- hold;
- reject.

These dimensions must not be collapsed.

## 10. Idempotency

Asynchronous and consequential operations must tolerate retry and duplicate delivery.

Current controls include:

- idempotency records keyed by actor, operation, and key;
- a unique active analysis job per intake;
- stable persisted job state;
- atomic analysis persistence;
- queue retry states;
- audit events.

External operations should be reconciled before retry when the outcome is uncertain.

Never create duplicate analyses, decisions, drafts, publication attempts, or audit meaning merely because a message was delivered twice.

## 11. Source retrieval safety

Source retrieval occurs server-side.

Current retrieval controls include:

- HTTP and HTTPS only;
- URL credentials rejected;
- localhost and local domains rejected;
- private, link-local, loopback, multicast, documentation, and reserved IP ranges rejected;
- every redirect destination revalidated;
- maximum five redirects;
- 15-second fetch timeout;
- four-megabyte raw response cap;
- accepted content-type allowlist;
- no source JavaScript execution;
- no privileged cookies or secrets forwarded;
- cache disabled;
- bounded normalized evidence.

The current normalized evidence limit is 250,000 characters, with deterministic middle truncation when required.

If evidence is truncated, the analysis must preserve qualification.

Source retrieval safety is a security boundary, not an editorial judgment.

## 12. Source normalization

Direct text formats are decoded directly.

Supported document and HTML formats are normalized through Workers AI document conversion.

The normalized record preserves enough provenance to inspect why analysis occurred, including where available:

- original URL;
- final URL;
- normalized URL;
- MIME type;
- title;
- extraction format;
- fetch time;
- content hash;
- bounded extracted evidence.

Do not retain unnecessary full copied pages merely because storage is available.

## 13. Prompt-injection boundary

Fetched content is evidence, not instruction.

The analysis system prompt explicitly tells the model that instructions, role prompts, secret requests, URLs, tool requests, and formatting commands inside source material are untrusted.

The model is not authorized to:

- make network calls;
- follow source-embedded instructions;
- invent corroboration;
- invent sources;
- imply independent research beyond the supplied evidence.

## 14. AI structured-output contract

The analyzer uses a supplied JSON Schema through structured response formatting.

Current controls include:

- raw JSON parsing for string responses;
- accepted structured response envelopes;
- schema validation;
- deterministic semantic validation;
- exact intake metadata preservation;
- permitted-source-reference enforcement;
- truncated-evidence qualification enforcement.

The analyzer currently receives only source-1 as a permitted source reference.

If model output references an unauthorized source, it fails validation.

If one source is insufficient for PUBLISH, the analyzer must HOLD or REJECT rather than fabricate corroboration.

## 15. Semantic validation

AI does not determine its own validity.

The pipeline is:

Evidence
→ model output
→ JSON parse
→ JSON Schema validation
→ deterministic semantic validation
→ persistence

Enduring semantic invariants include:

- observed condition is not automatically attributable failure;
- institutional failure is not automatically proven specific-harm causation;
- clean audit is not no findings;
- later development is not automatically proof the original story was wrong.

Semantically invalid machine recommendations are rejected even if the JSON shape is valid.

## 16. Model portability

Editorial rules must not bind to one permanent model.

AI provider choice is implementation configuration.

A model change should be evaluated against:

- schema compliance;
- semantic invariants;
- invented-source behavior;
- qualification retention;
- recommendation distribution;
- human override patterns;
- cost;
- latency;
- failure behavior.

Do not alter editorial standards to accommodate a model's weaknesses.

## 17. Browser boundary

Browser clients must never receive:

- AI credentials;
- GitHub App private keys;
- Cloudflare secrets;
- Turnstile secret;
- privileged repository credentials;
- internal model configuration that would expose secrets.

The browser may display editorial evidence and state appropriate to the authenticated editor, but privileged operations remain server-side.

## 18. Draft and approval integrity

Drafts are revisioned and should not be silently overwritten.

An approval must reference the exact draft reviewed.

Editing after approval invalidates the editorial meaning of the prior approval.

Approval is not publication.

## 19. Publication architecture

Current public stories remain repository-managed.

The v1.5 target publication path is:

approved exact draft
→ deterministic story generation
→ validation
→ unique branch
→ story file
→ deterministic feed generation
→ repository validation
→ commit
→ draft pull request
→ human GitHub review and merge
→ authorized deployment
→ live verification
→ publication complete

The planned GitHub publication adapter should use a GitHub App with minimum required permissions.

Initial automation is intended to stop at draft PR creation.

No framework document authorizes auto-merge or unsupervised production deployment.

## 20. Monitoring and corrections

Monitoring creates a new event. It does not silently mutate a published story.

Recommendation types are:

- no_action;
- update_review;
- correction_review;
- follow_up.

Correction publication requires immutable history.

Later information that does not make original reporting wrong is an update or follow-up, not a correction.

## 21. Public visitor submissions

Visitor submissions remain a later v1.5 phase unless separately implemented and verified.

Required controls include:

- Turnstile;
- server-side verification;
- rate limiting;
- URL validation;
- note length limits;
- duplicate detection;
- abuse logging with data minimization;
- no executable upload path;
- the same downstream review queue.

Visitor input must never create a public story directly.

## 22. Observability

Useful operational measures include:

- intake volume;
- queue backlog;
- analysis duration;
- analysis failures;
- source-fetch failures;
- model-validation failures;
- recommendation distribution;
- human override rate;
- publication failures;
- monitoring actionable rate.

Analytics should not receive source text, private editorial text, or visitor contact information unless separately justified and approved.

## 23. Testing doctrine

The repository uses executable regression contracts rather than relying on prose alone.

Current verified baseline records include:

- 86 Phase 3 analysis scenarios;
- 33 persistence scenarios;
- 39 admin API scenarios;
- 6 JWT scenarios;
- retained v1.4 intake, monitoring, and publication suites;
- JavaScript syntax validation;
- public/admin/analysis Worker dry runs.

npm run check must remain non-deploying.

Tests should prove both expected success and expected refusal.

A safety control without a negative test should be treated as incompletely enforced.

## 24. Staging and production separation

Staging is the place to prove behavior.

Production mutation requires separate authorization.

The current public staging Worker is deployed independently of:

- production DNS;
- admin Worker deployment changes;
- analysis Worker deployment changes;
- D1 migrations.

The public deployment workflow validates only the public surface and verifies the expected health identity after deployment.

Health verification retries through short propagation delay rather than immediately interpreting stale edge state as failure.

## 25. Current staging baseline

The repository baseline records:

- application version 1.5.0;
- public Worker sbns-news;
- admin Worker sbns-admin;
- analysis Worker sbns-analysis;
- D1 schema version 3;
- 13 tables;
- 17 indexes;
- analysis queue and DLQ names;
- AI Gateway identifier;
- 4096 token ceiling;
- 11 published feed records: five reporting and six clearly fictional prototype samples.

Environment facts that cannot be verified from repository state must remain explicitly marked unverified.

Do not guess account-only values.

## 26. Deployment workflow

The current GitHub Actions public staging workflow:

- triggers on main for public-surface paths or manual dispatch;
- uses Node 22;
- installs with npm ci;
- validates content;
- syntax-checks public code;
- dry-runs Wrangler;
- deploys only the public sbns-news Worker;
- verifies /api/health;
- does not apply D1 migrations;
- does not deploy admin or analysis Workers;
- does not change DNS.

Secrets are held in the GitHub staging environment.

## 27. DNS and email boundary

Production email remains a first-class dependency hosted through GreenGeeks.

The cutover runbook intentionally separated:

1. decoupling GreenGeeks mail from the web apex;
2. moving authoritative DNS while leaving the existing website in place;
3. attaching the verified Worker to the production domain.

Each phase requires separate action-time approval and a rollback path.

As verified on September 19, 2026, the mail decoupling and authoritative-DNS
move are complete, and the production apex is a Cloudflare-managed Custom
Domain on `sbns-news`. `www` remains pending. The application still identifies
itself as Phase 3 staging, so production routing must not be confused with final
public-launch identity cleanup. `PRODUCTION-CUTOVER-BASELINE.md` is the current
operational record.

Never repoint a web apex in a way that accidentally sends MX, mail, cPanel, autodiscover, CalDAV, or CardDAV traffic to the Worker.

A DNS runbook alone is not proof a cutover occurred; the production baseline
records the separately verified operational result.

## 28. Secrets and least privilege

Secrets remain server-side and outside D1.

Use least privilege for:

- Cloudflare API tokens;
- GitHub App permissions;
- Access policies;
- future Turnstile secrets;
- model credentials;
- monitoring integrations.

Do not request workflow or administration permissions merely because they are convenient.

## 29. Audit and provenance

Consequential operations should create durable history for:

- intake creation;
- analysis completion or failure;
- draft revision;
- human decision;
- publication request;
- repository branch or PR creation;
- publication failure;
- deployment;
- verification;
- monitoring decision;
- correction decision.

Normal application behavior must not rewrite audit history.

## 30. Change discipline

Before changing architecture, answer four questions:

1. Which editorial or safety invariant is this component protecting?
2. Is the proposed change replacing implementation or changing the invariant itself?
3. What regression test proves the invariant survives?
4. What is the rollback or recovery path?

Every new infrastructure phase should explicitly enumerate new:

- databases;
- migrations;
- queues;
- secrets;
- Access policies;
- bindings;
- routes;
- cron triggers;
- repository permissions;
- domains.

Nothing is implicitly authorized.

## 31. Durable technical invariants

The following should survive future platform changes:

- public content truth is versioned and inspectable;
- workflow state is not public-content truth;
- AI recommendation is not human decision;
- approval is tied to an exact revision;
- AI never publishes by itself;
- external source content is untrusted;
- AI output is untrusted until deterministic validation;
- browser clients do not receive privileged secrets;
- asynchronous work is idempotent and retriable;
- failures are explicit;
- deployment success requires verification;
- corrections preserve history;
- production changes have bounded rollback paths;
- technical convenience does not silently weaken editorial standards.
