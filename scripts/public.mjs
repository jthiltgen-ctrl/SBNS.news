import { readFile } from "node:fs/promises";
import worker from "../src/index.js";
import { refreshStoryFeed, storyMatchesView } from "../public/reader-state.js";
import { validateStoryEvidence } from "./evidence.mjs";

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
  faaSourceText,
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
    readFile(new URL("../content/stories/2026-09-20-faa-bnatcs-gao-review.json", import.meta.url), "utf8"),
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
assert(
  homepageHtml.includes("Accountability should apply to the publication itself, too."),
  "Publication-accountability introduction is missing from the About surface",
);
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
const faaStory = publicStories.find((story) => story.id === knownId);
const faaSourceStory = JSON.parse(faaSourceText);
assert(
  publicStories.filter((story) => Object.hasOwn(story, "visuals")).every((story) => story.id === knownId) &&
    publicStories.filter((story) => Object.hasOwn(story, "visuals")).length === 1,
  "Evidence components were published on a story outside the bounded FAA pilot",
);
assert(faaStory?.visuals?.length === 2 && faaStory.visuals.length <= 3, "FAA pilot does not contain exactly two bounded components");
assert(validateStoryEvidence(faaSourceStory).length === 0, "FAA pilot evidence does not validate");
assert(
  faaStory.visuals.map((visual) => visual.type).join(",") === "receipt,number",
  "FAA pilot component order or approved types changed",
);
assert(
  faaStory.visuals.every((visual) => visual.source_id === "gao-report") &&
    faaSourceStory.sources.some((source) => source.id === "gao-report"),
  "FAA pilot evidence does not resolve to its approved story-local GAO source",
);
const { visuals: ignoredFaaVisuals, ...faaFactsWithSourceIds } = faaSourceStory;
const faaFacts = {
  ...faaFactsWithSourceIds,
  sources: faaFactsWithSourceIds.sources.map(({ id: ignoredSourceId, ...source }) => source),
};
const expectedFaaFacts = {
  id: "faa-bnatcs-gao-cost-schedule-review",
  status: "published",
  content_type: "reporting",
  category: "National",
  headline: "GAO Says FAA’s Air-Traffic Overhaul Lacks the Cost and Schedule Controls It Needs",
  summary: "The Government Accountability Office says the FAA has made progress on its accelerated Brand New Air Traffic Control System, but the agency still lacks a reliable lifecycle cost estimate and a detailed integrated master schedule while implementation is already underway across nine of 13 phase-one programs. GAO found FAA’s $10.6 billion phase-one systems-modernization estimate omits government costs, most post-implementation operations and maintenance, and all phase-two costs, while 11,389 individual project schedules had not been integrated as of May 2026. The Transportation Department partially concurred with GAO’s recommendations, while FAA Administrator Bryan Bedford says the agency is meeting or exceeding its accelerated transformation schedule and cites substantial deployment progress.",
  fml_kicker: "Nothing says integrated modernization like 11,389 schedules waiting to meet each other.",
  severity: 4,
  topic_tags: ["FAA", "air traffic control", "modernization", "GAO", "infrastructure", "oversight"],
  sources: [
    {
      name: "U.S. Government Accountability Office — Air Traffic Control Systems: Ambitious New Modernization Effort Needs to Improve Cost and Schedule Planning",
      url: "https://www.gao.gov/products/gao-26-107992",
    },
    {
      name: "Federal Aviation Administration — Bryan Bedford FY2027 budget testimony",
      url: "https://www.faa.gov/testimony/testimony-bryan-bedford-faa-administrator-hearing-committee-appropriations-subcommittee",
    },
    {
      name: "Reuters — FAA says billions more needed to modernize air traffic control",
      url: "https://www.reuters.com/business/us-faa-says-billions-more-needed-modernize-air-traffic-control-2026-09-15/",
    },
  ],
  published_at: "2026-09-20T12:43:42Z",
};
assert(
  JSON.stringify(faaFacts) === JSON.stringify(expectedFaaFacts),
  "FAA facts outside the approved evidence components and source ID changed",
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
    homepageHtml.includes('id="transparency"'),
  "Transparency surface is not reachable or complete",
);
const transparencyTitles = [
  "Publication identity",
  "Editor &amp; publisher",
  "Ownership",
  "Funding",
  "Method &amp; provenance",
  "Corrections &amp; updates",
  "AI-assisted work",
  "Conflicts &amp; disclosures",
  "Contact",
];
for (const title of transparencyTitles) {
  assert(homepageHtml.includes(`<h3>${title}</h3>`), `Transparency category is missing: ${title}`);
}
for (const phrase of [
  "independent publication edited and published by Justin Thiltgen",
  "A formal public funding model has not yet been established",
  "Relevant relationships belong in the record, too.",
  "Ordinary email should not be treated as an anonymous or secure-source system",
]) {
  assert(homepageHtml.includes(phrase), `Revised transparency copy is missing: ${phrase}`);
}
assert(
  homepageHtml.includes('href="mailto:editor@shockedbutnotsurprised.news"') &&
    (homepageHtml.match(/mailto:/g) || []).length === 1,
  "Public editorial email is missing or duplicated",
);
assert(!homepageHtml.includes('href="tel:'), "A private telephone contact was exposed");
for (const obsoletePlaceholder of [
  "belongs here rather than in a guess",
  "reserved for that disclosure when it is established",
  "No standing public conflict disclosure is currently established",
  "A public editorial contact channel has not yet been designated",
]) {
  assert(!homepageHtml.includes(obsoletePlaceholder), `Obsolete transparency placeholder remains: ${obsoletePlaceholder}`);
}
assert(appScript.includes("Severity ${severity}/5"), "Homepage severity has no visible numeric value");
assert(storyHtml.includes('class="severity-value"'), "Story severity has no visible numeric value");
assert(
  storyHtml.includes('class="story-evidence"') &&
    (storyHtml.match(/class="evidence-component /g) || []).length === 2,
  "FAA page does not contain exactly the two approved evidence components",
);
assert(
  storyHtml.indexOf('id="receipt-unintegrated-project-schedules"') <
    storyHtml.indexOf('id="number-phase-one-estimate"'),
  "FAA evidence components do not follow story-data order",
);
assert(
  storyHtml.includes('class="evidence-component evidence-receipt"') &&
    storyHtml.includes('class="evidence-component evidence-number"') &&
    !storyHtml.includes('class="evidence-component evidence-timeline"') &&
    !storyHtml.includes("<blockquote>"),
  "FAA Receipt, Number, or omitted Timeline semantics regressed",
);
for (const evidenceText of [
  "GAO-26-107992, pp. 30–31",
  "The scheduling risk does not establish that any specific disruption will occur.",
  "$10.6B",
  "billion U.S. dollars",
  "excludes facilities construction",
  "GAO-26-107992, pp. 20, 28",
  "all phase-two costs",
]) {
  assert(storyHtml.includes(evidenceText), `FAA evidence lost required context: ${evidenceText}`);
}
assert(
  (storyHtml.match(/href="https:\/\/www\.gao\.gov\/products\/gao-26-107992"/g) || []).length >= 3,
  "FAA evidence provenance does not link to the approved GAO source",
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
  "Public reader tests passed: FAA Receipt/Number pilot, source-linked qualifications, nine-part transparency copy, initial-HTML reporting, progressive refresh preservation, Prototype isolation, accountability, canonical identity, accessibility media, routing, health, and homepage pass-through.",
);
