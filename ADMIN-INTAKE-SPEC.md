# SBNS Administrator Intake Specification

Version: v1.4 specification

Status: Design contract; no administrator dashboard is implemented by this document.

## 1. Purpose

The SBNS administrator intake system will turn a submitted news, government, audit, watchdog, public-record, or other source URL into a structured editorial recommendation and proposed SBNS story while preserving human editorial control.

The intended workflow is:

`Submit URL -> Analyze -> Recommend -> Human Review/Edit -> Human Approve -> Publish`

The system should automate research, source comparison, claim verification, classification, drafting, validation, and deterministic publication work wherever practical.

It must not silently replace human editorial judgment.

Publication remains a human decision.

This specification is based on the manual editorial workflow used to publish SBNS Stories #001 through #005.

## 2. Existing editorial contract

This specification extends the existing repository-managed editorial workflow rather than replacing it.

Public stories continue to use the existing story fields:

- `id`
- `status`
- `content_type`
- `category`
- `headline`
- `summary`
- `fml_kicker`
- `severity`
- `topic_tags`
- `sources`
- `published_at`

Internal intake analysis must remain separate from the public story payload unless the public content schema is deliberately changed in a future version.

`public/stories.json` remains generated output and must never become the editorial source of truth.

Draft reporting remains excluded from the public feed.

## 3. Design principles

### 3.1 Human gate

AI may recommend publication, holding, or rejection.

AI may prepare the complete proposed story and publication artifacts.

AI must not convert its own recommendation into publication without an explicit human editorial action.

A future `Approve & Publish` control is acceptable because the human click constitutes the publication gate.

### 3.2 Evidence before rhetoric

The system should determine what the evidence establishes before generating the strongest possible headline or kicker.

The headline, summary, severity, and humor must stay within the factual boundaries established by verified sources.

### 3.3 Punch up

SBNS humor targets institutions, systems, policies, processes, leadership decisions, bureaucracy, or concentrations of power.

Victims, vulnerable populations, people harmed by a system, or people merely subject to a system must not become the punchline.

### 3.4 Qualification is a feature

Important qualifications must not be removed merely because they weaken a cleaner or more dramatic narrative.

If a source states that several explanations may account for an observed condition, SBNS must not attribute every instance to institutional failure unless the evidence supports that attribution.

### 3.5 No invented sourcing

The system must never invent, silently substitute, or imply a source that it has not actually reviewed.

Every published factual claim must remain supportable by one or more identified sources.

## 4. Intake states

An intake item should support these workflow states:

`submitted`

`analyzing`

`review_ready`

`held`

`rejected`

`approved`

`publishing`

`published`

`publish_failed`

Recommendation state and publication state are separate concepts.

A system recommendation of `publish` does not mean that publication has occurred.

## 5. Editorial recommendation

Every completed analysis must return one of three recommendations:

### PUBLISH

Use when the available evidence supports a current, consequential, institutionally relevant SBNS story with manageable editorial risk.

### HOLD

Use when the candidate may become publishable but meaningful uncertainty remains.

Common hold reasons include:

- missing primary documentation
- insufficient corroboration
- unresolved source conflict
- institution response still needed
- developing facts
- unclear causation
- ambiguous jurisdiction or category
- duplicate-story uncertainty
- legal or factual risk requiring review
- proposed humor that cannot yet be safely aimed

### REJECT

Use when the candidate does not meet SBNS editorial standards.

Common rejection reasons include:

- no meaningful institutional or systemic failure
- isolated individual misconduct without broader accountability relevance
- opinion presented as fact
- unsupported speculation
- trivial consequence
- stale material without a meaningful new development
- duplicate of an existing SBNS story without sufficient new information
- inadequate sourcing
- unsupported allegation
- misleading causal framing
- humor would primarily punch down
- factual or legal risk cannot reasonably be cured

## 6. Required intake analysis

Each analysis should evaluate at least the following:

### Editorial fit

- Is there an institutional or systemic failure?
- What institution, process, program, policy, or control failed?
- Is the failure consequential enough for SBNS?
- What is new or currently relevant?
- Is the story meaningfully different from an existing SBNS story?

### Evidence

- Is a primary source available?
- Is an independent source available?
- Is an authoritative source available?
- Is the institution's response available?
- Which material claims are verified?
- Which claims require qualification?
- Do sources conflict?
- Is any relevant source materially outdated?

Independent media reporting is desirable but is not an absolute publication requirement when authoritative primary records independently establish the material facts.

### Attribution and causation

The system must distinguish:

`observed condition`

from:

`institutionally attributable failure`

and from:

`specific harm caused by that failure`

These are not interchangeable.

The existence of a bad outcome or alarming statistic does not prove that every instance was caused by institutional failure.

The existence of an institutional failure does not automatically establish that it caused a specific injury, death, crime, financial loss, or other downstream outcome.

### Context

- Is an official description materially narrower than common-language usage?
- Does a technical term have a specific legal, auditing, accounting, regulatory, or programmatic meaning?
- Does the institution describe the same finding differently?
- Does the source contain a response, mitigation, corrective action, concurrence, disagreement, or explanation that should be included?

### Sensitive-subject risk

The system must identify subjects involving:

- deaths
- missing people
- crime victims
- Indigenous communities
- children
- health or disability
- sexual violence
- incarceration
- addiction
- poverty
- other vulnerable populations

Sensitive subject matter does not make a story unpublishable.

It raises the standard for attribution, causation, tone, and kicker review.

## 7. Claim ledger

The future intake engine should maintain a claim-level evidence ledger.

Each material claim should support:

- `claim_id`
- `claim_text`
- `verification_status`
- `source_refs`
- `qualification`
- `conflict`

Recommended `verification_status` values:

- `verified`
- `verified_with_qualification`
- `disputed`
- `unverified`

A proposed story should not be recommended for publication while a material core claim remains `unverified`.

A disputed claim may appear only when the dispute itself is accurately represented and editorially relevant.

## 8. Source model

Each source in the internal intake record should support:

- `source_id`
- `name`
- `url`
- `source_type`
- `authority`
- `recency`
- `claims_supported`

Suggested `source_type` values:

- `primary`
- `government`
- `watchdog`
- `audit`
- `court`
- `official_response`
- `independent_reporting`
- `other`

Source quality must be evaluated according to the claim being supported, not according to a universal publication hierarchy.

A government press release may be authoritative for what the government says it did.

It may not independently establish that the government's characterization of its own performance is complete.

## 9. Source conflicts

The intake engine must surface material inconsistencies rather than silently choose one interpretation.

A source conflict should record:

- the conflicting statements
- the relevant sources
- whether the conflict is resolvable
- whether the conflict affects publication
- whether the proposed story avoids the unresolved claim

If a source contains an unexplained internal inconsistency, the system should not invent the missing explanation.

## 10. Audit and oversight interpretation

The system must preserve distinctions among different kinds of audit findings.

In particular:

`clean audit`

is not equivalent to:

`no findings`

An unmodified financial-statement opinion can coexist with statutory, compliance, internal-control, operational, performance, or other findings.

The intake system should separately represent relevant concepts such as:

- `financial_statement_opinion`
- `material_weakness`
- `significant_deficiency`
- `statutory_finding`
- `compliance_finding`
- `questioned_cost`
- `questionable_expenditure`

The system must not transform a budget-control or compliance finding into an allegation of fraud, waste, theft, or missing money unless the evidence independently supports that allegation.

## 11. Category classification

Existing public categories are:

- `International`
- `National`
- `Local`

The intake engine must return both:

- proposed category
- category confidence

`Local` should be based on the practical geographic and institutional scope of the story, not merely on where a source happens to be published.

`National` applies to United States federal or broadly national systems and institutions.

`International` applies to reporting centered outside the United States or on international institutions/systems.

## 12. Severity

Severity is an editorial judgment, not a factual finding from a source.

Suggested interpretation:

### Severity 1

Minor administrative or procedural failure with limited demonstrated consequence.

### Severity 2

Clear control, compliance, management, or governance failure with limited or moderate demonstrated consequence.

### Severity 3

Meaningful systemic failure with substantial operational, financial, rights, service-delivery, or public-accountability consequences.

### Severity 4

Serious systemic failure or risk involving public safety, civil rights, large-scale institutional authority, significant public resources, or similarly high stakes.

### Severity 5

Extreme institutional failure involving demonstrated or substantial risk of severe harm, widespread direct consequences, or exceptionally serious abuse of public power.

Severity must not automatically increase because:

- a story is national
- a dollar amount is large
- a topic is emotionally charged
- a headline is shocking

The intake system should record a `severity_rationale`.

## 13. Kicker safety

The intake engine should identify the intended target of the kicker before generating the final line.

Internal fields should include:

- `kicker_target`
- `kicker_safety`

A kicker is acceptable when its joke or weary observation primarily targets:

- the institution
- its policy
- its bureaucracy
- its contradiction
- its management
- its public promises
- its control failure

A kicker should be rejected or rewritten if the joke primarily lands on victims or other people harmed by the failure.

## 14. Duplicate detection

The intake engine must compare a candidate with existing published and draft SBNS stories.

Duplicate analysis should consider:

- same institution
- same event
- same audit/report
- same underlying failure
- same factual development
- whether meaningful new facts have emerged

A related story is not necessarily a duplicate.

A candidate with a meaningful new development may be appropriate as a follow-up.

The intake record should support:

- `duplication_risk`
- `related_story_ids`

## 15. Internal intake data model

A future implementation should support an internal record conceptually equivalent to:

```text
intake_id
submitted_url
submitted_at
analysis_status

recommendation
recommendation_confidence
recommendation_reasons
hold_reasons
reject_reasons

category
category_confidence

systemic_failure
failure_type
consequence_significance

primary_source_available
independent_source_available
authoritative_source_available
institution_response_present

sources
claims
source_conflicts

observed_condition
attributable_failure
causation_supported
specific_harm_causation
qualification_required

sensitive_subject
victim_targeting_risk
factual_risk
legal_risk

duplication_risk
related_story_ids

severity
severity_rationale

kicker_target
kicker_safety

proposed_headline
proposed_summary
proposed_fml_kicker
proposed_topic_tags
proposed_sources

human_decision
human_edits
approved_at
published_at

This internal model does not change the current public story schema.

16. Confidence

Confidence should be explicit.

Recommended values:

* high
* medium
* low

Confidence describes the strength of the recommendation or classification.

It is not a substitute for evidence.

A high-confidence recommendation with an unverified material claim is invalid.

17. Administrator user experience

The initial administrator interface should optimize for one primary workflow:

Paste URL -> Analyze -> Review -> Edit -> Approve & Publish

Intake view

The administrator submits one URL.

The system displays analysis progress and then produces a review card.

Recommendation card

The most important result should be immediately visible:

RECOMMEND PUBLISH

HOLD

or:

REJECT

The card should also show:

* confidence
* category
* severity
* systemic-failure determination
* source sufficiency
* institution response status
* major qualifications
* factual/legal risk
* duplicate risk

Why SBNS

The system should provide a concise explanation of why the candidate does or does not belong on SBNS.

Do not claim

The interface should explicitly surface unsupported or dangerous interpretations.

Example:

Do not claim that the monitoring agency caused every unmonitored case.

Example:

Do not characterize this budget-control finding as missing money or fraud.

This is a required editorial feature, not optional explanatory text.

Evidence view

The administrator should be able to inspect:

* source list
* claim ledger
* qualifications
* source conflicts
* institution response

The initial UI does not need to expose every internal field simultaneously.

Story editor

The system should present editable proposed values for:

* headline
* summary
* kicker
* severity
* category
* tags
* sources

Human edits must remain visible in the resulting story payload.

Decision actions

The administrator should be able to:

* approve and publish
* hold
* reject
* re-analyze after changing or adding a source

18. Publication behavior

After explicit human approval, the future system may automate deterministic publication work.

That workflow may include:

1. Generate the final repository-managed story JSON.
2. Set status to published.
3. Set the actual UTC ISO-8601 publication timestamp.
4. Rebuild public/stories.json.
5. Run repository validation.
6. Commit the approved change.
7. Merge through the approved repository workflow.
8. Deploy to the authorized target.
9. Verify the live result.

Human approval must occur before the publication-state mutation.

Until production deployment is explicitly enabled, automated publication work must remain limited to the existing authorized workers.dev staging environment.

19. Publication failure

A failed build, validation, merge, or deployment must not be represented as successful publication.

The intake record should retain:

* human approval
* failure stage
* error state
* whether repository publication completed
* whether deployment completed

Retrying deterministic publication after an operational failure should not require repeating editorial analysis unless story content or source facts changed.

20. Corrections and updates

A published story should be capable of later monitoring.

Meaningful developments may include:

* corrected official statistics
* new audit findings
* implementation of recommendations
* institution response
* litigation or official investigation
* material factual correction
* a major policy change

Monitoring is not publication.

A substantive follow-up or correction must return to human editorial review before changing published content.

21. Lessons from Stories #001-#005

Story #001

A serious institutional practice can support Severity 5 without claiming a specific death or injury was caused by the documented practice.

Lesson:

institutional_failure != proven_specific_harm_causation

Story #002

An oversight report can establish a system-wide policy weakness even when field-level sampling is limited.

Lesson:

distinguish component-wide policy findings from nongeneralizable sampled observations.

Story #003

Sensitive communities require explicit tone and causation safeguards.

Lesson:

sensitive_subject = true increases editorial review requirements but does not itself determine publishability.

Story #004

A concerning statistic can coexist with multiple causes.

Lesson:

observed_condition != attributable_failure

Qualification must survive into final copy.

Story #005

A clean financial-statement opinion can coexist with statutory budget findings.

Lesson:

clean_audit != no_findings

Technical audit terminology must be interpreted according to its actual scope.

22. Non-goals for this specification milestone

This v1.4 specification does not authorize implementation of:

* a database
* D1
* authentication
* administrator routes
* administrator UI
* new Worker APIs
* AI provider integration
* automatic web research code
* GitHub write automation
* automatic merge behavior
* production deployment
* DNS changes
* nameserver changes
* production-domain migration
* GreenGeeks changes

Those are implementation decisions for a subsequent approved milestone.

23. Architecture constraints for implementation

Future implementation must preserve these constraints unless explicitly changed:

* existing public story JSON remains repository-managed
* publication remains human-gated
* drafts remain excluded from the public feed
* generated public/stories.json is never edited directly
* source URLs must be real and verified
* public source links must retain safe external-link rendering
* infrastructure changes require explicit approval
* D1 is not assumed merely because internal metadata eventually requires persistence
* production DNS/domain changes are outside the administrator-intake feature unless separately approved
* legacy GreenGeeks deployment files remain untouched unless separately approved

24. Future implementation sequence

Recommended implementation order after approval of this specification:

Phase A — Intake analysis contract

Define machine-readable request and response structures for URL analysis.

Establish fixtures representing PUBLISH, HOLD, and REJECT candidates.

Phase B — Read-only administrator prototype

Build the intake form and analysis/review interface without publication mutation.

Phase C — Editable story proposal

Add human editing of the proposed public story fields and validation.

Phase D — Human-gated publication

Connect explicit administrator approval to the existing repository publication workflow.

Phase E — Monitoring and corrections

Add post-publication update detection and correction/follow-up review.

Authentication, persistence, and deployment architecture should be selected when their actual implementation requirements are known rather than assumed in this specification.

25. v1.4 implementation acceptance criteria

A future v1.4 administrator implementation should not be considered complete until:

* an administrator can submit a URL
* the system returns PUBLISH, HOLD, or REJECT
* the system explains its recommendation
* verified sources are visible
* material claims have evidence status
* important qualifications are surfaced
* unsupported interpretations appear under a clear Do not claim warning
* systemic-failure fit is explicit
* category and confidence are explicit
* severity and rationale are explicit
* duplicate risk is evaluated
* sensitive-subject safeguards are evaluated
* the proposed public story is editable
* public story output conforms to the existing story schema
* no AI recommendation can publish without an explicit human action
* publication validation must succeed before a deployment is treated as successful
* generated feed state and live deployment can be verified after publication

26. Editorial invariant

The administrator system exists to make careful editorial work faster.

It must not make careless editorial work easier.

The goal is not autonomous publishing.

The goal is a fast, evidence-aware editorial copilot that performs the tedious parts of accountability reporting while leaving consequential judgment with the human editor.
