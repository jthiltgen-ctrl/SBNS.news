import worker from "../src/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const knownId = "faa-bnatcs-gao-cost-schedule-review";
const canonicalPath = `/story/${knownId}`;
const assetRequests = [];
const env = {
  ASSETS: {
    fetch(request) {
      assetRequests.push(request);
      return new Response("static asset", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  },
};

async function request(path, init) {
  return worker.fetch(new Request(`https://shockedbutnotsurprised.news${path}`, init), env);
}

const canonical = await request(canonicalPath);
assert(canonical.status === 200, "Canonical story path did not serve its static asset");
assert(assetRequests.length === 1, "Canonical story path did not reach the asset binding exactly once");
assert(new URL(assetRequests[0].url).pathname === canonicalPath, "Canonical asset request path changed");

for (const variant of [`${canonicalPath}/`, `${canonicalPath}/index.html`, `${canonicalPath}.html`]) {
  const response = await request(`${variant}?from=test`);
  assert(response.status === 308, `${variant} did not return a permanent redirect`);
  assert(
    response.headers.get("location") ===
      `https://shockedbutnotsurprised.news${canonicalPath}?from=test`,
    `${variant} did not redirect to the canonical URL while preserving the query`,
  );
}

for (const unknownPath of ["/story/not-a-published-story", "/story", "/story/"]) {
  const response = await request(unknownPath);
  assert(response.status === 404, `${unknownPath} did not return a genuine 404`);
}
assert(assetRequests.length === 1, "An unknown story path reached the SPA asset fallback");

const methodResponse = await request(canonicalPath, { method: "POST" });
assert(methodResponse.status === 405, "Unsupported story method did not return 405");
assert(methodResponse.headers.get("allow") === "GET, HEAD", "Story 405 response is missing Allow");

const health = await request("/api/health");
assert(health.status === 200, "Public health route regressed");
const healthBody = await health.json();
assert(healthBody.version === "v1.5 production", "Public health identity regressed");

const homepage = await request("/");
assert(homepage.status === 200, "Homepage asset routing regressed");
assert(assetRequests.length === 2, "Homepage did not pass through to the asset binding");

console.log(
  "Public routing tests passed: canonical assets, permanent variants, unknown-story 404, method handling, health, and homepage pass-through.",
);
