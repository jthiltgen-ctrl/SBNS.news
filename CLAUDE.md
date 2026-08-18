# CLAUDE.md — Shocked But Not Surprised
> Project memory for Claude Code. Read this at the start of every session.

---

## What This Is

**"Shocked But Not Surprised"** is a news aggregator at `www.shockedbutnotsurprised.news`.

It covers two things simultaneously:
1. **Serious**: Institutional and systemic failures — governments, corporations, agencies, infrastructure — and their real impacts on people and environments.
2. **Darkly humorous**: Each story carries a "FML Kicker" — one-line commentary in the style of FMyLife.com. Tone is weary policy analyst, not cruelty. We punch UP at power, never DOWN at victims.

**Tagline**: *"Another day. Another system that had one job."*

**Operator**: Solo, one person (Justin), managed primarily from an iPhone. Every feature decision must account for this. If it requires a laptop to maintain, reconsider.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React (Vite) | Core component: `src/ShockedButNotSurprised.jsx` |
| AI / Stories | Anthropic API (`claude-sonnet-4-20250514`) | With web search tool enabled |
| Story fetch | PHP (`api/fetch-stories.php`) | Server-side; called by GitHub Actions 4×/day |
| Admin panel | PHP (`api/admin.php`) | HTTP Basic Auth; approve/reject pending stories |
| Public feed | PHP (`api/published.php`) | Serves curated stories to the React frontend |
| Data store | JSON files (`data/`) | `pending.json` + `published.json`; GreenGeeks only, never in git |
| Hosting | GreenGeeks (shared hosting) | Domain: shockedbutnotsurprised.news |
| SSL | GreenGeeks / Let's Encrypt via cPanel | Already provisioned |
| CI/CD | GitHub Actions → FTP to GreenGeeks | Push to `main` = live deploy; schedule = story fetch |

---

## Environment Variables

### Local development (`.env` — gitignored)
```
VITE_API_URL=http://localhost:5173/api/published.php
```

### Production — GreenGeeks cPanel → Environment Variables
```
ANTHROPIC_API_KEY      # Anthropic API key
FETCH_SECRET_TOKEN     # Matches GitHub Secret; authenticates the scheduled fetch job
ADMIN_USERNAME         # HTTP Basic Auth username for admin.php
ADMIN_PASSWORD         # HTTP Basic Auth password for admin.php
```

### GitHub Actions Secrets (repo Settings → Secrets → Actions)
```
FTP_SERVER             # GreenGeeks FTP hostname
FTP_USERNAME           # GreenGeeks FTP username
FTP_PASSWORD           # GreenGeeks FTP password
FETCH_SECRET_TOKEN     # Sent as X-Fetch-Token header to fetch-stories.php
```

---

## Architecture

```
GitHub Actions (schedule 4×/day)
      │  POST /api/fetch-stories.php
      │  Header: X-Fetch-Token
      ▼
fetch-stories.php (GreenGeeks)
      │  POST api.anthropic.com/v1/messages (web search)
      ▼
Anthropic API → 6 story candidates
      │
      │  deduplicate vs pending.json + published.json (80% headline fuzzy match)
      ▼
data/pending.json  ←──────────────────────────────────┐
      │                                                │
      ▼                                                │
admin.php (Basic Auth — Justin reviews on iPhone)     │
      │  Approve (edit kicker) → data/published.json  │
      │  Reject  → discard                            │
      ▼                                                │
data/published.json                                    │
      │                                                │
      ▼                                                │
published.php (public, newest-first, cap 50)          │
      │  GET                                           │
      ▼                                                │
React App (static, GreenGeeks public_html/) ──────────┘
      │  fetch on load + manual refresh
      ▼
Reader's browser
```

### Deploy Flow
```
Edit code → push to main → GitHub Action (deploy job):
  1. npm ci
  2. npm run build  (VITE_API_URL → /api/published.php)
  3. FTP uploads dist/ → public_html/  (excludes api/ and data/)

Schedule (6am, 11am, 4pm, 9pm CT) → GitHub Action (fetch-stories job):
  1. curl POST /api/fetch-stories.php with X-Fetch-Token
  2. PHP fetches Anthropic, deduplicates, appends to pending.json
```

---

## File Structure

```
sbns-app/                              ← git repo root
├── CLAUDE.md
├── .env                               ← Local secrets (gitignored)
├── .env.example
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy.yml                 ← Build+deploy (push) + fetch (schedule)
├── api/
│   ├── fetch-stories.php              ← Scheduled AI fetch; token-protected
│   ├── admin.php                      ← Editorial queue; HTTP Basic Auth
│   └── published.php                  ← Public feed endpoint
├── data/                              ← GITIGNORED — lives on GreenGeeks only
│   ├── pending.json                   ← Stories awaiting editorial review
│   └── published.json                 ← Approved stories (newest first)
├── public/
│   └── favicon.ico
├── src/
│   ├── App.jsx
│   └── ShockedButNotSurprised.jsx     ← Core component; fetches from published.php
└── vite.config.js

GreenGeeks public_html/
├── index.html                         ← React build output
├── assets/                            ← React build output
├── data/                              ← Created by PHP on first run; .htaccess protected
│   ├── .htaccess                      ← Deny from all (auto-created by PHP)
│   ├── pending.json
│   └── published.json
└── api/                               ← Deployed manually once; never overwritten
    ├── fetch-stories.php
    ├── admin.php
    └── published.php
```

---

## Story Structure

### In pending.json / published.json
```json
{
  "headline": "Max 12 words, direct, serious",
  "summary": "2–3 sentences. What happened. Who was harmed.",
  "fml_kicker": "One darkly humorous line. Punch up, never down.",
  "category": "International | National | Local",
  "source": "Publication name",
  "topic_tags": ["tag1", "tag2"],
  "severity": 3,
  "fetched_at": "2026-04-07T11:00:00+00:00",
  "published_at": "2026-04-07T14:23:00+00:00"
}
```

`published_at` is added when approved via admin.php. **Severity scale**: 1 = frustrating bureaucracy → 5 = catastrophic, mass harm.

---

## AI Prompt System

The system prompt lives in `api/fetch-stories.php`. Key rules:

- Stories must be **real and recent** (past 2–3 weeks)
- **No partisan framing** — accountability focus only
- Topic diversity: health, housing, environment, criminal justice, education, infrastructure, finance
- Return **raw JSON only** — no markdown, no preamble, no backticks
- Web search is enabled on every API call

When modifying the prompt, preserve these invariants. The kicker tone is the soul of the product — don't let it drift toward snark-for-snark's-sake.

---

## Deduplication

`fetch-stories.php` normalizes headlines (lowercase, strip punctuation) then uses PHP `similar_text()` to compare each incoming headline against every story in both `pending.json` and `published.json`. Stories with **≥80% similarity** are discarded as duplicates. This prevents the same event from appearing multiple times across fetch cycles.

---

## Admin Panel

`/api/admin.php` — HTTP Basic Auth (credentials: `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars).

- Shows pending stories newest-first
- Editable FML Kicker textarea before approving
- **Approve**: updates kicker if edited, sets `published_at`, prepends to `published.json`, removes from `pending.json`
- **Reject**: removes from `pending.json`, discarded permanently
- Matches site design system (Bebas Neue, Lora, Special Elite, design tokens)
- Works in Safari mobile (iPhone-first)

---

## Design System

Aesthetic: **Depression-era newspaper meets late-night policy briefing**. Serious, with a dark undercurrent.

| Token | Value |
|---|---|
| `--paper` | `#f2ede3` |
| `--paper-dark` | `#e6dfd0` |
| `--ink` | `#1a1714` |
| `--red` | `#b91c1c` |
| `--border` | `#c8bcaa` |
| `--kicker-bg` | `#141210` |

Fonts (Google Fonts):
- **Bebas Neue** — headlines, nameplate
- **Lora** — body text
- **Special Elite** — FML kickers, taglines (typewriter feel)
- **Barlow Condensed** — labels, badges, metadata

Do not introduce new fonts or colors without updating this table.

---

## Current Features (v0.2)

- [x] Live story fetch via Anthropic API + web search (scheduled 4×/day)
- [x] Deduplication: 80% fuzzy headline match across pending + published
- [x] Editorial queue: admin.php with approve/reject + kicker editing
- [x] Published feed: published.php serves curated stories (newest-first, cap 50)
- [x] React frontend fetches from published.php on load
- [x] Severity dot indicator (1–5)
- [x] FML Kicker per story
- [x] Topic tags + source attribution
- [x] Mobile-responsive grid (1 → 2 → 3 col)
- [x] GitHub Actions → FTP auto-deploy (push)
- [x] GitHub Actions → scheduled fetch job (4×/day)

---

## Planned Features (Prioritized)

### High Priority (Mobile Operability)
- [ ] **PWA manifest** — installable on iPhone home screen
- [ ] **Story save/bookmark** — tap to save; persists to localStorage
- [ ] **Share button** per story — native iOS share sheet via Web Share API

### Medium Priority (Editorial Control)
- [ ] **Category override** — correct misclassified stories from admin panel
- [ ] **Bulk reject** — clear low-quality fetch batches quickly

### Lower Priority (Growth)
- [ ] **Story archive** — browsable history of past stories
- [ ] **RSS feed** output
- [ ] **Email digest** (weekly, via Resend or Buttondown)
- [ ] **Reader story submissions**

---

## Operational Constraints

1. **iPhone-first**. All admin workflows must work in Safari mobile. No laptop-required steps in the daily publishing flow.
2. **Minimal dependencies**. Every npm package is a maintenance burden for a solo operator. Prefer native browser APIs.
3. **Free / already-paid-for tier whenever possible**. GreenGeeks (already paid), Anthropic pay-per-use, GitHub free.
4. **Fail gracefully**. If the API is down or returns malformed JSON, show a readable fallback state — never a blank screen.
5. **No CMS overhead**. Do not architect toward WordPress, Contentful, or similar. The AI is the CMS.
6. **`api/` is sacred**. Never let the automated deploy overwrite `public_html/api/`. The deploy.yml excludes it. Keep it that way.
7. **`data/` is ephemeral**. Never commit it. Never let the FTP deploy overwrite it. The deploy.yml excludes it too.

---

## First-Time Server Setup Checklist

When deploying `api/` to GreenGeeks for the first time (via cPanel File Manager or FTP):

1. Upload `api/fetch-stories.php`, `api/admin.php`, `api/published.php`
2. Set env vars in cPanel: `ANTHROPIC_API_KEY`, `FETCH_SECRET_TOKEN`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`
3. Add GitHub Secrets: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `FETCH_SECRET_TOKEN`
4. The `data/` directory and its `.htaccess` are created automatically on the first fetch call
5. Push to `main` to trigger the first React build + FTP deploy

---

## Editorial Philosophy

> The site doesn't exist to make people angry. It exists to make people feel *seen* in their exhaustion with systems that fail them — and to do it with enough dark wit that they come back tomorrow to see what else fell apart.

When in doubt about a feature: **does this serve the reader on their phone, or does it serve the developer's desire to build something interesting?** Choose the reader.

---

*Domain registered: April 2026*
*Last updated: April 2026 | Maintained by Justin*
