import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../public/admin-persistent/", import.meta.url)));
const now = "2026-09-30T18:59:19.913Z";
const candidate = {
  schema_version: "1.2", discovered_title: "Synthetic records show an oversight gap",
  institution_or_system: "Example Agency", topic: "Procurement", normalized_url: "https://example.test/report",
  primary_record_status: "located", evidence_review_state: "reviewed", reviewed_material: "Synthetic public record",
  primary_record_url: "https://example.test/record", source: { name: "Example Gazette", source_class: "official" },
  publication_date: "2026-09-29", discovered_at: now, submission_readiness: { ready: true },
  why_this_may_belong: "An explicit accountability question.", apparent_job: "Deliver the contracted service.",
  observed_condition: "The synthetic record shows a missed milestone.", accountability_gap: "Oversight was incomplete.",
  record_summary: "Synthetic record only; no real source material.", accountability_question: "Why was the milestone missed?",
  research_prompt: "Check the underlying contract.", material_qualification: "No causal conclusion is established.",
  institutional_response: "Not recorded.", remains_unproven: "Responsibility and harm.",
  triage: { recommendation: "Investigate", rationale: "Synthetic test fixture." }, research_burden: "Medium",
  key_sources: [{ role: "Primary record", url: "https://example.test/record" }]
};
const items = [
  { id: "intake-synthetic-1", origin: "discovery", status: "review_ready", submitted_url: candidate.normalized_url, updated_at: now, latest_analysis_job_state: "complete", latest_recommendation: "hold", latest_decision: null, latest_discovery_metadata_json: JSON.stringify({ candidate }) },
  { id: "intake-synthetic-2", origin: "editor", status: "queued", submitted_url: "https://example.test/editor-report", updated_at: now, latest_analysis_job_state: "queued", latest_recommendation: null, latest_decision: null },
  { id: "intake-synthetic-3", origin: "editor", status: "approved", submitted_url: "https://example.test/approved-report", updated_at: now, latest_analysis_job_state: "complete", latest_recommendation: "publish", latest_decision: "approve" },
  { id: "intake-synthetic-4", origin: "editor", status: "failed", submitted_url: "https://example.test/retry", updated_at: now, latest_analysis_job_state: "failed", latest_recommendation: null, latest_decision: null }
];
const analysis = {
  recommendation: "hold", recommendation_confidence: "medium", category: "National", severity: 3,
  why_sbns: "The record raises an accountability question but needs further corroboration.",
  recommendation_reasons: ["Relevant public-interest issue."], hold_reasons: ["Attribution remains unproven."],
  reject_reasons: [], observed_condition: candidate.observed_condition,
  attributable_failure: "Not established.", specific_harm_causation: "Not established.",
  qualification_required: true, factual_risk: "Avoid implying causation.", legal_risk: "Low if carefully qualified.",
  do_not_claim: ["Do not identify a responsible individual."], proposed_headline: "Synthetic oversight record warrants review",
  proposed_summary: "A synthetic record points to an oversight question, with responsibility and harm unproven.",
  proposed_fml_kicker: "The paperwork got here first.", proposed_topic_tags: ["oversight", "procurement"],
  claims: [{ claim_id: "C1", claim_text: "The synthetic record lists a missed milestone.", material: true, verification_status: "verified", qualification: "No attribution.", conflict: false }],
  source_conflicts: []
};
const run = {
  run_id: "watchdesk_synthetic", trigger_type: "manual", dry_run: true, started_at: now,
  completed_at: now, status: "success", source_failure_count: 0, submitted_count: 0,
  metrics: { sources_checked: 5, sources_succeeded: 5, items_discovered: 102, discovery_leads: 25, submission_ready: 0, would_submit: 0, submitted_to_newsroom: 0 },
  source_health: [{ source_id: "synthetic-source", checked_at: now, status: "succeeded", items_parsed: 10 }]
};
function json(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}
createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  if (request.method !== "GET") return json(response, { error: { message: "Preview is read-only." } }, 405);
  if (path === "/api/admin/session") return json(response, { ok: true, actor: { email: "synthetic-editor@example.test" } });
  if (path === "/api/admin/intakes") return json(response, { ok: true, intakes: items });
  if (path === "/api/admin/watchdesk/status") return json(response, { ok: true, schedule_configured: true, cron_utc: "0 14,23 * * *", latest: run, last_completed: run, recent: [run] });
  if (path === "/api/admin/intakes/intake-synthetic-1") return json(response, {
    ok: true, intake: { ...items[0], submitted_at: now, submitter_note: "Synthetic intake for visual review", analysis_status: "complete" },
    analysis_jobs: [{ state: "complete" }], analyses: [{ raw_analysis_json: JSON.stringify(analysis) }],
    sources: [{ source_title: "Synthetic primary record", url: "https://example.test/record", verification_status: "verified", extraction_format: "html", extracted_text: "Synthetic evidence only. No real source or confidential material." }],
    drafts: [{ id: "draft-1", revision: 1, story_id: "synthetic-story", headline: "Synthetic oversight record", summary: analysis.proposed_summary, fml_kicker: "The paperwork got here first.", category: "National", severity: 3, topic_tags_json: JSON.stringify(["oversight", "procurement"]) }],
    decisions: [{ decision: "hold", decided_at: now, draft_id: null }],
    audit: [{ created_at: now, actor_type: "system", action: "watchdesk.candidate_submitted", metadata_json: JSON.stringify({ candidate }) }, { created_at: now, actor_id: "synthetic-editor@example.test", action: "decision.hold" }]
  });
  const local = path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
  if (!["index.html", "admin.css", "admin.js", "desk-state.js"].includes(local)) return json(response, { error: { message: "Not found." } }, 404);
  const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  response.writeHead(200, { "Content-Type": mime[extname(local)] });
  response.end(readFileSync(resolve(root, local)));
}).listen(4173, "127.0.0.1", () => console.log("Synthetic admin preview: http://127.0.0.1:4173"));
