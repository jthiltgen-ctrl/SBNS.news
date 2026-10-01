# SBNS v1.5 Project Map

## Product

**Shocked But Not Surprised (SBNS)** is an accountability news project covering institutional and systemic failures with factual reporting and weary, dark humor.

Tagline: **Another day. Another system that had one job.**

Its editorial voice punches up at powerful institutions and never down at people living with the consequences.

## Current operating posture

As of October 1, 2026, SBNS is transitioning from **Build** into **Normal editorial operation**.

The public and editorial infrastructure is mature enough that the default next move is no longer another feature. The default next move is to use the system on worthy reporting, observe real production friction, measure founder burden, and change the tooling only when evidence shows a meaningful bottleneck.

See:

- [docs/CURRENT-STATE.md](docs/CURRENT-STATE.md)
- [docs/AUDIENCE-OPTION-VALIDATION.md](docs/AUDIENCE-OPTION-VALIDATION.md)
- [docs/EDITORIAL-PRODUCTION-SPRINT-2026-10.md](docs/EDITORIAL-PRODUCTION-SPRINT-2026-10.md)

## Current architecture

```text
Public reader
  `-- sbns-news ----------------------> repository-generated story pages/feed
           |                              robots / sitemap / RSS / share/follow
           |
           `-- canonical story URLs

Authenticated editor
  `-- Cloudflare Access -> sbns-admin -> D1 editorial state
                                  |
                                  |-> Watchdesk discovery + run ledger
                                  |-> Echo durable state
                                  |
                                  `-> analysis Queue
                                          |
                                          `-> sbns-analysis -> Workers AI
```

Source-of-truth boundaries:

```text
D1                  = internal editorial and durable operational state
content/stories/    = published-story source of truth
public/stories.json = deterministic generated public feed
public/story/       = deterministic generated canonical story pages
```

The public, admin, and analysis Workers remain deliberately separate. Browser clients never receive model or repository credentials. Fetched pages and model outputs remain untrusted until deterministic validation succeeds.

## Implemented editorial and admin capabilities

Current main-line capabilities include:

- versioned D1 migrations through `0005_echo_durable_contracts.sql`;
- persistent intake, analysis, draft, decision, job, idempotency, audit, Watchdesk-run, and Echo durable records;
- Cloudflare Access JWT verification for the protected admin API;
- mobile-first newsroom workspace;
- editor-originated URL intake;
- Queue-backed analysis and dead-letter handling;
- bounded server-side source retrieval with SSRF and redirect protections;
- Workers AI analysis through AI Gateway with cache bypass;
- JSON Schema plus deterministic semantic validation;
- human-authored draft revisions and approve, hold, or reject decisions;
- repository-local, human-gated publication-package preparation;
- Watchdesk discovery with deterministic fit/readiness gates and Rabbit Hole Triage;
- durable Watchdesk run/lease protections and bounded scheduling;
- Echo durable persistence contracts.

PR #44, deterministic Echo Desk orchestration, remains open and draft. It is not active main-line capability until merged and verified.

## Reader-facing frontend

The public frontend is dependency-free HTML, CSS, and JavaScript. Its adopted Brand Guide treatment uses locally served EB Garamond and Inter with Ink Black, Newsprint Gray, Slate, Paper White, Signal Red, and Rule Gray.

Reporting is the default public view. Fictional fixtures remain available only as a clearly separated Prototype archive.

Current reader/discovery capabilities include:

- deterministic initial-HTML reporting;
- canonical permanent story pages;
- branded share-card assets;
- Share and Copy Link controls;
- reporting RSS at `/feed.xml`;
- native Follow SBNS control;
- `robots.txt`;
- `sitemap.xml`;
- explicit search-indexing readiness;
- public accountability and AI-use transparency;
- ordinary editorial contact with simple anti-scraping protection.

The content model supports an optional maximum of three explicitly ordered, source-grounded Receipt, Number, or Timeline components. The FAA/GAO reporting story currently uses Receipt and Number.

See [PUBLIC-EDITORIAL-GRAMMAR.md](PUBLIC-EDITORIAL-GRAMMAR.md).

## Public-content state

Current repository content:

- 6 published reporting stories;
- 6 published fictional sample stories segregated as Prototype material;
- 1 reporting draft excluded from the public feed.

There is no publication quota. Content count is an inventory fact, not a cadence requirement.

## Public-launch and deployment state

The canonical apex and v1.5 production reader completed formal public-launch acceptance on September 19, 2026. The post-launch `www` canonical redirect is complete.

Later main-line changes have continued through scoped GitHub Actions deployment workflows.

At the October 1 baseline, the latest public and admin deployment workflows associated with current main both report success.

Environment truth remains distinct from repository intent. See:

- [PUBLIC-LAUNCH-BASELINE.md](PUBLIC-LAUNCH-BASELINE.md)
- [PRODUCTION-CUTOVER-BASELINE.md](PRODUCTION-CUTOVER-BASELINE.md)
- [ADMIN-DEPLOYMENT.md](ADMIN-DEPLOYMENT.md)

## Current closeout item

The only open pull request is PR #44: **Add deterministic Echo Desk orchestration**.

Efficient closeout:

1. integrate current `main`;
2. run focused tests if needed;
3. run one full combined-tree validation;
4. repair only contract-blocking defects;
5. make the merge/no-merge decision;
6. stop technical expansion.

Closing PR #44 does not authorize another feature cycle.

## Audience and option validation

The active business/growth phase is October–December 2026 Audience & Option Validation.

Core posture:

- audience first;
- no content quota;
- no manufactured traffic or revenue target;
- normal founder burden roughly 2–4 hours/week;
- target $0 new recurring software spend;
- soft recurring ceiling $25/month when evidence justifies it;
- $0 paid acquisition until measurement and direct-reader conversion work;
- measurement before scale;
- stop when marginal value is lower than founder burden.

See [docs/AUDIENCE-OPTION-VALIDATION.md](docs/AUDIENCE-OPTION-VALIDATION.md).

## Next sprint

The next approximately 7–10 days are an editorial-production sprint.

Use real story work to optimize:

- candidate quality;
- evidence packets;
- background and chronology;
- claim/qualification discipline;
- institutional response;
- distinctive Receipt / Number / Timeline use where justified;
- SBNS voice and kicker quality;
- candidate-to-publication ergonomics;
- founder-burden measurement.

Technical work is freeze-by-default and becomes eligible only when a real production cycle exposes repeatable friction, quality risk, or unnecessary labor.

See [docs/EDITORIAL-PRODUCTION-SPRINT-2026-10.md](docs/EDITORIAL-PRODUCTION-SPRINT-2026-10.md).

## Development and validation

```sh
npm ci
npm run content:build
npm run dev
npm run check
```

`npm run check` uses local isolated state and performs dry runs only. It does not deploy, mutate the remote database, or create Cloudflare resources.

## Deployment files

The root `deploy.yml` is a legacy GreenGeeks artifact retained for historical reference.

`.github/workflows/deploy.yml` deploys the public Worker with `wrangler.jsonc`.

`.github/workflows/deploy-admin.yml` deploys the protected admin Worker with `wrangler.admin.jsonc`.

Qualifying pushes or merges to `main` may run either or both workflows. Inspect trigger consequences before merge authorization.
