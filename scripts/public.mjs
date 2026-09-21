import { readFile } from "node:fs/promises";
import worker from "../src/index.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const knownId = "faa-bnatcs-gao-cost-schedule-review";
const canonicalPath = `/story/${knownId}`;

const [homepageHtml, styles, appScript, storyHtml, feedText, sourceDisplayFont, publicDisplayFont, sourceUtilityFont, publicUtilityFont] =
  await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL(`../public/story/${knownId}.html`, import.meta.url), "utf8"),
    readFile(new URL("../public/stories.json", import.meta.url), "utf8"),
    readFile(new URL("../assets/fonts/eb-garamond-variable.ttf", import.meta.url)),
    readFile(new URL("../public/fonts/eb-garamond-variable.ttf", import.meta.url)),
    readFile(new URL("../assets/fonts/inter-variable.ttf", import.meta.url)),
    readFile(new URL("../public/fonts/inter-variable.ttf", import.meta.url)),
  ]);

for (const color of ["#0b0b0d", "#4b4f56", "#9aa0a6", "#f8f7f4", "#c8102e", "#d9d9d6"]) {
  assert(styles.includes(color), `Canonical brand color ${color} is missing from the public stylesheet`);
}
assert(styles.includes('font-family: "EB Garamond"'), "Local EB Garamond font face is missing");
assert(styles.includes('font-family: "Inter"'), "Local Inter font face is missing");
assert(sourceDisplayFont.equals(publicDisplayFont), "Public EB Garamond does not match the canonical committed font");
assert(sourceUtilityFont.equals(publicUtilityFont), "Public Inter does not match the canonical committed font");

const readerSurface = `${homepageHtml}\n${styles}\n${storyHtml}`;
for (const obsoleteFont of ["Bebas Neue", "Barlow Condensed", "Special Elite", '"Lora"']) {
  assert(!readerSurface.includes(obsoleteFont), `Obsolete reader font remains: ${obsoleteFont}`);
}
assert(!readerSurface.includes("fonts.googleapis.com"), "Reader still depends on Google Fonts");
assert(!readerSurface.includes("fonts.gstatic.com"), "Reader still depends on a remote font host");
assert(homepageHtml.includes('<meta name="theme-color" content="#0B0B0D" />'), "Homepage theme color is not canonical");
assert(storyHtml.includes('<meta name="theme-color" content="#0B0B0D" />'), "Story theme color is not canonical");
assert(homepageHtml.includes("Public Edition"), "Public Edition identity regressed");
assert(homepageHtml.includes("Prototype archive"), "Prototype archive identity regressed");
assert(homepageHtml.includes('data-view="Samples"'), "Prototype archive filter regressed");
const publicStories = JSON.parse(feedText);
assert(
  publicStories.filter((story) => story.content_type === "reporting").length === 6,
  "Homepage feed does not contain exactly six reporting stories",
);
assert(
  publicStories.filter((story) => story.content_type === "sample").length === 6,
  "Homepage feed does not contain exactly six Prototype samples",
);
assert(
  appScript.includes('if (activeView === "Samples") return story.content_type === "sample";') &&
    appScript.includes('if (activeView === "Reporting") return story.content_type === "reporting";'),
  "Reporting and Prototype filter isolation regressed",
);
assert(appScript.includes("Severity ${severity}/5"), "Homepage severity has no visible numeric value");
assert(storyHtml.includes('class="severity-value"'), "Story severity has no visible numeric value");
const severityStyles = styles.match(/\.severity \{[\s\S]*?(?=\.story-masthead)/u)?.[0];
assert(severityStyles, "Reader severity styles are missing");
assert(!severityStyles.includes("--sbns-signal-red"), "Signal Red incorrectly encodes reader severity");
assert(styles.includes("@media (forced-colors: active)"), "Forced-colors support is missing");
assert(styles.includes("@media print"), "Print styling is missing");

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
  "Public reader tests passed: canonical brand assets, local fonts, neutral visible severity, accessibility media, routing, health, and homepage pass-through.",
);
