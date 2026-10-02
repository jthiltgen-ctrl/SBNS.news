// Deterministic, offline contract checks for development-only Echo source adapters.
import assert from "node:assert/strict";
import {
  SOURCE_RECORD_SCHEMA, MAX_RESULTS_PER_ADAPTER, MAX_TOTAL_RESULTS,
  canonicalDiscoveryQuery, normalizeLocResult, normalizeSmithsonianResult,
  verifyLocContext, verifySmithsonianContext, dedupeSourceRecords,
  discoverLoc, discoverSmithsonian, verifyDiscoveredContext, toEchoHistoricalSource,
  EchoSourceInputError, EchoSourceNetworkError,
} from "../src/echo-source-adapters.js";
import {
  ECHO_SOURCE_NETWORK_LIMITS, locSearch, locDetail, smithsonianSearch, smithsonianDetail,
} from "../src/echo-source-network.js";
import { canonicalCandidate, evaluateEchoGate } from "../src/echo-orchestration.js";
import { syntheticCandidate } from "../fixtures/echo/synthetic-fixtures.mjs";

const AT = "2026-10-01T12:00:00.000Z";
const LOC_ITEM = {
  id: "http://www.loc.gov/item/2026123456/", title: "Invented Labor Poster",
  contributor_names: ["Fictional Printmaker"], date: "1938", original_format: ["posters"],
  description: ["A catalog description of an invented labor poster."],
  summary: ["This invented poster was made for a fictional workers' reading room in 1938; the collection note explains its original setting."],
  rights_advisory: ["Public domain"],
};
const SMITH_ITEM = {
  id: "edanmdm-npg_C_NPG.2015.135", title: "Invented Workshop Object",
  content: {
    descriptiveNonRepeating: {
      record_ID: "npg_C_NPG.2015.135", record_link: "https://npg.si.edu/object/invented-workshop-object",
      metadata_usage: { access: "CC0 metadata" },
      online_media: { media: [{ usage: { access: "CC0 media" } }] },
    },
    freetext: {
      name: [{ label: "Maker", content: "Imaginary Maker" }],
      date: [{ label: "Date made", content: "1940" }],
      objectType: [{ label: "Object type", content: "tool" }],
      notes: [
        { label: "Description", content: "A short fictional catalog description." },
        { label: "Historical context", content: "This invented workshop object was used in a fictional community classroom to explain routine maintenance." },
        { label: "Cultural sensitivity", content: "Community protocol applies to this fictional ceremonial record." },
      ],
    },
  },
};
let assertions = 0;
function eq(actual, expected) { assert.deepEqual(actual, expected); assertions++; }
function ok(value) { assert(value); assertions++; }
function throws(action, code) {
  assert.throws(action, (error) => error instanceof EchoSourceInputError && error.code === code);
  assertions++;
}
async function rejects(action, type, code) {
  await assert.rejects(async () => action(), (error) => error instanceof type && error.code === code);
  assertions++;
}
function jsonResponse(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
}
function fixtureFetch(body, capture = []) {
  return async (url, options) => { capture.push({ url, options }); return jsonResponse(body); };
}
function locRecord(overrides = {}) { return normalizeLocResult({ ...LOC_ITEM, ...overrides }, AT); }
function smithRecord(overrides = {}) { return normalizeSmithsonianResult({ ...SMITH_ITEM, ...overrides }, AT); }

function check() {
  eq(SOURCE_RECORD_SCHEMA, "echo-source-record-v1");
  eq(MAX_RESULTS_PER_ADAPTER, 10);
  eq(MAX_TOTAL_RESULTS, 20);
  eq(ECHO_SOURCE_NETWORK_LIMITS.resultsPerSearch, 10);
  eq(canonicalDiscoveryQuery({ terms: ["  labor   records  ", "posters"], excludeIds: ["b", "a", "b"] }),
    { terms: ["labor records", "posters"], excludeIds: ["a", "b"] });
  throws(() => canonicalDiscoveryQuery({ terms: [] }), "INVALID_QUERY");
  throws(() => canonicalDiscoveryQuery({ terms: ["labor"], wholeBrief: "not allowed" }), "INVALID_QUERY");
  throws(() => canonicalDiscoveryQuery({ terms: ["x".repeat(81)] }), "INVALID_QUERY");

  const loc = locRecord();
  eq(loc.recordId, "loc:2026123456");
  eq(loc.canonicalIdentifier, "loc:record:2026123456");
  eq(loc.canonicalUrl, "https://www.loc.gov/item/2026123456/");
  eq(loc.creators, ["Fictional Printmaker"]);
  eq(loc.artifactType, "posters");
  eq(loc.rights.status, "public_domain");
  eq(loc.rights.scope, "catalog_record");
  eq(loc.context.status, "discovery_only");
  eq(loc.context.creatorIntentStatus, "not_claimed");
  eq(loc.culturalProtocol.status, "unclear");
  throws(() => toEchoHistoricalSource(loc), "CONTEXT_NOT_VERIFIED");
  eq(locRecord({ rights_advisory: ["CC BY 4.0"] }).rights.status, "open_license");
  eq(locRecord({ rights_advisory: ["No known restrictions"] }).rights.status, "unknown");
  eq(locRecord({ contributor_names: [], date: null }).creators, []);
  eq(locRecord({ contributor_names: [], date: null }).date, null);
  eq(locRecord({ access_advisory: ["Traditional Knowledge label: community protocol applies"] }).culturalProtocol.status, "indicated");
  eq(locRecord({ rights_advisory: ["Community protocol applies to this sacred material"] }).culturalProtocol.status, "indicated");
  eq(locRecord({ id: "http://www.loc.gov/item/sn85033000/1911-08-10/ed-1/" }).canonicalUrl,
    "https://www.loc.gov/item/sn85033000/1911-08-10/ed-1/");
  eq(normalizeLocResult({ ...LOC_ITEM, id: "https://evil.example/item/2026123456/" }, AT), null);
  eq(normalizeLocResult({ ...LOC_ITEM, id: "https://www.loc.gov/item/../private/" }, AT), null);
  eq(normalizeLocResult({ ...LOC_ITEM, title: "" }, AT), null);

  const smith = smithRecord();
  eq(smith.recordId, "smithsonian:edanmdm-npg_C_NPG.2015.135");
  eq(smith.canonicalUrl, "https://npg.si.edu/object/invented-workshop-object");
  eq(smith.creators, ["Imaginary Maker"]);
  eq(smith.date, "1940");
  eq(smith.rights.status, "unknown"); // CC0 metadata/media hints do not license the artifact.
  eq(smith.rights.metadataLicenseHint, "CC0 metadata");
  eq(smith.rights.mediaLicenseHint, "CC0 media");
  eq(smith.culturalProtocol.status, "indicated");
  eq(normalizeSmithsonianResult({ ...SMITH_ITEM, content: { ...SMITH_ITEM.content,
    descriptiveNonRepeating: { ...SMITH_ITEM.content.descriptiveNonRepeating,
      record_link: "http://npg.si.edu/object/invented-workshop-object" } } }, AT).canonicalUrl,
    "https://npg.si.edu/object/invented-workshop-object");
  eq(normalizeSmithsonianResult({ ...SMITH_ITEM, content: { ...SMITH_ITEM.content,
    descriptiveNonRepeating: { ...SMITH_ITEM.content.descriptiveNonRepeating,
      record_link: "https://npg.si.edu/object/invented-workshop-object?token=untrusted#fragment" } } }, AT).canonicalUrl,
    "https://npg.si.edu/object/invented-workshop-object");
  eq(normalizeSmithsonianResult({ ...SMITH_ITEM, content: { ...SMITH_ITEM.content,
    descriptiveNonRepeating: { ...SMITH_ITEM.content.descriptiveNonRepeating,
      record_link: "https://evil.example/object/invented-workshop-object" } } }, AT), null);
  eq(normalizeSmithsonianResult({ ...SMITH_ITEM, content: { ...SMITH_ITEM.content,
    descriptiveNonRepeating: { ...SMITH_ITEM.content.descriptiveNonRepeating,
      record_ID: "different-record" } } }, AT), null);
  eq(normalizeSmithsonianResult({ ...SMITH_ITEM, title: null,
    content: { ...SMITH_ITEM.content, descriptiveNonRepeating: {
      ...SMITH_ITEM.content.descriptiveNonRepeating, title: null } } }, AT), null);
  const sparseSmith = smithRecord({ content: { ...SMITH_ITEM.content, freetext: {} } });
  eq(sparseSmith.creators, []);
  eq(sparseSmith.date, null);

  eq(dedupeSourceRecords([loc, { ...loc, recordId: "loc:another" }]).length, 1);
  eq(dedupeSourceRecords([loc, { ...loc, canonicalIdentifier: "loc:record:another", recordId: "loc:another" }]).length, 1);
  eq(dedupeSourceRecords([loc, smith]).length, 2); // No fuzzy cross-source collapse.
  throws(() => dedupeSourceRecords([{}]), "INVALID_RESULTS");

  const verifiedLoc = verifyLocContext(loc, { item: LOC_ITEM }, AT);
  eq(verifiedLoc.context.status, "source_supported");
  eq(verifiedLoc.context.contextAuthority, "limited");
  eq(verifiedLoc.context.creatorIntentStatus, "not_claimed");
  const historicalSource = toEchoHistoricalSource(verifiedLoc);
  eq(historicalSource.sourceRole, "historical_context");
  eq(historicalSource.supportsField, "original_context");
  eq(historicalSource.canonicalIdentifier, loc.canonicalIdentifier);
  eq(verifyLocContext(loc, { item: { ...LOC_ITEM, summary: [] } }, AT).context.status, "insufficient");
  throws(() => verifyLocContext(loc, { item: { ...LOC_ITEM, id: "https://www.loc.gov/item/other/" } }, AT), "IDENTITY_MISMATCH");
  const verifiedSmith = verifySmithsonianContext(smith, { response: SMITH_ITEM }, AT);
  eq(verifiedSmith.context.status, "source_supported");
  eq(verifiedSmith.context.contextAuthority, "limited");
  eq(verifiedSmith.culturalProtocol.status, "indicated");
  eq(verifySmithsonianContext(smith, { response: { ...SMITH_ITEM,
    content: { ...SMITH_ITEM.content, freetext: { ...SMITH_ITEM.content.freetext,
      notes: [{ label: "Description", content: "A short description." }] } } } }, AT).context.status, "insufficient");

  // A verified collection record supplies only artifact identity and a context
  // citation. Synthetic downstream inputs still supply the analogy, present-day
  // intake evidence, rights review, and deterministic gates.
  const candidate = syntheticCandidate();
  candidate.canonicalArtifactId = verifiedLoc.canonicalIdentifier;
  candidate.artifactType = verifiedLoc.artifactType;
  candidate.title = verifiedLoc.title;
  candidate.creator = verifiedLoc.creators[0];
  candidate.creationDate = verifiedLoc.date;
  candidate.assessment.originalContext = verifiedLoc.context.originalContext;
  candidate.sources[0] = historicalSource;
  candidate.gate.contextAuthority = verifiedLoc.context.contextAuthority;
  candidate.gate.culturalProtocol = "unresolved"; // Missing protocol clearance is not a clear signal.
  const handoff = canonicalCandidate(candidate);
  eq(handoff.schema, "echo-candidate-v1");
  eq(handoff.sources.length, 3);
  eq(handoff.sources.filter((source) => source.sourceRole === "historical_context")[0].canonicalIdentifier,
    verifiedLoc.canonicalIdentifier);
  eq(evaluateEchoGate(handoff), "CULTURAL_PROTOCOL_UNRESOLVED");
  console.log(`Echo public-source pure check passed: ${assertions} assertions; synthetic/offline only.`);
}

async function test() {
  check();
  const requests = [];
  const locResults = { results: [LOC_ITEM, LOC_ITEM, { ...LOC_ITEM, id: "https://evil.example/item/bad/" }] };
  const loc = await discoverLoc({ terms: ["labor", "poster"] }, { fetchImpl: fixtureFetch(locResults, requests), retrievedAt: AT });
  eq(loc.length, 1);
  eq(new URL(requests[0].url).hostname, "www.loc.gov");
  eq(new URL(requests[0].url).pathname, "/search/");
  eq(new URL(requests[0].url).searchParams.get("c"), "10");
  eq(new URL(requests[0].url).searchParams.get("sp"), "1");
  eq(requests[0].options.redirect, "manual");
  eq(await discoverLoc({ terms: ["labor"], excludeIds: [loc[0].recordId] },
    { fetchImpl: fixtureFetch(locResults), retrievedAt: AT }), []);
  eq(await discoverLoc({ terms: ["labor"] }, { fetchImpl: fixtureFetch({ results: [] }), retrievedAt: AT }), []);
  await rejects(() => discoverLoc({ terms: ["labor"] }, { fetchImpl: fixtureFetch({ wrong: [] }), retrievedAt: AT }), EchoSourceInputError, "INVALID_RESPONSE");
  const verified = await verifyDiscoveredContext(loc[0], { fetchImpl: fixtureFetch({ item: LOC_ITEM }), retrievedAt: AT });
  eq(verified.context.status, "source_supported");

  const smithRequests = [];
  const smith = await discoverSmithsonian({ terms: ["workshop"] }, {
    apiKey: "synthetic-test-key", fetchImpl: fixtureFetch({ response: { rows: [SMITH_ITEM] } }, smithRequests), retrievedAt: AT,
  });
  eq(smith.length, 1);
  eq(new URL(smithRequests[0].url).hostname, "api.si.edu");
  eq(new URL(smithRequests[0].url).searchParams.get("rows"), "10");
  eq(smithRequests[0].options.headers["X-Api-Key"], "synthetic-test-key");
  ok(!smithRequests[0].url.includes("synthetic-test-key"));
  const smithDetail = await verifyDiscoveredContext(smith[0], {
    apiKey: "synthetic-test-key", fetchImpl: fixtureFetch({ response: SMITH_ITEM }), retrievedAt: AT,
  });
  eq(smithDetail.context.status, "source_supported");
  await rejects(() => discoverSmithsonian({ terms: ["workshop"] }, { fetchImpl: fixtureFetch({ response: { rows: [] } }) }),
    EchoSourceInputError, "API_KEY_REQUIRED");

  const largeRows = Array.from({ length: 30 }, (_, index) => ({ ...LOC_ITEM, id: `https://www.loc.gov/item/${index + 1}/` }));
  const bounded = await discoverLoc({ terms: ["labor"] }, { fetchImpl: fixtureFetch({ results: largeRows }), retrievedAt: AT });
  eq(bounded.length, MAX_RESULTS_PER_ADAPTER);
  const longList = Array.from({ length: 30 }, (_, index) => locRecord({ id: `https://www.loc.gov/item/${index + 1}/` }));
  eq(dedupeSourceRecords(longList).length, MAX_TOTAL_RESULTS);

  await rejects(() => locSearch("labor", { fetchImpl: async () => jsonResponse({}, { status: 429 }) }),
    EchoSourceNetworkError, "RATE_LIMITED");
  await rejects(() => locSearch("labor", { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://localhost/private" } }) }),
    EchoSourceNetworkError, "REDIRECT_REJECTED");
  await rejects(() => locSearch("labor", { fetchImpl: async () => jsonResponse({ results: [] }, { headers: { "content-length": "2000000" } }) }),
    EchoSourceNetworkError, "RESPONSE_TOO_LARGE");
  await rejects(() => locSearch("labor", { fetchImpl: async () => new Response("x".repeat(100), { headers: { "content-type": "application/json" } }), maxBytes: 50 }),
    EchoSourceNetworkError, "RESPONSE_TOO_LARGE");
  await rejects(() => locSearch("labor", { fetchImpl: () => new Promise(() => {}), timeoutMs: 5 }),
    EchoSourceNetworkError, "TIMEOUT");
  await rejects(() => locSearch("labor", { fetchImpl: async () => new Response("not-json", { headers: { "content-type": "application/json" } }) }),
    EchoSourceNetworkError, "INVALID_JSON");
  await rejects(() => locSearch("labor", { fetchImpl: async () => new Response("text", { headers: { "content-type": "text/html" } }) }),
    EchoSourceNetworkError, "NON_JSON_RESPONSE");
  await rejects(() => locDetail("https://localhost/internal"), EchoSourceNetworkError, "INVALID_RECORD_ID");
  const newspaperRequests = [];
  await locDetail("sn85033000/1911-08-10/ed-1", { fetchImpl: fixtureFetch({ item: LOC_ITEM }, newspaperRequests) });
  eq(new URL(newspaperRequests[0].url).pathname, "/item/sn85033000/1911-08-10/ed-1/");
  await rejects(() => smithsonianDetail("../private", "synthetic-test-key"), EchoSourceNetworkError, "INVALID_RECORD_ID");
  const smithNetwork = [];
  await smithsonianSearch("workshop", "synthetic-test-key", { fetchImpl: fixtureFetch({ response: { rows: [] } }, smithNetwork) });
  eq(smithNetwork.length, 1); // No pagination, crawling, or retry loop.
  console.log(`Echo public-source offline tests passed: ${assertions} assertions; no network or persistence.`);
}

const mode = process.argv[2];
if (mode === "check") check();
else if (mode === "test") await test();
else throw new Error("Usage: node scripts/echo-sources.mjs check|test");
