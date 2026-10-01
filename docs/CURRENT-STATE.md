# SBNS Current State & Website Status

As of: October 1, 2026 (Central)
Repository baseline: `main` at `85e262a04c848de43a98cac9fb9f8d3b16fd8917`
Status purpose: living project and website baseline for the transition from infrastructure build-out to editorial-production optimization.

## Executive state

Shocked But Not Surprised is no longer blocked on basic public-site infrastructure.

The publication now has the core reader and discovery substrate needed to support an editorial-first operating period: canonical story pages, deterministic story generation, branded share assets, explicit search-indexing readiness, robots and sitemap output, RSS, a native Follow SBNS control, public accountability/transparency surfaces, a protected editorial desk, persistent editorial state, Watchdesk discovery, and a bounded scheduled discovery path.

The principal unresolved technical item is PR #44, deterministic Echo Desk orchestration. It is an implementation closeout item, not a reason to continue general feature development.

The next operating emphasis should therefore be editorial quality, production ergonomics, story distinctiveness, and publish-worthy output. Technical work should be frozen by default unless it protects reliability, removes recurring editorial burden, or fixes friction observed during real story production.

## Repository and deployment state

### Current main

Current `main`:

`85e262a04c848de43a98cac9fb9f8d3b16fd8917`

Latest main-line changes include:

- PR #38 — Watchdesk evidence-state and GAO-feed tuning;
- PR #39 — bounded Watchdesk scheduling;
- PR #40 — Editorial Desk newsroom-workspace redesign;
- PR #41 — explicit search-indexing readiness;
- PR #42 — Echo Desk durable persistence contracts;
- PR #43 — transparency and ordinary editorial-contact reconciliation;
- PR #45 — open reporting RSS feed and Follow SBNS control.

The latest GitHub Actions runs associated with current main reported success for both the public and admin deployment workflows.

This record treats workflow success as deployment evidence. It does not convert unavailable external observability into a stronger claim of live-site verification than the evidence supports.

### Open pull requests

Only one pull request is open:

- PR #44 — **Add deterministic Echo Desk orchestration**
- state: open draft;
- head: `d7d3d714338bc1d8fb6f2cae904a105ff9c1b354`;
- GitHub reports it mergeable;
- relative to current main, the branch is two commits ahead and one commit behind;
- the one-behind condition exists because PR #45 landed after PR #44's merge base.

Efficient closeout path:

1. integrate current main into PR #44;
2. run one full combined-tree validation;
3. resolve only defects that block the defined orchestration contract;
4. make one merge/no-merge decision;
5. stop.

Do not begin another technical feature merely because PR #44 closes.

## Data and persistence state

Repository migrations now include:

- `0001_editorial_foundation.sql`
- `0002_admin_queue.sql`
- `0003_live_analysis.sql`
- `0004_watchdesk_runs.sql`
- `0005_echo_durable_contracts.sql`

Older framework records that describe migrations 0001–0003 as the current state are stale and should not be used as the implementation baseline.

Current source-of-truth boundaries remain:

- D1 = internal editorial workflow and durable operational state;
- `content/stories/` = public-story source of truth;
- generated public artifacts = deterministic outputs, not authoring sources.

## Public reader and discovery state

Current repository output includes:

- reporting-first homepage;
- canonical permanent story pages;
- branded share-card assets;
- Share and Copy Link functionality;
- `robots.txt`;
- `sitemap.xml`;
- reporting RSS at `/feed.xml`;
- Follow SBNS controls;
- locally served brand fonts and adopted SBNS visual system;
- ordinary editorial contact with the public address protected from simple scraping;
- public accountability and AI-use transparency;
- Prototype archive separated from reporting;
- optional Receipt, Number, and Timeline evidence components.

Search-indexing readiness is implemented in code. Reliable external indexed coverage is not established by this record. Search Console metrics were not available for this review, and a general web search is not a substitute for Search Console coverage data.

## Published-content state

The repository currently contains:

- 6 published reporting stories;
- 6 published fictional sample stories, segregated as Prototype material;
- 1 reporting draft that is excluded from the public feed.

The September 20 FAA/GAO story is the first published reporting story using the evidence grammar and currently includes two public evidence components:

- Receipt;
- Number.

No publication quota follows from this count. The relevant next question is whether the current system can repeatedly produce stories that are worth a reader's time and distinct enough to justify return visits.

## Editorial and discovery system state

### Editorial Desk

The protected Editorial Desk has been redesigned as a newsroom workspace. Persistent editorial records, analysis state, human revisions, decisions, and audit history remain separate from public publication.

Human editorial authority remains final.

### Watchdesk

Watchdesk is implemented as a bounded discovery system with:

- curated public-source registry;
- normalization;
- filtering;
- deduplication;
- substantive-fit gate;
- submission-readiness gate;
- Rabbit Hole Triage;
- bounded discovery leads;
- 0–5 submission-ready candidates per run;
- durable run ledger and lease protections;
- manual dry and live run controls;
- scheduled execution configured at `0 14,23 * * *` UTC.

Scheduled discovery is not automated journalism. Discovery, research, editorial analysis, approval, publication, and live verification remain separate authorities.

### Echo Desk

Echo durable persistence contracts are merged on main through PR #42.

Deterministic Echo orchestration remains in draft PR #44. Until PR #44 is merged and verified, Echo orchestration should be described as implemented in the draft branch, not as active main-line capability.

## Business, audience, and growth state

The current operating phase is **Audience & Option Validation**, not scale.

The controlling business posture is:

- audience first;
- no content quota;
- no traffic target manufactured for validation;
- no revenue target manufactured for validation;
- normal founder burden roughly 2–4 hours per week;
- target $0 new recurring software spend during validation;
- soft recurring ceiling $25/month only when evidence justifies it;
- $0 paid acquisition until measurement and direct-reader conversion are working;
- measure before scaling;
- stop when marginal value falls below founder burden.

Priority measurement sequence remains:

1. reliable analytics baseline;
2. story-level measurement;
3. referral and sharing behavior;
4. search/indexing;
5. direct-reader capture;
6. bounded distribution experiments only after organic evidence.

Current reliable metrics for Reach, Loyalty, Depth, Sharing, Direct Relationship, Authority, Economics, and conversion were not available in this review. Do not backfill estimates.

## Risk and debt register

### High-value near-term risks

**Technical drift after the system is already adequate.**
The main risk is continuing to build because build work is available rather than because editorial production has demonstrated a bottleneck.

**Framework/documentation drift.**
The canonical framework package still reflects portions of the September 19 state and understates later Watchdesk, persistence, indexing, newsroom, and follow/feed work.

**Content-to-infrastructure imbalance.**
The platform is becoming more capable faster than the reporting archive is becoming deeper. The reader-facing value proposition ultimately depends on reporting, not internal architecture.

**Founder burden.**
A sophisticated internal system is only valuable if it reduces repeated judgment and production cost rather than creating a second job maintaining the system.

### Known evidence gaps

Unavailable or not verified in this review:

- current Search Console coverage and query data;
- reliable site reach and returning-reader metrics;
- share/copy event counts;
- direct-reader conversion;
- subscriber counts, if any;
- story-level engagement;
- production time per story;
- Watchdesk-to-published-story conversion;
- Echo operational value after orchestration;
- current production D1 row counts and queue state.

These are measurement gaps, not invitations to invent targets.

## Operating transition

Current mode is **Build transitioning to Normal editorial operation**.

The transition gate is deliberately small:

- close PR #44 through one combined-tree validation and decision;
- reconcile the canonical/living project records;
- then freeze feature work by default.

After that point, the preferred normal state is editorial production.

Mode may become Active Story or Surge when evidence warrants it. It should not remain Build simply because additional technical ideas exist.

## Next sprint direction

The next roughly 7–10 days should prioritize:

1. the first genuinely worthy candidate that can exercise the production system end to end;
2. research/evidence quality and background-before-conclusion discipline;
3. better editorial transformation from evidence packet to readable SBNS story;
4. distinctive but bounded use of Receipt, Number, Timeline, chronology, institutional response, and SBNS voice;
5. production ergonomics and founder-burden measurement;
6. publication acceptance, permalink/share/feed/search hygiene as routine completion, not a separate product project;
7. only observed workflow friction as a trigger for technical change.

A zero-publication day is normal. A zero-publication sprint is acceptable if no candidate clears the editorial threshold. The purpose is not to feed a cadence; it is to improve the probability that worthy material becomes high-quality published work without unnecessary founder burden.

## Current stop rules

Stop technical refinement when:

- the current story can be responsibly produced without the change;
- the improvement is aesthetic or architectural rather than decision-changing;
- the benefit is speculative;
- another tool creates an ongoing maintenance obligation;
- a paid product does not clearly remove more recurring burden than it adds;
- the problem has not appeared in a real production cycle.

Stop research when:

- the material claims needed for a responsible decision are established;
- additional sources are repetitive rather than decision-changing;
- the candidate has reached a legitimate HOLD, REJECT, ROUTE, or NO ACTION state;
- a future event or unavailable record is the real dependency.

## Next review trigger

Update this living record when one of the following materially changes:

- PR #44 merges or is closed;
- a new public story is published;
- Search Console or analytics begins producing reliable decision-useful data;
- direct-reader capture goes live;
- a real editorial-production cycle exposes a repeated bottleneck;
- a new recurring cost is proposed;
- a major technical or editorial control changes.
