import { refreshStoryFeed, storyMatchesView } from "./reader-state.js";

const storyGrid = document.querySelector("#stories");
const status = document.querySelector("#status");
const refreshButton = document.querySelector("#refresh");
const dateline = document.querySelector("#dateline");
const filterButtons = [...document.querySelectorAll(".filter-button")];

let loadedStories = [];
let activeView = "Reporting";

dateline.textContent = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
}).format(new Date());

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function severityDots(value) {
  const severity = Math.max(1, Math.min(5, Number(value) || 1));
  const container = document.createElement("span");
  container.className = "severity";
  container.setAttribute("aria-label", `Severity ${severity} out of 5`);

  const valueLabel = document.createElement("span");
  valueLabel.className = "severity-value";
  valueLabel.textContent = `Severity ${severity}/5`;
  valueLabel.setAttribute("aria-hidden", "true");
  container.append(valueLabel);

  for (let index = 1; index <= 5; index += 1) {
    const dot = document.createElement("span");
    dot.className = `severity-dot${index <= severity ? " active" : ""}`;
    dot.setAttribute("aria-hidden", "true");
    container.append(dot);
  }

  return container;
}

function publishedDate(value) {
  if (typeof value !== "string" || !value) return "Date pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date pending";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function renderStory(story) {
  const article = document.createElement("article");
  article.className = "story-card";
  article.dataset.storyId = text(story.id);
  article.dataset.contentType = text(story.content_type);
  article.dataset.category = text(story.category);

  const body = document.createElement("div");
  body.className = "story-body";

  const isSample = story.content_type === "sample";
  if (isSample) {
    const sampleLabel = document.createElement("p");
    sampleLabel.className = "fictional-label";
    sampleLabel.textContent = "Fictional prototype sample — not real news";
    body.append(sampleLabel);
  }

  const meta = document.createElement("div");
  meta.className = "story-meta";

  const storyLine = document.createElement("span");
  storyLine.textContent = `${text(story.category, "Accountability")} · ${publishedDate(story.published_at)}`;
  meta.append(storyLine, severityDots(story.severity));

  const headline = document.createElement("h3");
  if (!isSample && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(story.id)) {
    const headlineLink = document.createElement("a");
    headlineLink.href = `/story/${story.id}`;
    headlineLink.textContent = text(story.headline, "Untitled report");
    headline.append(headlineLink);
  } else {
    headline.textContent = text(story.headline, "Untitled report");
  }

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = text(story.summary, "Details are still developing.");

  const source = document.createElement("div");
  source.className = "source-area";

  const sourceLabel = document.createElement("span");
  sourceLabel.className = "source-label";
  sourceLabel.textContent = isSample ? "Fictional sample source" : "Primary sources";
  source.append(sourceLabel);

  const sources = Array.isArray(story.sources) ? story.sources : [];
  sources.forEach((item) => {
    const sourceName = document.createElement(isHttpUrl(item.url) ? "a" : "span");
    sourceName.className = "source-name";
    sourceName.textContent = text(item.name, "Unnamed source");
    if (sourceName instanceof HTMLAnchorElement) {
      sourceName.href = item.url;
      sourceName.target = "_blank";
      sourceName.rel = "noopener noreferrer";
    }
    source.append(sourceName);
  });

  const tags = document.createElement("div");
  tags.className = "tags";
  const labels = Array.isArray(story.topic_tags) ? story.topic_tags : [];
  labels.filter(Boolean).forEach((label) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = String(label);
    tags.append(tag);
  });

  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = text(story.fml_kicker, "The system remains confident in the system.");

  body.append(meta, headline, summary);
  if (sources.length > 0) body.append(source);
  body.append(tags);
  article.append(body, kicker);
  return article;
}

function renderStories() {
  const visibleStories = loadedStories.filter((story) => storyMatchesView(story, activeView));

  if (visibleStories.length === 0) {
    storyGrid.replaceChildren();
    status.hidden = false;
    const label = activeView === "Samples" ? "prototype samples" : activeView.toLowerCase();
    status.textContent = `No ${label} stories are available.`;
    return;
  }

  storyGrid.replaceChildren(...visibleStories.slice(0, 50).map(renderStory));
  status.hidden = true;
}

function filterInitialStories() {
  const cards = [...storyGrid.querySelectorAll(".story-card")];
  let visibleCount = 0;
  cards.forEach((card) => {
    const visible = storyMatchesView(
      {
        content_type: card.dataset.contentType,
        category: card.dataset.category,
      },
      activeView,
    );
    card.hidden = !visible;
    if (visible) visibleCount += 1;
  });

  if (visibleCount === 0) {
    status.hidden = false;
    status.textContent = activeView === "Samples"
      ? "The Prototype archive needs a successful feed refresh. Published reporting remains available."
      : `No ${activeView.toLowerCase()} stories are available.`;
  } else {
    status.hidden = true;
  }
}

async function loadStories({ manual = false } = {}) {
  refreshButton.disabled = true;
  if (manual) {
    status.hidden = false;
    status.textContent = "Checking the filing cabinets…";
  }

  const initialReportingCount = storyGrid.querySelectorAll(
    '.story-card[data-content-type="reporting"]',
  ).length;

  await refreshStoryFeed({
    fetchImplementation: fetch,
    url: `/stories.json?ts=${Date.now()}`,
    minimumStories: initialReportingCount > 0 ? 1 : 0,
    validateStories(stories) {
      return initialReportingCount === 0 || stories.some((story) => story.content_type === "reporting");
    },
    onSuccess(stories) {
      loadedStories = stories;
      if (manual || activeView !== "Reporting") renderStories();
      else status.hidden = true;
    },
    onFailure(error) {
      console.error("Unable to refresh stories", error);
      status.hidden = false;
      status.textContent = storyGrid.childElementCount > 0
        ? "Refresh failed. The reporting already on the page stays put."
        : "The news failed to load. Shocked? Neither are we.";
    },
  });

  refreshButton.disabled = false;
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeView = button.dataset.view;
    filterButtons.forEach((candidate) => {
      const isActive = candidate === button;
      candidate.classList.toggle("active", isActive);
      candidate.setAttribute("aria-pressed", String(isActive));
    });
    if (loadedStories.length > 0) renderStories();
    else filterInitialStories();
  });
});

refreshButton.addEventListener("click", () => loadStories({ manual: true }));
loadStories();
