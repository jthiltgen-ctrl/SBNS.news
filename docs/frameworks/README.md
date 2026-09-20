# ShockedButNotSurprised.news Framework Registry

Status: Proposed canonical synthesis
Prepared: September 18, 2026 Central / September 19, 2026 UTC repository window
Scope: Editorial governance, technical governance, historical provenance, and operator practice

## Purpose

This directory preserves the operating ideas that built ShockedButNotSurprised.news from its first repository deployment work through the current Cloudflare production reader and staged editorial architecture. It is also meant to keep those ideas usable as the publication evolves.

The public and canonical name is ShockedButNotSurprised.news. SBNS remains a legacy and internal abbreviation in repository history, runtime resource names, schemas, and older documents. Renaming those technical identifiers is a separate change and is not implied by this framework package.

The core preservation rule is:

Editorial principles, technical controls, and implementation details must remain distinguishable.

A new implementation may replace an old tool. It must not silently replace the editorial reason the tool existed.

## Canonical framework set

### EDITORIAL-FRAMEWORK.md

The editorial constitution and decision system.

It governs:

- mission and scope;
- institutional and systemic accountability fit;
- evidence, sourcing, chronology, attribution, and causation;
- qualification and uncertainty;
- sensitive-subject review;
- severity and category;
- humor and kicker safety;
- PUBLISH, HOLD, and REJECT decisions;
- human editorial authority;
- corrections, updates, and follow-ups;
- research stoppage and no-action states.

### TECHNICAL-FRAMEWORK.md

The durable technical control framework.

It governs:

- source-of-truth boundaries;
- public, admin, analysis, database, queue, and repository roles;
- authentication and authorization;
- untrusted-input boundaries;
- source retrieval safety;
- AI structured-output validation;
- persistence and audit history;
- idempotency and retries;
- staging and production separation;
- publication orchestration boundaries;
- testing, release, observability, and recovery.

### HISTORY-AND-PROVENANCE.md

The reconstruction of how the publication developed.

It distinguishes:

- documented repository history;
- design contracts;
- implemented controls;
- current operational baseline;
- legacy artifacts;
- future or not-yet-authorized capabilities.

### OPERATOR-RUNBOOK.md

The practical operating sequence for ordinary use.

It covers:

- intake and triage;
- evidence review;
- human decisions;
- drafting and publication preparation;
- staging checks;
- migrations;
- monitoring and corrections;
- release gates;
- incident response;
- framework maintenance.

## Framework hierarchy

When documents appear to conflict, use this order unless a later explicitly approved change says otherwise:

1. EDITORIAL-FRAMEWORK.md for editorial principles and publication judgment.
2. TECHNICAL-FRAMEWORK.md for technical safety and architecture invariants.
3. Current schemas, migrations, tests, and runtime configuration for implemented behavior.
4. OPERATOR-RUNBOOK.md for ordinary procedure.
5. Current launch and staging baselines and checklists for environment-specific facts.
6. Historical specifications for provenance and design intent.

Implementation does not overrule the editorial constitution merely because code can do something.

A historical specification does not prove that a feature was implemented.

A future roadmap item does not authorize deployment.

## Existing documents and status

### Active supporting documents

- EDITORIAL.md — original repository-managed editorial workflow. Its core rules are incorporated into the editorial framework.
- PERSISTENCE.md — active D1 migration and recovery rules.
- STAGING-CHECKLIST.md — active ordinary staging acceptance routine.
- STAGING-BASELINE.md — preserved staging checkpoint; account-only facts remain explicitly marked when unverified.
- PRODUCTION-CUTOVER-BASELINE.md — verified apex-cutover snapshot and rollback record.
- PUBLIC-LAUNCH-BASELINE.md — formal production launch acceptance and current non-blocking follow-up.
- DNS-CUTOVER-RUNBOOK.md — completed cutover procedure retained for chronology, safeguards, and rollback; the baselines provide proof of the executed results.
- README.md and PROJECT.md — current product and repository map.

### Historical design contracts with continuing principles

- ADMIN-INTAKE-SPEC.md — v1.4 specification distilled from the first five reporting stories. Many editorial rules remain canonical even though later persistence and live analysis changed implementation.
- V1.5-ARCHITECTURE-SPEC.md — production-architecture design contract. Some phases are implemented; later phases remain roadmap items.

### Regression and executable contracts

- intake/schemas and intake/fixtures;
- monitoring/schemas and monitoring/fixtures;
- publication schemas and fixtures;
- migrations/0001 through 0003;
- scripts for content, intake, monitoring, publication, persistence, admin API, and analysis;
- npm run check and Worker dry runs.

Fixtures are test assets. They are not editorial precedent merely because a synthetic example passes a test.

### Legacy artifacts

- root deploy.yml — historical GreenGeeks deployment reference;
- April 2026 React/FTP/PHP deployment architecture recorded in repository history;
- fictional prototype stories — preserved only as clearly labeled prototype archive and regression/demo material.

## Change classification

Every future framework change should be labeled as one of the following:

### Editorial principle change

Changes what the publication believes constitutes responsible reporting or publication.

Requires explicit human editorial approval and a provenance note.

### Technical control change

Changes how an invariant is enforced without changing the invariant itself.

Requires tests and a migration or rollback plan when stateful.

### Operational procedure change

Changes the ordinary sequence used by the operator.

Must remain consistent with the editorial and technical frameworks.

### Environment baseline change

Records a deployment, resource, version, secret configuration, route, or infrastructure fact.

Must identify what was verified and what remains unverified.

### Historical correction

Corrects the reconstruction of what previously happened.

Must preserve the prior record or explain the correction rather than silently rewriting history.

## Preservation rules

- Preserve original specifications even after they are superseded operationally.
- Prefer additive framework revisions over deleting old reasoning.
- Record why a control was introduced, not only what the control does.
- Separate documented fact from reconstruction or inference.
- Preserve negative findings and limitations.
- Never backfill certainty into a historical decision that originally contained uncertainty.
- Do not treat a working deployment as proof that the editorial model is correct.
- Do not treat an editorial principle as proof that the implementation enforces it.
- Keep public story truth separate from internal workflow state.
- Keep recommendation separate from human decision.
- Keep approval separate from publication.
- Keep publication separate from successful deployment and live verification.
- Keep later developments separate from correction unless the earlier reporting was actually wrong.

## Review cadence

Review this framework package when any of the following occurs:

- a public-content schema changes;
- a new intake origin is enabled;
- visitor submissions go live;
- a new model or provider materially changes analysis behavior;
- publication automation gains new repository permissions;
- production DNS or hosting changes;
- monitoring becomes durable and scheduled;
- correction history becomes public;
- an editorial failure reveals a missing rule;
- a technical incident reveals an unenforced invariant.

The goal is not to freeze ShockedButNotSurprised.news in 2026. The goal is to make change legible, reversible where possible, and faithful to the reasons the publication was built the way it was.
