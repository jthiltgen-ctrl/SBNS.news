import { validateSourceUrl } from "./source-retrieval.js";

const SEARCH_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const MAX_BYTES = 256_000;
export const SEARCH_RESULT_LIMIT = 10;

export class DiscoveryQueryError extends Error {}

export function discoverySearchUrl(input, { maxRecords = SEARCH_RESULT_LIMIT, toneAbsThreshold = null } = {}) {
  const query = String(input || "").trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} ,.'-]{4,120}$/u.test(query) || query.split(" ").length > 12) throw new DiscoveryQueryError("Use 4–120 plain-text characters and at most 12 words for a bounded search.");
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > SEARCH_RESULT_LIMIT) throw new DiscoveryQueryError(`Search result limit must be from 1 to ${SEARCH_RESULT_LIMIT}.`);
  if (toneAbsThreshold != null && ![8, 10].includes(toneAbsThreshold)) throw new DiscoveryQueryError("Only the documented bounded toneabs thresholds are supported.");
  const url = new URL(SEARCH_ENDPOINT);
  // GDELT documents toneabs>10 as filtering for stronger positive or negative
  // tone. It is a discovery variant only; no emotional score is retained or
  // used as evidence/admission criteria.
  url.searchParams.set("query", toneAbsThreshold == null ? query : `${query} toneabs>${toneAbsThreshold}`);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(maxRecords));
  url.searchParams.set("timespan", "30d");
  url.searchParams.set("sort", "datedesc");
  return url.href;
}

export async function searchPublicDiscovery(query, { fetchImpl = fetch, timeoutMs = 8_000, maxRecords = SEARCH_RESULT_LIMIT, toneAbsThreshold = null, retryRateLimit = false } = {}) {
  const url = discoverySearchUrl(query, { maxRecords, toneAbsThreshold });
  let response;
  let activeTimer;
  for (let attempt = 0; attempt < (retryRateLimit ? 2 : 1); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl(url, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "SBNS-Editorial-Research/1.0" } });
    } catch (error) { clearTimeout(timer); throw error; }
    if (response.ok && !response.redirected && !(response.status >= 300 && response.status < 400)) { activeTimer = timer; break; }
    clearTimeout(timer);
    if (response.status === 429 && retryRateLimit && attempt === 0) {
      try { await response.body?.cancel(); } catch { /* ignore canceled rate-limit body */ }
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(1_000, retryAfter * 1_000) : 250));
      continue;
    }
    throw new Error("Public discovery search is unavailable; no intake was created.");
  }
  try {
    if (!response?.ok || response.redirected || (response.status >= 300 && response.status < 400)) throw new Error("Public discovery search is unavailable; no intake was created.");
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
    return payload.articles.slice(0, maxRecords).flatMap((item) => {
      try {
        const article = validateSourceUrl(item.url);
        if (seen.has(article.href)) return [];
        seen.add(article.href);
        return [{ title: String(item.title || article.hostname).slice(0, 300), url: article.href, domain: article.hostname, seen_at: String(item.seendate || "").slice(0, 30) }];
      } catch { return []; }
    });
  } finally { if (activeTimer) clearTimeout(activeTimer); }
}
