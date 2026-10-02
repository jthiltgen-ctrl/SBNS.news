# Echo Desk PR B — synthetic orchestration contract

Echo Desk is downstream of established newsroom relevance. This PR assembles a
bounded cultural *research packet* from caller-supplied, synthetic inputs. It
does not discover cultural works, fetch sources, call a model, expose an API or
UI, configure a Queue/Worker/schedule, create public copy, or make a human Echo
decision. `WE WERE WARNED` remains a later, separately authorized public
feature. The fixture institutions, works, creators, and `example.test` URLs are
invented. No live cultural research occurs in PR B.

## Input boundary and canonical brief

`src/echo-orchestration.js` accepts a versioned `echo-brief-v1` object and a
bounded list of `echo-candidate-v1` objects. Both have strict, documented field
allowlists and constrained vocabularies. The issue key is supplied by the
newsroom caller as a durable lowercase issue identity; it is not derived from
a date, label, cultural artifact, or headline. PR B does no semantic issue
deduplication.

The brief contains `issueKey`, a working `title`, institution, jurisdiction,
condition, institutional expectation, sourced verified facts, unresolved facts,
material qualifications, accountability question, affected interests, systemic
mechanism, explicit `mustNotClaim`, linked intake IDs/roles, linked contemporary
evidence source IDs/content hashes/confidence/provenance, and a confidence/
provenance summary. Exactly one primary intake is required. IDs may not repeat;
facts must reference declared evidence sources; those sources must belong to
linked intakes. Missing facts, questions, malformed lists/roles/provenance, or
unsupported fields return bounded `EchoInputError` codes. The validator trims
outer text whitespace and normalizes CRLF to LF, but never infers a fact.
There is no cultural candidate data in the brief.

`echo-candidate-v1` supplies artifact identity, a nine-field Analogy Truth
Test, claim-specific sources, per-asset rights reviews, structured gate facts,
and prior-use status/justification. `gate.contextAuthority` (primary, scholarly,
limited) describes only the authority supporting the artifact's **original
historical context**. It is not a global authority grade for the candidate,
its contemporary connection, rights, or any other claim. This is the contract a future PR C adapter
may supply; PR B does not couple it to a catalog or search API. During the
`researching` stage, before any candidate write, an intake-scoped contemporary candidate source must match the brief's
linked source and intake IDs.

## Canonicalization and hashes

`canonicalJson` recursively sorts object keys, omits undefined object fields,
rejects undefined list entries, cyclic structures, non-finite numbers, and
unsupported values. Array order remains significant unless the input contract
declares it an unordered set. Brief intakes, evidence sources, and verified
facts are sorted by ID; each fact's source IDs and the text-set fields are
sorted. Candidate sources are sorted by their canonical source identity.
Duplicate IDs or identities are rejected. Text is trimmed at its edges and
line endings are normalized; internal wording, case, punctuation, and URL
query order are not semantically rewritten. All hashes use UTF-8 SHA-256,
lowercase 64-character hex.

`evidence_snapshot_hash` covers the canonical contemporary brief except its
working `title`. It includes issue identity, linked intakes/roles, facts and
their source references, source identity/content hashes/confidence/provenance,
qualifications, constraints, institution/jurisdiction/condition/expectation,
question, affected interests, mechanism, and unresolved facts. `runtimeAt`,
packet/job IDs, and candidate data are never part of the brief hash. A title
change alone therefore reuses the same packet; the originally reviewed brief
remains immutable. A material evidence change creates a new packet revision.

The separate candidate-package digest covers the complete list of
`canonicalCandidate()` results: artifact identity and metadata, every Analogy
Truth Test field, all normalized source identities **and** metadata, per-asset
rights reviews and their citations, gate inputs (including
`contextAuthority`), and prior-use status and justification. Candidates are
sorted by `canonicalArtifactId` with ordinal string comparison before canonical
JSON and SHA-256 hashing; each candidate's source and rights lists are likewise
ordinally sorted for this package digest. This does not change the separate
assessment source-set hash.
Changing caller list order does not change the digest, while adding, removing,
or materially changing a candidate does. Run keys, job IDs, requester identity,
and the orchestration run timestamp are not part of this digest; timestamps in
the normalized candidate's source and rights metadata remain part of it. The
digest binds one supplied cultural research result to an open packet; it does
**not** alter the contemporary `evidence_snapshot_hash` or create a new packet
revision.

For each Echo source, stable identity uses its role, supported assessment
field, linked SBNS source/intake IDs when applicable, canonical identifier,
normalized HTTP(S) URL, and optional content/version hash. URL normalization
uses the URL parser (host/default-port normalization and fragment removal);
credentials/non-HTTP(S) URLs are rejected. The hash excludes retrieval time,
display title, and authority-rationale prose. It never hashes complete
copyrighted text. Independent cultural sources need a URL or canonical ID;
intake-scoped sources remain distinguishable from them.

`source_set_hash` is the sorted, duplicate-free set of **non-rights** source
identities for the assessment. Adding/removing one, changing its role or
supported field, or changing a content/version hash changes this hash.
Rights-role sources are deliberately excluded because post-readiness rights
provenance may be appended to the pinned assessment without changing the
frozen analogy assessment. Unlike this assessment-level hash, the
candidate-package digest includes rights evidence and other cultural inputs
to detect a changed research package on retry. The database stores, but does
not independently recalculate, the evidence and source-set hashes.

## Deterministic gates and assembly

Pure gate logic returns `PASS` or the first applicable reason, in this order:

1. `ORIGINAL_CONTEXT_INSUFFICIENT` — context not verified or no original/context source.
2. `PRESENT_EVIDENCE_INSUFFICIENT` — contemporary evidence insufficient or no contemporary source.
3. `ANALOGY_MISLEADING` / `ANALOGY_TOO_WEAK` — misleading mechanism or topic-only resemblance.
4. `NO_EDITORIAL_VALUE` — no explanatory increment.
5. `CULTURAL_PROTOCOL_UNRESOLVED` — cultural-use protocol unresolved.
6. `RESEARCH_BURDEN_DISPROPORTIONATE` — disproportionate research burden.
7. `RIGHTS_REVIEW_MISSING` — no per-asset rights assessment.
8. `PRIOR_USE_JUSTIFICATION_REQUIRED` — familiar/recent use without an explicit reason to reconsider.

Prior use is caution, never an automatic ban: a justified familiar artifact
can pass. Restrictive `unknown`, `link_metadata_only`, or
`do_not_reproduce` rights findings can also pass because review is not
reproduction permission. No gate assigns a similarity score or declares an
editorial FEATURE decision.

Survivors are tiered transparently by mechanism match (direct, qualified),
historical-context authority (primary, scholarly, limited), research burden
(low, moderate, high), prior-use caution, then canonical artifact ID. This order only selects a
reviewable packet; it is not an editorial verdict. At most three survivors
receive slots 1–3 and the existing database constraint also bars a fourth.
Additional passers use the schema-v5-compatible candidate state
`rejected_by_gate / NOT_IN_TOP_THREE`, but their evaluation audit records
substantive `PASS` plus packet-cap `NOT_IN_TOP_THREE`. This is neither a factual
nor an editorial rejection. Others keep their bounded substantive gate reason.
Every input candidate receives a durable identity;
only selected candidates receive an assessment, sources, rights review, and
`editor_ready` state. No FEATURE/HOLD/REJECT or publication row is created.

Zero candidates or zero survivors completes the packet/job successfully as
`NO CULTURAL ECHO WARRANTED`, with `NO_CANDIDATES`,
`ALL_CONTEXT_FAILED`, `ALL_PRESENT_EVIDENCE_FAILED`,
`ALL_ANALOGY_FAILED`, `RESEARCH_BURDEN_EXCEEDED`, or
`NO_ELIGIBLE_CANDIDATE`. It is not an operational failure and never forces a
cultural match.

## Persistence, replay, stale state, and failure

The orchestrator uses PR A's audited persistence functions and narrow
read/audit helpers. It validates the contemporary
brief before creating/reusing the packet and job. Candidate normalization,
hard gates, candidate creation/rejection, and top-three selection occur while
the durable job is `researching`; zero survivors complete `no_echo` there.
Before any candidate-package-dependent write, the orchestrator records one
`echo.candidate_package_bound` audit for the packet with a deterministic ID
and bounded metadata (packet, processor/package version, digest, count). On a
new-key retry, an existing binding must match the recomputed digest exactly;
otherwise `RETRY_INPUT_MISMATCH` stops the run before another candidate,
evaluation, source, rights, readiness, or terminal-result write. Reordering
the same normalized candidates or sources is not a mismatch. If a prior run
failed before binding and wrote no candidate-package rows, the next attempt
may establish the first binding. A completed packet still returns
`ALREADY_PROCESSED` without reconsidering supplied candidates.

Selected assessments, frozen non-rights sources, and source-set hashes are
persisted while `verifying`. Rights sources and per-asset rights reviews are
persisted while `rights_check`. Readiness slots, unresolved-candidate checks,
and `ready` completion occur while `assembling`. Failures are audited from the
actual stage in which they occur. Exact replay of a
completed snapshot returns `ALREADY_PROCESSED` without another job or row.
The packet is one research result per contemporary evidence snapshot: changing
only supplied candidates after completion does not reopen it. Reassessment
without material contemporary evidence change needs a separately designed
editorial revision contract, not a silent mutation.

Candidate, assessment, source, rights, packet, and job IDs are derived from
stable inputs. An open packet with a failed job accepts a new idempotency key;
only the bound candidate package may reuse its already written rows without
duplication. A changed package is rejected, not merged into those rows. An
active job blocks another. A material evidence change creates revision N+1 and
supersedes the prior packet without deleting its history. Each synthetic stage checks that
the packet remains current. Existing D1 conditions and triggers also reject
stale candidate/readiness/completion writes. Deterministic test-only step
hooks inject failures; a failed job is recorded with a bounded error, the
packet stays open, and earlier writes/audits remain durable. There is no
automatic retry infrastructure.

Existing generic `audit_events` records packet/job creation, lifecycle and
failure, candidate discovery/rejection, assessment/source/rights persistence,
readiness, and ready/no-echo completion. `echo.candidate_evaluated` additionally
records one bounded **selection plan** per packet/candidate: packet/candidate IDs,
processor version, substantive gate result, intended slot/cap/substantive
selection outcome, mechanism and research-burden classes, prior-use status and
justification-present boolean, historical-context authority, and evidence/
rights-review presence booleans. A deterministic audit ID keyed to packet and
candidate makes new-key retries reuse the same event; conflicting metadata is
rejected rather than overwriting history. A slot in this evaluation event does
not claim that readiness completed: candidate-readiness and packet-result
audits are separate durable receipts. The packet-level
`echo.candidate_package_bound` receipt holds only the digest and bounded
identity/count metadata, never the supplied package itself. No justification
prose, raw source text, copyrighted material, or model reasoning is logged.

The suite uses only isolated SQLite memory migrated through v5 and fabricated
fixtures; `npm run echo:check` exercises pure contracts and `npm run echo:test`
exercises the full orchestration. Both are included in `npm run check`.

## PR B handoff boundary

PR C was the separately authorized next step for bounded public-source
discovery and historical-context adapters. PR B itself added no migration 0006,
remote D1 operation, Cloudflare resource, or live Newsroom integration. Its
deterministic candidate, hash, gate, retry, and human-authority contracts remain
unchanged by the adapter layer described below.

## PR C — development-only public-source adapters

PR C adds small, source-specific adapters for the [Library of Congress (LOC)
JSON API](https://www.loc.gov/apis/json-and-yaml/requests/endpoints/) and the
[Smithsonian Open Access API](https://www.si.edu/openaccess/devtools). The
purpose is to demonstrate a narrow sequence: public catalog search → bounded
normalized discovery record → separately checked historical/context metadata →
inputs compatible with `echo-candidate-v1`. Neither catalog search nor a
verified metadata record is a complete Echo candidate. The adapters do not
judge the analogy, establish contemporary evidence, clear rights for a proposed
use, make a human FEATURE/HOLD/REJECT decision, or publish anything.

### Source authority and limits of proof

| Adapter | Why it is present and what it can establish | What it cannot establish |
| --- | --- | --- |
| LOC | Finds music, manuscripts, photographs, newspapers, posters, and other historical objects. An item record can support identity, cataloged creator/date, collection provenance, and original-context details **when the record actually supplies them**. LOC documents separate [search and item responses](https://www.loc.gov/apis/json-and-yaml/responses/item-and-resource/). | A search hit is not a checked context source. Sparse catalog metadata cannot establish creator intent, a modern analogy, or rights to reproduce the work. LOC documents [request/page limits and incomplete search-hit metadata](https://www.loc.gov/apis/json-and-yaml/working-within-limits/); absence from its API is not evidence that an artifact does not exist. |
| Smithsonian | Finds art, objects, photography, and cultural/historical collection records. A detailed collection record can support identity, curator-supplied context, accession/provenance, and explicit reuse metadata when present. Its [developer tools](https://www.si.edu/openaccess/devtools) describe the public API and key registration. | An Open Access search result does not prove an interpretation, a modern analogy, creator intent, or unrestricted reuse of every associated asset. Smithsonian [terms](https://www.si.edu/termsofuse) and [FAQ](https://www.si.edu/openaccess/faq) caution that third-party and other rights can survive even where a record or asset carries a CC0 designation. |

`contextAuthority` is attached only to a source's support for an **original
historical-context claim**. These first adapters conservatively assign
`limited` to catalog descriptions, even when the institution holds the original
artifact. A later, claim-specific primary work or reliable scholarly source
could justify `primary` or `scholarly`; the adapter does not award a global
authority grade to an artifact or candidate. Creator intent stays
`not_claimed`: catalog description does not prove it. Missing creator, date, or
original context is kept missing, never filled by inference. A record without
sufficient historical context is marked insufficient for the downstream
context gate.

### Retrieval and normalization boundary

The query input is one to three concise caller-supplied search terms (at most
80 characters each) plus optional record-ID exclusions. It is not the full newsroom brief,
and PR C uses no model to generate search terms. Each source adapter makes
metadata-first requests to its own explicit HTTPS API family. It does not
follow arbitrary result links, retrieve full books, articles, lyrics,
transcripts, high-resolution images, audio, or video, or offer a general URL
fetcher. Requests have a maximum of 10 returned records per adapter/query,
one search-results page, at most 20 normalized results for the combined LOC and
Smithsonian pass, an eight-second timeout, and capped response bytes. Redirects
outside the fixed approved endpoint contract are rejected rather than
followed; non-HTTPS, credentialed, localhost/private-network, and alternate
host requests are not accepted; all HTTP redirects are rejected. Catalog
links to `*.si.edu` are normalized as metadata with query/fragment removed,
but never followed or fetched. LOC newspaper item IDs may contain up to four
bounded path segments under `/item/`; they cannot select another endpoint.
A rate limit or outage stops that source's
attempt rather than beginning an aggressive retry or wider crawl.

Normalized discovery records retain only concise catalog metadata: adapter,
stable record ID/canonical URL, title, known creator/date, artifact type, a
short description, source/provenance identity, retrieval time, explicit
rights/license statement if supplied, and cultural-protocol signal. They do
not persist source-native response blobs or complete works. Cross-adapter
deduplication uses strong canonical record IDs/URLs or a clearly shared stable
identifier, not fuzzy title similarity. Uncertain matches remain separate.
Verification is a distinct item-detail step: an unverified search hit must not
be passed off as an editor-ready historical source.

Rights normalization is conservative. Explicit public-domain or open-license
catalog statements are preserved as record-scoped hints, not blanket rights for
every image, excerpt, or proposed use; a missing statement
is `unknown` or `link_metadata_only`, never assumed public domain. No adapter
decides fair use or reproduction permission for a proposed excerpt, image, or
other asset. Protocol signals are independent of copyright: explicit
community/Indigenous, ceremonial, sacred-object, human-remains, or similar
use cautions are retained as restrictions, and missing or ambiguous protocol
information remains unresolved rather than automatically cleared. A
protocol-unclear candidate must satisfy PR B's deterministic cultural-protocol
gate before readiness.

### Tests, live smoke, and downstream handoff

`echo:sources:check` and `echo:sources:test` run deterministic offline fixtures
inside `npm run check`. The separate, opt-in `echo:sources:smoke` command is a
small development-time read-only query against the approved public endpoints;
it is not part of ordinary validation or deployment CI. The Smithsonian API
uses a development API key registered through its public developer portal; if
none is available, the Smithsonian live smoke is skipped rather than placing a
credential in source, logs, or a repository file. Smoke output is concise
metadata/status only, with no persistence, full-content dump, or live Echo
orchestration.

Captured normalized records can supply artifact identity and a claim-specific
historical/context source for a **local synthetic** `echo-candidate-v1` handoff.
They cannot supply the Analogy Truth Test, linked contemporary evidence,
independent rights review, prior-use judgment, or human decision. In short:

> Search result ≠ verified context ≠ valid analogy ≠ publication decision.

PR C adds no migration, production D1 access, Queue, Worker, API, UI, schedule,
model call, live Newsroom integration, public `WE WERE WARNED` route, or
publication authority. After source-adapter review, a bounded execution
service and Newsroom integration are separate decisions, not an automatic
consequence of these adapters.
