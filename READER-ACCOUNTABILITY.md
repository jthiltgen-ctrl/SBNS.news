# Reader Resilience and Public Accountability

Status: current public-reader requirement

## Publication source boundaries

The public reader has one published-story source of truth:

```text
content/stories/*.json = published-story source of truth
public/stories.json     = deterministic generated feed
public/index.html       = deterministic initial-HTML reporting surface
public/story/*.html     = deterministic canonical story pages
D1                      = editorial workflow state only
```

The content build regenerates the marked reporting region in `public/index.html`
from the same approved reporting JSON used for the feed and story pages. The
homepage is not a second manually maintained story source.

## Static-first reader contract

Published reporting, its ordinary permanent links, sources, dates, summaries,
tags, severity, and kickers must be meaningful in the initial homepage HTML.
JavaScript progressively adds filtering, Prototype archive access, manual
refresh, and status messaging. A script or refresh failure must not erase the
last valid reporting already present in the document.

Prototype samples remain excluded from the initial reporting region and appear
only through the clearly labeled Prototype archive enhancement.

## Public accountability

Shocked But Not Surprised remains the primary publication identity. Justin
Thiltgen is publicly identified as editor and publisher, and deterministic
reporting pages carry the byline `By Justin Thiltgen · Shocked But Not
Surprised`.

The homepage transparency surface provides durable locations for publication
identity, editor/publisher identity, ownership, funding, method and provenance,
corrections, AI-assisted work, conflicts/disclosures, and contact information.
Unknown facts remain explicitly unstated until a human decision establishes
them; the reader must not invent a legal structure, funding model, policy, or
contact channel.

## Canonical reader identity

The masthead combines the approved document/magnifying-glass/centered-star mark
with the exact `Shocked But Not Surprised.news` wordmark and formal
`Independent Accountability Reporting` descriptor. The voice-forward tagline
remains `Another day. Another system that had one job.`; `The institutional
failure desk` is supporting desk language, not a competing descriptor. The
process signature and brand promise are reserved for method and About contexts
rather than stacked into the masthead.

Reader severity meters use Signal Red for filled dots only. The visible numeric
value and `Severity N out of 5` accessible label remain mandatory, empty dots
remain neutral, and color does not encode evidence quality, guilt, certainty,
or political meaning. Story share and Copy Link controls use Signal Red as the
bounded primary action treatment. Story kicker labels read `SBNS Kicker`; the
legacy `fml_kicker` data field remains unchanged for compatibility.

## AI-use boundary

AI and automation may assist with research organization, source comparison,
evidence structuring, analysis, drafting, and production support. Human
editorial authority decides what is held, rejected, corrected, approved, and
published.

The public explanation preserves these separations:

```text
conversation != evidence
model output != source provenance
recommendation != decision
approval != publication
deployment != verified publication
```

## Voice boundary

Dry interface copy may point upward at institutions, systems, processes,
leadership decisions, and concentrations of power. Humor does not alter facts,
serve as evidence, or reduce the precision of standards, corrections, source
safety, privacy, or security language. The governing editorial principle
remains: **We punch up at power, never down at the people living with the
consequences.**

## Deployment-control fact

`.github/workflows/deploy.yml` runs on qualifying pushes to `main`, including
changes under `public/**`, `content/**`, and `scripts/content.mjs`. It validates
and deploys the public Worker. A future merge of reader changes is therefore a
deployment-triggering action unless that workflow behavior is separately
changed and verified first.

Before authorizing a merge, inspect the current workflow triggers and report
their consequences. A draft PR or local validation does not deploy.

## Explicit deferrals

This reader contract does not implement Receipt · Number · Timeline, The Shock
or Why We're Not Surprised, The Job / The Record / The Gap, Records Room,
System Files, Challenge the Record, story-history or institutional-response
data models, Newsroom Workbench, Secure Source, visitor submissions,
subscriptions, RSS, semantic search, or new publication automation.
