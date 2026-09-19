# Shocked But Not Surprised

SBNS v1.5 is a static-first accountability publication with a separate,
authenticated editorial system. Published stories remain repository-managed;
durable editorial workflow state lives in Cloudflare D1.

The governing rule is simple: AI may help analyze evidence, but human editorial
judgment remains authoritative and publication remains intentional.

## Runtime surfaces

- `sbns-news`: public website and `GET /api/health`
- `sbns-admin`: Cloudflare Access-protected editorial queue and admin API
- `sbns-analysis`: private Queue consumer for bounded source retrieval and
  structured analysis
- `sbns-editorial-staging`: staging D1 editorial database

See [V1.5-ARCHITECTURE-SPEC.md](V1.5-ARCHITECTURE-SPEC.md) for the complete
trust boundaries and rollout sequence.


## Editorial and technical frameworks

The preserved operating framework for ShockedButNotSurprised.news lives in
[docs/frameworks/](docs/frameworks/README.md). It separates the durable
editorial constitution, technical safety controls, historical provenance, and
day-to-day operator procedure so implementation changes do not silently change
the publication's standards.

## Local development

```sh
npm ci
npm run content:build
npm run dev
```

The default development command serves the public Worker. The admin and
analysis Workers use `wrangler.admin.jsonc` and `wrangler.analysis.jsonc`.

## Validation

```sh
npm run check
```

The check suite validates source-controlled stories, intake and monitoring
contracts, human-gated publication preparation, D1 persistence, authenticated
admin APIs, live-analysis safety boundaries, and all three Worker builds. It
uses isolated local D1 state and does not deploy or apply remote migrations.

## Editorial content

Each published or draft story is maintained as one JSON file under
`content/stories/`. Start from `content/story-template.json` and follow
[EDITORIAL.md](EDITORIAL.md).

```sh
npm run content:build
npm run content:check
```

`public/stories.json` is generated deterministically. Do not edit it manually.
Drafts never enter the public feed.

## Operations and deployment records

- [STAGING-CHECKLIST.md](STAGING-CHECKLIST.md) contains the short acceptance
  routine for the public site and protected editorial desk.
- [STAGING-BASELINE.md](STAGING-BASELINE.md) records the known deployed
  configuration and explicitly marks account-only facts that still require
  Cloudflare dashboard verification.
- [PRODUCTION-CUTOVER-BASELINE.md](PRODUCTION-CUTOVER-BASELINE.md) records the
  verified September 19, 2026 production-apex cutover, preserved GreenGeeks
  mail boundary, pending `www` work, and exact web rollback.
- [PERSISTENCE.md](PERSISTENCE.md) defines local/remote migration boundaries.
- [DNS-CUTOVER-RUNBOOK.md](DNS-CUTOVER-RUNBOOK.md) separates the
  authoritative-DNS move from the production Worker cutover and preserves the
  GreenGeeks mail path.

## Deployment boundary

Deployment, remote migrations, production DNS, nameservers, public visitor
submissions, and automated repository publication require separate
authorization. `.github/workflows/deploy.yml` validates and deploys only the
public `sbns-news` staging Worker after changes reach `main`; it requires the
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` secrets in the `staging`
GitHub environment. The root-level legacy GreenGeeks `deploy.yml` remains as a
historical reference and is not invoked by GitHub Actions.
