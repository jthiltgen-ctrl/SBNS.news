const storyGrid = document.querySelector("#stories");
const status = document.querySelector("#status");
const refreshButton = document.querySelector("#refresh");
const dateline = document.querySelector("#dateline");

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

  const tags = document.createElement("div");
  tags.className = "tags";
  const labels = [story.source, ...(Array.isArray(story.topic_tags) ? story.topic_tags : [])];
  labels.filter(Boolean).forEach((label) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = String(label);
    tags.append(tag);
  });

  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = text(story.fml_kicker, "The system remains confident in the system.");

  body.append(meta, headline, summary, tags);
  article.append(body, kicker);
  return article;
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

    const sorted = stories.toSorted((a, b) =>
      text(b.published_at).localeCompare(text(a.published_at)),
    );

    if (sorted.length === 0) {
      status.textContent = "No stories are published yet. A system somewhere is enjoying the silence.";
      return;
    }

    sorted.slice(0, 50).forEach((story) => storyGrid.append(renderStory(story)));
    status.hidden = true;
  } catch (error) {
    console.error("Unable to load stories", error);
    status.textContent = "The news failed to load. Shocked? Neither are we.";
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", loadStories);
loadStories();
