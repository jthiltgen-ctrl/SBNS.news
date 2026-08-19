# Shocked But Not Surprised

SBNS v1 is a minimal Cloudflare Workers Static Assets application. It has no
Worker script, database, or runtime bindings. The site is served directly from
`public/` and uses a small static JSON file as its initial story feed.

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
