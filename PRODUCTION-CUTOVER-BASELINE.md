# SBNS Production Apex Cutover Baseline

Recorded: 2026-09-19

This baseline records the verified production web-apex cutover separately from
the staging deployment baseline. It is an operational record, not authorization
for additional DNS, Worker, database, or deployment changes.

This is the cutover-time snapshot: production routing was accepted while the
application still carried its staging identity. The subsequent identity release
and formal launch acceptance are recorded in
[PUBLIC-LAUNCH-BASELINE.md](PUBLIC-LAUNCH-BASELINE.md).

## Production web state at apex cutover

| Item | Verified value |
| --- | --- |
| Canonical domain | `https://shockedbutnotsurprised.news` |
| Public Worker | `sbns-news` |
| Active deployment | Prefix `5a8d207e`; recorded UUID `5a8d207e-f76d-44e9-9306-59467c07211a` |
| Custom Domain | `shockedbutnotsurprised.news` |
| Custom Domain status | Production |
| Apex DNS | Cloudflare-managed, proxied Worker record targeting `sbns-news` |
| Legacy apex record | `A @ -> 69.175.102.130` removed |
| HTTPS | Valid at the canonical apex |
| Health | HTTP 200; `ok: true`; `version: "v1.5 phase 3 staging"` |
| Total Cloudflare DNS records | 26: 25 DNS-only and one managed/proxied Worker record |
| `www` | Existing DNS-only CNAME retained; production handling remains pending |

The apex is now served by Cloudflare through `sbns-news`. GreenGeeks no longer
serves the public web apex, but it continues to host mail and related service
infrastructure.

## Reader acceptance

Phase 3.5 reader acceptance passed on the production apex:

- five reporting stories are visible by default;
- six fictional samples are isolated in the Prototype archive;
- International, National, Local, and Prototype filters work;
- publication dates and source links are visible and correct;
- methodology and editorial-standards sections are present;
- the homepage, assets, and health endpoint load over valid HTTPS.

## Preserved mail and service infrastructure

The apex cutover did not alter:

- the apex MX record;
- the dedicated `mail` A record;
- DKIM or `_mailchannels` TXT records;
- autodiscover records;
- CalDAV or CardDAV records;
- FTP, cPanel, webmail, or related service records;
- any other non-apex DNS record.

GreenGeeks remains the host for those mail and service dependencies. They must
remain DNS-only unless a separately approved migration changes that design.

## Explicitly unchanged systems

The production apex operation did not:

- create a Worker route;
- deploy a new Worker version;
- change Worker bindings;
- apply a D1 migration;
- change Queue or dead-letter Queue configuration;
- change the AI Gateway;
- change DNSSEC;
- change the zone's SSL/TLS policy;
- change authoritative nameservers;
- change the admin or analysis Workers;
- alter application code, story content, or deployment workflows.

## Remaining launch work at apex cutover

- `www` has not been attached to the Worker or redirected to the canonical
  apex.
- The deployed application still labels itself as Phase 3 staging and displays
  a Staging Edition notice.
- Final public-launch identity cleanup requires a separately reviewed code and
  deployment change.
- SPF and DMARC policy remain separate follow-up work; they were not invented
  or changed during the cutover.

The identity cleanup above was later completed by PR #27 and verified through
GitHub Actions run #6. It must remain visible here as chronology: apex routing
preceded the launch-identity release. `www`, SPF, and DMARC remain follow-up.

## Rollback

If the production apex must return to GreenGeeks:

1. Remove the `shockedbutnotsurprised.news` Custom Domain from `sbns-news`.
2. Restore `A @ -> 69.175.102.130` as DNS only with TTL Auto.
3. Verify the restored homepage and HTTPS behavior.
4. Re-verify MX, `mail`, DKIM, `_mailchannels`, autodiscover,
   CalDAV/CardDAV, FTP, cPanel, and webmail.

The Cloudflare nameserver delegation does not need to be reverted for this
web-only rollback.
