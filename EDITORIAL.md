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

## Public accountability and assistance

The public reader identifies Justin Thiltgen as editor and publisher. Published
reporting pages use the factual attribution `By Justin Thiltgen · Shocked But
Not Surprised`; the publication remains the primary brand.

AI and automation may organize research, compare sources, structure evidence,
assist analysis and drafting, or support production. They are not reporters,
witnesses, factual sources, editors of record, or autonomous publishers. Human
editorial authority decides what is held, rejected, corrected, approved, and
published.

Preserve these distinctions in public and internal work:

```text
conversation != evidence
model output != source provenance
recommendation != decision
approval != publication
deployment != verified publication
```

The public transparency surface must not guess at ownership, funding, legal
structure, contact information, confidentiality, conflicts, or privacy terms.
Unknown facts remain explicitly unstated until they are formally established.

SBNS voice may sharpen utility copy, but humor never changes a factual claim or
acts as evidence. It must point upward at institutions, systems, processes,
leadership decisions, and concentrations of power. Standards, corrections,
source safety, privacy, and security language stay precise. **We punch up at
power, never down at the people living with the consequences.**
