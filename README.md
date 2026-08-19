# Shocked But Not Surprised

SBNS v1 is a minimal Cloudflare Worker with Static Assets. The Worker owns the
`/api/` namespace, while all other requests are served from `public/` through
the `ASSETS` binding. The prototype has no database or persistent storage.

## Local development

```sh
npm ci
npm run dev
```

## Validation

```sh
npm run check
```

`npm run check` performs a Wrangler dry run. It validates and packages the
application locally; it does not deploy.

## API

- `GET /api/health` returns the prototype identity and status.
- Every other `/api/` route returns a JSON 404 response.
- Non-API requests are served from Static Assets.

## Content

Edit `public/stories.json` to add published stories. Each story accepts:

- `headline`
- `summary`
- `fml_kicker`
- `category`
- `source`
- `topic_tags`
- `severity` (1–5)
- `published_at` (ISO 8601)

The two legacy GreenGeeks `deploy.yml` files are intentionally retained for
historical compatibility. This Cloudflare baseline does not invoke them.
