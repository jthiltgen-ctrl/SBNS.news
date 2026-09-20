# SBNS Staging Baseline

Recorded: 2026-09-19

This file separates repository-verifiable configuration from account-only
deployment facts. Do not guess missing Cloudflare values.

This is the preserved staging checkpoint. It is not the current public-launch
baseline; see [PUBLIC-LAUNCH-BASELINE.md](PUBLIC-LAUNCH-BASELINE.md).

## Repository baseline

| Item | Recorded value |
| --- | --- |
| Deployment branch | `main` |
| Deployed source SHA | `0a15c0dcdd39959b2ae41e72a20b0a71563efe44` |
| Latest deployed change | PR #22 — propagation-aware staging health verification |
| Application version | `1.5.0` |
| Deployed health identifier | `v1.5 phase 3 staging` |
| Published feed | 11 records: 5 reporting, 6 fictional prototype samples |
| D1 migrations | `0001`, `0002`, `0003` |
| Expected schema | version 3; 13 tables; 17 indexes |
| Regression state | 86 analysis, 33 persistence, 39 admin API, 6 JWT scenarios, plus v1.4 suites |

## Configured staging resources

| Resource | Configuration |
| --- | --- |
| Public Worker | `sbns-news` |
| Public staging URL | `https://sbns-news.sbns-news.workers.dev` |
| Admin Worker | `sbns-admin` |
| Analysis Worker | `sbns-analysis` |
| D1 | `sbns-editorial-staging` / binding `SBNS_DB` |
| D1 database ID | `66e016c7-928b-47e2-9bda-af411971910e` |
| Analysis Queue | `sbns-analysis-staging` |
| Dead-letter Queue | `sbns-analysis-dlq-staging` |
| AI Gateway | `sbns-staging` |
| Model token ceiling | `4096` |
| Analysis caching | disabled through Gateway request option |

## Verified deployment facts

Verified on 2026-09-19:

- GitHub Actions run #5 completed successfully at
  `https://github.com/jthiltgen-ctrl/SBNS.news/actions/runs/35412647720`;
- validation, public Worker deployment, and staging health verification all
  passed;
- public Worker deployment version ID is
  `5a8d207e-f76d-44e9-9306-59467c07211a`;
- the public staging homepage returned HTTP 200 with the title
  `Shocked But Not Surprised`;
- the public health endpoint returned HTTP 200 and
  `v1.5 phase 3 staging`;
- the deployed source matched the SHA above;
- no DNS, D1 migration, admin Worker, or analysis Worker changes were made.

The public staging Worker now also serves the production apex through a
Cloudflare Custom Domain. That production operation is recorded separately in
[PRODUCTION-CUTOVER-BASELINE.md](PRODUCTION-CUTOVER-BASELINE.md). The deployed
application still self-identified as `v1.5 phase 3 staging` and retained its
Staging Edition notice at that cutover checkpoint. PR #27 subsequently changed
the public identity to `v1.5 production` and `Public Edition`; `www` remains
pending. GreenGeeks continues to host the mail and related service
infrastructure.

## Account-only facts still requiring dashboard verification

| Item | Status |
| --- | --- |
| Admin Worker deployed version ID | Unverified; unchanged by this deployment |
| Analysis Worker deployed version ID | Unverified; unchanged by this deployment |
| Deployed `AI_MODEL` value | Unverified; secret/runtime configuration, not committed |
| Remote migration listing | Previously reported current through `0003`; recheck required |
| Queue and DLQ operational status | Names are verified; live status recheck required |
| Known remote synthetic intake IDs/count | Unverified; inspect authenticated queue/D1 |

Cloudflare's human-verification screen blocked the managed dashboard session.
The public Worker version is nevertheless verified from the authenticated
Wrangler deployment log and the live staging health endpoint.

## Staging-session log

| Date | Intake IDs | Outcome | Baseline changed? | Notes |
| --- | --- | --- | --- | --- |
| 2026-09-18 | None | Public endpoints verified; account inventory pending | No | Phase 3.5 documentation pass |
| 2026-09-19 | None | Public Worker deployed and smoke-tested successfully | Yes | GitHub Actions run #5; no migrations or DNS changes |
| 2026-09-19 | None | Production apex attached to the verified public Worker | No application change | Custom Domain only; see production cutover baseline |
