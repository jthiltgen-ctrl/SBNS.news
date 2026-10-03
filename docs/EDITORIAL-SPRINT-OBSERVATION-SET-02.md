# Editorial Sprint Observation Set 02 — Discovery Yield

Status: proposed on an unmerged draft branch; no production deployment or Watchdesk run is part of this work.

## Observed problem

The downstream editorial-production pipeline is operational, but a recurring-source portfolio alone is not a sufficiently broad discovery universe. In newsroom testing it can miss distinctive situations reported by local, consumer, regional, and independent publishers—especially human-centered stories about institutional delay, process failures, displaced costs, ignored complaints, and lack of recourse.

The response is a second lane inside the existing Watchdesk run, not a new product or service:

`Trusted Source Scan + bounded GDELT Open Sweep → one normalization/dedupe/event-cluster/triage path → existing Newsroom intake and analysis`

Trusted-source monitoring, source health, source-learning governance, and the twice-daily schedule remain intact. Open Sweep does not add publisher monitors. Unknown publishers can supply leads, but do not thereby become trusted sources or evidence authorities.

## Discovery is not evidence

Open Sweep searches ten rotating, deterministic formulations covering Human Burden, Bureaucratic Absurdity, Ignored Warnings, No One Owns the Problem, Little Guy Pays, Technical Compliance / Real-World Failure, Waste / Broken Delivery, No Recourse, and FML / You Cannot Make This Up. A separate GDELT `toneabs>10` formulation is a discovery lens, not an admission score. GDELT documents this operator as finding articles with stronger positive or negative tone; it does not establish accuracy, harm, causation, institutional fault, or SBNS relevance ([GDELT DOC API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/amp/)).

The Open Sweep gate is deliberately lightweight and metadata-only. It asks whether a title/URL plausibly indicates human impact, an institutional/system nexus, a concrete condition, an accountability aperture, distinctive SBNS value, and a researchable lead. Passing creates an explicitly unverified reporting lead for the ordinary analysis path. Emotionality alone cannot pass. A `fml_candidate` label is an internal invitation to investigate a vivid, human situation—not a finding, punchline, or permission to ridicule the people affected. Punch up at systems; do not target people living with consequences.

The article behind an Open Sweep result is not fetched during discovery. Its publisher remains unverified; the Story File must retrieve and analyze the submitted URL, pursue primary records and institutional response where appropriate, and may still return NO ACTION, HOLD, REJECT, or DRAFT WITHHELD. No new evidence standard or analyzer is introduced.

## Bounds and deduplication

Each normal run requests at most ten formulations, six metadata records per query, and sixty raw results total. Open Sweep uses the existing GDELT DOC endpoint over its fixed HTTPS host, a seven-day search window, sequential queries spaced by five seconds, a 15-second per-request timeout, manual redirect refusal, the existing 256 KB response cap, and at most one bounded retry for HTTP 429, GDELT's plain-text rate-limit notice, or a locally timed-out request. Interactive editorial search retains its prior 30-day default. GDELT documents day-based `timespan` values for DOC searches ([GDELT DOC API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/amp/)).

The first production Open Sweep run reported `The operation was aborted` for all ten queries under the prior eight-second timeout. That output is consistent with the local abort deadline being too aggressive, but does not establish that as the root cause; provider/network interruption remains possible. A development browser probe subsequently returned GDELT's notice asking clients to limit requests to one every five seconds. Accordingly, pacing follows that provider instruction rather than the originally planned sub-second interval. The transport also recognizes that plain-text rate-limit response even if it arrives with a success status. It reports bounded per-query outcome, attempts, elapsed time, HTTP status, and stable error category. After three consecutive timeout/network query failures, it opens a run-local circuit and records remaining hypotheses as skipped rather than sending more requests. This makes a future authorized run diagnostically useful while limiting repeat load. One failure still does not stop other queries or Trusted Source scanning.

There is no result-page crawl, model call, additional vendor, or paid service. The transport does not change editorial triage, ranking, or submission thresholds.

URLs are normalized before exact deduplication. Event clusters use exact normalized URL identity or a conservative high title-token overlap across distinct publisher domains and within seven days; missing dates do not permit title-only clustering. Similar headlines from one publisher are not merged by title alone. The deterministic event key uses a canonicalized title plus its first-seen week when available, or the representative URL when not. A representative lead, bounded coverage URLs/domains, lens provenance, and cluster ID travel with an admitted intake. Clustered coverage is not counted as independent corroboration. Previously published/queued exact items are suppressed; a title needs an explicit follow-up/new-finding/corrective-action signal before a related published item can be reconsidered as a possible development. Analysis must verify that signal.

Only up to five candidates across both lanes can enter the Newsroom in one run, under the existing cap and shared lease/ledger. Reviewed Trusted Source accountability gaps retain first priority. Remaining candidates are ordered by explicit metadata specificity signals (such as named institution, concrete scale/duration, warning/recourse, or possible follow-up), then recency—not emotionality or outlet count. Zero submissions is successful.

## Evaluation after activation

The existing Watchdesk run ledger records separate trusted-lane feed counts/failures/submissions; Open Sweep queries, raw/normalized/deduped hits, event clusters, triaged and eligible leads, human-burden/FML labels, discarded leads and submissions; and combined duplicate/cross-lane overlap counts. These are operational observations, not quality scores.

After a separately authorized production release and ordinary newsroom sprint, ask:

- Did Open Sweep surface situations that trusted monitors missed?
- Which lenses produced credible Story Files versus noise?
- How often did local/emotional leads lead to primary evidence or institutional response?
- How many candidates were duplicates, false matches, or too thin to analyze?
- Did cross-publisher clusters reduce editor burden without implying corroboration?
- What additional retrieval/analysis-model usage followed admitted leads?

Do not lower triage thresholds to fill the five-item cap. If Open Sweep adds noise without distinctive, verifiable accountability reporting, reduce or stop the lane before adding another discovery provider. New fixed recurring cost is $0; admitted intake analysis may produce variable retrieval/model usage under existing services.

## Scope and authority

The feature uses the existing Watchdesk Worker, run ledger, Newsroom intake, analysis queue, Story File, and human editorial authority. It does not add a worker, queue, endpoint, schedule, schema, permanent source registry entries, Echo flow, public page, publication decision, or Story Queue/email configuration. No production Watchdesk run is authorized by this observation set.
