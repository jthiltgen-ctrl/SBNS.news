import { validateSourceUrl } from "./source-retrieval.js";

const MEDIA_CLOUD_ENDPOINT = "https://search.mediacloud.org/api/search/story-list";
export const MEDIA_CLOUD_PROVIDER_ID = "mediacloud";
export const MEDIA_CLOUD_COLLECTION_ID = 34412234;
export const MEDIA_CLOUD_RESULTS_LIMIT = 6;
export const MEDIA_CLOUD_TIMEOUT_MS = 15_000;
export const MEDIA_CLOUD_RESPONSE_LIMIT = 128_000;

const ERROR_MESSAGES = Object.freeze({
  MEDIA_CLOUD_NOT_CONFIGURED: "Media Cloud API credentials are not configured.",
  MEDIA_CLOUD_TIMEOUT: "Media Cloud search timed out.",
  MEDIA_CLOUD_NETWORK_ERROR: "Media Cloud search could not reach its provider.",
  MEDIA_CLOUD_RATE_LIMITED: "Media Cloud search was rate limited.",
  MEDIA_CLOUD_HTTP_ERROR: "Media Cloud search is unavailable.",
  MEDIA_CLOUD_REDIRECT_BLOCKED: "Media Cloud search redirect was refused.",
  MEDIA_CLOUD_RESPONSE_TOO_LARGE: "Media Cloud response exceeded the size limit.",
  MEDIA_CLOUD_MALFORMED_RESPONSE: "Media Cloud returned malformed metadata.",
  MEDIA_CLOUD_UNEXPECTED_RESPONSE: "Media Cloud returned an unexpected result format.",
  MEDIA_CLOUD_NO_READABLE_RESULT: "Media Cloud returned no readable result.",
});

export class MediaCloudSearchError extends Error {
  constructor(code, { httpStatus = null, attempts = 1, durationMs = null } = {}) {
    super(ERROR_MESSAGES[code] || ERROR_MESSAGES.MEDIA_CLOUD_HTTP_ERROR);
    this.name = "MediaCloudSearchError";
    this.code = code;
    this.httpStatus = Number.isInteger(httpStatus) ? httpStatus : null;
    this.attempts = Number.isInteger(attempts) ? Math.max(0, Math.min(attempts, 1)) : 1;
    this.durationMs = Number.isFinite(durationMs) ? Math.max(0, Math.min(Math.trunc(durationMs), 60_000)) : null;
  }
}

function safeQuery(value) {
  const query = String(value || "").trim().replace(/\s+/g, " ");
  if (!/^[a-z0-9 ,.'-]{4,120}$/i.test(query) || query.split(" ").length > 12) {
    throw new MediaCloudSearchError("MEDIA_CLOUD_UNEXPECTED_RESPONSE", { attempts: 0 });
  }
  return query;
}

function isoDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new MediaCloudSearchError("MEDIA_CLOUD_UNEXPECTED_RESPONSE", { attempts: 0 });
  return date.toISOString().slice(0, 10);
}

function addUtcDays(dateValue, days) {
  const date = new Date(dateValue);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function normalizeStoryUrl(input) {
  const url = new URL(validateSourceUrl(input).href);
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || ["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src"].includes(lower)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

export function mediaCloudSearchRequest(query, now = new Date(), { maxResults = MEDIA_CLOUD_RESULTS_LIMIT } = {}) {
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MEDIA_CLOUD_RESULTS_LIMIT) {
    throw new MediaCloudSearchError("MEDIA_CLOUD_UNEXPECTED_RESPONSE", { attempts: 0 });
  }
  const normalizedQuery = safeQuery(query);
  const end = isoDay(now);
  const start = isoDay(addUtcDays(now, -6));
  const url = new URL(MEDIA_CLOUD_ENDPOINT);
  url.searchParams.set("q", `language:en AND (\"${normalizedQuery}\")`);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("platform", "onlinenews-mediacloud");
  url.searchParams.set("cs", String(MEDIA_CLOUD_COLLECTION_ID));
  url.searchParams.set("page_size", String(maxResults));
  return url;
}

function normalizeStories(payload, maxResults) {
  if (!Array.isArray(payload?.stories)) throw new MediaCloudSearchError("MEDIA_CLOUD_UNEXPECTED_RESPONSE");
  const seen = new Set();
  return payload.stories.slice(0, maxResults).flatMap((story) => {
    try {
      const article = normalizeStoryUrl(story?.url);
      if (seen.has(article.href)) return [];
      seen.add(article.href);
      const publishedAt = typeof story.publish_date === "string" && /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(story.publish_date)
        ? story.publish_date.slice(0, 10)
        : null;
      return [{
        provider_id: MEDIA_CLOUD_PROVIDER_ID,
        provider_story_id: typeof story.id === "string" || Number.isInteger(story.id) ? String(story.id).slice(0, 120) : null,
        title: String(story.title || article.hostname).replace(/[\r\n\t]+/g, " ").slice(0, 300),
        url: article.href,
        domain: article.hostname,
        published_at: publishedAt,
        discovery_provider_metadata: {
          publisher: typeof story.media_name === "string" ? story.media_name.slice(0, 120) : null,
        },
      }];
    } catch { return []; }
  });
}

async function readBoundedJson(response, maxBytes) {
  if (Number(response.headers.get("content-length") || 0) > maxBytes) {
    throw new MediaCloudSearchError("MEDIA_CLOUD_RESPONSE_TOO_LARGE", { httpStatus: response.status });
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MediaCloudSearchError("MEDIA_CLOUD_NO_READABLE_RESULT", { httpStatus: response.status });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MediaCloudSearchError("MEDIA_CLOUD_RESPONSE_TOO_LARGE", { httpStatus: response.status });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MediaCloudSearchError("MEDIA_CLOUD_MALFORMED_RESPONSE", { httpStatus: response.status }); }
}

function withTransport(items, transport) {
  Object.defineProperty(items, "transport", { value: Object.freeze(transport), enumerable: false });
  return items;
}

export async function searchMediaCloudDiscovery(query, {
  token,
  now = new Date(),
  fetchImpl = fetch,
  timeoutMs = MEDIA_CLOUD_TIMEOUT_MS,
  maxResults = MEDIA_CLOUD_RESULTS_LIMIT,
  clockMs = () => Date.now(),
} = {}) {
  if (typeof token !== "string" || !token.trim()) throw new MediaCloudSearchError("MEDIA_CLOUD_NOT_CONFIGURED", { attempts: 0 });
  const url = mediaCloudSearchRequest(query, now, { maxResults });
  const controller = new AbortController();
  const startedAt = clockMs();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetchImpl(url.href, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Token ${token}`,
        "User-Agent": "SBNS-Editorial-Research/1.0",
      },
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      try { await response.body?.cancel(); } catch { /* bounded redirect response is discarded */ }
      throw new MediaCloudSearchError("MEDIA_CLOUD_REDIRECT_BLOCKED", { httpStatus: response.status });
    }
    if (response.status === 429) {
      try { await response.body?.cancel(); } catch { /* bounded rate-limit response is discarded */ }
      throw new MediaCloudSearchError("MEDIA_CLOUD_RATE_LIMITED", { httpStatus: 429 });
    }
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* bounded error response is discarded */ }
      throw new MediaCloudSearchError("MEDIA_CLOUD_HTTP_ERROR", { httpStatus: response.status });
    }
    const payload = await readBoundedJson(response, MEDIA_CLOUD_RESPONSE_LIMIT);
    const items = normalizeStories(payload, maxResults);
    return withTransport(items, { attempts: 1, http_status: response.status, duration_ms: Math.max(0, clockMs() - startedAt) });
  } catch (error) {
    if (error instanceof MediaCloudSearchError) {
      if (error.durationMs == null) error.durationMs = Math.max(0, Math.min(60_000, clockMs() - startedAt));
      throw error;
    }
    const code = timedOut || controller.signal.aborted ? "MEDIA_CLOUD_TIMEOUT" : "MEDIA_CLOUD_NETWORK_ERROR";
    throw new MediaCloudSearchError(code, { durationMs: Math.max(0, clockMs() - startedAt) });
  } finally { clearTimeout(timer); }
}
