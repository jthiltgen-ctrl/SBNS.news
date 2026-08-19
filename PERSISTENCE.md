# SBNS Persistence Operations

SBNS v1.5 Phase 1 introduces durable editorial-state foundations without connecting the browser or public API to persistence.

## Source-of-truth boundary

Cloudflare D1 stores editorial workflow state. Git remains the published-story source of truth in `content/stories/*.json`, with `public/stories.json` generated deterministically.

A D1 approval record does not prove that a repository PR was opened, merged, deployed, or verified.

## Staging database

- Database: `sbns-editorial-staging`
- Worker binding: `SBNS_DB`
- Worker access: `env.SBNS_DB`
- Migration directory: `migrations/`
- Production database: none
- Preview database: none

## Local and remote rule

Development and tests always use Wrangler's local D1 state. Ordinary validation must never apply remote migrations.

```sh
npx wrangler d1 migrations apply SBNS_DB --local
npx wrangler d1 migrations list SBNS_DB --local
npm run persistence:check
npm run persistence:test
```

The persistence scripts create isolated temporary local state with `--local --persist-to` and remove it after each run.

Remote staging migration is an explicit post-merge rollout action only:

```sh
npx wrangler d1 migrations list SBNS_DB --remote
npx wrangler d1 migrations apply SBNS_DB --remote
```

Do not run the remote apply command during PR development or from `npm run check`.

## Schema overview

Migration `0001_editorial_foundation.sql` creates:

- `sbns_meta`
- `intakes`
- `analyses`
- `sources`
- `claims`
- `claim_sources`
- `editorial_drafts`
- `editorial_decisions`
- `publication_attempts`
- `monitoring_events`
- `audit_events`

Application-generated opaque TEXT IDs, ISO-8601 UTC TEXT timestamps, constrained integer booleans, foreign keys, immutable draft revisions, and append-only audit behavior establish the persistence contract. JSON stored as TEXT must be validated by application code before insertion.

No `submission_contacts` table exists in Phase 1.

## Recovery

Migrations move forward; there is no automatic destructive down migration. A failing D1 migration is rolled back while earlier successful migrations remain applied.

Before live editorial data exists, a broken initial staging migration should be fixed and reapplied. Recreating the staging database is an exceptional manual recovery action and must never happen automatically. Once durable editorial data exists, destructive recreation is not a normal recovery path.
