# ShockedButNotSurprised.news History and Provenance

Status: Proposed canonical historical reconstruction
Coverage: Repository origins through the September 18, 2026 Central / September 19, 2026 UTC staging-and-cutover documentation window

## 1. How to read this history

This document separates four kinds of statements:

- Documented: directly evidenced by repository history, code, schemas, migrations, pull requests, or baseline files.
- Implemented: code or infrastructure behavior that exists in the repository or is recorded as successfully deployed.
- Design contract: an approved architecture or editorial specification that may be only partly implemented.
- Reconstruction: a synthesis explaining why multiple documented steps form a coherent development path.

Do not treat a design contract as proof of implementation.

Do not treat a current implementation as proof that it existed earlier.

Do not silently rewrite earlier uncertainty using knowledge acquired later.

## 2. Stage 0 — Original GreenGeeks deployment architecture

### April 2026

Documented repository history begins with a GitHub Actions deployment workflow titled “Build & Deploy to GreenGeeks.”

The workflow:

- checked out the repository;
- used Node 20;
- installed dependencies;
- built a React application;
- supplied a VITE_API_URL pointing to the production PHP stories endpoint;
- deployed the built dist directory to GreenGeeks by FTP;
- excluded the PHP API folder from overwrite.

Historical commit:

53eafe58fef3853558373e5808686225c2064791 — Add GitHub Actions workflow for React app deployment

What this established:

- GreenGeeks as original production hosting;
- GitHub Actions as part of deployment;
- a React frontend;
- a server-side PHP stories path;
- a production domain already associated with the publication.

What it did not establish:

- Cloudflare Workers;
- D1;
- Queues;
- AI analysis;
- repository-managed story JSON;
- formal editorial intake contracts.

The root-level deploy.yml is retained as historical reference.

## 3. Stage 1 — Cloudflare Worker prototype baseline

### August 18, 2026

PR #1: Align SBNS v1 Worker architecture

Merge commit:

bd1ae1bce5f24d7f980c645901f71a6847826231 — Establish SBNS v1 Cloudflare Worker baseline

The repository moved toward a static-first Cloudflare Worker architecture.

Documented changes included:

- dependency-light public HTML, CSS, and JavaScript;
- Worker static assets;
- a public /api/health endpoint;
- six unmistakably fictional sample stories;
- International, National, Local, and all-story prototype filtering;
- a prominent Prototype Edition notice;
- Worker observability;
- no D1 or persistent storage;
- no deployment performed by the PR.

Important preservation choice:

The GreenGeeks deployment artifacts were deliberately left unchanged during the initial Worker rebuild.

Reconstruction:

The project did not begin by replacing every old dependency at once. It first created a controlled new public runtime while keeping rollback and historical continuity.

## 4. Stage 2 — Repository-managed editorial content

### August 18, 2026

PR #2: Add repository-managed editorial content

Merge commit:

ce634593cb1c28ea0adf7bd8f2bd0f8f35667e2b — Establish SBNS v1.2 editorial workflow

This phase introduced the public-content model that remains foundational.

Documented changes:

- one source JSON file per story under content/stories;
- a story template;
- deterministic feed generation;
- draft exclusion from the public feed;
- sample versus reporting content types;
- real source URL requirements for reporting;
- human pull-request review;
- EDITORIAL.md;
- tests for deterministic output and invalid content.

Enduring invariant created here:

content/stories is editorial source; public/stories.json is generated output.

This remains distinct from later D1 workflow state.

## 5. Stage 3 — First five real reporting stories

### August 18–19, 2026

The first five repository-managed reporting stories were drafted and published in sequence.

### Story 001 — DEA fentanyl oversight

PR #3
Published merge commit:

5f14fd051e4a74ac939eae0eda64bd681e0420e1

Core lesson later formalized:

A serious institutional practice may justify high severity without proving that a specific death or injury was caused by that practice.

Invariant:

institutional failure is not proven specific-harm causation.

### Story 002 — DOJ task-force training

PR #4
Published merge commit:

294eff9ca0fc2a3ff2950a395f7dbf910bd11f36

Core lesson:

A system-wide policy weakness can be established even when field-level observations are based on limited sampling.

Do not generalize sampled facts beyond their scope.

### Story 003 — Savanna’s Act and MMIP oversight

PR #5
Published merge commit:

a458298c54198ee01044d24f82d197a11a98e1a7

Core lesson:

Sensitive communities raise the required care for causation, tone, and humor.

Sensitivity increases review requirements; it does not determine publishability.

### Story 004 — UK electronic monitoring

PR #6
Published merge commit:

7ae2001673955f6ac5b96dbd1a5716843a8b3655

Core lesson:

A concerning observed condition may have multiple causes.

Invariant:

observed condition is not automatically institutionally attributable failure.

### Story 005 — Dubuque FY2025 budget audit

PR #7
Published merge commit:

1b4d3ed77952f553f4c6d96fb1fc5eeb7e3a5cfd

Core lesson:

Technical audit language must be read according to scope.

Invariant:

clean audit is not no findings.

The story preserved that an unmodified financial-statement opinion coexisted with a statutory budget finding and no questionable expenditures.

## 6. Stage 4 — v1.4 turns editorial judgment into an explicit contract

### August 19, 2026

PR #8: SBNS v1.4 Administrator intake specification

Merge commit:

14ef9a9c00795cfb53d9e8620f9809686f474ccc

ADMIN-INTAKE-SPEC.md explicitly states that it freezes the editorial decision model learned from Stories 001–005.

The intended workflow became:

Submit URL
→ Analyze
→ Recommend
→ Human Review/Edit
→ Human Approve
→ Publish

Major editorial concepts formalized:

- human publication gate;
- PUBLISH, HOLD, REJECT;
- claim ledger;
- source model;
- source conflicts;
- observed condition versus attributable failure versus specific harm;
- sensitive-subject risk;
- severity rationale;
- kicker target and kicker safety;
- duplicate detection;
- “Do not claim” guardrails;
- corrections and updates.

This was initially a design contract only.

## 7. Stage 5 — v1.4 becomes executable without live AI

### Phase A — Intake analysis contract

PR #9
Merge commit:

95f665e740b70d0d1406602eba5a13bc264054bc

Added:

- request schema;
- analysis schema;
- golden PUBLISH fixture;
- golden HOLD fixture;
- golden REJECT fixture;
- deterministic validation and negative tests.

Significance:

The project turned editorial concepts into machine-checkable contracts before adding live model inference.

### Phase B — Read-only admin prototype

PR #10
Merge commit:

5abd333167936d1ab40c0badff8eb6768243339e

Fixture-backed recommendation display was added without mutation.

### Phase C — Editable human review

PR #11
Merge commit:

dd2111ef4238976d999aea6012bc3d1cca45cb16

Human edits and decisions were kept separate from analyzer output.

### Phase D — Human-gated publication

PR #12
Merge commit:

f00d1a91c01b1586436d60c3b497bbfcb15d29d2

A publication package and deterministic repository-local preparation were added behind explicit approval.

Enduring invariant:

human approval is not publication.

### Phase E — Monitoring and corrections review

PR #13
Merge commit:

c262e605e0182f1fc986965f9d9750c728093cb1

Added deterministic monitoring outcomes:

- no_action;
- update_review;
- correction_review;
- follow_up.

Monitoring could recommend action but could not silently mutate a story.

## 8. Stage 6 — v1.5 production architecture is specified before implementation

### August 19, 2026

PR #14: SBNS v1.5 Production architecture specification

Merge commit:

e973901adfc09f57792e490042247ab102113fbb

The design contract defined the transition from fixture-backed prototype to authenticated, durable, live-assisted editorial system.

Major architecture choices:

- Cloudflare Access for editor authentication;
- D1 for editorial workflow state;
- repository-managed public stories retained;
- Cloudflare Queues for asynchronous work;
- server-side URL retrieval with SSRF protection;
- provider-neutral AI boundary;
- AI Gateway;
- deterministic post-model validation;
- GitHub App for future controlled publication;
- durable monitoring and immutable correction history as later phases.

The specification explicitly did not authorize implementation or infrastructure changes by itself.

## 9. Stage 7 — v1.5 Phase 1 persistence

PR #15
Merge commit:

c03bde85747c1ef5265d805ffd2af6efb612a612

Implemented:

- D1 binding and staging database configuration;
- migration 0001_editorial_foundation.sql;
- persistent intakes;
- analyses;
- sources;
- claims and claim/source links;
- draft revisions;
- decisions;
- publication attempts;
- monitoring events;
- audit events;
- persistence checks and isolated local tests.

PERSISTENCE.md formalized local versus remote migration discipline.

Enduring boundary:

D1 stores editorial workflow state.
Git stores published-story truth.

## 10. Stage 8 — v1.5 Phase 2 authenticated persistent queue

PR #16
Merge commit:

8348f82aca69bd516b819268bc726ba86910c14f

Implemented:

- Cloudflare Access JWT verification;
- persistent admin queue;
- saved drafts;
- persistent decisions;
- migration 0002_admin_queue.sql;
- idempotency records;
- admin API tests;
- JWT tests.

Significance:

Authentication and persistence preceded live AI mutation.

## 11. Stage 9 — v1.5 Phase 3 live editor URL analysis

PR #17
Merge commit:

1ef3770911629d39575576fe8b273ce380ff72e5

Implemented:

- migration 0003_live_analysis.sql;
- persisted analysis jobs;
- analysis queue and DLQ configuration;
- private analysis Worker;
- editor-originated URL intake;
- SSRF-aware server-side retrieval;
- redirect, time, size, and content-type bounds;
- Workers AI document normalization;
- AI Gateway;
- shared schema and semantic validation;
- atomic persistence;
- retries;
- duplicate-delivery handling;
- safe failure states.

At this phase, visitor submissions, autonomous search, publication automation, production resources, and DNS changes remained out of scope.

## 12. Stage 10 — structured AI output repair

PR #18
Merge commit:

cc6ab7a657a15d35b6e7dc7589071624aff828e5

The live analyzer was tightened after compatibility testing.

Changes included:

- canonical JSON Schema structured response formatting;
- bounded token configuration with 4096 default;
- stricter response normalization;
- removal of duplicated prompt schema material;
- continued semantic validation;
- continued source-reference restriction.

Recorded validation baseline:

- 86 Phase 3 analysis scenarios;
- 33 persistence scenarios;
- 39 admin API scenarios;
- 6 JWT scenarios;
- all v1.4 regression suites.

This is a useful development lesson:

A model returning syntactically structured output was not considered enough. Semantic invalidity still had to fail closed.

## 13. Stage 11 — Phase 3.5 reader stabilization

### September 18, 2026

PR #19
Merge commit:

59e180a50054975e68365dfa6909a373f6df7bf3

Changes included:

- reporting-first homepage;
- fictional samples moved behind a clearly labeled prototype archive;
- reader-facing method and editorial-standards sections;
- clearer dates and source labeling;
- clearer distinction between public fixture material and the protected editorial desk;
- STAGING-CHECKLIST.md;
- STAGING-BASELINE.md;
- application/health identity aligned to v1.5 Phase 3 staging.

No deployment was performed by PR #19 itself.

## 14. Stage 12 — automated public Cloudflare staging deployment

### Evening of September 18 Central / September 19 UTC

PR #20 replaced the disabled GreenGeeks GitHub Actions workflow with a scoped public Worker staging deployment.

Follow-on PRs adjusted:

- Node runtime compatibility;
- propagation-aware health retries;
- successful staging baseline recording.

Recorded public staging facts include:

- public Worker: sbns-news;
- staging URL under workers.dev;
- application version 1.5.0;
- health identity: v1.5 phase 3 staging;
- schema version 3;
- 11 published feed records: five reporting and six fictional prototype samples;
- public Worker successfully deployed and smoke-tested;
- no D1 migration performed by the public deployment;
- no admin Worker deployment change;
- no analysis Worker deployment change;
- no production DNS change.

The baseline file deliberately separates repository-verifiable facts from account-only facts that still require live verification.

## 15. Stage 13 — bounded production DNS and apex cutover

PR #24: Add mail-safe production DNS cutover runbook

The runbook records why email cannot be treated as incidental to the web migration.

It separates production migration into:

1. decouple GreenGeeks mail from the web apex;
2. move authoritative DNS while keeping the existing website in place;
3. attach the verified Worker to the production web domain.

Each mutable phase requires separate action-time approval and rollback.

Important historical distinction:

The presence of DNS-CUTOVER-RUNBOOK.md originally proved only that the cutover
had been designed. It did not itself prove that production DNS, nameservers,
mail routing, or Worker custom-domain routing changed.

### September 19, 2026 operational completion record

The separately approved operational phases were subsequently executed and
verified:

- GreenGeeks mail and service records were decoupled from the web apex;
- Cloudflare became authoritative for the active 26-record DNS zone;
- inbound and outbound mail-safety tests passed;
- the legacy apex A record to `69.175.102.130` was removed;
- `shockedbutnotsurprised.news` was attached to `sbns-news` as a Production
  Custom Domain;
- the active deployment remained
  `5a8d207e-f76d-44e9-9306-59467c07211a`;
- no new Worker deployment, route, binding, D1 migration, Queue, AI Gateway,
  DNSSEC, SSL/TLS policy, or nameserver change accompanied the apex operation.

Production reader acceptance verified five reporting stories by default, six
fictional samples isolated in the Prototype archive, working filters, visible
publication dates and sources, methodology and standards content, valid HTTPS,
and a healthy `/api/health` response.

The operational boundary remains intentionally incomplete rather than silently
overstated: `www` is unchanged and pending, and the deployed application still
self-identifies as Phase 3 staging. The exact current state and rollback are
recorded in `PRODUCTION-CUTOVER-BASELINE.md`.

## 16. Stage 14 — public-launch identity and final acceptance

### September 19, 2026

PR #27, squash merge:

`73880369f2ddb042756d6d2ea4efdf7cc8c6d437`

The public-launch identity release followed the apex cutover rather than being
retroactively folded into it. It changed `Staging Edition` to `Public Edition`,
changed the health identity from `v1.5 phase 3 staging` to `v1.5 production`,
and updated the scoped deployment assertion accordingly.

GitHub Actions `Deploy public Worker` run #6 (`35485324877`) succeeded. Active
Worker version `fb71aeed-7fe0-482a-a9eb-6cb5a7e6461f` received 100% of
production traffic. Final reader, health, DNS/routing, HTTPS, and mail/service
preservation checks passed with non-blocking follow-up for `www` and one local
resolver cache.

The formal checkpoint is recorded in `PUBLIC-LAUNCH-BASELINE.md`. No visitor
submission, publication-orchestration, monitoring, correction-publication,
SPF, DMARC, mail, or `www` implementation was included.

## 17. Architectural pattern across the history

A recurring development pattern appears throughout the repository:

### Preserve before replacing

Legacy deployment files were retained while new architecture was proven.

### Contract before automation

Editorial schemas and fixtures preceded live AI.

### Persistence before live mutation

D1 arrived before live editor analysis.

### Authentication before privileged mutation

Cloudflare Access arrived before live analyzer-driven editorial state.

### Editor-only before public intake

Live editor URLs came before visitor submissions.

### Human approval before publication automation

Publication remained gated even as analysis became automated.

### Staging before production routing

Public Worker staging was proven before production DNS cutover.

### Correction semantics before correction automation

Monitoring fixtures defined no-action, update, correction, and follow-up before durable correction mutation.

Reconstruction:

The project evolved through deliberately bounded increments rather than a single “AI news site” leap. The operating philosophy has been to automate the repeatable work while preserving human authority at the points where meaning, accountability, publication, and historical correction are decided.

## 18. Current status classification

### Implemented and active in repository

- repository-managed public stories;
- deterministic public feed;
- reporting-first public reader;
- D1 persistence;
- migrations 0001–0003;
- authenticated admin queue code;
- live editor URL analysis code;
- Queue and DLQ configuration;
- source-retrieval safety controls;
- structured model output validation;
- draft revisions and human decisions;
- public staging deploy workflow;
- staging checklist and baseline.

### Recorded as formally public-launched

- sbns-news public Worker;
- public homepage;
- /api/health;
- v1.5 production identity;
- production apex Custom Domain with valid HTTPS;
- Cloudflare-managed proxied Worker record at the apex;
- preserved GreenGeeks mail and service infrastructure.

### Active design or operational plan, not proof of completion

- `www` Worker attachment or canonical redirect;
- visitor submissions;
- GitHub App draft-PR publication orchestration;
- durable live monitoring;
- immutable public correction history;
- later role expansion.

## 19. Provenance maintenance

When future phases are added, update this document with:

- date;
- PR number;
- merge commit;
- what changed;
- what did not change;
- whether infrastructure was merely specified, implemented, deployed, or verified;
- the editorial or technical invariant the change was intended to protect.

Do not replace this history with a cleaner summary that loses why safeguards were introduced.
