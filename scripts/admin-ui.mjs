import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterAssignments, queueCounts } from "../public/admin-persistent/desk-state.js";
import { draftZero, evidenceLedger } from "../public/admin-persistent/editorial-production.js";
import { echoFailureFields } from "../public/admin-persistent/echo-diagnostics.js";

const candidate = {
  discovered_title: "Synthetic watchdog report",
  institution_or_system: "Example Agency",
  topic: "Procurement",
  normalized_url: "https://example.test/report",
  source: { name: "Example source" },
  triage: { recommendation: "Investigate" }
};
const items = [
  { id: "one", origin: "discovery", status: "review_ready", submitted_url: "https://example.test/report", latest_discovery_metadata_json: JSON.stringify({ candidate }) },
  { id: "two", origin: "editor", status: "queued", submitted_url: "https://example.test/editor" },
  { id: "three", origin: "editor", status: "failed", submitted_url: "https://example.test/failed", latest_discovery_metadata_json: "{invalid" },
  { id: "four", origin: "editor", status: "rejected", submitted_url: "https://example.test/rejected" }
];
assert.deepEqual(filterAssignments(items, { query: "example agency" }).map((item) => item.id), ["one"]);
assert.deepEqual(filterAssignments(items, { query: "PROCUREMENT" }).map((item) => item.id), ["one"]);
assert.deepEqual(filterAssignments(items, { query: "editor", origin: "editor", status: "queued" }).map((item) => item.id), ["two"]);
assert.deepEqual(filterAssignments(items, { query: "no match" }), []);
assert.deepEqual(filterAssignments(items, { status: "active" }).map((item) => item.id), ["one", "two", "three"]);
assert.deepEqual(filterAssignments(items, { status: "rejected", query: "rejected" }).map((item) => item.id), ["four"]);
assert.deepEqual(queueCounts(items), { total: 4, reviewReady: 1, discovery: 1, attention: 2 });
const supportedAnalysis = JSON.parse(readFileSync(new URL("../intake/fixtures/publish-accountability-without-systemic-failure.json", import.meta.url), "utf8")).analysis;
const ledger = evidenceLedger(supportedAnalysis);
assert.equal(ledger.length, 3);
assert.equal(ledger[1].status, "Analysis cites with qualification — check source");
assert.equal(ledger[1].sources[0].authority, "Synthetic first-party review used only as a deterministic fixture");
const proposal = draftZero(supportedAnalysis);
assert.equal(proposal.state, "proposal");
assert.equal(proposal.paragraphs.length, 3);
assert.equal(proposal.sourceUrls.length, 1);
assert.equal(draftZero({ ...supportedAnalysis, recommendation: "hold" }).state, "withheld");
assert.equal(draftZero({ ...supportedAnalysis, claims: supportedAnalysis.claims.map((claim) => ({ ...claim, source_refs: [] })) }).state, "withheld");

const html = readFileSync(new URL("../public/admin-persistent/index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../public/admin-persistent/admin.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/admin-persistent/admin.css", import.meta.url), "utf8");
for (const id of ["queue-search", "status-filter", "origin-filter", "new-intake", "watchdesk-dry", "watchdesk-live", "watchdesk-metrics", "watchdesk-sources", "watchdesk-history", "discovery-search-form", "discovery-search-query", "discovery-search-results"]) {
  assert.match(html, new RegExp('id="' + id + '"'));
}
assert.match(html, /<option value="active" selected>/);
assert.match(js, /Draft 0 — AI Editorial Proposal/);
assert.match(js, /DRAFT WITHHELD — EVIDENCE GAPS REMAIN/);
assert.match(js, /Read complete inspected-material analysis/);
assert.match(js, /Editorial Frame/);
assert.match(js, /Analyze selected discovery/);
for (const label of ["Intake", "Discovery", "Analysis", "Evidence", "Drafts", "Decision", "Audit"]) assert.match(js, new RegExp('"' + label + '"'));
assert.match(js, /AI proposal — not saved \/ not approved/);
assert.match(js, /LAST APPROVED/);
assert.match(js, /Human decision: /);
assert.match(js, /AI read: /);
assert.match(js, /Readiness: /);
assert.match(html, /Watchdesk submitted/);
assert.doesNotMatch(html, /desk-last-run|Last scan/);
assert.match(js, /observed condition is not attributable failure/i);
assert.match(js, /window\.confirm\(/);
assert.match(js, /dry_run: dryRun/);
assert.match(js, /data\.intake\.id/);
assert.match(js, /textContent/);
assert.doesNotMatch(js, /\.innerHTML\s*=/);
assert.match(js, /echoFailureFields\(latestFailure\)/);
const unsafeEchoFailure = { action: "echo.research_failed", metadata_json: JSON.stringify({ analysis_id: "analysis_fixture", run_key: "safe:run-1",
  code: "ECHO_SOURCES_UNAVAILABLE", stage: "source_discovery", adapter_diagnostics: [
    { adapter: "loc", configured: true, attempted: true, outcome: "failed", error_code: "TIMEOUT", result_count: null, duration_ms: 12 },
    { adapter: "smithsonian", configured: false, attempted: false, outcome: "not_configured", error_code: "<img src=x onerror=alert(1)>", result_count: null, duration_ms: null },
    { adapter: "loc", configured: true, attempted: true, outcome: "failed", error_code: "<img src=x onerror=alert(1)>", result_count: null, duration_ms: null },
  ], raw_exception: "<script>alert('secret')</script>" }) };
const echoFailure = echoFailureFields(unsafeEchoFailure);
assert.ok(echoFailure.some(([label, value]) => label === "Adapter: Library of Congress error code" && value === "TIMEOUT"));
assert.ok(echoFailure.some(([label, value]) => label === "Adapter: Smithsonian outcome" && value === "not_configured"));
assert.equal(echoFailure.some(([, value]) => String(value).includes("<")), false);
assert.equal(echoFailure.some(([label]) => label === "raw_exception"), false);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /max-width: 1160px/);
assert.match(css, /max-width: 760px/);
assert.match(css, /max-width: 520px/);
console.log("Admin UI state, governance, structure, and responsive checks passed.");
