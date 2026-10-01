# SBNS Editorial, Search & Research Semantics Control

Status: active sprint control
Effective: October 2026 editorial-production sprint
Purpose: prevent semantic drift as a candidate moves from discovery query to research evidence to editorial copy to search/share presentation.

## Control principle

Words used to **find** a story are not automatically words that can be used to **prove** or **publish** the story.

SBNS therefore treats three semantic layers as related but distinct:

1. **Research semantics** — what sources, records, terms, measurements, chronology, and evidence states actually mean.
2. **Editorial semantics** — what SBNS is justified in saying about the evidence.
3. **Search semantics** — how readers and discovery systems may look for the subject without allowing discoverability language to overstate the reporting.

The controlling direction is:

`source meaning -> supported editorial meaning -> faithful search/discovery language`

Search optimization may broaden discovery. It may not broaden the factual claim.

## 1. Research semantics

Research language must preserve the scope and authority of the underlying material.

Track especially:

- source class versus source authority;
- primary record located versus actually reviewed;
- partial review versus full review;
- allegation versus finding;
- risk versus demonstrated harm;
- estimate versus actual expenditure;
- sampled condition versus population-wide condition;
- policy requirement versus implementation evidence;
- recommendation versus mandate;
- audit opinion versus individual audit findings;
- observed condition versus institutionally attributable failure;
- attributable failure versus specific-harm causation;
- date precision and chronology;
- denominator, population, jurisdiction, and time period.

A search result, snippet, model summary, or secondary headline is a discovery aid. It does not silently replace the underlying evidence.

## 2. Editorial semantics

Editorial language must be no stronger than the evidence state.

For each material term, ask:

- What exactly does this word assert?
- Is that assertion supported by the reviewed evidence?
- Is the scope narrower than the ordinary-language meaning?
- Would a reasonable reader infer causation, misconduct, illegality, intent, scale, or certainty that the evidence does not establish?
- Does a material qualification need to travel with the term?

High-risk substitutions include, but are not limited to:

- irregularity -> fraud;
- questioned cost -> theft;
- compliance finding -> corruption;
- weakness -> failure when failure is not established;
- risk -> harm;
- association -> causation;
- allegation -> fact;
- official statement -> independent verification;
- clean financial-statement opinion -> no audit findings;
- "systemic" when evidence supports only a bounded sample or isolated event.

Do not use a sharper synonym merely because it makes a stronger headline.

## 3. Search semantics

Search language may include ordinary variants readers genuinely use, but the public search/title/meta/share layer must remain faithful to the article.

### Allowed

- plain-language equivalents that preserve scope;
- common acronyms and full agency/program names;
- geographic variants;
- neutral topic terms;
- documented names of policies, programs, reports, or systems;
- query variants used only to discover potentially relevant evidence.

### Controlled

Terms that may be useful for discovery but can alter meaning must remain marked as **search-only** until independently supported.

Examples include words implying:

- fraud;
- corruption;
- scandal;
- cover-up;
- censorship;
- illegality;
- abuse;
- collapse;
- crisis;
- failure;
- harm;
- causation;
- intent.

A search query may ask whether such a concept is present. The existence of search results for that query does not establish the concept.

### Public metadata rule

Headline, title tag, meta description, social-preview text, structured data, internal-link anchor text, and feed copy must not make a stronger claim than the approved story.

SEO is not an exception to the editorial framework.

## 4. Semantic ledger

For a serious candidate, use a lightweight semantic ledger when terminology materially affects meaning.

Record only terms that create real ambiguity or claim risk.

| Field | Purpose |
| --- | --- |
| Canonical term | The term supported by the best reviewed evidence |
| Source meaning | What the authoritative source means by it |
| Scope | Population, time, jurisdiction, denominator, or technical boundary |
| Permitted public wording | Faithful plain-language wording |
| Search variants | Useful discovery terms that preserve or intentionally test meaning |
| Restricted substitutions | Terms that would materially strengthen or alter the claim |
| Qualification | Context that must travel with the term |
| Evidence state | Located / partially reviewed / reviewed, as applicable |

Do not create a semantic ledger for obvious, low-risk wording. The control exists to reduce error, not create clerical work.

## 5. Stage controls

### Discovery

- Keep query language separate from candidate findings.
- Treat query expansion as hypothesis generation.
- Do not let emotionally loaded search terms pre-frame Rabbit Hole Triage.

### Research

- Capture the source's actual terminology where scope matters.
- Preserve technical/legal definitions and measurement units.
- Record contradictions and alternate explanations.
- Do not upgrade "located" evidence to "reviewed."

### Editorial decision

- Check the accountability gap using supported terminology.
- Verify that attribution and causation have not strengthened during synthesis.
- Preserve material qualifications.

### Drafting

- Compare headline, summary, body, evidence components, and Kicker against the semantic ledger.
- Prefer clearer language, but not broader language.
- If plain English loses an important limitation, keep the limitation.

### Search / metadata

- Review title/meta/social/feed language after the story is editorially approved.
- Search wording may improve findability but cannot intensify culpability, causation, scale, or certainty.
- Internal links should describe the linked story accurately rather than optimize around a more dramatic phrase.

### Publication

A semantic mismatch is a publication blocker when it materially changes:

- who is responsible;
- what happened;
- why it happened;
- the scale;
- the legal or technical meaning;
- the evidence state;
- the demonstrated consequence.

Minor stylistic variation that preserves meaning is not a blocker.

## 6. Sprint monitoring

During the October editorial-production sprint, note semantic friction only when it is decision-useful.

Track:

- terms repeatedly requiring clarification;
- search queries that pull the reporting toward a stronger unsupported frame;
- model-generated synonyms that change scope;
- headline/meta wording that overstates the body;
- evidence-state language that becomes ambiguous;
- legal, audit, scientific, statistical, or program terms that require repeated rechecking;
- qualifications that repeatedly disappear during condensation.

The sprint should answer:

1. Where does semantic drift actually enter the workflow?
2. Which drift is consequential?
3. Which controls are sufficient as human practice?
4. Which repeated problems, if any, justify deterministic tooling?

Do not build automation before the pattern is demonstrated in real editorial use.

## 7. Drift disposition

Use one of four outcomes:

- **PASS** — wording preserves the supported meaning.
- **CLARIFY** — meaning is supportable but wording needs qualification or scope.
- **RESEARCH** — the proposed wording requires evidence not yet reviewed.
- **BLOCK** — wording materially overstates, misattributes, or changes the evidence.

These are semantic-control states, not publication decisions.

A story may still be HOLD or REJECT for independent editorial reasons.

## 8. Search-learning boundary

Search performance can teach SBNS how readers describe a subject.

It cannot retroactively redefine the evidence.

If Search Console later shows readers using terminology different from SBNS's approved terminology:

- evaluate whether the reader term is a faithful synonym;
- if yes, consider it for discoverability;
- if no, keep the accurate wording and do not chase the query;
- if the discrepancy reveals a genuine reporting question, route it back to research rather than silently rewriting the story.

Traffic is not authority.

## 9. Change threshold

Do not create a new schema, service, model pass, or automated semantic checker merely because this control exists.

A technical semantic-control feature becomes eligible only when real production shows a repeated consequential problem and the proposed control would credibly reduce error or recurring founder burden.

Until then, this document plus lightweight story-level notes are the control.

## 10. Governing relationships

This control is subordinate to the SBNS Editorial Framework and complements:

- background before conclusion;
- claim-specific source authority;
- causation ladder;
- qualification-is-evidence rule;
- technical/legal-term precision;
- Rabbit Hole Triage;
- research stoppage;
- human editorial authority.

When search language, research language, and editorial language conflict, the best reviewed evidence and the Editorial Framework control publication.
