# SBNS v1.5 Project Map

## Product

**Shocked But Not Surprised (SBNS)** is an iPhone-first accountability news
project covering institutional and systemic failures with factual reporting and
weary, dark humor. Its editorial voice punches up at powerful institutions and
never down at people living with the consequences.

Tagline: **Another day. Another system that had one job.**

## Current architecture

```text
Public reader
  `-- sbns-news ----------------------> repository-generated story feed

Authenticated editor
  `-- Cloudflare Access -> sbns-admin -> D1 editorial state
                                  |
                                  `-> analysis Queue
                                          |
                                          `-> sbns-analysis -> Workers AI
```

Source-of-truth boundaries:

```text
D1                  = editorial workflow state
content/stories/    = published-story source of truth
public/stories.json = deterministic public feed
```

The public, admin, and analysis Workers remain deliberately separate. Browser
clients never receive model or repository credentials. Fetched pages and model
outputs remain untrusted until deterministic validation succeeds.

## Implemented through Phase 3

- versioned D1 migrations and persistent intake, analysis, draft, decision,
  job, idempotency, and audit records;
- Cloudflare Access JWT verification for the protected admin API;
- persistent mobile-first editorial queue;
- editor-originated URL intake;
- Queue-backed analysis and dead-letter handling;
- bounded server-side source retrieval with SSRF and redirect protections;
- Workers AI analysis through AI Gateway with cache bypass;
- JSON Schema plus deterministic semantic validation;
- human-authored draft revisions and approve, hold, or reject decisions;
- repository-local, human-gated publication-package preparation;
- deterministic monitoring and corrections fixtures retained for regression.

## Reader-facing frontend

The public frontend is dependency-free HTML, CSS, and JavaScript. Its adopted
Brand Guide treatment uses locally served EB Garamond and Inter with Ink Black,
Newsprint Gray, Slate, Paper White, Signal Red, and Rule Gray.

Reporting is the default public view. Fictional fixtures remain available only
as a clearly separated prototype archive. Reporting sources render as safe
external links; topic tags remain visually and semantically separate.

Published reporting is rendered deterministically into the initial homepage
HTML from `content/stories/*.json`. JavaScript progressively adds filtering,
Prototype archive access, refresh, and status messaging; it is not required to
discover or navigate current reporting. The reader also identifies Justin
Thiltgen as editor and publisher, adds the same factual attribution to canonical
story pages, and exposes one homepage transparency surface for editorial and
AI-use accountability. See [READER-ACCOUNTABILITY.md](READER-ACCOUNTABILITY.md).

The content model and static story generator also support an optional maximum
of three explicitly ordered, source-grounded Receipt, Number, or Timeline
components. No current published story uses them; a real-story pilot remains a
separate editorial decision. See
[PUBLIC-EDITORIAL-GRAMMAR.md](PUBLIC-EDITORIAL-GRAMMAR.md).

## Public-launch state and remaining v1.5 sequence

The canonical apex and v1.5 production reader completed formal public-launch
acceptance on September 19, 2026. See
[PUBLIC-LAUNCH-BASELINE.md](PUBLIC-LAUNCH-BASELINE.md). Remaining numbered
phases are product options, not launch blockers:

The post-launch `www` canonical redirect is complete. The only known
infrastructure discrepancy is temporary local resolver/cache convergence.

1. Recheck local resolver convergence without changing authoritative DNS.
2. Add abuse-resistant visitor submissions with Turnstile if product need
   justifies opening public intake.
3. Add controlled GitHub App draft-PR publication orchestration.
4. Back monitoring with durable, queue-driven live records when monitoring
   demand and policy are defined.
5. Add immutable correction and update publication history before automating
   public historical mutation.

No later phase is implicitly authorized by the existence of this project map.
A real-story Receipt · Number · Timeline pilot and the Newsroom Workbench remain
explicitly deferred; the available public grammar infrastructure does not
publish evidence components on its own.

## Development and validation

```sh
npm ci
npm run content:build
npm run dev
npm run check
```

`npm run check` uses local isolated state and performs dry runs only. It does not
deploy, mutate the remote database, or create Cloudflare resources.

## Deployment files

The root `deploy.yml` is a legacy GreenGeeks artifact retained for historical
reference. `.github/workflows/deploy.yml` deploys the public Worker with
`wrangler.jsonc`; `.github/workflows/deploy-admin.yml` deploys the protected
admin Worker with `wrangler.admin.jsonc`. Qualifying pushes or merges to `main`
may run either or both workflows. Their trigger consequences must be inspected
and reported before future merge authorization. See
[ADMIN-DEPLOYMENT.md](ADMIN-DEPLOYMENT.md) for the admin trigger, validation,
and protected machine-health verification boundary.
