# Production DNS Cutover Runbook

This runbook moves the public website to the verified Cloudflare Worker without
interrupting GreenGeeks-hosted email. It deliberately separates the DNS-provider
move from the website cutover so each step has a small rollback surface.

No step in this document authorizes a DNS, nameserver, Worker-route, database,
admin Worker, or analysis Worker change. Obtain action-time approval before
each mutable phase.

## Current execution status

Recorded on 2026-09-19:

- Phase 1 is complete: GreenGeeks mail and service dependencies were decoupled
  from the web apex and mail-safety tests passed.
- Phase 2 is complete: Cloudflare is authoritative, the zone is active, and
  the verified 26-record set remains in place.
- Phase 3 is complete for the apex: `shockedbutnotsurprised.news` is a
  Production Custom Domain on `sbns-news` with valid HTTPS.
- At the apex-cutover checkpoint, `www` remained an unchanged DNS-only CNAME.
  It was canonicalized after formal launch through the separately bounded
  redirect recorded below.
- The later PR #27 deployment removed the staging identity, and formal public
  launch acceptance passed. That post-cutover state is recorded in
  [PUBLIC-LAUNCH-BASELINE.md](PUBLIC-LAUNCH-BASELINE.md).

See [PRODUCTION-CUTOVER-BASELINE.md](PRODUCTION-CUTOVER-BASELINE.md) for the
verified production state and exact web rollback.

## Historical verified starting point

The following snapshot is preserved as the pre-cutover baseline. It is no
longer the current production state.

Recorded on 2026-09-19:

- production domain: `shockedbutnotsurprised.news`;
- authoritative nameservers: `ns1.greengeeks.net` and
  `ns2.greengeeks.net`;
- production web apex: `69.175.102.130`;
- verified staging Worker:
  `https://sbns-news.sbns-news.workers.dev`;
- expected health: `v1.5 phase 3 staging`;
- public Worker version:
  `5a8d207e-f76d-44e9-9306-59467c07211a`;
- GreenGeeks email and all production DNS were unchanged at this starting
  point.

## Why email had to be decoupled first

At the historical starting point, the mail path depended on the web apex:

- the apex A record points to `69.175.102.130`;
- the MX record targets the apex;
- `mail` is a CNAME to the apex;
- CalDAV/CardDAV service records also target the apex.

Pointing the apex directly at the Worker before removing those dependencies can
send mail and groupware traffic to the web service. The safe replacement is a
dedicated, unproxied mail hostname with its own A record.

## Historical mail-critical dependencies and cutover rules

Re-export the complete GreenGeeks zone immediately before the change. The
following list is a guardrail, not a substitute for that complete export.

| Record | Current purpose | Cutover rule |
| --- | --- | --- |
| MX at apex, priority 0 | inbound GreenGeeks mail | retarget to a verified dedicated mail A record before moving the web apex |
| `mail` CNAME to apex | mail client hostname | replace with an unproxied A record to `69.175.102.130` after GreenGeeks verification |
| `default._domainkey` TXT | DKIM | copy the exact value; never retype or truncate it |
| `_mailchannels` TXT | `v=mc1 auth=greengeeks` | copy exactly |
| autodiscover SRV | cPanel discovery | copy exactly |
| CalDAV/CardDAV SRV records | calendar/contact discovery | point only to a verified unproxied host; do not leave them dependent on the web apex |
| `cpanel`, `webmail`, and related A records | GreenGeeks services | keep on `69.175.102.130` and DNS-only |
| SPF and DMARC | sender policy | do not invent values; use the current zone and GreenGeeks guidance |

Cloudflare proxying must be off for MX targets and every mail, cPanel, webmail,
FTP, autodiscover, CalDAV, and CardDAV host.

## Phase 0 — evidence and rollback package

Status: Completed on 2026-09-19.

Complete before any mutation:

- export or capture all GreenGeeks records, including names, types, TTLs,
  priorities, ports, weights, and exact TXT values;
- capture the current registrar nameservers;
- record screenshots or an export from the Cloudflare zone;
- confirm access to GreenGeeks DNS, the registrar nameserver controls,
  Cloudflare DNS, and GitHub Actions;
- verify a recent inbound and outbound email round trip;
- record the public homepage and health responses;
- if GreenGeeks permits it, lower relevant DNS TTLs to 300 seconds at least one
  prior TTL period before the window.

Stop if the complete zone cannot be reproduced or if either provider cannot be
accessed.

## Phase 1 — decouple email while GreenGeeks remains authoritative

Status: Completed on 2026-09-19. The dedicated mail path and related service
targets were verified before the nameserver move.

After action-time approval:

1. Confirm with GreenGeeks that `mail.shockedbutnotsurprised.news` is valid for
   the account and certificate.
2. Replace the `mail` CNAME with an A record to `69.175.102.130`.
3. Retarget the apex MX record to
   `mail.shockedbutnotsurprised.news` at priority 0.
4. Retarget only the CalDAV/CardDAV records that GreenGeeks confirms should use
   the dedicated mail/service host.
5. Leave DKIM, MailChannels, autodiscover, and service-host records intact.
6. Verify DNS, TLS, webmail, IMAP/POP as used, SMTP submission, inbound mail,
   outbound mail, and reply delivery.

Rollback: restore the original MX-to-apex and `mail` CNAME records from the
snapshot. Do not continue unless the dedicated mail path is proven.

## Phase 2 — move authoritative DNS without moving the website

Status: Completed on 2026-09-19. Cloudflare became authoritative while the
apex and `www` still served the pre-cutover GreenGeeks web configuration.

After a second action-time approval:

1. Populate Cloudflare with the complete, verified zone.
2. Keep all records DNS-only initially.
3. Keep the apex and `www` serving the existing GreenGeeks website.
4. Compare GreenGeeks and Cloudflare record-by-record.
5. Change registrar nameservers to the exact pair assigned by Cloudflare.
6. Wait for Cloudflare to report the zone active and verify public NS, SOA, A,
   CNAME, MX, TXT, and SRV answers from multiple resolvers.
7. Repeat inbound and outbound email tests and verify the existing website.

This phase changed only the authoritative DNS provider. At its completion, the
public site was still served by GreenGeeks. The later apex change is recorded
under Phase 3 and in the production cutover baseline.

Rollback: restore `ns1.greengeeks.net` and `ns2.greengeeks.net` at the
registrar, then verify the restored zone. Preserve the Cloudflare copy for
diagnosis.

## Phase 3 — attach the production web domain to the Worker

Status at the apex-cutover checkpoint: Apex completed on 2026-09-19; `www`
remained pending until the later post-launch redirect change.

After authoritative DNS and mail have been stable, and after a third
action-time approval:

1. Confirm the staging Worker health still reports
   `v1.5 phase 3 staging`.
2. Attach `shockedbutnotsurprised.news` to the public `sbns-news` Worker as a
   Cloudflare custom domain or route.
3. Configure `www` deliberately: either serve the same Worker or redirect to
   the canonical apex.
4. Do not proxy or alter any mail/service hostname.
5. Verify TLS, the homepage, assets, archive filters, reporting links, and
   `/api/health`.
6. Repeat inbound and outbound email tests.
7. Monitor HTTP errors and mail delivery during the rollback window.

Current apex rollback: remove the `shockedbutnotsurprised.news` Custom Domain
from `sbns-news`, then restore `A @ -> 69.175.102.130` as DNS only with TTL
Auto. At the apex-cutover checkpoint, the unchanged `www` CNAME did not require
rollback. The later redirect has its own rollback below. Nameservers do not need
to be reverted while Phase 2 remains healthy.

## Acceptance criteria

- [x] The apex serves the intended Worker over valid HTTPS.
- [x] `www` redirects deliberately to the canonical apex; completed as a
  separately bounded post-launch change.
- [x] Health returns `ok: true` and `v1.5 phase 3 staging`.
- [x] MX resolves to an unproxied hostname on the GreenGeeks server.
- [x] DKIM and MailChannels TXT values match the pre-cutover snapshot.
- [x] Mail-safety tests passed before the apex attachment; mail and service
  records remained unchanged by the apex operation.
- [x] No D1 migration or admin/analysis Worker change occurred.
- [x] The final apex record, reader acceptance, unchanged systems, pending
  work, and rollback are recorded in the production cutover baseline.

## Post-cutover

After the observation window, restore ordinary TTLs, retain the pre-cutover
snapshot, and document any intentionally absent SPF/DMARC policy separately.
Security-policy additions are follow-up work, not emergency cutover edits.

The staging identity was removed through separately reviewed PR #27.

### Post-launch `www` completion

The separately approved `www` change completed successfully:

- proxied A `www` to `192.0.2.0`, TTL Auto;
- Single Redirect `Redirect www to apex`;
- match: `http.host eq "www.shockedbutnotsurprised.news"`;
- target:
  `concat("https://shockedbutnotsurprised.news", http.request.uri.path)`;
- query-string preservation enabled;
- HTTP 301.

Root, path, query-string, and TLS acceptance passed. The apex remained HTTP 200
with `v1.5 production` health, remained the sole Production Custom Domain, and
no Worker Route or mail/service record changed.

`www` rollback:

1. remove `Redirect www to apex`;
2. remove proxied A `www` to `192.0.2.0`;
3. restore CNAME `www` to `shockedbutnotsurprised.news`, DNS only, TTL Auto;
4. verify apex health.

Authoritative/public DNS is correct. A remaining former answer in one local
resolver is a cache-convergence condition unless later evidence contradicts it.
