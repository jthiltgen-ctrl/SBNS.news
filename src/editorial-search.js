import { validateSourceUrl } from "./source-retrieval.js";

const SEARCH_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const MAX_BYTES = 256_000;
export const SEARCH_RESULT_LIMIT = 10;

export class DiscoveryQueryError extends Error {}

export function discoverySearchUrl(input) {
  const query = String(input || "").trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} ,.'-]{4,120}$/u.test(query) || query.split(" ").length > 12) throw new DiscoveryQueryError("Use 4–120 plain-text characters and at most 12 words for a bounded search.");
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(SEARCH_RESULT_LIMIT));
  url.searchParams.set("timespan", "30d");
  url.searchParams.set("sort", "datedesc");
  return url.href;
}

export async function searchPublicDiscovery(query, { fetchImpl = fetch, timeoutMs = 8_000 } = {}) {
  const url = discoverySearchUrl(query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "SBNS-Editorial-Research/1.0" } });
    if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) throw new Error("Public discovery search is unavailable; no intake was created.");
    if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("Public discovery response exceeded the size limit.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Public discovery returned no readable result.");
    const chunks = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) { await reader.cancel(); throw new Error("Public discovery response exceeded the size limit."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let payload;
    try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new Error("Public discovery returned malformed metadata."); }
    if (!Array.isArray(payload.articles)) throw new Error("Public discovery returned an unexpected result format.");
    const seen = new Set();
    return payload.articles.slice(0, SEARCH_RESULT_LIMIT).flatMap((item) => {
      try {
        const article = validateSourceUrl(item.url);
        if (seen.has(article.href)) return [];
        seen.add(article.href);
        return [{ title: String(item.title || article.hostname).slice(0, 300), url: article.href, domain: article.hostname, seen_at: String(item.seendate || "").slice(0, 30) }];
      } catch { return []; }
    });
  } finally { clearTimeout(timer); }
}
