import { retrieveSource, validateSourceUrl } from "./source-retrieval.js";

export const MAX_PRIMARY_EXPANSIONS = 2;
const MAX_SCANNED_LINKS = 40;
const MAX_LINK_LENGTH = 2_048;

export function approvedPublicRecordHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host.endsWith(".gov") || host.endsWith(".gov.uk");
}

export function primaryRecordLinks(text, submittedUrl) {
  const found = [];
  const seen = new Set();
  const submitted = validateSourceUrl(submittedUrl).href;
  const matches = String(text || "").match(/https?:\/\/[^\s<>"'\])]+/gi) || [];
  for (const raw of matches.slice(0, MAX_SCANNED_LINKS)) {
    if (raw.length > MAX_LINK_LENGTH) continue;
    try {
      const url = validateSourceUrl(raw.replace(/[.,;]+$/, ""));
      url.hash = "";
      if (!approvedPublicRecordHost(url.hostname) || url.href === submitted || seen.has(url.href)) continue;
      seen.add(url.href);
      found.push(url.href);
      if (found.length === MAX_PRIMARY_EXPANSIONS) break;
    } catch { /* An invalid citation is not a fetch target. */ }
  }
  return found;
}

export async function expandPrimaryRecords(submittedEvidence, env, options = {}) {
  const urls = primaryRecordLinks(submittedEvidence.text, submittedEvidence.finalUrl);
  const records = [];
  const failures = [];
  for (const url of urls) {
    try {
      const record = await retrieveSource(url, env, { ...options, allowHost: approvedPublicRecordHost });
      records.push(record);
    } catch (error) {
      failures.push({ url, code: error?.code || "retrieval_failed", message: error?.safeMessage || "Linked public record could not be inspected." });
    }
  }
  return { attempted: urls, records, failures };
}
