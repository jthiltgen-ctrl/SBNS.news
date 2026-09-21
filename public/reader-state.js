export function storyMatchesView(story, view) {
  if (view === "Samples") return story.content_type === "sample";
  if (view === "Reporting") return story.content_type === "reporting";
  return story.content_type === "reporting" && story.category === view;
}

export function sortPublishedStories(stories) {
  if (!Array.isArray(stories)) throw new Error("Story feed must be an array");
  return stories.toSorted((a, b) =>
    String(b?.published_at || "").localeCompare(String(a?.published_at || "")),
  );
}

export async function fetchStoryFeed(fetchImplementation, url) {
  const response = await fetchImplementation(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return sortPublishedStories(await response.json());
}

export async function refreshStoryFeed({
  fetchImplementation,
  url,
  minimumStories = 0,
  validateStories = () => true,
  onSuccess,
  onFailure,
}) {
  try {
    const stories = await fetchStoryFeed(fetchImplementation, url);
    if (stories.length < minimumStories) {
      throw new Error("Refreshed feed did not contain the already-published reporting");
    }
    if (!validateStories(stories)) {
      throw new Error("Refreshed feed failed the reader's publication checks");
    }
    onSuccess(stories);
    return true;
  } catch (error) {
    onFailure(error);
    return false;
  }
}
