import { validateSourceUrl } from "./source-retrieval.js";

const SEARCH_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const MAX_BYTES = 256_000;
const ALLOWED_TIMESPANS = new Set(["7d", "30d"]);
export const SEARCH_RESULT_LIMIT = 10;

const ERROR_MESSAGES = Object.freeze({
  DISCOVERY_TIMEOUT: "Public discovery timed out; no intake was created.",
  DISCOVERY_NETWORK_ERROR: "Public discovery could not reach its provider; no intake was created.",
  DISCOVERY_RATE_LIMITED: "Public discovery was rate limited; no intake was created.",
  DISCOVERY_REDIRECT_BLOCKED: "Public discovery search is unavailable; no intake was created.",
  DISCOVERY_HTTP_ERROR: "Public discovery search is unavailable; no intake was created.",
  DISCOVERY_RESPONSE_TOO_LARGE: "Public discovery response exceeded the size limit.",
  DISCOVERY_MALFORMED_RESPONSE: "Public discovery returned malformed metadata.",
  DISCOVERY_UNEXPECTED_RESPONSE: "Public discovery returned an unexpected result format.",
  DISCOVERY_NO_READABLE_RESULT: "Public discovery returned no readable result.",
});

export class DiscoveryQueryError extends Error {
  constructor(message, { code = "DISCOVERY_QUERY_INVALID", httpStatus = null, attempts = 0 } = {}) {
    super(message);
    this.name = "DiscoveryQueryError";
    this.code = code;
    this.httpStatus = Number.isInteger(httpStatus) ? httpStatus : null;
    this.attempts = Number.isInteger(attempts) ? attempts : 0;
  }
}

function discoveryError(code, details = {}) {
  return new DiscoveryQueryError(ERROR_MESSAGES[code] || ERROR_MESSAGES.DISCOVERY_NETWORK_ERROR, { code, ...details });
}

function boundedRetryDelay(value) {
  if (Number.isFinite(value) && value > 0) return Math.min(1_000, value);
  return 250;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function discoverySearchUrl(input, { maxRecords = SEARCH_RESULT_LIMIT, toneAbsThreshold = null, timespan = "30d" } = {}) {
  const query = String(input || "").trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} ,.'-]{4,120}$/u.test(query) || query.split(" ").length > 12) throw new DiscoveryQueryError("Use 4–120 plain-text characters and at most 12 words for a bounded search.");
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > SEARCH_RESULT_LIMIT) throw new DiscoveryQueryError(`Search result limit must be from 1 to ${SEARCH_RESULT_LIMIT}.`);
  if (toneAbsThreshold != null && ![8, 10].includes(toneAbsThreshold)) throw new DiscoveryQueryError("Only the documented bounded toneabs thresholds are supported.");
  if (!ALLOWED_TIMESPANS.has(timespan)) throw new DiscoveryQueryError("Search timespan must be 7d or 30d.");
  const url = new URL(SEARCH_ENDPOINT);
  // GDELT documents toneabs>10 as filtering for stronger positive or negative
  // tone. It is a discovery variant only; no emotional score is retained or
  // used as evidence/admission criteria.
  url.searchParams.set("query", toneAbsThreshold == null ? query : `${query} toneabs>${toneAbsThreshold}`);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("maxrecords", String(maxRecords));
  url.searchParams.set("timespan", timespan);
  url.searchParams.set("sort", "datedesc");
  return url.href;
}

function normalizeArticles(payload, maxRecords) {
  if (!Array.isArray(payload?.articles)) throw discoveryError("DISCOVERY_UNEXPECTED_RESPONSE");
  const seen = new Set();
  return payload.articles.slice(0, maxRecords).flatMap((item) => {
    try {
      const article = validateSourceUrl(item.url);
      if (seen.has(article.href)) return [];
      seen.add(article.href);
      return [{ title: String(item.title || article.hostname).slice(0, 300), url: article.href, domain: article.hostname, seen_at: String(item.seendate || "").slice(0, 30) }];
    } catch { return []; }
  });
}

function withTransport(results, transport) {
  // Keep the established array response shape for callers while making
  // bounded request telemetry available to the Open Sweep run ledger.
  Object.defineProperty(results, "transport", { value: Object.freeze(transport), enumerable: false });
  return results;
}

export async function searchPublicDiscovery(query, {
  fetchImpl = fetch,
  timeoutMs = 8_000,
  maxRecords = SEARCH_RESULT_LIMIT,
  toneAbsThreshold = null,
  timespan = "30d",
  retryRateLimit = false,
  retryTimeout = false,
  retryBackoffMs = 250,
  rateLimitBackoffMs = 5_000,
  sleep = wait,
} = {}) {
  const url = discoverySearchUrl(query, { maxRecords, toneAbsThreshold, timespan });
  const boundedRateLimitBackoffMs = Number.isFinite(rateLimitBackoffMs) ? Math.min(30_000, Math.max(5_000, rateLimitBackoffMs)) : 5_000;
  const mayRetry = retryRateLimit || retryTimeout;
  const maxAttempts = mayRetry ? 2 : 1;
  const startedAt = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let retryDelay = null;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "SBNS-Editorial-Research/1.0" },
      });
      if (response.status === 429 && retryRateLimit && attempt === 1) {
        try { await response.body?.cancel(); } catch { /* discard bounded rate-limit body */ }
        const retryAfterSeconds = Number(response.headers.get("retry-after"));
        retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(30_000, Math.max(boundedRateLimitBackoffMs, retryAfterSeconds * 1_000))
          : boundedRateLimitBackoffMs;
        lastError = discoveryError("DISCOVERY_RATE_LIMITED", { httpStatus: 429, attempts: attempt });
      } else if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) {
        const code = response.status === 429 ? "DISCOVERY_RATE_LIMITED" : response.redirected || (response.status >= 300 && response.status < 400) ? "DISCOVERY_REDIRECT_BLOCKED" : "DISCOVERY_HTTP_ERROR";
        lastError = discoveryError(code, { httpStatus: response.status, attempts: attempt });
      } else {
        if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) throw discoveryError("DISCOVERY_RESPONSE_TOO_LARGE", { httpStatus: response.status, attempts: attempt });
        const reader = response.body?.getReader();
        if (!reader) throw discoveryError("DISCOVERY_NO_READABLE_RESULT", { httpStatus: response.status, attempts: attempt });
        const chunks = [];
        let total = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BYTES) {
              await reader.cancel();
              throw discoveryError("DISCOVERY_RESPONSE_TOO_LARGE", { httpStatus: response.status, attempts: attempt });
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const responseText = new TextDecoder().decode(bytes);
        let payload;
        try { payload = JSON.parse(responseText); }
        catch {
          if (/please limit requests to one every\s+\d+\s+seconds?/i.test(responseText)) throw discoveryError("DISCOVERY_RATE_LIMITED", { httpStatus: response.status, attempts: attempt });
          throw discoveryError("DISCOVERY_MALFORMED_RESPONSE", { httpStatus: response.status, attempts: attempt });
        }
        const results = normalizeArticles(payload, maxRecords);
        return withTransport(results, { attempts: attempt, http_status: response.status, duration_ms: Math.max(0, Date.now() - startedAt) });
      }
    } catch (error) {
      if (error instanceof DiscoveryQueryError) lastError = error;
      else if (timedOut || controller.signal.aborted) lastError = discoveryError("DISCOVERY_TIMEOUT", { attempts: attempt });
      else lastError = discoveryError("DISCOVERY_NETWORK_ERROR", { attempts: attempt });

      if (lastError.code === "DISCOVERY_TIMEOUT" && retryTimeout && attempt === 1) retryDelay = boundedRetryDelay(retryBackoffMs);
      if (lastError.code === "DISCOVERY_RATE_LIMITED" && retryRateLimit && attempt === 1) retryDelay = boundedRateLimitBackoffMs;
    } finally {
      clearTimeout(timer);
    }

    if (retryDelay != null && attempt < maxAttempts) {
      await sleep(retryDelay);
      continue;
    }
    throw discoveryError(lastError.code, {
      httpStatus: lastError.httpStatus,
      attempts: attempt,
    });
  }
  throw discoveryError(lastError?.code || "DISCOVERY_NETWORK_ERROR", { attempts: maxAttempts });
}
