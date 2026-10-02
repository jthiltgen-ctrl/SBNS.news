// PR C: development-only, metadata-first public-source adapters. Nothing in a
// Worker imports this module; a search hit is not an Echo assessment or decision.
import { locSearch, locDetail, smithsonianSearch, smithsonianDetail, EchoSourceNetworkError } from "./echo-source-network.js";
import { normalizeEchoSource } from "./echo-orchestration.js";

export const SOURCE_RECORD_SCHEMA = "echo-source-record-v1";
export const MAX_RESULTS_PER_ADAPTER = 10;
export const MAX_TOTAL_RESULTS = 20;

export class EchoSourceInputError extends Error {
  constructor(code, message) { super(message); this.name = "EchoSourceInputError"; this.code = code; }
}
const fail = (code, message) => { throw new EchoSourceInputError(code, message); };
const plain = (value) => value && typeof value === "object" && !Array.isArray(value);
const text = (value, limit = 500) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) || null : null;
const firstText = (value, limit) => text(Array.isArray(value) ? value.find((item) => typeof item === "string") : value, limit);
const strings = (value, limit = 5) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string").map((entry) => text(entry, 160)).filter(Boolean).slice(0, limit) : [];
// The network response is already byte-capped. Scan every supplied note for
// explicit cultural cautions, while retaining only one short signal below.
const labeledPhrases = (value) => Array.isArray(value) ? value.flatMap((entry) =>
  typeof entry === "string" ? [entry] : plain(entry) ? [entry.label, entry.name, entry.content, entry.description] : []).filter((item) => typeof item === "string") : [];
const stamp = (value) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("INVALID_RETRIEVAL_TIME", "A retrieval timestamp is required");
  return new Date(value).toISOString();
};
function smithsonianRecordUrl(value) {
  if (typeof value !== "string") return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !(host === "si.edu" || host.endsWith(".si.edu"))) return null;
  // Legacy catalog links may use HTTP even though the approved public record
  // host supports HTTPS. This URL is metadata only and is never fetched here.
  url.protocol = "https:";
  // Record links are display metadata, not a place to retain tracking tokens,
  // credential-like query parameters, or fragments from upstream records.
  url.search = "";
  url.hash = "";
  return url.toString();
}
function locIdentity(raw) {
  if (!plain(raw)) return null;
  let url;
  try { url = new URL(raw.id); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.hostname.toLowerCase() !== "www.loc.gov" || url.username || url.password || url.port || url.search || url.hash) return null;
  const match = /^\/item\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,3})\/?$/.exec(url.pathname);
  if (!match || match[1].length > 150 || match[1].split("/").some((part) => part === "." || part === "..")) return null;
  const id = match[1];
  return { id, url: `https://www.loc.gov/item/${id}/` };
}
function smithsonianIdentity(raw) {
  if (!plain(raw)) return null;
  const id = text(raw.id ?? raw.content?.descriptiveNonRepeating?.record_ID, 150);
  if (!id || !/^[A-Za-z0-9:._-]+$/.test(id)) return null;
  const nestedId = text(raw.content?.descriptiveNonRepeating?.record_ID, 150);
  if (nestedId && /^edanmdm[-:]/.test(id) && ![ `edanmdm-${nestedId}`, `edanmdm:${nestedId}` ].includes(id)) return null;
  const url = smithsonianRecordUrl(raw.content?.descriptiveNonRepeating?.record_link);
  return url ? { id, url } : null;
}
function conservativeRights(statements, { metadataAccess = null, mediaAccess = null } = {}) {
  const statement = statements.map((entry) => text(entry, 300)).filter(Boolean).join("; ").slice(0, 400) || null;
  const explicitPublicDomain = statements.some((entry) => /^(?:this (?:item|work|object) is )?(?:in the )?public domain\.?$/i.test(text(entry) ?? ""));
  const explicitOpen = statements.some((entry) => /^(?:licensed under )?(?:cc[- ]?by(?:[- ]?sa)?(?: [0-9.]+)?|creative commons attribution(?:[- ]sharealike)?(?: [0-9.]+)?)\.?$/i.test(text(entry) ?? ""));
  return {
    status: explicitPublicDomain ? "public_domain" : explicitOpen ? "open_license" : "unknown",
    scope: "catalog_record", statement,
    // Smithsonian metadata and media licenses are separate; neither silently
    // changes the artifact-level result or creates an Echo rights review.
    metadataLicenseHint: text(metadataAccess, 100), mediaLicenseHint: text(mediaAccess, 100),
  };
}
function protocolSignal(values) {
  // Only an explicit catalog statement can establish that no special protocol
  // was identified. Silence (including an unrestricted copyright license) is
  // still unclear, and any caution takes precedence over such a statement.
  const explicitNone = (entry) => /^no (?:known )?(?:special )?(?:cultural|community|traditional knowledge) (?:protocols?|(?:use |protocol )?restrictions?) (?:have been |were |are )?identified(?: for (?:this |the )?(?:item|work|object))?\.?$/i.test(entry.trim());
  const caution = values.find((entry) => !explicitNone(entry) &&
    /traditional knowledge|cultur(?:al|ally) sensitiv|indigen|tribal|ceremonial|sacred|human remains|restricted access|community protocol/i.test(entry));
  const clear = values.find(explicitNone);
  return { status: caution ? "indicated" : clear ? "none_identified" : "unclear", basis: text(caution ?? clear, 250) };
}
function mergeProtocolSignals(...signals) {
  return signals.find((signal) => signal?.status === "indicated") ??
    signals.find((signal) => signal?.status === "none_identified") ??
    { status: "unclear", basis: null };
}
function baseRecord({ adapter, id, url, title, creators, date, artifactType, description, authorityBasis, rights, protocol, retrievedAt, versionId }) {
  return {
    schema: SOURCE_RECORD_SCHEMA, adapter, recordId: `${adapter}:${id}`,
    canonicalIdentifier: `${adapter}:record:${id}`, canonicalUrl: url,
    title, creators, date, artifactType, description,
    sourceAuthorityBasis: authorityBasis, rights, culturalProtocol: protocol,
    retrievedAt: stamp(retrievedAt), versionId,
    context: { status: "discovery_only", originalContext: null, contextAuthority: "limited", basis: null, creatorIntentStatus: "not_claimed" },
  };
}

export function canonicalDiscoveryQuery(raw) {
  if (!plain(raw) || Object.keys(raw).some((key) => key !== "terms" && key !== "excludeIds")) fail("INVALID_QUERY", "Use only bounded terms and optional exclusions");
  if (!Array.isArray(raw.terms) || raw.terms.length < 1 || raw.terms.length > 3) fail("INVALID_QUERY", "Provide one to three search terms");
  const terms = raw.terms.map((term) => {
    const value = text(term, 81);
    if (!value || value.length > 80 || /[\r\n]/.test(term)) fail("INVALID_QUERY", "Each term must be concise text (at most 80 characters)");
    return value;
  });
  if (terms.join(" ").length > 160) fail("INVALID_QUERY", "Combined search terms exceed 160 characters");
  const excludeIds = raw.excludeIds ?? [];
  if (!Array.isArray(excludeIds) || excludeIds.length > 20 || excludeIds.some((id) => typeof id !== "string" || id.length > 200)) fail("INVALID_QUERY", "Exclusions must be bounded record IDs");
  return { terms, excludeIds: [...new Set(excludeIds)].sort() };
}

export function normalizeLocResult(raw, retrievedAt) {
  const identity = locIdentity(raw);
  const title = text(raw?.title, 250);
  if (!identity || !title) return null;
  const rights = conservativeRights([...strings(raw.rights_advisory), ...strings(raw.rights), ...strings(raw.rights_information)]);
  const protocol = protocolSignal([...labeledPhrases(raw.access_advisory), ...labeledPhrases(raw.traditional_knowledge_labels),
    ...labeledPhrases(raw.rights_advisory), ...labeledPhrases(raw.rights)]);
  return baseRecord({ adapter: "loc", id: identity.id, url: identity.url, title,
    creators: strings(raw.contributor_names ?? raw.contributors), date: text(raw.date, 60),
    artifactType: firstText(raw.original_format ?? raw.item_type, 100) ?? "unspecified",
    description: firstText(raw.description ?? raw.summary, 500),
    authorityBasis: "Library of Congress collection record; catalog metadata establishes identity, not interpretation",
    rights, protocol, retrievedAt, versionId: text(raw._version_?.toString() ?? raw.timestamp, 100) });
}

function smithField(content, field, preferredLabels = []) {
  const values = content?.freetext?.[field];
  if (!Array.isArray(values)) return null;
  const preferred = values.find((entry) => plain(entry) && preferredLabels.includes(String(entry.label ?? "").toLowerCase()));
  return text((preferred ?? values.find((entry) => plain(entry) && typeof entry.content === "string"))?.content, 500);
}
function smithsonianContextNote(content) {
  const notes = content?.freetext?.notes;
  if (!Array.isArray(notes)) return null;
  const allowed = new Set(["historical context", "curatorial description", "context"]);
  const match = notes.find((entry) => plain(entry) && allowed.has(String(entry.label ?? "").trim().toLowerCase()));
  return text(match?.content, 500);
}
export function normalizeSmithsonianResult(raw, retrievedAt) {
  const identity = smithsonianIdentity(raw);
  const title = text(raw?.title ?? raw?.content?.descriptiveNonRepeating?.title?.content, 250);
  if (!identity || !title) return null;
  const content = raw.content;
  const accessNotes = [...labeledPhrases(content?.freetext?.notes), ...labeledPhrases(content?.freetext?.physicalDescription),
    text(content?.descriptiveNonRepeating?.metadata_usage?.access, 100)].filter(Boolean);
  const media = content?.descriptiveNonRepeating?.online_media?.media;
  const mediaAccess = Array.isArray(media) ? text(media.find((entry) => entry?.usage?.access)?.usage?.access, 100) : null;
  return baseRecord({ adapter: "smithsonian", id: identity.id, url: identity.url, title,
    creators: [smithField(content, "name", ["artist", "creator", "maker", "author"])].filter(Boolean),
    date: smithField(content, "date", ["date", "date made", "date of creation"]),
    artifactType: smithField(content, "objectType") ?? "unspecified",
    description: smithField(content, "notes", ["description", "summary"]),
    authorityBasis: "Smithsonian collection record; catalog metadata establishes identity, not interpretation",
    rights: conservativeRights([], { metadataAccess: content?.descriptiveNonRepeating?.metadata_usage?.access, mediaAccess }),
    protocol: protocolSignal(accessNotes), retrievedAt, versionId: null });
}

function contextStatement(raw, adapter) {
  if (adapter === "loc") return firstText(raw?.summary, 500);
  return smithsonianContextNote(raw?.content);
}
function contextFromDetail(record, detail, retrievedAt) {
  const statement = contextStatement(detail, record.adapter);
  const status = statement && statement.length >= 40 ? "source_supported" : "insufficient";
  return { ...record, retrievedAt: stamp(retrievedAt),
    context: { status, originalContext: status === "source_supported" ? statement : null,
      contextAuthority: "limited", basis: status === "source_supported" ? `${record.adapter} detailed collection metadata explicitly describes context; interpretation still requires review` : "Detailed collection metadata does not establish original historical context",
      creatorIntentStatus: "not_claimed" } };
}
export function verifyLocContext(record, response, retrievedAt) {
  if (record?.adapter !== "loc" || !plain(response?.item)) fail("INVALID_DETAIL", "LOC item detail is required");
  const normalized = normalizeLocResult(response.item, retrievedAt);
  if (!normalized || normalized.canonicalIdentifier !== record.canonicalIdentifier) fail("IDENTITY_MISMATCH", "LOC detail does not match discovery identity");
  const detailProtocol = protocolSignal([...labeledPhrases(response.traditional_knowledge_labels), ...labeledPhrases(response.item.access_advisory),
    ...labeledPhrases(response.item.rights_advisory), ...labeledPhrases(response.item.rights)]);
  const detailRights = conservativeRights([...strings(response.item.rights_advisory), ...strings(response.item.rights), ...strings(response.item.rights_information)]);
  const merged = { ...normalized,
    culturalProtocol: mergeProtocolSignals(detailProtocol, normalized.culturalProtocol, record.culturalProtocol),
    rights: detailRights.status !== "unknown" || detailRights.statement ? detailRights : record.rights };
  return contextFromDetail(merged, response.item, retrievedAt);
}
export function verifySmithsonianContext(record, response, retrievedAt) {
  if (record?.adapter !== "smithsonian" || !plain(response?.response)) fail("INVALID_DETAIL", "Smithsonian object detail is required");
  const normalized = normalizeSmithsonianResult(response.response, retrievedAt);
  if (!normalized || normalized.canonicalIdentifier !== record.canonicalIdentifier) fail("IDENTITY_MISMATCH", "Smithsonian detail does not match discovery identity");
  const merged = { ...normalized,
    culturalProtocol: mergeProtocolSignals(normalized.culturalProtocol, record.culturalProtocol) };
  return contextFromDetail(merged, response.response, retrievedAt);
}

export function dedupeSourceRecords(records) {
  if (!Array.isArray(records)) fail("INVALID_RESULTS", "Records must be a list");
  const seenIdentifiers = new Set();
  const seenUrls = new Set();
  const result = [];
  for (const record of records) {
    if (!record || record.schema !== SOURCE_RECORD_SCHEMA) fail("INVALID_RESULTS", "Unexpected source record");
    if (seenIdentifiers.has(record.canonicalIdentifier) || seenUrls.has(record.canonicalUrl)) continue;
    seenIdentifiers.add(record.canonicalIdentifier); seenUrls.add(record.canonicalUrl);
    result.push(record);
    if (result.length === MAX_TOTAL_RESULTS) break;
  }
  return result;
}
function normalizeSearch(raw, adapter, retrievedAt, exclusions) {
  const rows = adapter === "loc" ? raw?.results : raw?.response?.rows;
  if (!Array.isArray(rows)) fail("INVALID_RESPONSE", `${adapter} search response has no result list`);
  const normalize = adapter === "loc" ? normalizeLocResult : normalizeSmithsonianResult;
  return dedupeSourceRecords(rows.slice(0, MAX_RESULTS_PER_ADAPTER).map((row) => normalize(row, retrievedAt)).filter(Boolean))
    .filter((record) => !exclusions.has(record.recordId));
}
export async function discoverLoc(query, { fetchImpl, retrievedAt = new Date().toISOString() } = {}) {
  const input = canonicalDiscoveryQuery(query);
  const raw = await locSearch(input.terms.join(" "), { fetchImpl });
  return normalizeSearch(raw, "loc", retrievedAt, new Set(input.excludeIds));
}
export async function discoverSmithsonian(query, { fetchImpl, apiKey, retrievedAt = new Date().toISOString() } = {}) {
  const input = canonicalDiscoveryQuery(query);
  if (!apiKey) fail("API_KEY_REQUIRED", "A development Smithsonian API key is required");
  const raw = await smithsonianSearch(input.terms.join(" "), apiKey, { fetchImpl });
  return normalizeSearch(raw, "smithsonian", retrievedAt, new Set(input.excludeIds));
}
export async function verifyDiscoveredContext(record, { fetchImpl, apiKey, retrievedAt = new Date().toISOString() } = {}) {
  if (!record || record.schema !== SOURCE_RECORD_SCHEMA) fail("INVALID_RECORD", "A normalized discovery record is required");
  const id = record.recordId.slice(record.adapter.length + 1);
  if (record.adapter === "loc") return verifyLocContext(record, await locDetail(id, { fetchImpl }), retrievedAt);
  if (record.adapter === "smithsonian") {
    if (!apiKey) fail("API_KEY_REQUIRED", "A development Smithsonian API key is required");
    return verifySmithsonianContext(record, await smithsonianDetail(id, apiKey, { fetchImpl }), retrievedAt);
  }
  fail("INVALID_RECORD", "Unsupported source adapter");
}
export function toEchoHistoricalSource(record) {
  if (record?.schema !== SOURCE_RECORD_SCHEMA || record.context?.status !== "source_supported") fail("CONTEXT_NOT_VERIFIED", "Discovery metadata alone cannot support an Echo context source");
  return normalizeEchoSource({ sourceRole: "historical_context", supportsField: "original_context",
    url: record.canonicalUrl, canonicalIdentifier: record.canonicalIdentifier, title: record.title,
    authorityRationale: record.context.basis, publishedAt: record.date, retrievedAt: record.retrievedAt,
    contentHash: null });
}
export { EchoSourceNetworkError };
