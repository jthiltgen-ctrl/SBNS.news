import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { filterAssignments, queueCounts } from "../public/admin-persistent/desk-state.js";

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
  { id: "three", origin: "editor", status: "failed", submitted_url: "https://example.test/failed", latest_discovery_metadata_json: "{invalid" }
];
assert.deepEqual(filterAssignments(items, { query: "example agency" }).map((item) => item.id), ["one"]);
assert.deepEqual(filterAssignments(items, { query: "PROCUREMENT" }).map((item) => item.id), ["one"]);
assert.deepEqual(filterAssignments(items, { query: "editor", origin: "editor", status: "queued" }).map((item) => item.id), ["two"]);
assert.deepEqual(filterAssignments(items, { query: "no match" }), []);
assert.deepEqual(queueCounts(items), { total: 3, reviewReady: 1, discovery: 1, attention: 2 });

const html = readFileSync(new URL("../public/admin-persistent/index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../public/admin-persistent/admin.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/admin-persistent/admin.css", import.meta.url), "utf8");
for (const id of ["queue-search", "status-filter", "origin-filter", "new-intake", "watchdesk-dry", "watchdesk-live", "watchdesk-metrics", "watchdesk-sources", "watchdesk-history"]) {
  assert.match(html, new RegExp('id="' + id + '"'));
}
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
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);
assert.match(css, /max-width: 1160px/);
assert.match(css, /max-width: 760px/);
assert.match(css, /max-width: 520px/);
console.log("Admin UI state, governance, structure, and responsive checks passed.");
