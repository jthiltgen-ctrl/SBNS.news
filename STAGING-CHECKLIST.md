# SBNS Phase 3 Staging Checklist

Use this short checklist for ordinary staging sessions. Stop if a step exposes
private data, loses a prior decision, or implies publication without a separate
human action.

## Links

- Public site: <https://sbns-news.sbns-news.workers.dev/>
- Public health: <https://sbns-news.sbns-news.workers.dev/api/health>
- Protected editorial desk: <https://sbns-admin.sbns-news.workers.dev/>

## Five-minute public check

- [ ] Public site loads without an authentication prompt.
- [ ] The default feed shows reporting—not fictional samples.
- [ ] International, National, Local, and Prototype archive filters work.
- [ ] Reporting sources open as external HTTPS links.
- [ ] Health returns `ok: true` and the version recorded in the current baseline.

## Fifteen-minute editorial check

- [ ] Cloudflare Access requires and accepts the authorized editor identity.
- [ ] Queue and prior records load after sign-in.
- [ ] Submit one ordinary public HTTP(S) source URL with a short neutral note.
- [ ] Confirm the record moves through `submitted`, `queued`, `analyzing`, and
  either `review_ready` or an explicit safe failure state.
- [ ] Inspect the submitted source, extracted evidence, claims, qualifications,
  warnings, and model recommendation. The recommendation is not a decision.
- [ ] Save a draft, reload the page, and confirm the draft revision persists.
- [ ] Record HOLD or REJECT for routine tests. Use APPROVE only when deliberately
  testing exact-revision approval; approval must not publish anything.
- [ ] If analysis fails, verify the displayed reason is safe and retry once.
- [ ] Reopen the intake and confirm its audit history and latest state agree.

## Phone-width check

- [ ] At approximately 390 × 844, the queue, evidence, draft form, and decision
  controls are readable without horizontal scrolling.
- [ ] Controls remain tappable and saved-state messaging remains visible.

## Record after each session

Add the date, tested intake IDs, final states, unexpected behavior, and whether
the baseline changed to [STAGING-BASELINE.md](STAGING-BASELINE.md). Never paste
source text, authentication tokens, private contact details, or secrets there.
