// Development-only public-source transport. Callers cannot supply a URL or host.

export const ECHO_SOURCE_NETWORK_LIMITS = Object.freeze({
  resultsPerSearch: 10,
  timeoutMs: 8_000,
  defaultMaxBytes: 512 * 1024,
  absoluteMaxBytes: 1024 * 1024,
});

export class EchoSourceNetworkError extends Error {
  constructor(code) {
    super(code);
    this.name = 'EchoSourceNetworkError';
    this.code = code;
  }
}

function boundedText(value, maxLength, code) {
  if (typeof value !== 'string') throw new EchoSourceNetworkError(code);
  const text = value.trim();
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new EchoSourceNetworkError(code);
  }
  return text;
}

function recordId(value, pattern) {
  const id = boundedText(value, 160, 'INVALID_RECORD_ID');
  if (!pattern.test(id)) throw new EchoSourceNetworkError('INVALID_RECORD_ID');
  return id;
}

function smithsonianKey(value) {
  // The key must never enter a URL, error, log, or response object.
  return boundedText(value, 256, 'MISSING_API_KEY');
}

function requestOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new EchoSourceNetworkError('INVALID_OPTIONS');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new EchoSourceNetworkError('INVALID_FETCH');
  const timeoutMs = options.timeoutMs ?? ECHO_SOURCE_NETWORK_LIMITS.timeoutMs;
  const maxBytes = options.maxBytes ?? ECHO_SOURCE_NETWORK_LIMITS.defaultMaxBytes;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > ECHO_SOURCE_NETWORK_LIMITS.timeoutMs) {
    throw new EchoSourceNetworkError('INVALID_TIMEOUT');
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > ECHO_SOURCE_NETWORK_LIMITS.absoluteMaxBytes) {
    throw new EchoSourceNetworkError('INVALID_RESPONSE_LIMIT');
  }
  return { fetchImpl, timeoutMs, maxBytes };
}

function approvedEndpoint(url) {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  if (url.hostname === 'www.loc.gov') {
    return url.pathname === '/search/' || /^\/item\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,3}\/$/u.test(url.pathname);
  }
  if (url.hostname === 'api.si.edu') {
    return url.pathname === '/openaccess/api/v1.0/search'
      || /^\/openaccess\/api\/v1\.0\/content\/[A-Za-z0-9%:._-]+\/$/u.test(url.pathname);
  }
  return false;
}

async function boundedJsonGet(url, options, apiKey) {
  if (!approvedEndpoint(url)) throw new EchoSourceNetworkError('UNAPPROVED_ENDPOINT');
  const { fetchImpl, timeoutMs, maxBytes } = requestOptions(options);
  const controller = new AbortController();
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new EchoSourceNetworkError('TIMEOUT'));
    }, timeoutMs);
  });

  const work = async () => {
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'SBNS-Echo-Source-Adapters/1.0 (+https://shockedbutnotsurprised.news)',
    };
    if (apiKey !== undefined) headers['X-Api-Key'] = smithsonianKey(apiKey);

    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new EchoSourceNetworkError('TIMEOUT');
      throw new EchoSourceNetworkError('NETWORK_FAILURE');
    }

    if (!response || typeof response.status !== 'number') {
      throw new EchoSourceNetworkError('MALFORMED_RESPONSE');
    }
    if (response.redirected || (response.url && response.url !== url.href)
      || (response.status >= 300 && response.status < 400)) {
      throw new EchoSourceNetworkError('REDIRECT_REJECTED');
    }
    if (response.status === 429) throw new EchoSourceNetworkError('RATE_LIMITED');
    if (!response.ok) throw new EchoSourceNetworkError('HTTP_FAILURE');

    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!/^application\/(?:[\w.+-]*\+)?json\b/iu.test(contentType)) {
      throw new EchoSourceNetworkError('NON_JSON_RESPONSE');
    }
    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader !== null) {
      const length = Number(lengthHeader);
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new EchoSourceNetworkError('MALFORMED_RESPONSE');
      }
      if (length > maxBytes) throw new EchoSourceNetworkError('RESPONSE_TOO_LARGE');
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new EchoSourceNetworkError('MALFORMED_RESPONSE');
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new EchoSourceNetworkError('MALFORMED_RESPONSE');
        received += value.byteLength;
        if (received > maxBytes) throw new EchoSourceNetworkError('RESPONSE_TOO_LARGE');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof EchoSourceNetworkError) throw error;
      if (controller.signal.aborted) throw new EchoSourceNetworkError('TIMEOUT');
      throw new EchoSourceNetworkError('NETWORK_FAILURE');
    } finally {
      reader.releaseLock();
    }

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new EchoSourceNetworkError('INVALID_JSON');
    }
  };

  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export function locSearch(query, options = {}) {
  const url = new URL('https://www.loc.gov/search/');
  url.searchParams.set('q', boundedText(query, 160, 'INVALID_QUERY'));
  url.searchParams.set('fo', 'json');
  url.searchParams.set('at', 'results');
  url.searchParams.set('c', String(ECHO_SOURCE_NETWORK_LIMITS.resultsPerSearch));
  url.searchParams.set('sp', '1');
  return boundedJsonGet(url, options);
}

export function locDetail(id, options = {}) {
  const safeId = recordId(id, /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,3}$/u);
  if (safeId.split('/').some((part) => part === '.' || part === '..')) throw new EchoSourceNetworkError('INVALID_RECORD_ID');
  const url = new URL(`https://www.loc.gov/item/${safeId}/`);
  url.searchParams.set('fo', 'json');
  url.searchParams.set('at', 'item,traditional_knowledge_labels');
  return boundedJsonGet(url, options);
}

export function smithsonianSearch(query, apiKey, options = {}) {
  const url = new URL('https://api.si.edu/openaccess/api/v1.0/search');
  url.searchParams.set('q', boundedText(query, 160, 'INVALID_QUERY'));
  url.searchParams.set('start', '0');
  url.searchParams.set('rows', String(ECHO_SOURCE_NETWORK_LIMITS.resultsPerSearch));
  url.searchParams.set('sort', 'relevancy');
  url.searchParams.set('type', 'edanmdm');
  url.searchParams.set('row_group', 'objects');
  return boundedJsonGet(url, options, smithsonianKey(apiKey));
}

export function smithsonianDetail(id, apiKey, options = {}) {
  const safeId = recordId(id, /^[A-Za-z0-9:._-]+$/u);
  const url = new URL(`https://api.si.edu/openaccess/api/v1.0/content/${encodeURIComponent(safeId)}/`);
  return boundedJsonGet(url, options, smithsonianKey(apiKey));
}
