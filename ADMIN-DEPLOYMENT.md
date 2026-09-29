# Admin Worker deployment

`sbns-admin` is a separate, Cloudflare Access-protected Worker. Its automatic
deployment is defined by `.github/workflows/deploy-admin.yml`, runs only after
a qualifying push to `main`, and uses `wrangler.admin.jsonc` explicitly. Pull
requests do not deploy it. The workflow retains the GitHub `staging`
environment for existing credential management; that environment name does not
change the production role of this Worker.

## Trigger and validation boundary

The workflow watches its own file, the admin Wrangler configuration, package
manifest and lockfile, all `src/**` modules (the admin entry point and shared
runtime), the served `public/admin-persistent/**` UI, and the admin, persistence,
and Watchdesk validation scripts, plus `migrations/**`. It also watches `watchdesk/**`,
`public/stories.json`, its source `content/stories/**`, and the content builder
because the Watchdesk runtime imports the generated public feed and
source registry. This is deliberately conservative for shared runtime changes;
ordinary documentation-only pushes do not trigger an admin deployment.

Before deploying, the job installs from the lockfile, checks the generated
content, runs admin authentication/API and persistence checks, runs Watchdesk
checks when those package scripts exist, syntax-checks the admin and available
Watchdesk modules, and dry-runs the admin Wrangler build. Before deployment it
applies pending D1 migrations to the existing bound database; a migration
failure stops the deployment. The `0004_watchdesk_runs.sql` migration adds a
run ledger and singleton lease, without changing intake or publication data.

The job deploys with `--keep-vars` so dashboard-managed `ACCESS_TEAM_DOMAIN`
and `ACCESS_AUD` remain available to the Worker. It sets
`SBNS_ADMIN_BUILD_SHA` to the exact triggering commit SHA for this deployment;
the same value must be returned by post-deployment health verification.
Cloudflare account credentials come from the existing encrypted GitHub
`staging` environment secrets. A qualifying approved merge that includes
`triggers.crons` deploys the admin Worker and activates its twice-daily
Watchdesk schedule; an unmerged PR does not. Because the persistent admin UI
resides under `public/admin-persistent/**`, it also matches the public
workflow's existing `public/**` filter. Thus an approved merge of this release
triggers both the admin and public Worker deployments, although the public
reader runtime and story content are unchanged.

## Protected machine health

`GET /api/admin/health` remains behind the existing Cloudflare Access
application. At the Worker boundary it verifies the signed Access JWT against
the configured team issuer and application audience, then accepts only the
service-token claim shape. The Access application policy must continue to
allow only the dedicated CI service token as a machine identity; the Worker
limits that identity to the two read-only health routes. The existing endpoint returns
only `ok`, the admin publication/Worker identity, and the deployed revision;
it does not read D1 or Queue state and sends `Cache-Control: no-store`.

The separate `GET /api/admin/watchdesk/health` route uses the same signed
service-token boundary but reads only aggregate D1 run status. It returns the
configured UTC cron and latest run ID/time/status and counts, never candidate,
queue, intake, editor, or decision contents. The workflow checks its exact
revision and response shape after deployment.

The existing `/api/admin/session` and editorial routes still require a human
email-bearing Access identity. A service token cannot use the machine-health
route to acquire an editor session or editorial access. Unsigned headers such
as `CF-Access-Client-Id` are not accepted as Worker authorization.

After deployment, the workflow uses the existing encrypted
`CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET` secrets
only in its final verification step. It sends Cloudflare's service-token
headers to the protected read-only health endpoint and requires HTTP 200,
the expected response identity, and the exact triggering SHA. It also verifies
that the same service-token identity receives `401 AUTH_REQUIRED` from the
human-editor session route. Any validation,
deployment, Access, or health mismatch fails the job. No credential value is
logged or returned by the endpoint.

## Merge impact

The public Worker is deployed by `.github/workflows/deploy.yml` using
`wrangler.jsonc`; the admin Worker uses `.github/workflows/deploy-admin.yml`
and `wrangler.admin.jsonc`. Depending on changed paths, a push to `main` may
deploy the public Worker, the admin Worker, or both. Before authorizing a merge,
identify all matching workflows and expected Worker deployments. The root
`deploy.yml` is a legacy GreenGeeks reference and is not a GitHub Action.
