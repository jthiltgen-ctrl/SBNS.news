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
and prior-use status/justification. This is the contract a future PR C adapter
may supply; PR B does not couple it to a catalog or search API. Before any
write, an intake-scoped contemporary candidate source must match the brief's
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
frozen analogy package. The database stores, but does not independently
recalculate, either hash.

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

Survivors are tiered transparently by authority (primary, scholarly, limited),
mechanism match (direct, qualified), research burden (low, moderate, high),
prior-use caution, then canonical artifact ID. This order only selects a
reviewable packet; it is not an editorial verdict. At most three survivors
receive slots 1–3 and the existing database constraint also bars a fourth.
Additional passers become gate-rejected with `NOT_IN_TOP_THREE`. Others keep
their bounded gate reason. Every input candidate receives a durable identity;
only selected candidates receive an assessment, sources, rights review, and
`editor_ready` state. No FEATURE/HOLD/REJECT or publication row is created.

Zero candidates or zero survivors completes the packet/job successfully as
`NO CULTURAL ECHO WARRANTED`, with `NO_CANDIDATES`,
`ALL_CONTEXT_FAILED`, `ALL_PRESENT_EVIDENCE_FAILED`,
`ALL_ANALOGY_FAILED`, `RESEARCH_BURDEN_EXCEEDED`, or
`NO_ELIGIBLE_CANDIDATE`. It is not an operational failure and never forces a
cultural match.

## Persistence, replay, stale state, and failure

The orchestrator uses PR A's audited persistence functions and only adds two
narrow read helpers. It validates all supplied input before writes, computes
the evidence hash, creates or reuses the issue packet, creates one job, moves
the job through research/verification/rights/assembly, writes deterministic
candidate packages, and completes `ready` or `no_echo`. Exact replay of a
completed snapshot returns `ALREADY_PROCESSED` without another job or row.
The packet is one research result per contemporary evidence snapshot: changing
only supplied candidates after completion does not reopen it. Reassessment
without material contemporary evidence change needs a separately designed
editorial revision contract, not a silent mutation.

Candidate, assessment, source, rights, packet, and job IDs are derived from
stable inputs. An open packet with a failed job accepts a new idempotency key;
already written rows are checked/reused, not duplicated. An active job blocks
another. A material evidence change creates revision N+1 and supersedes the
prior packet without deleting its history. Each synthetic stage checks that
the packet remains current. Existing D1 conditions and triggers also reject
stale candidate/readiness/completion writes. Deterministic test-only step
hooks inject failures; a failed job is recorded with a bounded error, the
packet stays open, and earlier writes/audits remain durable. There is no
automatic retry infrastructure.

Existing generic `audit_events` records packet/job creation, lifecycle and
failure, candidate discovery/rejection, assessment/source/rights persistence,
readiness, and ready/no-echo completion. No raw model reasoning is logged.
The suite uses only isolated SQLite memory migrated through v5 and fabricated
fixtures; `npm run echo:check` exercises pure contracts and `npm run echo:test`
exercises the full orchestration. Both are included in `npm run check`.

## Next boundary

PR C may add bounded public-source discovery and historical-context adapters
that produce these validated inputs. Live source access, model use, scheduling,
and any production Echo execution each require separate authorization. PR B
adds no migration 0006, remote D1 operation, Cloudflare resource, or live
Newsroom integration.
