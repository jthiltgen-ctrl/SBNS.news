const RAW_LIMIT = 4 * 1024 * 1024;
const EVIDENCE_LIMIT = 250_000;
const REDIRECT_LIMIT = 5;
const FETCH_TIMEOUT_MS = 15_000;
const DIRECT_TEXT = new Set(["text/plain", "text/xml"]);
const ACCEPTED = new Set([
  "text/html", "text/plain", "application/pdf", "application/xml", "text/xml", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.text", "application/vnd.oasis.opendocument.spreadsheet",
]);

export class AnalysisFailure extends Error {
  constructor(code, message, { retryable = false, safeMessage = message } = {}) { super(message); this.code = code; this.retryable = retryable; this.safeMessage = safeMessage; }
}

function ipv4Number(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
}
function inRange(value, start, bits) { const size = 2 ** (32 - bits); return value >= start && value < start + size; }
function blockedIpv4(value) {
  return [[0x00000000,8],[0x0a000000,8],[0x64400000,10],[0x7f000000,8],[0xa9fe0000,16],[0xac100000,12],[0xc0000000,24],[0xc0000200,24],[0xc0586300,24],[0xc0a80000,16],[0xc6120000,15],[0xc6336400,24],[0xcb007100,24],[0xe0000000,4],[0xf0000000,4]].some(([start,bits])=>inRange(value,start,bits));
}
function blockedIpv6(hostname) {
  const value = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(value) || /^fe[89ab][0-9a-f]:/.test(value) || /^ff[0-9a-f]{2}:/.test(value)) return true;
  if (value.startsWith("::ffff:")) { const embedded = ipv4Number(value.slice(7)); return embedded !== null && blockedIpv4(embedded); }
  const first = Number.parseInt(value.split(":", 1)[0], 16);
  return !Number.isInteger(first) || first < 0x2000 || first > 0x3fff || value.startsWith("2001:db8:");
}

export function validateSourceUrl(input) {
  let url; try { url = new URL(input); } catch { throw new AnalysisFailure("unsafe_url", "Malformed URL.", { safeMessage: "The submitted URL is not valid." }); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new AnalysisFailure("unsafe_url", "Unsupported URL scheme or credentials.", { safeMessage: "The submitted URL is not safe to retrieve." });
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host === "localhost.localdomain" || host.endsWith(".localhost") || host.endsWith(".local")) throw new AnalysisFailure("unsafe_url", "Local hostname blocked.", { safeMessage: "The submitted URL is not safe to retrieve." });
  const v4 = ipv4Number(host); if (v4 !== null && blockedIpv4(v4)) throw new AnalysisFailure("unsafe_url", "Private or reserved IPv4 blocked.", { safeMessage: "The submitted URL is not safe to retrieve." });
  if ((host.startsWith("[") || host.includes(":")) && blockedIpv6(host)) throw new AnalysisFailure("unsafe_url", "Private or reserved IPv6 blocked.", { safeMessage: "The submitted URL is not safe to retrieve." });
  return url;
}

async function boundedBody(response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > RAW_LIMIT) throw new AnalysisFailure("document_too_large", "Content-Length exceeds limit.", { safeMessage: "Document exceeded the retrieval limit." });
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > RAW_LIMIT) { await reader.cancel(); throw new AnalysisFailure("document_too_large", "Stream exceeds limit.", { safeMessage: "Document exceeded the retrieval limit." }); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
}

function classifyHttp(status) {
  if (status === 429 || status >= 500) return new AnalysisFailure(`http_${status}`, `Upstream HTTP ${status}.`, { retryable: true, safeMessage: "The source is temporarily unavailable." });
  return new AnalysisFailure(`http_${status}`, `Source HTTP ${status}.`, { safeMessage: "The source could not be retrieved." });
}

function boundedEvidence(text) {
  if (text.length <= EVIDENCE_LIMIT) return { text, truncated: false };
  const marker = "\n\n[SBNS EVIDENCE TRUNCATED: middle omitted deterministically]\n\n";
  return { text: `${text.slice(0, 180_000)}${marker}${text.slice(-(EVIDENCE_LIMIT - 180_000 - marker.length))}`, truncated: true };
}

export async function retrieveSource(submittedUrl, env, { fetchImpl = fetch, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  let current = validateSourceUrl(submittedUrl); let redirects = 0; let response;
  while (true) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try { response = await fetchImpl(current.href, { method: "GET", headers: { Accept: "text/html,text/plain,application/pdf,application/xml,text/xml,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.spreadsheet", "User-Agent": "SBNS-Editorial-Research/1.0" }, cache: "no-store", redirect: "manual", signal: controller.signal }); }
    catch (error) { if (error?.name === "AbortError") throw new AnalysisFailure("source_timeout", "Source fetch timed out.", { retryable: true, safeMessage: "Source timed out." }); throw new AnalysisFailure("source_network", "Source fetch failed.", { retryable: true, safeMessage: "The source is temporarily unavailable." }); }
    finally { clearTimeout(timer); }
    if ([301,302,303,307,308].includes(response.status)) { const location = response.headers.get("location"); if (!location) throw new AnalysisFailure("invalid_redirect", "Redirect missing Location.", { safeMessage: "The source returned an invalid redirect." }); if (redirects++ >= REDIRECT_LIMIT) throw new AnalysisFailure("redirect_limit", "Too many redirects.", { safeMessage: "The source redirected too many times." }); current = validateSourceUrl(new URL(location, current).href); continue; }
    break;
  }
  if (!response.ok) throw classifyHttp(response.status);
  const mime = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!ACCEPTED.has(mime)) throw new AnalysisFailure("unsupported_content_type", `Unsupported content type: ${mime || "missing"}.`, { safeMessage: "Source type is not supported." });
  const bytes = await boundedBody(response);
  if (DIRECT_TEXT.has(mime)) {
    const evidence = boundedEvidence(new TextDecoder("utf-8").decode(bytes).trim());
    if (!evidence.text) throw new AnalysisFailure("malformed_document", "Document contained no readable text.", { safeMessage: "The source document contained no readable text." });
    return { originalUrl: submittedUrl, finalUrl: current.href, normalizedUrl: current.href, mimeType: mime, title: current.hostname, extractionFormat: "text", ...evidence };
  }
  const conversionOptions = { output: { format: "text" } };
  if (mime === "text/html") conversionOptions.html = { hostname: current.origin };
  if (mime === "application/pdf") conversionOptions.pdf = { metadata: false };
  let conversion; try { conversion = await env.AI.toMarkdown({ name: current.pathname.split("/").pop() || "source", blob: new Blob([bytes], { type: mime }) }, { conversionOptions }); }
  catch { throw new AnalysisFailure("extraction_failed", "Markdown conversion failed.", { retryable: true, safeMessage: "The source could not be normalized." }); }
  if (!conversion || conversion.format === "error" || typeof conversion.data !== "string") throw new AnalysisFailure("malformed_document", "Document conversion returned no text.", { safeMessage: "The source document could not be read." });
  const evidence = boundedEvidence(conversion.data.trim());
  if (!evidence.text) throw new AnalysisFailure("malformed_document", "Document contained no readable text.", { safeMessage: "The source document contained no readable text." });
  return { originalUrl: submittedUrl, finalUrl: current.href, normalizedUrl: current.href, mimeType: mime, title: conversion.name || current.hostname, extractionFormat: conversion.format, ...evidence };
}

export async function sha256(text) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(digest)].map((byte)=>byte.toString(16).padStart(2,"0")).join(""); }

export const RETRIEVAL_LIMITS = { RAW_LIMIT, EVIDENCE_LIMIT, REDIRECT_LIMIT, FETCH_TIMEOUT_MS };
