import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND_COLORS,
  BRAND_TYPOGRAPHY,
  CARD_HEIGHT,
  CARD_WIDTH,
  canonicalShareCardUrl,
  generateShareCard,
  layoutHeadline,
  shareCardAlt,
  validatePng,
} from "./share-card.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = resolve(process.env.SBNS_CONTENT_DIR || join(ROOT, "content", "stories"));
const OUTPUT_FILE = resolve(process.env.SBNS_OUTPUT_FILE || join(ROOT, "public", "stories.json"));
const PUBLIC_DIR = resolve(process.env.SBNS_PUBLIC_DIR || dirname(OUTPUT_FILE));
const HOMEPAGE_FILE = resolve(process.env.SBNS_HOMEPAGE_FILE || join(PUBLIC_DIR, "index.html"));
const STORY_OUTPUT_DIR = resolve(process.env.SBNS_STORY_OUTPUT_DIR || join(PUBLIC_DIR, "story"));
const SHARE_OUTPUT_DIR = resolve(process.env.SBNS_SHARE_OUTPUT_DIR || join(PUBLIC_DIR, "share"));
const SITEMAP_FILE = resolve(process.env.SBNS_SITEMAP_FILE || join(PUBLIC_DIR, "sitemap.xml"));
const STORY_IDS_FILE = resolve(
  process.env.SBNS_STORY_IDS_FILE || join(ROOT, "src", "generated-story-ids.js"),
);
const SITE_ORIGIN = "https://shockedbutnotsurprised.news";
const PUBLICATION_NAME = "Shocked But Not Surprised";
const PUBLICATION_WORDMARK = "Shocked But Not Surprised.news";
const EDITOR_NAME = "Justin Thiltgen";
const HOMEPAGE_REPORTING_START = "<!-- SBNS_GENERATED_REPORTING_START -->";
const HOMEPAGE_REPORTING_END = "<!-- SBNS_GENERATED_REPORTING_END -->";
const COMMANDS = new Set(["build", "check", "test"]);
const REQUIRED_FIELDS = [
  "id",
  "status",
  "content_type",
  "category",
  "headline",
  "summary",
  "fml_kicker",
  "severity",
  "topic_tags",
  "sources",
  "published_at",
];
const STATUSES = new Set(["draft", "published"]);
const CONTENT_TYPES = new Set(["sample", "reporting"]);
const CATEGORIES = new Set(["International", "National", "Local"]);
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidHttpUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidTimestamp(value) {
  return (
    isNonEmptyString(value) &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validateStory(story, filename) {
  const errors = [];
  const issue = (message) => errors.push(`${filename}: ${message}`);

  if (!story || typeof story !== "object" || Array.isArray(story)) {
    return [`${filename}: story must be a JSON object`];
  }

  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(story, field)) issue(`missing required field "${field}"`);
  }

  if (!isNonEmptyString(story.id) || !ID_PATTERN.test(story.id)) {
    issue('"id" must be a non-empty lowercase slug');
  }
  if (!STATUSES.has(story.status)) issue('"status" must be "draft" or "published"');
  if (!CONTENT_TYPES.has(story.content_type)) {
    issue('"content_type" must be "sample" or "reporting"');
  }
  if (!CATEGORIES.has(story.category)) {
    issue('"category" must be International, National, or Local');
  }

  for (const field of ["headline", "summary", "fml_kicker"]) {
    if (!isNonEmptyString(story[field])) issue(`"${field}" must be a non-empty string`);
  }

  if (!Number.isInteger(story.severity) || story.severity < 1 || story.severity > 5) {
    issue('"severity" must be an integer from 1 through 5');
  }

  if (!Array.isArray(story.topic_tags)) {
    issue('"topic_tags" must be an array of strings');
  } else if (story.topic_tags.some((tag) => !isNonEmptyString(tag))) {
    issue('"topic_tags" entries must be non-empty strings');
  }

  if (!Array.isArray(story.sources)) {
    issue('"sources" must be an array');
  } else {
    story.sources.forEach((source, index) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        issue(`"sources[${index}]" must be an object with name and url`);
        return;
      }
      if (!isNonEmptyString(source.name)) {
        issue(`"sources[${index}].name" must be a non-empty string`);
      }
      if (!Object.hasOwn(source, "url")) {
        issue(`"sources[${index}]" is missing required field "url"`);
      } else if (source.url !== null && source.url !== "" && !isValidHttpUrl(source.url)) {
        issue(`"sources[${index}].url" must be null, empty, or a valid http:// or https:// URL`);
      }
    });
  }

  if (story.published_at !== null && !isValidTimestamp(story.published_at)) {
    issue('"published_at" must be null or a valid ISO-8601 timestamp');
  }
  if (story.status === "published" && !isValidTimestamp(story.published_at)) {
    issue('published stories require a valid "published_at" timestamp');
  }

  if (story.status === "published" && story.content_type === "reporting") {
    if (!Array.isArray(story.sources) || story.sources.length === 0) {
      issue("published reporting stories require at least one source");
    } else if (!story.sources.some((source) => source && isValidHttpUrl(source.url))) {
      issue("published reporting stories require at least one valid http:// or https:// source URL");
    }
  }

  return errors;
}

function normalizedStory(story) {
  return {
    id: story.id,
    status: story.status,
    content_type: story.content_type,
    category: story.category,
    headline: story.headline,
    summary: story.summary,
    fml_kicker: story.fml_kicker,
    severity: story.severity,
    topic_tags: story.topic_tags,
    sources: story.sources.map(({ name, url }) => ({ name, url })),
    published_at: story.published_at,
  };
}

function publishedStories(stories) {
  return stories
    .filter(({ story }) => story.status === "published")
    .map(({ story }) => normalizedStory(story))
    .sort((a, b) => {
      const newestFirst = b.published_at.localeCompare(a.published_at);
      return newestFirst || a.id.localeCompare(b.id);
    });
}

function generateFeed(stories) {
  return `${JSON.stringify(publishedStories(stories), null, 2)}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonForHtml(value) {
  return JSON.stringify(value, null, 2)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function canonicalStoryUrl(storyId) {
  return `${SITE_ORIGIN}/story/${storyId}`;
}

function publishedDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function homepagePublishedDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function renderSeverity(severity, indentation = "") {
  const dots = Array.from(
    { length: 5 },
    (_, index) =>
      `${indentation}  <span class="severity-dot${index < severity ? " active" : ""}" aria-hidden="true"></span>`,
  ).join("\n");
  return `${indentation}<span class="severity" aria-label="Severity ${severity} out of 5">
${indentation}  <span class="severity-value" aria-hidden="true">Severity ${severity}/5</span>
${dots}
${indentation}</span>`;
}

function renderHomepageCard(story) {
  const isSample = story.content_type === "sample";
  const headline = isSample
    ? escapeHtml(story.headline)
    : `<a href="/story/${escapeHtml(story.id)}">${escapeHtml(story.headline)}</a>`;
  const sampleLabel = isSample
    ? '        <p class="fictional-label">Fictional prototype sample — not real news</p>\n'
    : "";
  const sourceLabel = isSample ? "Fictional sample source" : "Primary sources";
  const sources = story.sources
    .map((source) => {
      const name = escapeHtml(source.name);
      return isValidHttpUrl(source.url)
        ? `          <a class="source-name" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${name}</a>`
        : `          <span class="source-name">${name}</span>`;
    })
    .join("\n");
  const tags = story.topic_tags
    .map((tag) => `          <span class="tag">${escapeHtml(tag)}</span>`)
    .join("\n");

  return `      <article
        class="story-card"
        data-story-id="${escapeHtml(story.id)}"
        data-content-type="${escapeHtml(story.content_type)}"
        data-category="${escapeHtml(story.category)}"
      >
        <div class="story-body">
${sampleLabel}          <div class="story-meta">
            <span>${escapeHtml(story.category)} · <time datetime="${escapeHtml(story.published_at)}">${escapeHtml(homepagePublishedDate(story.published_at))}</time></span>
${renderSeverity(story.severity, "            ")}
          </div>
          <h3>${headline}</h3>
          <p class="summary">${escapeHtml(story.summary)}</p>
          <div class="source-area">
            <span class="source-label">${sourceLabel}</span>
${sources}
          </div>
          <div class="tags">
${tags}
          </div>
        </div>
        <p class="kicker">${escapeHtml(story.fml_kicker)}</p>
      </article>`;
}

function generateHomepage(homepage, reporting) {
  const start = homepage.indexOf(HOMEPAGE_REPORTING_START);
  const end = homepage.indexOf(HOMEPAGE_REPORTING_END);
  if (
    start === -1 ||
    end === -1 ||
    end < start ||
    homepage.indexOf(HOMEPAGE_REPORTING_START, start + 1) !== -1 ||
    homepage.indexOf(HOMEPAGE_REPORTING_END, end + 1) !== -1
  ) {
    throw new Error("Homepage must contain exactly one ordered generated-reporting marker pair");
  }

  const cards = reporting.map(renderHomepageCard).join("\n");
  const before = homepage.slice(0, start + HOMEPAGE_REPORTING_START.length);
  const after = homepage.slice(end);
  return `${before}\n${cards}\n      ${after}`;
}

function relatedStories(story, reportingStories, limit = 3) {
  const storyTags = new Set(story.topic_tags.map((tag) => tag.toLocaleLowerCase("en-US")));
  return reportingStories
    .filter((candidate) => candidate.id !== story.id)
    .map((candidate) => ({
      story: candidate,
      tagOverlap: candidate.topic_tags.filter((tag) =>
        storyTags.has(tag.toLocaleLowerCase("en-US")),
      ).length,
      categoryMatch: candidate.category === story.category ? 1 : 0,
    }))
    .sort((a, b) =>
      b.tagOverlap - a.tagOverlap ||
      b.categoryMatch - a.categoryMatch ||
      Date.parse(b.story.published_at) - Date.parse(a.story.published_at) ||
      a.story.id.localeCompare(b.story.id),
    )
    .slice(0, limit)
    .map(({ story: candidate }) => candidate);
}

function renderSources(story) {
  return story.sources
    .map((source) => {
      const name = escapeHtml(source.name);
      const sourceContent = isValidHttpUrl(source.url)
        ? `<a href="${escapeHtml(source.url)}" rel="noopener noreferrer">${name}</a>`
        : `<span>${name}</span>`;
      return `          <li>${sourceContent}</li>`;
    })
    .join("\n");
}

function renderTags(story) {
  return story.topic_tags
    .map((tag) => `          <li>${escapeHtml(tag)}</li>`)
    .join("\n");
}

function renderRelated(story, reporting) {
  const related = relatedStories(story, reporting);
  if (related.length === 0) {
    return '        <p class="related-empty">No other reporting is published yet.</p>';
  }
  return related
    .map(
      (candidate) => `        <article class="related-story">
          <p>${escapeHtml(candidate.category)} · <time datetime="${escapeHtml(candidate.published_at)}">${escapeHtml(publishedDate(candidate.published_at))}</time></p>
          <h3><a href="/story/${candidate.id}">${escapeHtml(candidate.headline)}</a></h3>
        </article>`,
    )
    .join("\n");
}

function generateStoryPage(story, reporting) {
  const canonicalUrl = canonicalStoryUrl(story.id);
  const imageUrl = canonicalShareCardUrl(story.id);
  const imageAlt = shareCardAlt(story);
  const escapedHeadline = escapeHtml(story.headline);
  const escapedSummary = escapeHtml(story.summary);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    url: canonicalUrl,
    image: imageUrl,
    headline: story.headline,
    description: story.summary,
    datePublished: story.published_at,
    articleSection: story.category,
    keywords: story.topic_tags,
    author: {
      "@type": "Person",
      name: EDITOR_NAME,
    },
    publisher: {
      "@type": "Organization",
      name: PUBLICATION_NAME,
      url: `${SITE_ORIGIN}/`,
    },
  };
  const articleTags = story.topic_tags
    .map((tag) => `    <meta property="article:tag" content="${escapeHtml(tag)}" />`)
    .join("\n");
  const severityDots = Array.from(
    { length: 5 },
    (_, index) => `              <span class="severity-dot${index < story.severity ? " active" : ""}" aria-hidden="true"></span>`,
  ).join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${escapedSummary}" />
    <meta name="theme-color" content="#0B0B0D" />
    <title>${escapedHeadline} | ${PUBLICATION_WORDMARK}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="${PUBLICATION_NAME}" />
    <meta property="og:title" content="${escapedHeadline}" />
    <meta property="og:description" content="${escapedSummary}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="${CARD_WIDTH}" />
    <meta property="og:image:height" content="${CARD_HEIGHT}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta property="article:published_time" content="${escapeHtml(story.published_at)}" />
    <meta property="article:section" content="${escapeHtml(story.category)}" />
    <meta property="article:author" content="${EDITOR_NAME}" />
${articleTags}
    <script type="application/ld+json">
${jsonForHtml(jsonLd)}
    </script>
    <link rel="stylesheet" href="/styles.css" />
    <script src="/story.js" type="module"></script>
  </head>
  <body class="story-page">
    <header class="masthead story-masthead">
      <div class="dateline">
        <span>Public Edition</span>
        <span>The institutional failure desk · Est. 2026</span>
      </div>
      <div class="nameplate">
        <a
          class="brand-lockup"
          href="/"
          aria-label="${PUBLICATION_WORDMARK} — Independent Accountability Reporting"
        >
          <img class="brand-mark" src="/brand/sbns-mark.svg" alt="" width="192" height="192" />
          <span class="brand-lockup-copy">
            <span class="brand-wordmark">${PUBLICATION_NAME}<span class="brand-tld">.news</span></span>
            <span class="brand-descriptor">Independent Accountability Reporting</span>
          </span>
        </a>
        <p class="tagline">Another day. Another system that had one job.</p>
      </div>
    </header>

    <main class="story-page-main">
      <nav class="story-return" aria-label="Story navigation">
        <a href="/#reports">← Return to latest reports</a>
      </nav>

      <article class="story-article">
        <header>
          <div class="story-article-meta">
            <span>${escapeHtml(story.category)}</span>
            <time datetime="${escapeHtml(story.published_at)}">${escapeHtml(publishedDate(story.published_at))}</time>
            <span class="severity" aria-label="Severity ${story.severity} out of 5">
              <span class="severity-value" aria-hidden="true">Severity ${story.severity}/5</span>
${severityDots}
            </span>
          </div>
          <h1>${escapedHeadline}</h1>
          <p class="story-byline">By <a href="/#transparency">${EDITOR_NAME}</a> · ${PUBLICATION_NAME}</p>
          <p class="story-deck">${escapedSummary}</p>
        </header>

        <section class="story-sources" aria-labelledby="sources-title">
          <h2 id="sources-title">Sources</h2>
          <ol>
${renderSources(story)}
          </ol>
        </section>

        <section class="story-topics" aria-labelledby="topics-title">
          <h2 id="topics-title">Topics</h2>
          <ul>
${renderTags(story)}
          </ul>
        </section>

        <aside class="story-kicker" aria-label="SBNS Kicker">
          <span>SBNS Kicker</span>
          <p>${escapeHtml(story.fml_kicker)}</p>
        </aside>

        <section
          class="share-controls"
          aria-labelledby="share-title"
          data-share-controls
          data-share-title="${escapedHeadline}"
          data-share-url="${canonicalUrl}"
        >
          <h2 id="share-title">Share this report</h2>
          <div class="share-buttons">
            <button type="button" data-native-share hidden>Share</button>
            <button type="button" data-copy-link>Copy Link</button>
          </div>
          <label class="share-url-label">
            Permanent link
            <input type="text" readonly value="${canonicalUrl}" data-share-url-field />
          </label>
          <p class="share-status" role="status" aria-live="polite" data-share-status></p>
        </section>
      </article>

      <section class="related-stories" aria-labelledby="related-title">
        <p class="section-label">Keep reading</p>
        <h2 id="related-title">You may also be unsurprised by…</h2>
        <div class="related-grid">
${renderRelated(story, reporting)}
        </div>
      </section>

      <nav class="story-return story-return-bottom" aria-label="Return navigation">
        <a href="/#reports">← Return to latest reports</a>
      </nav>
    </main>

    <footer>
      <p>We punch up at power, never down at the people living with the consequences.</p>
      <nav aria-label="Footer navigation">
        <a href="/#reports">Reports</a>
        <a href="/#method">Method</a>
        <a href="/#standards">Standards</a>
        <a href="/#transparency">About &amp; transparency</a>
      </nav>
    </footer>
  </body>
</html>
`;
}

function generateSitemap(reporting) {
  const storyEntries = reporting
    .map(
      (story) => `  <url>
    <loc>${canonicalStoryUrl(story.id)}</loc>
    <lastmod>${story.published_at.slice(0, 10)}</lastmod>
  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_ORIGIN}/</loc>
  </url>
${storyEntries}
</urlset>
`;
}

function generateStoryIds(reporting) {
  const ids = reporting.map((story) => `  ${JSON.stringify(story.id)},`).join("\n");
  return `// Generated by scripts/content.mjs. Do not edit by hand.
export const REPORTING_STORY_IDS = Object.freeze([
${ids}
]);
`;
}

function generateArtifacts(stories, homepage) {
  const published = publishedStories(stories);
  const reporting = published.filter((story) => story.content_type === "reporting");
  const pages = new Map(
    reporting.map((story) => [`${story.id}.html`, generateStoryPage(story, reporting)]),
  );
  const cards = new Map(
    reporting.map((story) => [`${story.id}.png`, generateShareCard(story).png]),
  );
  return {
    feed: `${JSON.stringify(published, null, 2)}\n`,
    homepage: generateHomepage(homepage, reporting),
    pages,
    cards,
    sitemap: generateSitemap(reporting),
    storyIds: generateStoryIds(reporting),
    publishedCount: published.length,
    reportingCount: reporting.length,
  };
}

async function loadStories(contentDir = CONTENT_DIR) {
  let entries;
  try {
    entries = await readdir(contentDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Unable to read content directory ${contentDir}: ${error.message}`);
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  const stories = [];
  const errors = [];

  for (const filename of files) {
    const path = join(contentDir, filename);
    let story;
    try {
      story = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      errors.push(`${filename}: invalid JSON (${error.message})`);
      continue;
    }
    errors.push(...validateStory(story, filename));
    stories.push({ filename, story });
  }

  const ids = new Map();
  for (const { filename, story } of stories) {
    if (!isNonEmptyString(story.id)) continue;
    if (ids.has(story.id)) {
      errors.push(`${filename}: duplicate id "${story.id}" also used by ${ids.get(story.id)}`);
    } else {
      ids.set(story.id, filename);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Content validation failed:\n- ${errors.join("\n- ")}`);
  }
  return stories;
}

async function build() {
  const [stories, homepage] = await Promise.all([
    loadStories(),
    readFile(HOMEPAGE_FILE, "utf8"),
  ]);
  const artifacts = generateArtifacts(stories, homepage);
  await Promise.all([
    mkdir(dirname(OUTPUT_FILE), { recursive: true }),
    mkdir(dirname(SITEMAP_FILE), { recursive: true }),
    mkdir(dirname(STORY_IDS_FILE), { recursive: true }),
  ]);
  await Promise.all([
    rm(STORY_OUTPUT_DIR, { recursive: true, force: true }),
    rm(SHARE_OUTPUT_DIR, { recursive: true, force: true }),
  ]);
  await Promise.all([
    mkdir(STORY_OUTPUT_DIR, { recursive: true }),
    mkdir(SHARE_OUTPUT_DIR, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(OUTPUT_FILE, artifacts.feed, "utf8"),
    writeFile(HOMEPAGE_FILE, artifacts.homepage, "utf8"),
    writeFile(SITEMAP_FILE, artifacts.sitemap, "utf8"),
    writeFile(STORY_IDS_FILE, artifacts.storyIds, "utf8"),
    ...[...artifacts.pages].map(([filename, html]) =>
      writeFile(join(STORY_OUTPUT_DIR, filename), html, "utf8"),
    ),
    ...[...artifacts.cards].map(([filename, png]) =>
      writeFile(join(SHARE_OUTPUT_DIR, filename), png),
    ),
  ]);
  console.log(
    `Built ${artifacts.publishedCount} published stories, ${artifacts.reportingCount} canonical pages, ${artifacts.cards.size} share cards, and sitemap -> ${PUBLIC_DIR}`,
  );
}

async function assertFileMatches(path, expected, label) {
  let actual;
  try {
    actual = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read generated ${label} ${path}: ${error.message}`);
  }
  if (actual !== expected) {
    throw new Error(`Generated ${label} is out of date. Run: npm run content:build`);
  }
}

async function assertBinaryFileMatches(path, expected, label) {
  let actual;
  try {
    actual = await readFile(path);
  } catch (error) {
    throw new Error(`Unable to read generated ${label} ${path}: ${error.message}`);
  }
  if (!actual.equals(expected)) {
    throw new Error(`Generated ${label} is out of date. Run: npm run content:build`);
  }
}

async function generatedFiles(directory, label) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    throw new Error(`Unable to read generated ${label} ${directory}: ${error.message}`);
  }
}

async function check() {
  const [stories, homepage] = await Promise.all([
    loadStories(),
    readFile(HOMEPAGE_FILE, "utf8"),
  ]);
  const artifacts = generateArtifacts(stories, homepage);
  await Promise.all([
    assertFileMatches(OUTPUT_FILE, artifacts.feed, "feed"),
    assertFileMatches(HOMEPAGE_FILE, artifacts.homepage, "homepage reporting"),
    assertFileMatches(SITEMAP_FILE, artifacts.sitemap, "sitemap"),
    assertFileMatches(STORY_IDS_FILE, artifacts.storyIds, "story ID manifest"),
  ]);

  const actualPageFiles = await generatedFiles(STORY_OUTPUT_DIR, "story pages");
  const expectedPageFiles = [...artifacts.pages.keys()].sort();
  if (JSON.stringify(actualPageFiles) !== JSON.stringify(expectedPageFiles)) {
    throw new Error("Generated story page set is out of date. Run: npm run content:build");
  }
  await Promise.all(
    expectedPageFiles.map((filename) =>
      assertFileMatches(
        join(STORY_OUTPUT_DIR, filename),
        artifacts.pages.get(filename),
        `story page ${filename}`,
      ),
    ),
  );

  const actualCardFiles = await generatedFiles(SHARE_OUTPUT_DIR, "share cards");
  const expectedCardFiles = [...artifacts.cards.keys()].sort();
  if (JSON.stringify(actualCardFiles) !== JSON.stringify(expectedCardFiles)) {
    throw new Error("Generated share-card set is out of date. Run: npm run content:build");
  }
  await Promise.all(
    expectedCardFiles.map((filename) =>
      assertBinaryFileMatches(
        join(SHARE_OUTPUT_DIR, filename),
        artifacts.cards.get(filename),
        `share card ${filename}`,
      ),
    ),
  );
  console.log(
    `Content valid; feed, ${artifacts.reportingCount} reporting pages and share cards, sitemap, and routing manifest match deterministic output.`,
  );
}

function validFixture(overrides = {}) {
  return {
    id: "fixture-story",
    status: "published",
    content_type: "sample",
    category: "Local",
    headline: "Fixture headline",
    summary: "Fixture summary",
    fml_kicker: "Fixture kicker",
    severity: 3,
    topic_tags: ["fixture"],
    sources: [{ name: "Fixture source", url: null }],
    published_at: "2026-08-18T12:00:00Z",
    ...overrides,
  };
}

function reportingFixture(overrides = {}) {
  return validFixture({
    id: "reporting-fixture",
    content_type: "reporting",
    sources: [{ name: "Public record", url: "https://example.com/source" }],
    ...overrides,
  });
}

function expectInvalid(story, expectedMessage) {
  const errors = validateStory(story, "fixture.json");
  if (!errors.some((error) => error.includes(expectedMessage))) {
    throw new Error(`Expected validation failure containing "${expectedMessage}", got: ${errors.join("; ")}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test() {
  expectInvalid({ ...validFixture(), headline: undefined }, '"headline" must be a non-empty string');
  const missingRequired = validFixture();
  delete missingRequired.summary;
  expectInvalid(missingRequired, 'missing required field "summary"');
  expectInvalid(validFixture({ status: "review" }), '"status" must be "draft" or "published"');
  expectInvalid(validFixture({ content_type: "article" }), '"content_type" must be "sample" or "reporting"');
  expectInvalid(validFixture({ category: "Regional" }), '"category" must be International, National, or Local');
  expectInvalid(validFixture({ severity: 6 }), '"severity" must be an integer from 1 through 5');
  expectInvalid(validFixture({ topic_tags: "fixture" }), '"topic_tags" must be an array of strings');
  expectInvalid(validFixture({ sources: "Fixture source" }), '"sources" must be an array');
  expectInvalid(validFixture({ published_at: "next Tuesday" }), '"published_at" must be null or a valid ISO-8601 timestamp');
  expectInvalid(validFixture({ published_at: null }), 'published stories require a valid "published_at" timestamp');
  expectInvalid(
    validFixture({ content_type: "reporting", sources: [] }),
    "published reporting stories require at least one source",
  );
  expectInvalid(
    validFixture({ content_type: "reporting", sources: [{ name: "Source", url: null }] }),
    "at least one valid http:// or https:// source URL",
  );

  const duplicateStories = [
    { filename: "one.json", story: validFixture() },
    { filename: "two.json", story: validFixture() },
  ];
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "sbns-content-"));
  try {
    await writeFile(join(temporaryDirectory, "invalid.json"), "{ not valid JSON }\n", "utf8");
    let invalidJsonFailed = false;
    try {
      await loadStories(temporaryDirectory);
    } catch (error) {
      invalidJsonFailed = error.message.includes("invalid JSON");
    }
    if (!invalidJsonFailed) throw new Error("Invalid JSON fixture did not fail validation");
    await rm(join(temporaryDirectory, "invalid.json"));

    await Promise.all(
      duplicateStories.map(({ filename, story }) =>
        writeFile(join(temporaryDirectory, filename), `${JSON.stringify(story)}\n`, "utf8"),
      ),
    );
    let duplicateFailed = false;
    try {
      await loadStories(temporaryDirectory);
    } catch (error) {
      duplicateFailed = error.message.includes("duplicate id");
    }
    if (!duplicateFailed) throw new Error("Duplicate ID fixture did not fail validation");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const draft = reportingFixture({ id: "draft-fixture", status: "draft", published_at: null, sources: [] });
  const sample = validFixture({ id: "sample-fixture" });
  const unsafe = reportingFixture({
    id: "unsafe-fixture",
    headline: 'Unsafe </title><script>alert("headline")</script>',
    summary: 'Summary " onmouseover="alert(1)" & <img src=x onerror=alert(1)>',
    fml_kicker: "Kicker </p><script>alert(2)</script>",
    topic_tags: ["oversight", "<unsafe>"],
    sources: [{
      name: "Source </a><script>alert(3)</script>",
      url: "https://example.com/source?a=1&b=2",
    }],
    published_at: "2026-09-20T12:00:00Z",
  });
  const related = reportingFixture({
    id: "related-fixture",
    headline: "Related report",
    category: "National",
    topic_tags: ["oversight"],
    published_at: "2026-09-19T12:00:00Z",
  });
  const fixtureStories = [
    { filename: "draft.json", story: draft },
    { filename: "sample.json", story: sample },
    { filename: "unsafe.json", story: unsafe },
    { filename: "related.json", story: related },
  ];
  const homepageFixture = `<!doctype html>
<main>
      ${HOMEPAGE_REPORTING_START}
      <p>stale output</p>
      ${HOMEPAGE_REPORTING_END}
</main>
`;
  const artifacts = generateArtifacts(fixtureStories, homepageFixture);
  const reverseArtifacts = generateArtifacts(fixtureStories.toReversed(), homepageFixture);

  assert(artifacts.feed === generateFeed(fixtureStories), "Existing public feed generation changed");
  const parsedFeed = JSON.parse(artifacts.feed);
  assert(parsedFeed.length === 3, "Published stories were not preserved in the public feed");
  assert(!parsedFeed.some((story) => story.id === draft.id), "Draft fixture entered the public feed");
  assert(artifacts.pages.size === 2, "Did not generate exactly one page per published reporting story");
  assert(!artifacts.pages.has(`${draft.id}.html`), "Draft fixture received a generated story page");
  assert(!artifacts.pages.has(`${sample.id}.html`), "Prototype sample received a generated story page");
  assert(artifacts.cards.size === 2, "Did not generate exactly one card per published reporting story");
  assert(!artifacts.cards.has(`${draft.id}.png`), "Draft fixture received a generated share card");
  assert(!artifacts.cards.has(`${sample.id}.png`), "Prototype sample received a generated share card");
  assert(artifacts.sitemap.includes(`${SITE_ORIGIN}/`), "Sitemap is missing the homepage");
  assert(artifacts.sitemap.includes(canonicalStoryUrl(unsafe.id)), "Sitemap is missing a reporting page");
  assert(!artifacts.sitemap.includes(draft.id), "Draft fixture entered the sitemap");
  assert(!artifacts.sitemap.includes(sample.id), "Prototype sample entered the sitemap");
  assert((artifacts.sitemap.match(/<url>/g) || []).length === 3, "Sitemap entry count is incorrect");
  assert(artifacts.storyIds.includes(JSON.stringify(unsafe.id)), "Routing manifest is missing a reporting ID");
  assert(!artifacts.storyIds.includes(sample.id), "Prototype sample entered the routing manifest");
  assert(
    (artifacts.homepage.match(/class="story-card"/g) || []).length === 2,
    "Homepage did not contain exactly one initial card per published reporting story",
  );
  assert(
    artifacts.homepage.includes(`/story/${unsafe.id}`) && artifacts.homepage.includes(`/story/${related.id}`),
    "Homepage initial HTML is missing permanent reporting links",
  );
  assert(!artifacts.homepage.includes(sample.headline), "Prototype sample entered homepage initial HTML");
  assert(!artifacts.homepage.includes(draft.headline), "Draft entered homepage initial HTML");
  assert(artifacts.homepage.includes("&lt;/title&gt;"), "Homepage story text was not safely escaped");
  assert(!artifacts.homepage.includes('<script>alert("headline")'), "Homepage headline injected executable HTML");

  const page = artifacts.pages.get(`${unsafe.id}.html`);
  const canonicalUrl = canonicalStoryUrl(unsafe.id);
  const imageUrl = canonicalShareCardUrl(unsafe.id);
  const imageAlt = shareCardAlt(unsafe);
  assert(page.includes(`<link rel="canonical" href="${canonicalUrl}" />`), "Canonical link is incorrect");
  assert(page.includes(`<meta property="og:url" content="${canonicalUrl}" />`), "Open Graph URL is incorrect");
  assert(page.includes('<meta property="og:type" content="article" />'), "Open Graph article type is missing");
  assert(page.includes(`<meta property="og:image" content="${imageUrl}" />`), "Open Graph image URL is incorrect");
  assert(page.includes(`<meta property="og:image:width" content="${CARD_WIDTH}" />`), "Open Graph image width is incorrect");
  assert(page.includes(`<meta property="og:image:height" content="${CARD_HEIGHT}" />`), "Open Graph image height is incorrect");
  assert(page.includes('<meta property="og:image:type" content="image/png" />'), "Open Graph image type is incorrect");
  assert(page.includes(`<meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />`), "Open Graph image alt is missing or incorrect");
  assert(page.includes('<meta name="twitter:card" content="summary_large_image" />'), "Large-card metadata is missing");
  assert(page.includes(`<meta name="twitter:image" content="${imageUrl}" />`), "Twitter image URL is incorrect");
  assert(imageUrl.startsWith("https://shockedbutnotsurprised.news/share/"), "Share-card URL is not canonical HTTPS");
  for (const reportingStory of [unsafe, related]) {
    const reportingPage = artifacts.pages.get(`${reportingStory.id}.html`);
    const reportingImageUrl = canonicalShareCardUrl(reportingStory.id);
    const reportingImageAlt = shareCardAlt(reportingStory);
    assert(
      reportingPage.includes(`<meta property="og:image" content="${reportingImageUrl}" />`),
      `${reportingStory.id} is missing its Open Graph image`,
    );
    assert(
      reportingPage.includes(`<meta property="og:image:alt" content="${escapeHtml(reportingImageAlt)}" />`),
      `${reportingStory.id} is missing useful Open Graph image alt text`,
    );
    assert(
      reportingPage.includes('<meta name="twitter:card" content="summary_large_image" />'),
      `${reportingStory.id} is missing large-card metadata`,
    );
    const reportingJsonLdMatch = reportingPage.match(
      /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
    );
    assert(reportingJsonLdMatch, `${reportingStory.id} is missing NewsArticle JSON-LD`);
    assert(
      JSON.parse(reportingJsonLdMatch[1]).image === reportingImageUrl,
      `${reportingStory.id} has inconsistent NewsArticle image metadata`,
    );
  }
  assert(page.includes('property="article:published_time"'), "Article publication metadata is missing");
  assert(page.includes(PUBLICATION_NAME), "Publication name is missing from direct HTML");
  assert(page.includes(`<span>${unsafe.category}</span>`), "Category is missing from direct HTML");
  assert(page.includes("September 20, 2026"), "Publication date is missing from direct HTML");
  assert(page.includes(`Severity ${unsafe.severity} out of 5`), "Severity is missing from direct HTML");
  assert(
    page.includes(`>Severity ${unsafe.severity}/5</span>`),
    "Visible numeric severity is missing from direct HTML",
  );
  assert(
    (page.match(/class="severity-dot active"/g) || []).length === unsafe.severity &&
      (page.match(/class="severity-dot"/g) || []).length === 5 - unsafe.severity,
    "Severity dot count does not match the visible numeric severity",
  );
  assert(page.includes(escapeHtml(unsafe.headline)), "Headline is missing from direct HTML");
  assert(page.includes(escapeHtml(unsafe.summary)), "Summary is missing from direct HTML");
  assert(page.includes(escapeHtml(unsafe.sources[0].name)), "Complete source list is missing from direct HTML");
  assert(page.includes(escapeHtml(unsafe.topic_tags[1])), "Topic tags are missing from direct HTML");
  assert(page.includes(escapeHtml(unsafe.fml_kicker)), "Kicker prose is missing from direct HTML");
  assert(page.includes('aria-label="SBNS Kicker"'), "Approved kicker label is missing from direct HTML");
  assert(page.includes("<span>SBNS Kicker</span>"), "Visible kicker label is incorrect");
  assert(!page.includes('aria-label="FML kicker"') && !page.includes("<span>FML</span>"), "Legacy reader-visible kicker label remains");
  assert(page.includes('href="/favicon.svg"'), "Canonical favicon is missing from direct HTML");
  assert(page.includes('src="/brand/sbns-mark.svg"'), "Canonical masthead mark is missing from direct HTML");
  assert(page.includes(PUBLICATION_WORDMARK), "Canonical wordmark is missing from direct HTML");
  assert(page.includes("Independent Accountability Reporting"), "Formal descriptor is missing from direct HTML");
  assert(page.includes('href="/#reports"'), "Return navigation is missing from direct HTML");
  assert(page.includes("&lt;script&gt;alert"), "Untrusted story text was not HTML-escaped");
  assert(!page.includes('<script>alert("headline")'), "Headline injected executable HTML");
  assert(!page.includes("<img src=x"), "Summary injected executable HTML");
  assert(page.includes("You may also be unsurprised by…"), "Related-story section is missing");
  assert(page.includes(`/story/${related.id}`), "Related-story link is missing");
  assert(page.includes("data-copy-link"), "Copy Link control is missing");
  assert(page.includes("data-native-share"), "Native Share control is missing");

  const jsonLdMatch = page.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert(jsonLdMatch, "NewsArticle JSON-LD is missing");
  const jsonLd = JSON.parse(jsonLdMatch[1]);
  assert(jsonLd["@type"] === "NewsArticle", "JSON-LD type is not NewsArticle");
  assert(jsonLd.mainEntityOfPage["@id"] === canonicalUrl, "JSON-LD canonical identity is incorrect");
  assert(jsonLd.image === imageUrl, "NewsArticle image does not match the canonical share card");
  assert(jsonLd.headline === unsafe.headline, "JSON-LD headline does not preserve source data");
  assert(
    jsonLd.author?.["@type"] === "Person" && jsonLd.author?.name === EDITOR_NAME,
    "JSON-LD human attribution is missing or incorrect",
  );
  assert(
    page.includes(`By <a href="/#transparency">${EDITOR_NAME}</a> · ${PUBLICATION_NAME}`),
    "Visible story attribution is missing",
  );

  const unsafeCard = generateShareCard(unsafe);
  const png = validatePng(unsafeCard.png);
  assert(png.width === CARD_WIDTH && png.height === CARD_HEIGHT, "Share card dimensions are incorrect");
  assert(png.format === "png", "Share card format is not PNG");
  assert(unsafeCard.svg.includes("Shocked But Not Surprised"), "Share card is missing canonical publication branding");
  assert(
    unsafeCard.svg.includes("INDEPENDENT ACCOUNTABILITY REPORTING"),
    "Share card is missing the canonical descriptor",
  );
  assert(
    unsafeCard.svg.includes('d="M28 18 H98 L116 36 V122 H28 Z"'),
    "Share card is missing the canonical page-and-lens mark",
  );
  assert(unsafeCard.svg.includes(unsafe.category.toUpperCase()), "Share card is missing its category");
  assert(unsafeCard.svg.includes(`SEVERITY ${unsafe.severity} / 5`), "Share card is missing its severity");
  assert(unsafeCard.svg.includes("ShockedButNotSurprised"), "Share card is missing the publication domain");
  assert(unsafeCard.svg.includes(BRAND_TYPOGRAPHY.serif), "Share card is missing the canonical display serif");
  assert(unsafeCard.svg.includes(BRAND_TYPOGRAPHY.sans), "Share card is missing the canonical supporting sans");
  assert(
    Object.values(BRAND_COLORS).every((color) => unsafeCard.svg.includes(color)),
    "Share card does not use the complete canonical palette",
  );
  assert(!unsafeCard.svg.includes("#101827"), "Obsolete navy remains in the share card");
  assert(!unsafeCard.svg.includes("#0a101b"), "Obsolete dark navy remains in the share card");
  assert(!unsafeCard.svg.includes("#c6a15b"), "Obsolete gold remains in the share card");
  assert(!unsafeCard.svg.includes("Barlow"), "Obsolete Barlow typography remains in the share card");
  assert(
    !unsafeCard.svg.includes("THE INSTITUTIONAL FAILURE DESK"),
    "Share card stacks the retired surface label with the canonical descriptor",
  );
  assert(!unsafeCard.svg.includes("Same Questions."), "Static campaign copy remains in the story-card body");
  const severityMarkup = unsafeCard.svg.match(/<g data-role="severity">[\s\S]*?<\/g>/u)?.[0];
  assert(severityMarkup, "Share card severity group is missing");
  assert(
    !severityMarkup.includes(BRAND_COLORS.signalRed),
    "Signal Red incorrectly encodes story severity",
  );
  assert(!unsafeCard.svg.includes("<script>"), "Story text injected executable SVG");
  assert(unsafeCard.svg.includes("&lt;/title&gt;"), "Story text was not safely escaped in SVG");
  assert(!unsafeCard.svg.includes("<image"), "Share card introduced an external image element");
  assert(!/https?:\/\/(?!www\.w3\.org)/u.test(unsafeCard.svg), "Share card contains an external URL");

  const metadataImageUrls = [...page.matchAll(/<meta (?:property="og:image"|name="twitter:image") content="([^"]+)" \/>/gu)]
    .map((match) => match[1]);
  assert(metadataImageUrls.length === 2, "Unexpected image metadata field count");
  assert(metadataImageUrls.every((url) => url === imageUrl), "Metadata contains an external image URL");

  const pageTitles = [...artifacts.pages.values()].map(
    (html) => html.match(/<title>(.*?)<\/title>/)?.[1],
  );
  assert(pageTitles.every(Boolean), "A generated story page is missing its HTML title");
  assert(new Set(pageTitles).size === pageTitles.length, "Generated story page titles are not unique");

  const serializedArtifacts = (value) => JSON.stringify({
    feed: value.feed,
    homepage: value.homepage,
    pages: [...value.pages],
    sitemap: value.sitemap,
    storyIds: value.storyIds,
  });
  assert(
    serializedArtifacts(artifacts) === serializedArtifacts(reverseArtifacts),
    "Generated text artifacts are not deterministic",
  );
  assert(
    JSON.stringify([...artifacts.cards.keys()]) === JSON.stringify([...reverseArtifacts.cards.keys()]),
    "Generated share-card set is not deterministic",
  );
  for (const [filename, card] of artifacts.cards) {
    assert(card.equals(reverseArtifacts.cards.get(filename)), `${filename} is not byte deterministic`);
    validatePng(card);
  }

  const longHeadline = reportingFixture({
    id: "long-headline-fixture",
    headline: "Federal Inspectors Say a Multi-Agency Modernization Program Still Lacks Reliable Cost Controls, an Integrated Schedule, and a Plan for Accountability",
  });
  const longLayout = layoutHeadline(longHeadline.headline);
  const longCard = generateShareCard(longHeadline);
  assert(longLayout.lines.length <= 4, "Long headline exceeded the defined line limit");
  assert(longLayout.lineWidths.every((width) => width <= longLayout.maxWidth), "Long headline exceeded the card width");
  assert(longLayout.bottom <= 512, "Long headline exceeded the card height");
  validatePng(longCard.png);
  let excessiveHeadlineFailed = false;
  try {
    layoutHeadline("W".repeat(241));
  } catch (error) {
    excessiveHeadlineFailed = error.message.includes("Unable to fit share-card headline");
  }
  assert(excessiveHeadlineFailed, "An excessively long headline did not fail clearly");

  const rankingCurrent = reportingFixture({
    id: "ranking-current",
    category: "National",
    topic_tags: ["oversight"],
  });
  const overlapSameCategory = reportingFixture({
    id: "overlap-same-category",
    category: "National",
    topic_tags: ["oversight"],
    published_at: "2026-08-01T12:00:00Z",
  });
  const overlapOtherCategory = reportingFixture({
    id: "overlap-other-category",
    category: "Local",
    topic_tags: ["oversight"],
    published_at: "2026-09-01T12:00:00Z",
  });
  const categoryOnly = reportingFixture({
    id: "category-only",
    category: "National",
    topic_tags: ["budget"],
    published_at: "2026-09-10T12:00:00Z",
  });
  const ranked = relatedStories(
    rankingCurrent,
    [rankingCurrent, categoryOnly, overlapOtherCategory, overlapSameCategory],
  ).map((story) => story.id);
  assert(
    JSON.stringify(ranked) === JSON.stringify(["overlap-same-category", "overlap-other-category", "category-only"]),
    "Related stories do not rank by tag overlap, category, then recency",
  );

  console.log(
    "Content tests passed: validation, feed compatibility, reporting-only pages/cards/sitemap, PNG dimensions and structure, safe text, metadata, JSON-LD, long-headline handling, recommendations, and determinism.",
  );
}

const command = process.argv[2];
if (!COMMANDS.has(command)) {
  console.error("Usage: node scripts/content.mjs <build|check|test>");
  process.exitCode = 1;
} else {
  try {
    await { build, check, test }[command]();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
