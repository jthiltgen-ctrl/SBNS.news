# SBNS Editorial Production Sprint — October 2026

Status: next-sprint operating brief
Duration: approximately 7–10 days after technical closeout
Primary goal: improve the functionality, quality, distinctiveness, and founder efficiency of SBNS editorial production by using real story work as the test.

## Entry gate

Begin this sprint after:

- PR #44 receives one combined-tree validation and merge/no-merge decision;
- the October 1 current-state record is accepted;
- no known site-health or trust issue requires immediate repair.

Do not delay the sprint for nonessential technical polish.

## Sprint thesis

SBNS now has enough distribution and discoverability basics to learn more from publishing worthy work than from continuing general platform construction.

The next product is the reporting.

The sprint should therefore optimize the path:

`candidate -> evidence -> editorial decision -> story -> publication -> measurement -> learning`

not the path:

`feature idea -> implementation -> another feature idea`.

## Non-goals

This sprint does not require:

- a daily or weekly publication quota;
- a traffic target;
- a revenue target;
- new paid software;
- paid acquisition;
- social-media posting cadence;
- LinkedIn distribution;
- a redesign;
- another generalized newsroom subsystem;
- visitor submissions;
- Secure Source implementation;
- premium SEO or analytics tooling;
- technical work not grounded in observed editorial friction.

## Workstream 1 — Candidate quality

Use Watchdesk, direct editorial intake, and ordinary reporting discovery to identify candidates.

Apply Rabbit Hole Triage early.

Before research expands, establish:

- accountable institution or system;
- expected job, promise, policy, control, or obligation;
- observed condition;
- evidence-supported accountability gap;
- public relevance;
- what remains unproven;
- likely research burden.

STOP / NO ACTION, ROUTE, HOLD, and REJECT are successful outcomes.

## Workstream 2 — Accountability aperture

Do not require every viable SBNS candidate to prove a discrete institutional failure.

Before a candidate stops solely because "failure" is not established, test whether the record supports another consequential accountability frame: persistent poor performance, foreseeable or accepted risk, waste, displaced stakeholder burden, inequitable outcomes, rights or justice concerns, contradictory incentives, formal-compliance-versus-reality tension, inadequate recourse, or a consequential problem produced by the system's design.

This does not lower the evidence standard. It broadens the set of evidence-supported accountability questions SBNS is willing to examine.

During the sprint, sample stopped candidates to distinguish legitimate quality filtering from semantic throttling. Pay particular attention to candidates dismissed as stale, expected, unsurprising, or repetitive: recurrence may be meaningful when it shows failed remediation, growing burden, normalization, or a newly documented extension of the pattern.

Do not establish a target publication, pass, hold, or rejection rate.

## Workstream 3 — Evidence packet quality

For a candidate that survives triage, build the minimum decision-quality packet.

Prioritize:

- primary records where available;
- claim-specific source authority;
- chronology;
- material qualifications;
- institutional response;
- independent corroboration when it adds material value;
- explicit separation of observed condition, attributable failure, and specific-harm causation;
- a short list of unresolved questions that could change publication.

Stop research when additional work is repetitive or when a named future dependency becomes the real blocker.

## Workstream 4 — Distinctive SBNS story form

Use the first genuinely worthy story to test what makes SBNS more useful than a conventional summary.

Possible components are optional, not quotas:

- Receipt — show the record that matters;
- Number — show a consequential quantity with scope and qualification;
- Timeline — show chronology when sequence changes meaning;
- explicit "what was supposed to happen / what the record shows" structure;
- institutional response close to the claim it addresses;
- concise background before conclusion;
- an SBNS Kicker only when humor safely punches up and stays inside the factual record.

Do not add a component merely because the schema supports it.

The desired distinction is evidence clarity plus accountability framing, not visual decoration.

## Workstream 5 — Editorial transformation

Evaluate the step between evidence packet and published copy.

For each serious candidate, ask:

- Is the headline the strongest supported claim rather than the strongest rhetoric?
- Does the opening tell readers why the system matters?
- Is the accountability gap legible without oversimplification?
- Are qualifications visible rather than buried?
- Does chronology prevent hindsight distortion?
- Does the story distinguish source fact from SBNS analysis?
- Is the piece concise enough to read but complete enough to trust?
- Does the voice sound like SBNS rather than generic AI or institutional copy?

AI assistance may accelerate organization, comparison, drafting, and revision. It may not replace source authority or human editorial judgment.

## Workstream 6 — Production ergonomics

Track friction during real work instead of inventing hypothetical workflow needs.

Record approximately:

- time spent from candidate to triage decision;
- research time;
- drafting/revision time;
- publication-preparation time;
- repeated manual steps;
- context lost between stages;
- any error-prone copy/paste step;
- any step that requires reopening the same evidence repeatedly.

A technical change becomes sprint-eligible only when the same friction is meaningful enough that fixing it would reduce recurring burden or protect quality.

## Workstream 7 — Editorial, search & research semantics

Monitor semantic drift across discovery, evidence review, drafting, and search presentation.

Use [SEMANTICS-CONTROL.md](SEMANTICS-CONTROL.md) when terminology can materially change attribution, causation, scope, evidence state, technical/legal meaning, or certainty.

The key rule is:

`source meaning -> supported editorial meaning -> faithful search/discovery language`

Search terms may generate research questions. They do not establish editorial claims.

Keep the control lightweight during the sprint. Record consequential drift and repeated friction; do not build a semantic-automation subsystem unless real production demonstrates a recurring quality or burden problem.

## Workstream 8 — Publication acceptance

For a story approved for publication:

- verify every material source;
- run deterministic content build and full validation;
- inspect canonical story output;
- inspect share metadata/assets;
- confirm feed inclusion;
- confirm sitemap/canonical behavior;
- verify live story after deployment.

Treat this as the normal completion checklist, not a separate product sprint.

## Workstream 9 — Measurement and learning

Keep measurement light.

After a published story, capture only available reliable evidence relevant to:

- Reach;
- Loyalty;
- Depth;
- Sharing;
- Direct Relationship;
- Authority;
- Founder Burden;
- Economics;
- Asset Growth.

Do not spend more time measuring a story than producing or learning from it unless a measurement defect is blocking decisions.

## Usage-credit discipline

Use high-cost technical/agent work only for bounded objectives with an identifiable artifact or decision.

Prefer:

- one prompt that includes current state, authority boundaries, stop conditions, and acceptance tests;
- batching closely related changes in one layer;
- one full validation after focused tests pass;
- draft PR before merge;
- exact head/base references when available;
- "report blocker and stop" instead of exploratory repair loops.

Avoid:

- repeated full-repository audits after every small edit;
- rebuilding settled architecture from conversation history;
- asking an agent to "improve everything";
- speculative tooling;
- parallel implementations of the same capability;
- polishing after the acceptance condition has already been met.

## Sprint success

The sprint succeeds when it produces better evidence about SBNS's ability to create high-quality reporting sustainably.

Strong evidence may include:

- a worthy story moves cleanly through the full system and is published;
- a candidate is responsibly held or rejected with low wasted effort;
- one repeatable editorial improvement becomes clear;
- one real production bottleneck is identified and bounded;
- founder burden is lower or better understood;
- the public output becomes more recognizably SBNS without weakening factual discipline.

Publication count by itself is not the success metric.

## Exit decision

At the end of the sprint, choose one:

- continue Normal editorial production;
- enter Active Story mode for a specific candidate;
- run one bounded Build task for an observed bottleneck;
- enter Recovery;
- enter Dormant if the work is not currently worth the burden.

Do not automatically schedule another technical sprint.
