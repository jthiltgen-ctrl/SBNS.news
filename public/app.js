const storyGrid = document.querySelector("#stories");
const status = document.querySelector("#status");
const refreshButton = document.querySelector("#refresh");
const dateline = document.querySelector("#dateline");
const filterButtons = [...document.querySelectorAll(".filter-button")];

let loadedStories = [];
let activeCategory = "All";

dateline.textContent = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
}).format(new Date());

function text(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function severityDots(value) {
  const severity = Math.max(1, Math.min(5, Number(value) || 1));
  const container = document.createElement("span");
  container.className = "severity";
  container.setAttribute("aria-label", `Severity ${severity} out of 5`);

  for (let index = 1; index <= 5; index += 1) {
    const dot = document.createElement("span");
    dot.className = `severity-dot${index <= severity ? " active" : ""}`;
    dot.setAttribute("aria-hidden", "true");
    container.append(dot);
  }

  return container;
}

function renderStory(story) {
  const article = document.createElement("article");
  article.className = "story-card";

  const body = document.createElement("div");
  body.className = "story-body";

  const sampleLabel = document.createElement("p");
  sampleLabel.className = "fictional-label";
  sampleLabel.textContent = "Fictional prototype sample — not real news";

  const meta = document.createElement("div");
  meta.className = "story-meta";

  const category = document.createElement("span");
  category.textContent = text(story.category, "Accountability");
  meta.append(category, severityDots(story.severity));

  const headline = document.createElement("h3");
  headline.textContent = text(story.headline, "Untitled report");

  const summary = document.createElement("p");
  summary.className = "summary";
  summary.textContent = text(story.summary, "Details are still developing.");

  const source = document.createElement("div");
  source.className = "source-area";

  const sourceLabel = document.createElement("span");
  sourceLabel.className = "source-label";
  sourceLabel.textContent = "Fictional sample source";

  const sourceName = document.createElement("span");
  sourceName.className = "source-name";
  sourceName.textContent = text(story.source, "Fictional Prototype Desk — not a real publication");
  source.append(sourceLabel, sourceName);

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

  body.append(sampleLabel, meta, headline, summary, source, tags);
  article.append(body, kicker);
  return article;
}

function renderStories() {
  storyGrid.replaceChildren();

  const visibleStories = loadedStories.filter(
    (story) => activeCategory === "All" || story.category === activeCategory,
  );

  if (visibleStories.length === 0) {
    status.hidden = false;
    status.textContent = `No fictional ${activeCategory.toLowerCase()} samples are available.`;
    return;
  }

  visibleStories.slice(0, 50).forEach((story) => storyGrid.append(renderStory(story)));
  status.hidden = true;
}

async function loadStories() {
  refreshButton.disabled = true;
  status.hidden = false;
  status.textContent = "Loading the latest failures…";
  storyGrid.replaceChildren();

  try {
    const response = await fetch(`/stories.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const stories = await response.json();
    if (!Array.isArray(stories)) throw new Error("Story feed must be an array");

    loadedStories = stories.toSorted((a, b) =>
      text(b.published_at).localeCompare(text(a.published_at)),
    );

    if (loadedStories.length === 0) {
      status.textContent = "No stories are published yet. A system somewhere is enjoying the silence.";
      return;
    }

    renderStories();
  } catch (error) {
    console.error("Unable to load stories", error);
    status.textContent = "The news failed to load. Shocked? Neither are we.";
  } finally {
    refreshButton.disabled = false;
  }
}

filterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    activeCategory = button.dataset.category;
    filterButtons.forEach((candidate) => {
      const isActive = candidate === button;
      candidate.classList.toggle("active", isActive);
      candidate.setAttribute("aria-pressed", String(isActive));
    });
    renderStories();
  });
});

refreshButton.addEventListener("click", loadStories);
loadStories();
