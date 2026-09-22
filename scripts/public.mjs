import { readFile } from "node:fs/promises";
import worker from "../src/index.js";
import { refreshStoryFeed, storyMatchesView } from "../public/reader-state.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

const knownId = "faa-bnatcs-gao-cost-schedule-review";
const canonicalPath = `/story/${knownId}`;

const [
  homepageHtml,
  styles,
  appScript,
  storyHtml,
  feedText,
  sourceDisplayFont,
  publicDisplayFont,
  sourceUtilityFont,
  publicUtilityFont,
  sourceMark,
  publicMark,
  favicon,
] =
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
    readFile(new URL("../assets/brand/sbns-mark.svg", import.meta.url)),
    readFile(new URL("../public/brand/sbns-mark.svg", import.meta.url)),
    readFile(new URL("../public/favicon.svg", import.meta.url)),
  ]);

for (const color of ["#0b0b0d", "#4b4f56", "#9aa0a6", "#f8f7f4", "#c8102e", "#d9d9d6"]) {
  assert(styles.includes(color), `Canonical brand color ${color} is missing from the public stylesheet`);
}
assert(styles.includes('font-family: "EB Garamond"'), "Local EB Garamond font face is missing");
assert(styles.includes('font-family: "Inter"'), "Local Inter font face is missing");
assert(sourceDisplayFont.equals(publicDisplayFont), "Public EB Garamond does not match the canonical committed font");
assert(sourceUtilityFont.equals(publicUtilityFont), "Public Inter does not match the canonical committed font");
assert(sourceMark.equals(publicMark), "Public masthead mark does not match the canonical committed mark");
assert(sourceMark.equals(favicon), "Favicon does not match the canonical committed mark");

const readerSurface = `${homepageHtml}\n${styles}\n${storyHtml}`;
for (const obsoleteFont of ["Bebas Neue", "Barlow Condensed", "Special Elite", '"Lora"']) {
  assert(!readerSurface.includes(obsoleteFont), `Obsolete reader font remains: ${obsoleteFont}`);
}
assert(!readerSurface.includes("fonts.googleapis.com"), "Reader still depends on Google Fonts");
assert(!readerSurface.includes("fonts.gstatic.com"), "Reader still depends on a remote font host");
assert(homepageHtml.includes('<meta name="theme-color" content="#0B0B0D" />'), "Homepage theme color is not canonical");
assert(storyHtml.includes('<meta name="theme-color" content="#0B0B0D" />'), "Story theme color is not canonical");
for (const html of [homepageHtml, storyHtml]) {
  assert(html.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />'), "Canonical favicon is missing");
  assert(html.includes('src="/brand/sbns-mark.svg"'), "Canonical reader mark is missing");
  assert(html.includes("Shocked But Not Surprised") && html.includes(".news"), "Canonical reader wordmark is missing");
  assert(html.includes("Independent Accountability Reporting"), "Formal publication descriptor is missing");
}
assert(homepageHtml.includes("Observe. Verify. Explain."), "Process signature is missing from the method surface");
assert(homepageHtml.includes("Same Questions. A More Accountable Tomorrow."), "Brand promise is missing from the About surface");
assert(
  homepageHtml.includes("The institutional failure desk · Est. 2026"),
  "Desk language is not subordinate in the dateline",
);
assert(homepageHtml.includes("Public Edition"), "Public Edition identity regressed");
assert(homepageHtml.includes("Prototype archive"), "Prototype archive identity regressed");
assert(homepageHtml.includes('data-view="Samples"'), "Prototype archive filter regressed");
const publicStories = JSON.parse(feedText);
const reportingStories = publicStories.filter((story) => story.content_type === "reporting");
const sampleStories = publicStories.filter((story) => story.content_type === "sample");
assert(
  publicStories.every((story) => !Object.hasOwn(story, "visuals")),
  "The current public feed changed even though no real story has approved visuals",
);
assert(
  reportingStories.length === 6,
  "Homepage feed does not contain exactly six reporting stories",
);
assert(
  sampleStories.length === 6,
  "Homepage feed does not contain exactly six Prototype samples",
);
assert(
  sampleStories.every((story) => storyMatchesView(story, "Samples")) &&
    reportingStories.every((story) => storyMatchesView(story, "Reporting")) &&
    sampleStories.every((story) => !storyMatchesView(story, "Reporting")),
  "Reporting and Prototype filter isolation regressed",
);
assert(
  (homepageHtml.match(/class="story-card"/g) || []).length === reportingStories.length,
  "Homepage initial HTML does not contain one card per published reporting story",
);
assert(
  !homepageHtml.includes('data-content-type="sample"'),
  "Prototype material entered the homepage initial reporting HTML",
);
for (const story of reportingStories) {
  assert(
    homepageHtml.includes(`data-story-id="${story.id}"`) &&
      homepageHtml.includes(`href="/story/${story.id}"`),
    `Homepage initial HTML is missing ${story.id} or its permanent link`,
  );
}
assert(
  homepageHtml.includes('id="status"') && homepageHtml.includes('role="status"') &&
    homepageHtml.includes("hidden"),
  "Homepage status does not begin non-destructively hidden",
);
assert(!homepageHtml.includes("Loading the latest failures"), "Loading copy replaced initial reporting");
assert(
  appScript.includes("Refresh failed. The reporting already on the page stays put."),
  "Refresh failure does not communicate preserved reporting",
);
let committedAfterFailure = false;
let reportedFailure = false;
const refreshSucceeded = await refreshStoryFeed({
  fetchImplementation: async () => {
    throw new Error("synthetic refresh failure");
  },
  url: "/stories.json",
  minimumStories: 1,
  onSuccess() {
    committedAfterFailure = true;
  },
  onFailure() {
    reportedFailure = true;
  },
});
assert(!refreshSucceeded, "Synthetic refresh failure was reported as successful");
assert(!committedAfterFailure, "Refresh failure committed destructive replacement content");
assert(reportedFailure, "Refresh failure did not reach the non-destructive failure path");
let committedInvalidFeed = false;
const invalidFeedSucceeded = await refreshStoryFeed({
  fetchImplementation: async () => ({
    ok: true,
    async json() {
      return sampleStories;
    },
  }),
  url: "/stories.json",
  minimumStories: 1,
  validateStories: (stories) => stories.some((story) => story.content_type === "reporting"),
  onSuccess() {
    committedInvalidFeed = true;
  },
  onFailure() {},
});
assert(!invalidFeedSucceeded, "A feed missing published reporting was accepted");
assert(!committedInvalidFeed, "A feed missing reporting erased the valid rendered publication");
assert(
  homepageHtml.includes("Edited &amp; published by") && homepageHtml.includes("Justin Thiltgen"),
  "Homepage human editorial accountability is missing",
);
assert(
  homepageHtml.includes('href="#transparency"') &&
    homepageHtml.includes('id="transparency"') &&
    homepageHtml.includes("AI-assisted work"),
  "Transparency surface is not reachable or complete",
);
assert(appScript.includes("Severity ${severity}/5"), "Homepage severity has no visible numeric value");
assert(storyHtml.includes('class="severity-value"'), "Story severity has no visible numeric value");
assert(
  !storyHtml.includes('class="story-evidence"'),
  "A current story gained empty or unapproved evidence-component markup",
);
assert(storyHtml.includes('aria-label="SBNS Kicker"'), "Story kicker lacks the approved public label");
assert(storyHtml.includes("<span>SBNS Kicker</span>"), "Story kicker visible label is incorrect");
assert(!storyHtml.includes('aria-label="FML kicker"') && !storyHtml.includes("<span>FML</span>"), "Reader-visible FML label remains");
assert(
  storyHtml.includes('class="story-byline"') && storyHtml.includes("By <a") &&
    storyHtml.includes("Justin Thiltgen"),
  "Story page human attribution is missing",
);
const storyJsonLd = JSON.parse(
  storyHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)?.[1] || "null",
);
assert(
  storyJsonLd?.author?.["@type"] === "Person" && storyJsonLd.author.name === "Justin Thiltgen",
  "Story NewsArticle metadata is missing factual human attribution",
);
const inactiveSeverityStyles = styles.match(/\.severity-dot \{[\s\S]*?\}/u)?.[0];
const activeSeverityStyles = styles.match(/\.severity-dot\.active \{[\s\S]*?\}/u)?.[0];
assert(inactiveSeverityStyles?.includes("--sbns-rule-gray"), "Unfilled severity dots are not neutral");
assert(activeSeverityStyles?.includes("--sbns-signal-red"), "Filled severity dots do not use Signal Red");
const shareButtonStyles = styles.match(/\.share-buttons button \{[\s\S]*?\}/u)?.[0];
assert(shareButtonStyles?.includes("--sbns-signal-red"), "Story Share and Copy Link controls do not use Signal Red");
const baseButtonStyles = [...styles.matchAll(/^button \{[\s\S]*?\}/gmu)].map((match) => match[0]);
assert(
  baseButtonStyles.some((rule) => rule.includes("--sbns-ink-black")),
  "Signal Red leaked into unrelated primary controls",
);
assert(
  contrastRatio("#c8102e", "#f8f7f4") >= 4.5,
  "Signal Red share controls do not meet WCAG AA text contrast",
);
assert(
  (storyHtml.match(/class="severity-dot active"/g) || []).length === 4 &&
    (storyHtml.match(/class="severity-dot"/g) || []).length === 1,
  "FAA severity dots do not match the visible 4/5 value",
);
assert(styles.includes("@media (forced-colors: active)"), "Forced-colors support is missing");
assert(styles.includes("@media print"), "Print styling is missing");
for (const evidenceStyle of [
  ".story-evidence",
  ".evidence-component",
  ".evidence-timeline-list",
  ".evidence-qualification",
]) {
  assert(styles.includes(evidenceStyle), `Evidence presentation style is missing: ${evidenceStyle}`);
}

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
  "Public reader tests passed: initial-HTML reporting, progressive refresh preservation, Prototype isolation, accountability, canonical mark/wordmark/site identity, local fonts, labeled kickers, Signal Red actions and filled severity, accessibility media, routing, health, and homepage pass-through.",
);
