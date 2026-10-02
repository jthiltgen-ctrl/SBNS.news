function candidateFrom(item) {
  try { return JSON.parse(item.latest_discovery_metadata_json || "{}")?.candidate || null; }
  catch { return null; }
}

export function assignmentSearchText(item) {
  const candidate = candidateFrom(item);
  return [
    item.submitted_url, item.origin, item.status, item.latest_recommendation,
    candidate?.discovered_title, candidate?.institution_or_system,
    candidate?.topic, candidate?.normalized_url, candidate?.source?.name,
    candidate?.triage?.recommendation
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

export function filterAssignments(items, { query = "", status = "", origin = "" } = {}) {
  const needle = query.trim().toLocaleLowerCase();
  return items.filter((item) =>
    (!status || (status === "active" ? item.status !== "rejected" : item.status === status)) &&
    (!origin || item.origin === origin) &&
    (!needle || assignmentSearchText(item).includes(needle))
  );
}

export function queueCounts(items) {
  return {
    total: items.length,
    reviewReady: items.filter((item) => item.status === "review_ready").length,
    discovery: items.filter((item) => item.origin === "discovery").length,
    attention: items.filter((item) => ["review_ready", "failed"].includes(item.status)).length
  };
}
