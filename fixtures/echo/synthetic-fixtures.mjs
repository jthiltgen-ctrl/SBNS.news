// Invented institutions, works, creators and example.test identifiers only.
import { BRIEF_SCHEMA, CANDIDATE_SCHEMA } from "../../src/echo-orchestration.js";
export const AT = "2026-10-01T12:00:00.000Z";
export const TEST_HASH = "a".repeat(64);
export const SECOND_HASH = "b".repeat(64);

export function syntheticBrief(issueKey = "synthetic:water-oversight") {
  return { schema: BRIEF_SCHEMA, issueKey, title: "Synthetic water-control oversight",
    institution: "Fictional Civic Water Office", jurisdiction: "Invented District",
    condition: "A fictional inspection schedule was missed", institutionalExpectation: "Inspect the fabricated valves each quarter",
    verifiedFacts: [{ id: "fact-1", text: "A fabricated audit recorded one missed inspection.", sourceIds: ["synthetic-source-1"] }],
    unresolvedFacts: ["Whether another inspection was performed off schedule"],
    materialQualifications: ["The synthetic record covers one quarter only"],
    accountabilityQuestion: "How did the fictional office track its inspection duty?",
    affectedInterests: ["Residents of the invented district"], mechanism: "A recordkeeping gap obscures a routine duty",
    mustNotClaim: ["No real public system or person is implicated"],
    intakes: [{ intakeId: "synthetic-intake-1", role: "primary" }],
    evidenceSources: [{ id: "synthetic-source-1", intakeId: "synthetic-intake-1", canonicalId: "synthetic:audit:1",
      contentHash: TEST_HASH, confidence: "primary_record", provenance: "Fabricated acceptance fixture" }],
    provenanceSummary: { confidence: "primary_record", basis: "One invented audit record" } };
}

export function syntheticCandidate(n = 1) {
  const contextSource = { sourceRole: "historical_context", supportsField: "original_context",
    canonicalIdentifier: `synthetic:archive:${n}`, url: `https://example.test/fictional-archive/${n}`,
    title: `Invented archive entry ${n}`, authorityRationale: "Fabricated catalog fixture", contentHash: TEST_HASH };
  const contemporarySource = { sourceRole: "contemporary_evidence", supportsField: "present_day_evidence",
    intakeSourceId: "synthetic-source-1", sourceIntakeId: "synthetic-intake-1", authorityRationale: "Fabricated current audit" };
  const rightsSource = { sourceRole: "rights", supportsField: "rights", canonicalIdentifier: `synthetic:rights:${n}`,
    url: `https://example.test/fictional-rights/${n}`, authorityRationale: "Fabricated rights note" };
  return { schema: CANDIDATE_SCHEMA, canonicalArtifactId: `synthetic:work:${n}`, artifactType: "fictional_literature",
    title: `The Invented Ledger ${n}`, creator: `Imaginary Author ${n}`, creationDate: "1900",
    assessment: { originalContext: "An invented office loses track of its own ledgers.", creatorIntentStatus: "not_claimed",
      whatEchoes: "Recordkeeping can hide an unmet institutional duty.", comparisonBreaks: "The fictional office and present synthetic office are unrelated.",
      remainsUncertain: "No causal link can be established.", temptedOverclaim: "The work predicted a modern event.",
      presentDayEvidence: "The fabricated audit reports one missing inspection entry.",
      editorialValue: "Illustrates why documentary gaps deserve questions, not assumed motives.", researchBurden: "low" },
    sources: [contextSource, contemporarySource, rightsSource],
    rights: [{ assetType: "text", assetIdentifier: `synthetic:work:${n}`, proposedUse: "metadata and link only",
      status: "link_metadata_only", basis: "Synthetic restrictive review", permittedUse: "title and metadata only",
      rightsSource, reviewedBy: "synthetic-editor", reviewedAt: AT }],
    gate: { context: "verified", presentEvidence: "sufficient", mechanismMatch: "direct",
      editorialValue: "adds", culturalProtocol: "clear", authority: "primary" },
    priorUse: { status: "never_seen" } };
}

export function syntheticInput(suffix = "one", candidates = [syntheticCandidate()]) {
  return { brief: syntheticBrief(`synthetic:${suffix}`), candidates, runKey: "run-1", requestedBy: "synthetic-editor",
    triggerType: "manual", at: AT };
}

export const scenarios = {
  A_strong: () => syntheticInput("strong"),
  B_multiple: () => syntheticInput("multiple", [1, 2, 3, 4].map(syntheticCandidate)),
  C_no_echo: () => syntheticInput("none", []),
  D_weak: () => { const input = syntheticInput("weak"); input.candidates[0].gate.mechanismMatch = "topic_only"; return input; },
  E_context: () => { const input = syntheticInput("context"); input.candidates[0].gate.context = "insufficient"; return input; },
  F_present: () => { const input = syntheticInput("present"); input.candidates[0].gate.presentEvidence = "insufficient"; return input; },
  G_restrictive: () => { const input = syntheticInput("restrictive"); input.candidates[0].rights[0].status = "do_not_reproduce"; return input; },
  H_prior_use: () => { const input = syntheticInput("prior"); input.candidates[0].priorUse = { status: "recently_featured", justification: "The synthetic mechanism remains unusually apt" }; return input; },
  I_stale: () => syntheticInput("stale"),
  J_replay: () => syntheticInput("replay"),
};
