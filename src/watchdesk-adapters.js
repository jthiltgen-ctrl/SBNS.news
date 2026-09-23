const MAX_SOURCE_BYTES = 768 * 1024;
const MAX_ITEMS_PER_SOURCE = 40;
const SOURCE_TIMEOUT_MS = 10_000;
const SUBSTANTIVE_ABSTRACT = /\b(found|reported|identified|determined|estimated|documented|did not|does not|lacked|failed|reduced|increased|recommended|prohibits?|requires?)\b|\b\d+(?:[,.]\d+)?\s*(?:percent|%|million|billion|hours|years?)\b/i;

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'");
}

function plainText(value) {
  return decodeEntities(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function tagValue(fragment, names) {
  for (const name of names) {
    const match = fragment.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match) return plainText(match[1]);
  }
  return null;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

export function normalizeDate(value) {
  if (!value) return null;
  const text = plainText(value);
  const slash = text.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2})\b/);
  const candidate = slash ? `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}T00:00:00.000Z` : text;
  const date = new Date(candidate);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function allowedLink(source, href) {
  let url;
  try { url = new URL(href, source.discovery_url); } catch { return null; }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) return null;
  if (!source.allowed_hosts.includes(url.hostname)) return null;
  if (!source.allowed_path_prefixes.some((prefix) => url.pathname.startsWith(prefix))) return null;
  return url.href;
}

export function parseHtmlLinks(html, source) {
  const clean = String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const items = [];
  const seen = new Set();
  const anchors = clean.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi);
  for (const match of anchors) {
    const tag = match[0];
    const url = allowedLink(source, attribute(tag.match(/^<a\b[^>]*>/i)?.[0] || "", "href"));
    const rawTitle = plainText(tag);
    if (!url || rawTitle.length < 12 || rawTitle.length > 500 || seen.has(url)) continue;
    const around = plainText(clean.slice(Math.max(0, match.index - 140), Math.min(clean.length, match.index + tag.length + 140)));
    const dateText = around.match(/\b(?:\d{4}-\d{2}-\d{2}|(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/20\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+20\d{2})\b/i)?.[0] || null;
    if (source.require_date && !dateText) continue;
    const title = rawTitle.replace(/^\s*(?:\d{4}-\d{2}-\d{2}|(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/20\d{2})\s+/, "").trim();
    seen.add(url);
    items.push({ title, url, published_at: normalizeDate(dateText), summary: source.include_listing_context ? around : null });
    if (items.length >= MAX_ITEMS_PER_SOURCE) break;
  }
  return items;
}

export function parseRssAtom(xml, source) {
  const entries = [...String(xml || "").matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  const items = [];
  const seen = new Set();
  for (const entry of entries) {
    const fragment = entry[2];
    const title = tagValue(fragment, ["title"]);
    const linkTag = fragment.match(/<link\b[^>]*>/i)?.[0];
    const href = (linkTag ? attribute(linkTag, "href") : null) || tagValue(fragment, ["link", "guid"]);
    const url = allowedLink(source, href);
    if (!title || !url || seen.has(url)) continue;
    const publishedAt = normalizeDate(tagValue(fragment, ["pubDate", "published", "updated", "dc:date"]));
    if (source.require_date && !publishedAt) continue;
    const summary = tagValue(fragment, ["description", "summary", "content:encoded", "content"]);
    const abstract = source.official_report_abstract && /^What GAO Found\b/i.test(summary || "")
      && summary.length >= 120 && SUBSTANTIVE_ABSTRACT.test(summary.replace(/^What GAO Found\b/i, ""));
    seen.add(url);
    items.push({
      title,
      url,
      published_at: publishedAt,
      summary,
      ...(abstract ? {
        record_summary: `The official report feed abstract states: ${summary}`,
        evidence_review_state: "PARTIALLY REVIEWED",
        reviewed_material: "Official report abstract in the first-party RSS feed; full report not reviewed",
      } : {}),
    });
    if (items.length >= MAX_ITEMS_PER_SOURCE) break;
  }
  return items;
}

async function boundedText(response) {
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > MAX_SOURCE_BYTES) throw new Error("SOURCE_TOO_LARGE");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error("SOURCE_TOO_LARGE"); }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

export async function fetchRegistrySource(source, fetchImpl = fetch) {
  const response = await fetchImpl(source.discovery_url, {
    headers: { accept: "text/html, application/rss+xml, application/atom+xml, application/xml;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  const finalUrl = new URL(response.url || source.discovery_url);
  if (!source.allowed_hosts.includes(finalUrl.hostname)) throw new Error("SOURCE_REDIRECT_NOT_ALLOWED");
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("html") && !contentType.includes("xml") && !contentType.includes("rss") && !contentType.includes("atom")) throw new Error("SOURCE_TYPE_NOT_ALLOWED");
  const body = await boundedText(response);
  return source.adapter === "rss_atom" ? parseRssAtom(body, source) : parseHtmlLinks(body, source);
}
