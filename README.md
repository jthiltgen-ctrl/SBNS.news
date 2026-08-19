# Shocked But Not Surprised

SBNS v1.2 is a minimal Cloudflare Worker with Static Assets. The Worker owns the
`/api/` namespace, while all other requests are served from `public/` through
the `ASSETS` binding. The prototype has no database or persistent storage.

## Local development

```sh
npm ci
npm run content:build
npm run dev
```

## Validation

```sh
npm run check
```

`npm run check` validates source-controlled editorial content, verifies that the
generated feed is current, runs content and JavaScript checks, and performs a
Wrangler dry run. It does not deploy.

## API

- `GET /api/health` returns the prototype identity and status.
- Every other `/api/` route returns a JSON 404 response.
- Non-API requests are served from Static Assets.

## Editorial content

Each story is maintained as one JSON file in `content/stories/`. Start from
`content/story-template.json` and follow [EDITORIAL.md](EDITORIAL.md).

```sh
npm run content:build
npm run content:check
```

`public/stories.json` is generated deterministically from published source
files. Do not edit it manually. Drafts are validated but never included.

The two legacy GreenGeeks `deploy.yml` files are intentionally retained for
historical compatibility. This Cloudflare baseline does not invoke them.
