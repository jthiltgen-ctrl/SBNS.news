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

The public frontend is dependency-free HTML, CSS, and JavaScript. Its design
system uses:

- Bebas Neue for headlines and nameplate;
- Lora for editorial copy;
- Special Elite for kickers and taglines;
- Barlow Condensed for labels and metadata;
- paper `#f2ede3`, ink `#1a1714`, and red `#b91c1c`.

Reporting is the default public view. Fictional fixtures remain available only
as a clearly separated prototype archive. Reporting sources render as safe
external links; topic tags remain visually and semantically separate.

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
reference. `.github/workflows/deploy.yml` is the active, scoped public Worker
deployment workflow.
