const VERIFIED = new Set(["verified", "verified_with_qualification"]);

export function evidenceLedger(analysis) {
  if (!analysis || !Array.isArray(analysis.claims)) return [];
  const sources = new Map((analysis.sources || []).map((source) => [source.source_id, source]));
  return analysis.claims.map((claim) => ({
    id: claim.claim_id,
    text: claim.claim_text,
    material: claim.material === true,
    status: claim.verification_status === "verified" ? "Analysis cites as established — check source"
      : claim.verification_status === "verified_with_qualification" ? "Analysis cites with qualification — check source"
      : claim.verification_status === "disputed" ? "Disputed / counterevidence requires review" : "Unresolved",
    qualification: claim.qualification || null,
    locator: claim.locator || null,
    sources: (claim.source_refs || []).map((ref) => sources.get(ref)).filter(Boolean).map((source) => ({
      id: source.source_id, name: source.name, url: source.url, role: source.source_type,
      authority: source.authority, locator: source.locator || null,
    })),
  }));
}

export function draftZero(analysis) {
  const ledger = evidenceLedger(analysis);
  const material = ledger.filter((claim) => claim.material);
  const missing = [];
  if (!analysis) missing.push("Completed analysis");
  else {
    if (analysis.recommendation !== "publish") missing.push("A supported REVIEW READY editorial analysis");
    if (!material.length || material.some((claim) => !VERIFIED.has((analysis.claims || []).find((item) => item.claim_id === claim.id)?.verification_status))) missing.push("Verified material claims with qualifications preserved");
    if (material.some((claim) => !claim.sources.length)) missing.push("A cited source for every material claim");
    if (!analysis.observed_condition) missing.push("Documented observed condition");
    if (!analysis.proposed_headline || !analysis.proposed_summary || !analysis.proposed_fml_kicker) missing.push("Complete proposed headline, summary, and kicker");
    if ((analysis.source_conflicts || []).some((conflict) => conflict.affects_publication && !conflict.proposed_story_avoids_unresolved_claim)) missing.push("Resolution or exclusion of publication-relevant source conflicts");
  }
  if (missing.length) return { state: "withheld", missing };
  const byId = new Map(ledger.map((claim) => [claim.id, claim]));
  const modelParagraphs = Array.isArray(analysis.proposed_body) && analysis.proposed_body.length
    ? analysis.proposed_body.map((paragraph) => {
      const refs = paragraph.claim_refs.map((ref) => byId.get(ref));
      return refs.length && refs.every((claim) => claim && claim.sources.length && VERIFIED.has((analysis.claims || []).find((item) => item.claim_id === claim.id)?.verification_status))
        ? { text: paragraph.text, qualification: refs.map((claim) => claim.qualification).filter(Boolean).join(" ") || null, sources: [...new Map(refs.flatMap((claim) => claim.sources).map((source) => [source.url, source])).values()] }
        : null;
    }) : null;
  return {
    state: "proposal",
    headline: analysis.proposed_headline,
    summary: analysis.proposed_summary,
    kicker: analysis.proposed_fml_kicker,
    category: analysis.category,
    severity: analysis.severity,
    tags: analysis.proposed_topic_tags || [],
    paragraphs: modelParagraphs?.every(Boolean) ? modelParagraphs : [
      ...material,
      ...ledger.filter((claim) => !claim.material && analysis.institution_response_present && /\b(said|stated|responded|acknowledged|disagreed)\b/i.test(claim.text) && claim.sources.length),
    ].map((claim) => ({ text: claim.text, qualification: claim.qualification, sources: claim.sources })),
    sourceUrls: [...new Set(material.flatMap((claim) => claim.sources.map((source) => source.url)))],
  };
}
