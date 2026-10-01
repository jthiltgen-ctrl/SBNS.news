# September 22–23, 2026 transparency reconciliation

Implemented October 1, 2026 against production/main
`aa8520c204b03b59acfcb5e84a6d2e7bb9a64f99`.

## Files and editorial decisions

- `public/index.html`: reconcile four cards; load the independent contact enhancement.
- `public/editorial-contact.js`: assemble ordinary editorial email on activation.
- `public/styles.css`: use existing typography, Signal Red, and focus treatment for contact and native manual instructions.
- `scripts/public.mjs`: replace obsolete static-email expectations with nine-card, current-state, contact-action, fallback, and publication-boundary regressions.
- `TRANSPARENCY-RECONCILIATION.md`: implementation and validation record.

Reviewed all nine cards together. Preserve all existing headings and order,
two-column desktop/single-column mobile layout, full-width AI explanation,
brand assets, reader functionality, and the other five cards' substantive copy.
Preserve the method signature, rendered as **OBSERVE. VERIFY. EXPLAIN.**, and
**Receipts first. Judgment stays human.**

The exact replacement copy is:

**Ownership**

> Justin Thiltgen controls SBNS editorial decisions. The independent publication does not speak on behalf of any government agency, political organization, advocacy group, news organization, or other institution.

**Funding**

> SBNS is self-funded by its editor and publisher, Justin Thiltgen. Financial support does not confer editorial authority; material financial relationships relevant to coverage belong in the disclosure record.

The publisher confirmed "Self-funded" during this implementation. No separate
legal structure, outside funder, or additional financing claim was inferred.

**Conflicts & disclosures**

> Relevant personal, professional, financial, or institutional relationships belong with the coverage or an accompanying note. Disclosure gives readers context to evaluate the work; it does not by itself establish a conflict.

**Contact**

> Questions, corrections, responses, and public records are welcome. Please identify the story and include supporting information.
>
> Email the editorial desk
>
> Ordinary email does not provide anonymity or guaranteed confidentiality.

Native optional fallback summary:

> Manual email instructions

Fallback instructions:

> Address a message to editor, followed by the @ sign and shockedbutnotsurprised.news.

Remove redundant opening declarations and promises about future ownership,
funding, standing disclosures, and a future Secure Source / Tip Line. Current
public copy does not advertise secure intake, anonymity, confidentiality
guarantees, GlobaLeaks, or other unreleased functionality.

## Editorial contact

The visible native link reads "Email the editorial desk". Its static target is
the manual instructions, inside native `details`. Fragment navigation reveals
those instructions when JavaScript is disabled or the enhancement fails.
The optional instructions spell out separate mailbox/domain components;
they never print the complete address as routine page copy.

A separate deferred script handles ordinary mouse and keyboard activation.
It joins mailbox/domain components only inside the activation handler and
requests the standard `mailto:` workflow. The full address is not written to
the page or a static link. Modified clicks preserve the native fallback.
The link's accessible description states the ordinary-email boundary, and
existing visible focus styles apply to the link and native summary. The
enhancement is independent of reporting JavaScript and feed availability.

This reduces trivial address harvesting; it does not make the address secret.
It introduces no service, tracker, dependency, source-intake system, or mail
infrastructure change. An installed/configured mail handler remains the
reader's responsibility; manual instructions remain available.

Repository-wide search found only the homepage contact and its obsolete
regression assertion as contiguous occurrences of the editorial address.
Both were reconciled. No other public ordinary-contact occurrence required
changes; machine-readable configuration and operational mail settings were
unaffected.

## Historical wording

**HELD — exact approved wording not recovered; no substitute was invented.**

Searched all 86 locally fetched commits across available repository branches,
their changed copy/documentation/brand assets, commit messages, current project
records, prior PR descriptions, and the repository issue-comment collection.
No authoritative "Same problem…" wording was recovered. Relevant prior records
include PR #35 and its September 22 commit
`cdaf0690b25683d4e9285c52836e87f37d8c9e39`, PR #33, and the canonical brand
reconciliation records. A historical "Same Questions" line is different copy
and is not evidence for the requested wording. Nothing was restored beneath
the preserved method signature.

## Validation and release workflow

- `npm ci` using a writable temporary cache: passed without dependency or lockfile changes.
- `npm run content:build`, `npm run intake:build`, `npm run monitoring:build`: passed; generated reader/story/feed/share-card artifacts remained unchanged outside the intended homepage edit.
- `npm run check`: passed in full, including content/evidence/public reader, intake, monitoring, publication, persistence, admin, analysis, Watchdesk, JavaScript syntax checks, and public/admin/analysis Worker dry runs.
- `node --check public/editorial-contact.js` and `git diff --check`: passed.
- Browser checks: desktop 1440px, 850px breakpoint, 390px and 320px mobile; nine cards, balanced layout, uniform padding/headings, no overflow, native link accessibility tree and described-by association, visible keyboard focus, ordinary email URI, native manual instructions, JavaScript-disabled/script-blocked access, 200% text, forced colors, print structure, Reporting/Prototype filters, failed-refresh preservation, and no JavaScript errors.
- The headless QA host has no external mail client. It verifies the correct requested `mailto:` URI for mouse and Enter; it does not claim to have opened a user's installed composer or sent correspondence.

The initial full-suite run stopped at a Wrangler configuration write outside
the writable sandbox. The successful run used temporary Wrangler configuration
and npm cache directories; no project configuration changed.

The normal `.github/workflows/deploy.yml` production workflow validates and
deploys `sbns-news` after the PR reaches `main`. Its credential environment is
named `staging`, but this Worker serves production. These five changed paths do
not trigger `.github/workflows/deploy-admin.yml`. No remote migrations, admin
deployment, DNS, mail service, delivery settings, or governance change is part
of this release. Final commit/PR/deployment and production verification results
are recorded in the release PR and implementation report.
