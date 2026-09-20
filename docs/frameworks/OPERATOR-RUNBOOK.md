# ShockedButNotSurprised.news Operator Runbook

Status: Proposed canonical operating procedure
Purpose: Turn the editorial and technical frameworks into a repeatable human workflow

## 1. Operating rule

The operator's job is not to make every candidate into a story.

The operator's job is to move each candidate into the correct state with the least unnecessary friction while preserving evidence, judgment, and provenance.

Valid outcomes include:

- publish;
- hold;
- reject;
- no action;
- update review;
- correction review;
- follow-up;
- technical failure requiring retry;
- technical failure requiring escalation.

## 2. Start-of-session preflight

Before ordinary editorial work:

1. Confirm the public staging health endpoint returns the expected version.
2. Confirm the public site loads without authentication.
3. Confirm the protected editorial desk still requires Cloudflare Access.
4. Confirm prior queue records load after sign-in.
5. Check STAGING-BASELINE.md for any known unverified environment facts.
6. Do not change infrastructure merely to begin editorial work.

If the baseline appears stale, record that fact before treating environment assumptions as current.

## 3. Candidate intake

For an editor-originated candidate:

1. Submit one public HTTP or HTTPS source URL.
2. Add a short neutral note if needed.
3. Avoid embedding a desired conclusion in the note.
4. Let the system create and persist the intake.
5. Confirm the record enters submitted or queued state.

The initial question is not “How do we write this?”

The initial question is “What does the evidence actually establish?”

## 4. Analysis-state check

Expected path:

submitted
→ queued
→ analyzing
→ review_ready

Safe alternate outcomes include:

- failed;
- retrying;
- dead_letter.

If analysis fails:

1. Read the safe failure reason.
2. Determine whether the failure is operational or evidentiary.
3. Retry once when the failure is explicitly retryable.
4. Do not repeatedly retry a structurally unsupported source.
5. Record or investigate DLQ state when retries are exhausted.

Never interpret failure to analyze as evidence that the underlying claim is true or false.

## 5. Evidence review

Before considering the recommendation, inspect:

- submitted URL;
- final retrieved URL;
- extracted evidence;
- source metadata;
- claim ledger;
- verification status;
- qualifications;
- source conflicts;
- evidence truncation;
- factual and legal warnings;
- institution response status;
- duplicate risk.

Ask:

- Did the system analyze only the source it actually had?
- Did it imply corroboration it did not perform?
- Are material claims tied to source evidence?
- Did a qualification disappear?
- Is a technical term being overstated?
- Did the model jump from observation to attribution?
- Did it jump from attribution to specific harm?
- Is the proposed institutional target the right one?
- Is the subject sensitive enough to require additional review?

If the evidence display and recommendation disagree, trust the inspectable evidence and deterministic rules over model confidence.

## 6. Recommendation handling

### If recommendation is PUBLISH

Do not approve immediately.

Confirm:

- meaningful institutional or systemic failure;
- all core material claims verified or verified with qualification;
- causation phrased within evidence;
- no unresolved material source conflict;
- category appropriate;
- severity justified;
- headline accurate;
- summary preserves qualifications;
- kicker punches up;
- source list contains only actually reviewed sources;
- no unsafe “Do not claim” boundary is crossed.

Then create or save the human-reviewed draft revision.

### If recommendation is HOLD

Identify the actual dependency.

Examples:

- primary record missing;
- institution response needed;
- causation unresolved;
- conflicting source;
- developing event;
- duplicate question;
- legal or factual risk;
- additional corroboration needed.

Record the hold reason clearly enough that a future session knows what would change the state.

Do not keep researching without a named dependency.

### If recommendation is REJECT

Confirm that the rejection reason is substantive.

Common valid reasons:

- no meaningful institutional failure;
- isolated misconduct without broader accountability relevance;
- unsupported speculation;
- duplicate without new information;
- trivial consequence;
- stale material;
- inadequate sourcing;
- misleading causal framing;
- unsafe humor;
- incurable factual or legal risk.

Record the decision.

Do not rewrite the system until it produces PUBLISH.

## 7. Human draft revision

The draft is a human editorial artifact.

Review and edit:

- headline;
- summary;
- FML kicker;
- category;
- severity;
- topic tags;
- source list.

Draft rules:

- strongest supported claim, not strongest available rhetoric;
- material qualifications stay;
- institutional response stays when relevant;
- no invented source;
- no stronger causation than evidence;
- no victim-targeted humor;
- no technical-term inflation.

Save a new revision rather than silently overwriting the reviewed state.

## 8. Human decision

Available decisions:

- approve;
- hold;
- reject.

Approval must reference the exact draft revision reviewed.

If the draft changes after approval, treat the prior approval as no longer sufficient for the new revision.

Approval does not mean:

- repository branch exists;
- pull request exists;
- merge occurred;
- deployment occurred;
- public site changed.

## 9. Current publication procedure

Until controlled GitHub App publication orchestration is implemented and separately authorized, use the repository-managed publication workflow.

1. Start from content/story-template.json.
2. Create or update the story JSON under content/stories.
3. Keep status as draft and published_at as null while editing.
4. Personally verify every source.
5. Run content build.
6. Run full repository validation.
7. Open a pull request.
8. Review the exact changed story and generated feed.
9. Only after editorial approval:
   - change status to published;
   - set the actual UTC publication timestamp;
   - regenerate the public feed;
   - rerun validation.
10. Merge only through the authorized repository process.
11. Deploy only through the authorized environment path.
12. Verify the live result.

Never edit public/stories.json directly.

## 10. Publication acceptance

A story is not operationally complete until all applicable states are distinguishable:

- editorially approved;
- repository-prepared;
- pull request reviewed;
- merged;
- deployment succeeded;
- live site verified.

If any stage fails, record the failure stage.

Do not report “published” merely because preparation started.

## 11. Public acceptance after a public change

Use STAGING-CHECKLIST.md.

Minimum public check:

- public site loads;
- reporting is default;
- prototype archive remains clearly separated;
- International, National, Local, and Prototype filters work;
- reporting source links open safely;
- health endpoint returns expected version.

Minimum editorial check when protected services are under test:

- Access protects the desk;
- prior records load;
- one safe test intake moves through expected state;
- evidence and claims display correctly;
- a saved draft persists after reload;
- HOLD or REJECT can be recorded;
- audit history remains coherent.

Use APPROVE in staging only when deliberately testing exact-revision approval.

Approval must not silently publish.

## 12. Phone-width acceptance

At approximately 390 by 844:

- queue readable;
- evidence readable;
- draft form usable;
- controls tappable;
- no horizontal scrolling for core workflow;
- saved-state feedback visible.

Do not assume responsive CSS is sufficient without visual staging acceptance.

## 13. Test-data discipline

Synthetic or fixture records must remain identifiable.

Do not confuse:

- fixture recommendation with real editorial precedent;
- synthetic intake with real source provenance;
- prototype story with reporting;
- staging approval with publication.

When possible, use HOLD or REJECT for routine staging tests to reduce accidental interpretation as publish-ready work.

## 14. Migration procedure

Before a remote staging migration:

1. Confirm the migration file is committed.
2. Run local migration listing.
3. Run local persistence tests.
4. Run full npm run check.
5. Confirm no unrelated production change is bundled.
6. List remote migrations.
7. Review the expected next migration.
8. Obtain explicit authorization for the remote apply.
9. Apply the migration.
10. Re-list remote migrations.
11. Run the relevant staging smoke tests.
12. Record the changed baseline.

Never run a remote migration from ordinary PR validation.

Never automatically recreate the database as routine recovery.

## 15. Public Worker deployment procedure

The current GitHub Actions workflow is scoped to the public Worker.

Before deployment:

- public content checks pass;
- public JavaScript syntax passes;
- Worker dry run passes;
- expected health identity is known.

After deployment:

- health check reaches expected version;
- homepage loads;
- public story feed renders;
- no unrelated DNS, D1, admin Worker, or analysis Worker change occurred.

Record the deployment version and source SHA in the applicable operational
record. Do not rewrite the fixed formal-launch checkpoint as routine deployment
history.

## 16. Admin or analysis Worker changes

Treat admin and analysis Worker deployment as separate from public deployment.

Before change:

- identify bindings affected;
- identify migration requirements;
- identify queue behavior change;
- identify secrets or Access policy dependencies;
- run full tests;
- define rollback.

After change:

- verify Access;
- verify D1 schema;
- verify queue health;
- verify analysis job lifecycle;
- verify one safe intake;
- verify DLQ behavior if relevant;
- update baseline.

Do not infer their deployed versions from public Worker state.

## 17. Model change procedure

A model change is an implementation change with editorial implications.

Before adopting:

1. Keep the same output schema.
2. Keep the same semantic validators.
3. Run the full analysis suite.
4. Compare:
   - schema failure rate;
   - semantic failure rate;
   - invented-source attempts;
   - qualification retention;
   - PUBLISH/HOLD/REJECT distribution;
   - latency;
   - cost.
5. Manually review representative sensitive and high-severity cases.
6. Record the model configuration in environment documentation without exposing secrets.

Do not weaken validators to make a model “work.”

## 18. Monitoring a published story

When a later development appears:

1. Create a monitoring candidate.
2. Compare the new evidence to the exact original published claim.
3. Ask whether the original story was accurate at publication time.
4. Classify:
   - no_action;
   - update_review;
   - correction_review;
   - follow_up.
5. Send any substantive change back through human review.

Do not mutate the original story merely because circumstances changed.

## 19. Correction procedure

Use correction_review only when the original published reporting was materially wrong.

Before correcting:

- identify the exact wrong claim;
- identify the evidence establishing the error;
- preserve the prior version;
- draft corrected language;
- draft a correction note;
- record the deciding editor;
- record timestamps;
- rerun publication validation;
- verify the live correction.

Do not label later context as a correction if the original story was accurate.

## 20. Update or follow-up procedure

Use update_review when later information materially changes the present status but does not invalidate the earlier reporting.

Use follow_up when the development deserves a distinct story.

Preserve links between related stories or monitoring events where supported.

## 21. Research stoppage procedure

For a held candidate, ask:

- What exact missing evidence would change the decision?
- Is that evidence reasonably obtainable now?
- Has additional searching stopped producing new information?
- Is the candidate waiting on a future event rather than more research?

If no current action would materially improve the decision, record HOLD or no action and stop.

Do not turn research into an open-ended obligation.

## 22. Incident response

### Public site incident

- verify health;
- compare deployed source SHA and baseline;
- check recent public deployment;
- avoid touching D1 or admin systems unless evidence points there;
- roll back public deployment when a known good version exists.

### Admin authentication incident

- verify Access configuration;
- verify issuer and audience expectations;
- do not bypass authentication by weakening server-side checks;
- use a controlled staging recovery path.

### Analysis incident

- inspect job state;
- inspect safe error code;
- distinguish retrieval, conversion, model, validation, persistence, and queue failure;
- retry only retryable failures;
- inspect DLQ after exhaustion;
- do not bypass validation to clear a backlog.

### Persistence incident

- stop writes if integrity is uncertain;
- inspect migration version;
- avoid destructive recreation;
- preserve audit state;
- restore forward from known schema and data where possible.

### Publication incident

- identify whether failure occurred at preparation, branch, file write, PR, merge, deploy, or verification;
- do not mark published until live verification succeeds;
- reconcile uncertain external operations before retry.

## 23. DNS and hosting changes

Use DNS-CUTOVER-RUNBOOK.md.

Never combine all of these into one blind cutover:

- mail decoupling;
- nameserver change;
- web apex change;
- Worker custom domain;
- D1 migration;
- admin Worker deployment;
- analysis Worker deployment.

Preserve mail-critical records exactly.

Obtain separate action-time approval for each mutable DNS phase.

Maintain a rollback path.

## 24. Weekly maintenance

Review:

- held candidates and their named dependencies;
- failed and dead-letter analysis jobs;
- stale approved drafts;
- staging baseline changes;
- monitoring candidates;
- open correction or update reviews;
- regression-test health.

Close or defer work that no longer has a meaningful next action.

## 25. Monthly framework review

Ask:

- Did any editorial failure expose a missing rule?
- Did any technical incident expose an unenforced invariant?
- Did a roadmap item become implemented?
- Did an implementation become obsolete?
- Are account-only facts still marked unverified when they should now be verified?
- Are historical documents being mistakenly treated as current instructions?
- Are internal SBNS names causing operational confusion with the current public name?

Update the framework registry rather than letting undocumented practice become the new standard.

## 26. Change record

For consequential changes, record:

- date;
- actor;
- reason;
- affected framework or control;
- source PR or commit;
- validation performed;
- deployment status;
- rollback or recovery note;
- unresolved questions.

The goal is operational memory: enough context that a future operator can understand not only what changed, but why.
