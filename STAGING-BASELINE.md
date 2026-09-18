# SBNS Staging Baseline

Recorded: 2026-09-18

This file separates repository-verifiable configuration from account-only
deployment facts. Do not guess missing Cloudflare values.

## Repository baseline

| Item | Recorded value |
| --- | --- |
| Canonical branch | `main` |
| Canonical SHA | `cc6ab7a657a15d35b6e7dc7589071624aff828e5` |
| Latest merged change | PR #18 — Phase 3 structured-output repair |
| Application version | `1.5.0` in the Phase 3.5 review branch |
| Published feed | 11 records: 5 reporting, 6 fictional prototype samples |
| D1 migrations | `0001`, `0002`, `0003` |
| Expected schema | version 3; 13 tables; 17 indexes |
| Regression state | 86 analysis, 33 persistence, 39 admin API, 6 JWT scenarios, plus v1.4 suites |

## Configured staging resources

| Resource | Configuration |
| --- | --- |
| Public Worker | `sbns-news` |
| Admin Worker | `sbns-admin` |
| Analysis Worker | `sbns-analysis` |
| D1 | `sbns-editorial-staging` / binding `SBNS_DB` |
| D1 database ID | `66e016c7-928b-47e2-9bda-af411971910e` |
| Analysis Queue | `sbns-analysis-staging` |
| Dead-letter Queue | `sbns-analysis-dlq-staging` |
| AI Gateway | `sbns-staging` |
| Model token ceiling | `4096` |
| Analysis caching | disabled through Gateway request option |

## Live facts verified without account access

Verified on 2026-09-18:

- the public site returned HTTP 200;
- the public health endpoint returned HTTP 200 and still identified the live
  deployment as `prototype v1.2`;
- the admin hostname redirected to Cloudflare Access;
- repository `main` still matched the canonical SHA above.

The Phase 3.5 review branch updates the health identifier to
`v1.5 phase 3 staging`. That value is not live unless and until the branch is
approved, merged, and separately deployed.

## Account-only facts still requiring dashboard verification

The following values are intentionally marked **unverified** until an
authenticated Cloudflare session records them:

| Item | Status |
| --- | --- |
| Public Worker deployed version ID | Unverified |
| Admin Worker deployed version ID | Unverified |
| Analysis Worker deployed version ID | Unverified |
| Deployed `AI_MODEL` value | Unverified; secret/runtime configuration, not committed |
| Remote migration listing | Previously reported current through `0003`; recheck required |
| Queue and DLQ operational status | Names are verified; live status recheck required |
| Known remote synthetic intake IDs/count | Unverified; inspect authenticated queue/D1 |

Cloudflare's human-verification screen blocked the automated dashboard session
used during this baseline pass. That limitation does not change the verified
source configuration; it prevents falsely recording account-only details.

## Staging-session log

| Date | Intake IDs | Outcome | Baseline changed? | Notes |
| --- | --- | --- | --- | --- |
| 2026-09-18 | None | Public endpoints verified; account inventory pending | No | Phase 3.5 documentation pass |
