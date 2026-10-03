# Editorial Sprint Observation Set 02 — Discovery Yield

Status: provider-resilience implementation is proposed on an unmerged draft branch stacked on PR #51; no production deployment or Watchdesk run is part of this work. Media Cloud has not been live-probed because no API token is configured in this development environment.

## Observed problem

The downstream editorial-production pipeline is operational, but a recurring-source portfolio alone is not a sufficiently broad discovery universe. In newsroom testing it can miss distinctive situations reported by local, consumer, regional, and independent publishers—especially human-centered stories about institutional delay, process failures, displaced costs, ignored complaints, and lack of recourse.

The response is a second lane inside the existing Watchdesk run, not a new product or service:

`Trusted Source Scan + bounded provider-agnostic Open Sweep (GDELT DOC + optional Media Cloud Search) → one normalization/dedupe/event-cluster/triage path → existing Newsroom intake and analysis`

Trusted-source monitoring, source health, source-learning governance, and the twice-daily schedule remain intact. Open Sweep does not add publisher monitors. Unknown publishers can supply leads, but do not thereby become trusted sources or evidence authorities.

## Discovery is not evidence

Open Sweep searches ten rotating, deterministic formulations covering Human Burden, Bureaucratic Absurdity, Ignored Warnings, No One Owns the Problem, Little Guy Pays, Technical Compliance / Real-World Failure, Waste / Broken Delivery, No Recourse, and FML / You Cannot Make This Up. A separate GDELT `toneabs>10` formulation remains GDELT-only and is a discovery lens, not an admission score. GDELT documents this operator as finding articles with stronger positive or negative tone; it does not establish accuracy, harm, causation, institutional fault, or SBNS relevance ([GDELT DOC API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/amp/)).

The Open Sweep gate is deliberately lightweight and metadata-only. It asks whether a title/URL plausibly indicates human impact, an institutional/system nexus, a concrete condition, an accountability aperture, distinctive SBNS value, and a researchable lead. Passing creates an explicitly unverified reporting lead for the ordinary analysis path. Emotionality alone cannot pass. A `fml_candidate` label is an internal invitation to investigate a vivid, human situation—not a finding, punchline, or permission to ridicule the people affected. Punch up at systems; do not target people living with consequences.

The article behind an Open Sweep result is not fetched during discovery. Its publisher remains unverified; the Story File must retrieve and analyze the submitted URL, pursue primary records and institutional response where appropriate, and may still return NO ACTION, HOLD, REJECT, or DRAFT WITHHELD. No new evidence standard or analyzer is introduced.

## Bounds and deduplication

The provider allocation preserves ten query formulations per run. With a Media Cloud token configured, one rotating complementary formulation goes to Media Cloud and the other nine—including the separate emotional-intensity query—go to GDELT. If Media Cloud fails, only that formulation falls back to GDELT. Without a token, all ten formulations stay on GDELT and Media Cloud is reported as `not_configured` without issuing a request. Thus a normal configured run makes ten provider requests; the single bounded Media Cloud failure/fallback case makes eleven provider calls (one failed Media Cloud call plus ten GDELT calls). Existing GDELT transport retry remains bounded to one retry per eligible query and its run-local timeout/network circuit breaker remains in force.

Media Cloud uses its current Search API `story-list` route, `onlinenews-mediacloud` platform and the sample U.S. National collection ID `34412234` from its official client. It makes at most one request per Watchdesk run, returns at most six metadata records, uses a seven-day window and a 15-second deadline, caps response bodies at 128 KB, refuses redirects and does not retry. At the existing twice-daily schedule, this is at most 14 Media Cloud requests per week—0.35% of its documented default 4,000-request weekly quota, with large headroom. One request every nine hours is also below the FAQ’s stricter two-requests-per-minute limit for certain endpoints. Media Cloud’s client documents the API v4 base URL, Token authorization, and story-list parameters; its query guide supports capitalized Boolean operators, quoted phrases, and `language:en`, while excluding regular expressions ([official client](https://github.com/mediacloud/api-client/blob/main/mediacloud/api.py), [query guide](https://www.mediacloud.org/documentation/query-guide), [quota FAQ](https://www.mediacloud.org/documentation/faqs)).

The credential is an optional Worker secret named `MEDIA_CLOUD_API_TOKEN`; it is never placed in source or Wrangler configuration. Before any separately authorized live probe, an operator must set it through the admin Worker secret mechanism (for example, `wrangler secret put MEDIA_CLOUD_API_TOKEN --config wrangler.admin.jsonc`). Until configured, the Media Cloud provider is explicitly `not_configured`. Search results are metadata-only leads (ID, title, publication date, URL and publisher name); no story body is requested or retained. Media Cloud itself notes that it does not provide story text and exposes URLs instead ([Media Cloud FAQ](https://www.mediacloud.org/documentation/faqs)). GDELT continues to use its fixed HTTPS DOC endpoint, seven-day window, five-second sequential pacing, 15-second request timeout, manual redirect refusal, 256 KB response cap, bounded retry, and transport circuit breaker. Interactive editorial search retains its prior 30-day default. GDELT documents day-based `timespan` values for DOC searches ([GDELT DOC API documentation](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/amp/)).

The first production Open Sweep run reported `The operation was aborted` for all ten queries under the prior eight-second timeout. That output is consistent with the local abort deadline being too aggressive, but does not establish that as the root cause; provider/network interruption remains possible. A development browser probe subsequently returned GDELT's notice asking clients to limit requests to one every five seconds. Accordingly, pacing follows that provider instruction rather than the originally planned sub-second interval. The transport also recognizes that plain-text rate-limit response even if it arrives with a success status. It reports bounded per-query outcome, attempts, elapsed time, HTTP status, and stable error category. After three consecutive timeout/network query failures, it opens a run-local GDELT circuit and records remaining GDELT hypotheses as skipped rather than sending more requests; Media Cloud may still complete its independently assigned query. One provider failure does not cancel the other provider or Trusted Source scanning. If both Open Sweep providers fail, the run is accurately partial while a successful Trusted Source lane remains usable.

There is no result-page crawl, model call, or paid service. Media Cloud is the only new provider; no additional vendor is configured. The transport does not change editorial triage, ranking, source governance, or submission thresholds.

URLs from both providers are normalized before exact deduplication. Cross-provider exact duplicates collapse into one event cluster; `discovery_provider_ids` retains the provider set as operational provenance only. Provider overlap does not increase ranking, source authority, or evidentiary weight and is not independent corroboration. Event clusters use exact normalized URL identity or a conservative high title-token overlap across distinct publisher domains and within seven days; missing dates do not permit title-only clustering. Similar headlines from one publisher are not merged by title alone. The deterministic event key uses a canonicalized title plus its first-seen week when available, or the representative URL when not. A representative lead, bounded coverage URLs/domains, lens provenance, and cluster ID travel with an admitted intake. Previously published/queued exact items are suppressed; a title needs an explicit follow-up/new-finding/corrective-action signal before a related published item can be reconsidered as a possible development. Analysis must verify that signal.

Only up to five candidates across both lanes can enter the Newsroom in one run, under the existing cap and shared lease/ledger. Reviewed Trusted Source accountability gaps retain first priority. Remaining candidates are ordered by explicit metadata specificity signals (such as named institution, concrete scale/duration, warning/recourse, or possible follow-up), then recency—not emotionality or outlet count. Zero submissions is successful.

## Evaluation after activation

The existing Watchdesk run ledger records separate trusted-lane feed counts/failures/submissions; Open Sweep provider configuration/status, query attempts/successes/failures, raw results, latency, error categories and GDELT circuit state; Open Sweep raw/normalized/deduped hits, event clusters, triaged and eligible leads, human-burden/FML labels, discarded leads and submissions; and combined duplicate/cross-lane overlap counts. The existing Watchdesk health surface summarizes GDELT and Media Cloud status without adding a new dashboard. These are operational observations, not quality scores. Media Cloud is not activated or live-proven until the operator adds a token and an authorized development smoke query succeeds.

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
