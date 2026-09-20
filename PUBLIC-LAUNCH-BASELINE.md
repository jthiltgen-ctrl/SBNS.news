# ShockedButNotSurprised.news Public Launch Baseline

Accepted: September 19, 2026

Status: **PASS WITH NON-BLOCKING FOLLOW-UP**

This document records the formal public-launch checkpoint. It follows, and
does not rewrite, the earlier staging and production-apex cutover records. The
apex was routed to the Worker before the public staging identity was removed;
the launch-identity release and final production acceptance occurred afterward.

This baseline is evidence of the verified state below. It does not authorize
additional DNS, Worker, database, mail, `www`, or product-phase changes.

## Repository merge state

| Item | Verified value |
| --- | --- |
| Production-apex documentation | PR #26, squash merge `58196a0b259fd2c7d0f5c9bba8367654611d87a1` |
| Public-launch identity | PR #27, squash merge `73880369f2ddb042756d6d2ea4efdf7cc8c6d437` |
| Public deployment workflow | GitHub Actions `Deploy public Worker`, run #6 |
| Workflow run ID | `35485324877` |
| Workflow result | Successful |

PR #27 removed the remaining reader and health-response staging identity. Its
merge triggered the already-scoped public Worker deployment workflow.

## Deployed Worker state

| Item | Verified value |
| --- | --- |
| Public Worker | `sbns-news` |
| Active Worker version | `fb71aeed-7fe0-482a-a9eb-6cb5a7e6461f` |
| Production traffic | 100% on the active version |
| Health | `{"ok":true,"name":"Shocked But Not Surprised","acronym":"SBNS","version":"v1.5 production"}` |
| Public identity | `Public Edition` |
| Publication description | `SBNS is an independent publication.` |

`Staging Edition` is absent from the accepted public reader, and
`v1.5 phase 3 staging` is absent from the accepted production health response.

## Production-domain state

- The canonical public domain is
  `https://shockedbutnotsurprised.news`.
- The apex is the sole Production Custom Domain on `sbns-news`.
- The apex is a Cloudflare-managed proxied Worker record.
- No Worker Route is configured for the apex.
- The legacy apex A record to `69.175.102.130` is absent.
- Authoritative Cloudflare DNS, `1.1.1.1`, and `8.8.8.8` returned Cloudflare
  addresses.
- The canonical apex serves valid HTTPS.

Deployment success and domain routing were not treated as launch acceptance by
themselves. The reader and health checks below were also required.

## Public reader acceptance

Final acceptance verified:

- five real reporting stories shown by default;
- category distribution of one International, three National, and one Local;
- publication dates displayed;
- real external source links displayed and working;
- International, National, Local, and Prototype archive filters working;
- six fictional samples segregated under the Prototype archive;
- fictional samples clearly labeled;
- `How SBNS works` present;
- `Editorial standards` present;
- no reader regression found.

The reporting-first and prototype-separation rules remain unchanged.

## Mail and service preservation

The launch preserved the GreenGeeks-hosted mail and service boundary:

- MX targets `mail.shockedbutnotsurprised.news`;
- `mail` resolves by DNS-only A record to `69.175.102.130`;
- DKIM and `_mailchannels` records are preserved;
- autoconfig and autodiscover are preserved;
- CalDAV and CardDAV are preserved;
- FTP, cPanel, webmail, webdisk, and WHM service records are preserved;
- no SPF or DMARC change was made during launch.

The intentionally DNS-only mail and service hosts continue to expose the
GreenGeeks origin IP. That is an architectural consequence of preserving those
services, not evidence that the public web apex failed to move to Cloudflare.

## Known non-blocking follow-up at launch acceptance

1. One computer's system resolver temporarily continued returning the legacy
   `69.175.102.130` apex answer while authoritative and public resolvers were
   already correct. Treat this as local cache convergence unless a later
   comparison against authoritative and public resolvers shows otherwise.
2. At formal launch acceptance, `www.shockedbutnotsurprised.news` remained
   unfinished. Public DNS retained the existing DNS-only CNAME, but `www` was
   not a Worker Custom Domain and returned HTTP 522 through the public edge.
   The canonical apex was unaffected.

Neither condition blocked formal launch acceptance. The `www` condition was
completed afterward as the separately bounded post-launch change below.

## Post-launch `www` canonicalization

The `www` follow-up completed successfully after formal launch acceptance.

Current DNS and redirect state:

- DNS is a proxied A record, `www` to `192.0.2.0`, with TTL Auto;
- Cloudflare Single Redirect `Redirect www to apex` matches
  `http.host eq "www.shockedbutnotsurprised.news"`;
- the redirect target is
  `concat("https://shockedbutnotsurprised.news", http.request.uri.path)`;
- query-string preservation is enabled;
- the redirect returns HTTP 301.

Acceptance verified the root redirect, path preservation, query-string
preservation, and TLS on `www`. The apex remained HTTP 200 and production
health remained:

`{"ok":true,"name":"Shocked But Not Surprised","acronym":"SBNS","version":"v1.5 production"}`

The apex remains the sole Production Custom Domain. `www` was not added as a
Worker Custom Domain, no Worker Route exists, and mail and service records were
unchanged. Public resolvers `1.1.1.1` and `8.8.8.8` return Cloudflare addresses
for `www`.

One local/system resolver temporarily retained the former CNAME or legacy
answer. Authoritative and public resolution plus the accepted redirect show
this is local cache convergence, not an active infrastructure defect.

Rollback for the `www` change is:

1. remove `Redirect www to apex`;
2. remove proxied A `www` to `192.0.2.0`;
3. restore CNAME `www` to `shockedbutnotsurprised.news`, DNS only, TTL Auto;
4. verify apex health.

## Formal launch versus later product phases

Formal launch means the canonical apex, production identity, reader behavior,
health response, routing, HTTPS, and mail-preservation boundary passed the
recorded acceptance checks. It does **not** mean every planned v1.5 capability
is implemented.

The following remain later, separately scoped work:

- abuse-resistant visitor submissions with Turnstile;
- controlled GitHub App draft-PR publication orchestration;
- durable queue-backed monitoring;
- immutable correction and update publication history;
- separately researched SPF and DMARC policy.

Human editorial authority remains unchanged: recommendation is not decision,
approval is not publication, deployment is not live acceptance, and later
development is not evidence that an accurate original story was wrong.
