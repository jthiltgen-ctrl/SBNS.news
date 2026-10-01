# SBNS Persistence Operations

SBNS v1.5 Phase 1 introduces durable editorial-state foundations without connecting the browser or public API to persistence.

## Source-of-truth boundary

Cloudflare D1 stores editorial workflow state. Git remains the published-story source of truth in `content/stories/*.json`, with `public/stories.json` generated deterministically.

A D1 approval record does not prove that a repository PR was opened, merged, deployed, or verified.

## Editorial database (historical staging name)

- Database: `sbns-editorial-staging`
- Worker binding: `SBNS_DB`
- Worker access: `env.SBNS_DB`
- Migration directory: `migrations/`
- Production use: the admin Worker currently binds this historically named database
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

Remote migrations are not part of ordinary validation. For an approved admin
deployment, `.github/workflows/deploy-admin.yml` applies pending migrations
before deploying the Worker; a migration failure stops that deployment. To
inspect pending migrations without changing remote state:

```sh
npx wrangler d1 migrations list SBNS_DB --remote
```

Do not run remote apply during PR development or from `npm run check`.

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

## Watchdesk discovery reuse

Watchdesk candidate evidence still reuses
`intakes.origin = 'discovery'`; the normalized public source URL is the intake
URL, and the complete structured candidate is stored in the existing
`audit_events.metadata_json` record with action
`watchdesk.candidate_submitted`. Deterministic content fingerprints and
`INSERT OR IGNORE` make repeated unchanged submissions idempotent. Watchdesk
does not create an `analysis_jobs` row, an editorial decision, a publication
attempt, or a monitoring event. Migration `0004_watchdesk_runs.sql` creates
`watchdesk_runs` and `watchdesk_run_lock` for operational history and bounded
no-overlap control. It advances `schema_version` to 4; it does not duplicate
candidate evidence or alter existing editorial records.

See [WATCHDESK.md](WATCHDESK.md) for the candidate contract and operating
boundary.

## Echo Desk durable contracts (migration 0005)

`0005_echo_durable_contracts.sql` advances `sbns_meta.schema_version` from 4
to 5 without changing reporting rows. It adds eight Echo-only tables:

| Table | Durable purpose |
| --- | --- |
| `echo_packets` | One immutable structured issue-brief/evidence snapshot per `issue_key` revision; packet states are only `open`, `ready`, or `no_echo`. |
| `echo_packet_intakes` | Immutable many-to-many links to existing Newsroom intakes, with exactly one primary required by atomic creation and at most one primary enforced by a partial unique index. |
| `echo_jobs` | Pending/researching/verifying/rights-check/assembling lifecycle and terminal ready/no-echo/failed states for later orchestration; a failed job leaves its packet open and retryable. No Queue is configured here. |
| `echo_candidates` | Artifact identity and process/gate state, separate from human decisions; readiness pins one exact assessment ID. |
| `echo_candidate_assessments` | Append-only, explicit revisions of the seven-part Analogy Truth Test, research burden, source-set hash, and generator provenance. |
| `echo_candidate_sources` | Append-only claim-specific cultural, historical, contemporary, or rights citations; contemporary evidence may reference an existing intake-scoped `sources` row. |
| `echo_rights_assessments` | Append-only, asset- and proposed-use-specific rights revisions. A status is a recorded assessment, not publication permission. |
| `echo_decisions` | Append-only human `feature`, `hold`, or `reject` decisions pinned to an exact packet, candidate, and assessment revision. |

### Identity, revisions, and relational guardrails

An `issue_key` is a stable editorial issue identity, not a date or an artifact.
`createEchoPacket` atomically assigns `MAX(revision) + 1` for that key. The
database uniquely constrains `(issue_key, revision)` and
`(issue_key, evidence_snapshot_hash)`: an unchanged evidence snapshot cannot
create a duplicate revision, while changed evidence creates a new revision and
marks older packets superseded. New jobs and decisions through the persistence
API refuse superseded packets. The old brief, hash, links, and assessments
remain available. Brief content and packet/intake links cannot be updated or
deleted in place. The database stores the initial structured brief and hash;
PR B's synthetic-only orchestration caller now validates and computes them.
The database does not recalculate or attest either hash.

Assessment rows keep original context, creator-intent status, what echoes,
where the analogy breaks, uncertainty, tempted overclaim, present-day evidence,
and editorial value as separate columns. No raw model-output field is the
canonical assessment. Source rows identify the exact assessment component they
support. An existing SBNS source can only be referenced if its intake is linked
to that packet; independent Echo sources need no intake and store metadata,
not a complete copyrighted work. Non-rights assessment provenance freezes when
a candidate becomes editor-ready or receives a human decision. New rights-role
sources supporting only `rights` may be appended after readiness, but must
belong to the exact pinned `editor_ready_assessment_id`; rights revisions may
then cite that new evidence without changing the analogy the human reviewed.
Assessment insertion is permitted only for a found/researching candidate on
the current open packet. The candidate's
non-null `editor_ready_assessment_id` references an assessment for that exact
candidate and packet, is recorded in the readiness audit, and cannot be
repointed after readiness. Human decisions must reference this pinned
assessment; composite foreign keys also reject a direct unpinned decision
insert. Later assessments cannot silently change the reviewed analogy source
package.
Subsequent materially changed evidence needs a new packet revision or a
separately designed explicit re-review path. Rights assessments remain
independently versionable. PR B's synthetic-only caller now canonically orders,
normalizes, and hashes non-rights analogy sources into `source_set_hash`. Rights
provenance is excluded so it can evolve after readiness. The database does not
prove that the stored hash matches the attached rows; future live adapters must
use and verify the same caller contract.

`echo_candidates.editor_ready_slot` is database-constrained to slots 1–3,
unique per packet, and non-null exactly when state is `editor_ready`. Thus a
fourth editor-ready candidate is impossible even if two later writers race;
the persistence function requires the exact assessment ID before assigning a
slot.
Both the persistence transition and a database trigger require, for that pinned
assessment, at least one `original_work` or `historical_context` source and at
least one `contemporary_evidence` source, plus at least one rights assessment
for the candidate. This modest minimum is not exhaustive citation coverage or
verification. A restrictive rights result, including `unknown`,
`link_metadata_only`, or `do_not_reproduce`, satisfies the review requirement;
it is not permission to reproduce an asset.
Human FEATURE/HOLD/REJECT is stored only in `echo_decisions`, never in the
candidate's process state. A decision requires a nonblank human actor and
rationale, a current non-superseded ready packet, and the candidate's pinned
assessment revision. FEATURE does not update reporting
`editorial_decisions` and creates no publication state.

`no_echo` is a successful packet/job terminal result, possible with zero
candidates and requiring a bounded reason code. A job may enter `ready` only
from `assembling`; it may enter `no_echo` from `researching`, `verifying`,
`rights_check`, or `assembling`, but not `pending`. Completion requires every
candidate to be resolved: `ready` needs 1–3 editor-ready candidates and no
found/researching candidates; `no_echo` needs zero editor-ready and zero
found/researching candidates, permitting none or all gate-rejected. A job may
fail from any active state. That failure preserves the immutable packet in
`open`, releases the active-job slot, and permits a new job with a distinct
idempotency key on the same evidence snapshot. Packet-level `failed` is not a
valid state; any future unrecoverable packet-closing result requires a separate
forward migration with explicit semantics. No search result or daily cultural
feature is required.

Rights statuses are constrained per asset/proposed use; revisions
supersede only the prior revision of that same asset/use and preserve the old
assessment. `unknown` and `do_not_reproduce` are valid. This schema makes no
fair-use or reproduction authorization decision. A rights-role citation must
support the rights field, and a rights-field citation must have the rights role.

### Audit and retention

Echo persistence reuses the generic `audit_events` table with `echo_packet` or
`echo_candidate` entity types. Packet creation, job creation/transitions,
candidate discovery/gate rejection, assessment creation, source linking,
rights assessment, candidate readiness, packet ready/no-echo, and human decisions write concise
audit metadata in the same transactional D1 batch as their consequential
state. Conditional transitions abort the whole batch if the expected state is
stale. No raw model reasoning or complete copyrighted work is audited.
PR B adds one bounded `echo.candidate_evaluated` audit per packet/candidate,
keyed independently of job attempts. It records the deterministic selection
plan, not completed readiness; conflicting replay metadata is rejected.
Later runtime stages may add context-verification events such as
`echo.context_verified`; PR A does not pretend those operations have occurred.

Reviewed packet revisions, assessments, decisions, linked citations, relevant
rights records, and audits are durable editorial history. Failed-job details
and unreviewed discovery-stage data may receive bounded retention later, after
a separate retention policy and cleanup design. PR A implements no deletion
service, no public copy, no `echo_publications`, and no Cultural Memory
Registry. It implements no external cultural discovery, Echo automation,
Newsroom UI, or public WE WERE WARNED feature.

### Local validation and deployment boundary

`npm run echo:persistence:check` validates the eight tables, twelve named
indexes, schema v5, and foreign-key integrity in a freshly migrated isolated
**local D1** database. `npm run echo:persistence:test` repeats local migration
and D1 constraints, then exercises the JavaScript persistence API against the
same migration SQL in isolated SQLite memory. Both commands are included in
`npm run check`; neither contacts remote D1.

Migration 0005 was applied through the separately authorized admin deployment
of PR A. PR B adds no migration or schema change. A later PR B merge would
trigger existing deployment workflows because its `src/**` and `package.json`
paths are watched; opening its draft PR performs no deployment. Recovery of any
future schema defect remains a reviewed forward repair, never an automatic
destructive down migration.

## Recovery

Migrations move forward; there is no automatic destructive down migration. A failing D1 migration is rolled back while earlier successful migrations remain applied.

Before live editorial data exists, a broken initial staging migration should be fixed and reapplied. Recreating the staging database is an exceptional manual recovery action and must never happen automatically. Once durable editorial data exists, destructive recreation is not a normal recovery path.
