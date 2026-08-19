# SBNS v1 Architecture

## Product

**Shocked But Not Surprised (SBNS)** is an iPhone-first news product covering
institutional and systemic failures with factual reporting and weary, dark
humor. Its editorial voice punches up at powerful institutions and never down
at the people affected by their failures.

Tagline: **Another day. Another system that had one job.**

## Runtime architecture

SBNS v1 runs as one Cloudflare Worker with Workers Static Assets:

```text
Browser
  |-- /api/* --------> src/index.js
  |                       |-- GET /api/health -> JSON 200
  |                       `-- other /api/*    -> JSON 404
  |
  `-- everything else -> ASSETS binding -> public/
```

- `src/index.js` is the Worker entry point.
- `public/` contains the complete static frontend.
- `ASSETS` is the only Worker binding.
- `run_worker_first` limits Worker-first routing to `/api/`.
- Observability is enabled in `wrangler.jsonc`.
- There is no D1 database or other persistent storage in prototype v1.

## Frontend

The frontend is dependency-free HTML, CSS, and JavaScript. It preserves the
SBNS design system:

- Bebas Neue for headlines and the nameplate
- Lora for editorial body copy
- Special Elite for kickers and taglines
- Barlow Condensed for labels and metadata
- Paper `#f2ede3`, ink `#1a1714`, and red `#b91c1c`

Published prototype content lives in `public/stories.json`. The frontend sorts
stories newest-first, caps the rendered feed at 50 stories, and presents a
readable empty or error state when content is unavailable.

## Development and validation

```sh
npm ci
npm run dev
npm run check
```

`npm run check` runs `wrangler deploy --dry-run`; it packages and validates the
Worker locally without deploying it.

## Legacy deployment files

The root `deploy.yml` and `.github/workflows/deploy.yml` files are legacy
GreenGeeks deployment artifacts. They must remain byte-for-byte unchanged.
The Cloudflare prototype does not invoke or modify them.
