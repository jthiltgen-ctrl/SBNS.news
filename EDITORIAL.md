# SBNS Editorial Workflow

Publication is always a human editorial decision. Automation may validate and
format content, but it must never invent, infer, or silently replace a source.

1. Copy `content/story-template.json` into `content/stories/`.
2. Name the file with a readable date and slug, such as
   `2026-08-18-public-housing-audit.json`.
3. Write and revise the story with `status` set to `draft` and
   `published_at` set to `null`.
4. Add and personally verify every source. Published reporting needs at least
   one real `http://` or `https://` source URL.
5. Run `npm run content:build`.
6. Run `npm run check`.
7. Open a pull request for human review.
8. Only after editorial approval, change `status` to `published`, set an
   ISO-8601 `published_at` timestamp, rebuild, and update the pull request.

## Content types

- `sample` is unmistakably fictional demonstration content and receives a
  visible sample badge.
- `reporting` is factual editorial content and must cite verified sources before
  publication.

Never edit `public/stories.json` directly. It is generated from published files
in `content/stories/`; draft stories remain source-controlled but are excluded
from the public feed.
