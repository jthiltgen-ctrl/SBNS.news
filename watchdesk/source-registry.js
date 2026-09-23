export const WATCHDESK_SOURCES = Object.freeze([
  {
    id: "gao-reports",
    name: "U.S. Government Accountability Office — Recent Reports & Testimonies",
    source_class: "primary_oversight",
    jurisdiction: "United States",
    discovery_url: "https://www.gao.gov/widgets/reports",
    adapter: "html_links",
    enabled: true,
    primary_record: true,
    allowed_hosts: ["www.gao.gov", "gao.gov"],
    allowed_path_prefixes: ["/products/"],
    require_date: true,
    topic: "federal oversight",
    notes: "Official GAO report listing; prefer reports, audits, evaluations, and formal recommendations.",
  },
  {
    id: "doj-oig-reports",
    name: "U.S. Department of Justice Office of the Inspector General — Reports",
    source_class: "primary_oversight",
    jurisdiction: "United States",
    discovery_url: "https://oig.justice.gov/reports",
    adapter: "html_links",
    enabled: true,
    primary_record: true,
    allowed_hosts: ["oig.justice.gov"],
    allowed_path_prefixes: ["/reports/"],
    require_date: true,
    include_listing_context: true,
    topic: "justice oversight",
    notes: "Official DOJ OIG audits, evaluations, reviews, and management advisories.",
  },
  {
    id: "iowa-auditor-reports",
    name: "Iowa Auditor of State — Audit Reports",
    source_class: "primary_oversight",
    jurisdiction: "Iowa",
    discovery_url: "https://www.auditor.iowa.gov/reports/audit-reports",
    adapter: "html_links",
    enabled: true,
    primary_record: true,
    allowed_hosts: ["www.auditor.iowa.gov", "auditor.iowa.gov"],
    allowed_path_prefixes: ["/reports/"],
    require_date: true,
    include_listing_context: true,
    topic: "Iowa public audit",
    notes: "Official state audit records; routine financial statements still have to pass the fit gate.",
  },
  {
    id: "dubuque-city-news",
    name: "City of Dubuque — Public Notices",
    source_class: "local_regional",
    jurisdiction: "Dubuque, Iowa",
    discovery_url: "https://www.cityofdubuque.org/m/NewsFlash",
    adapter: "html_links",
    enabled: true,
    primary_record: false,
    allowed_hosts: ["www.cityofdubuque.org", "cityofdubuque.org"],
    allowed_path_prefixes: ["/m/NewsFlash/Home/Detail/"],
    topic: "Dubuque public accountability",
    notes: "Official local institutional signal. Routine notices stop deterministically; retain the underlying public record when identified.",
  },
  {
    id: "propublica-archive",
    name: "ProPublica — Reporting Archive",
    source_class: "secondary_reporting_signal",
    jurisdiction: "National / Regional",
    discovery_url: "https://www.propublica.org/archive",
    adapter: "html_links",
    enabled: true,
    primary_record: false,
    allowed_hosts: ["www.propublica.org", "propublica.org"],
    allowed_path_prefixes: ["/article/"],
    topic: "investigative reporting signal",
    notes: "Public secondary discovery signal. Retain a primary-record link when one is present; otherwise mark it as needed.",
  },
]);

export const SOURCE_CLASSES = Object.freeze(new Set([
  "primary_oversight",
  "primary_institutional",
  "secondary_reporting_signal",
  "local_regional",
]));

export function validateSourceRegistry(sources = WATCHDESK_SOURCES) {
  if (!Array.isArray(sources) || !sources.length) throw new Error("Watchdesk source registry must not be empty.");
  const ids = new Set();
  for (const source of sources) {
    if (!source || typeof source !== "object") throw new Error("Every Watchdesk source must be an object.");
    if (!/^[a-z0-9-]+$/.test(source.id || "") || ids.has(source.id)) throw new Error(`Invalid or duplicate source id: ${source.id || "(missing)"}`);
    ids.add(source.id);
    if (!source.name || !SOURCE_CLASSES.has(source.source_class) || !source.jurisdiction) throw new Error(`Source ${source.id} is missing required classification metadata.`);
    if (!new Set(["html_links", "rss_atom"]).has(source.adapter)) throw new Error(`Source ${source.id} uses an unsupported adapter.`);
    const url = new URL(source.discovery_url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error(`Source ${source.id} must use a credential-free HTTPS URL.`);
    if (!Array.isArray(source.allowed_hosts) || !source.allowed_hosts.includes(url.hostname)) throw new Error(`Source ${source.id} must allow its discovery host explicitly.`);
    if (!Array.isArray(source.allowed_path_prefixes) || !source.allowed_path_prefixes.length) throw new Error(`Source ${source.id} must define bounded link paths.`);
    if (typeof source.enabled !== "boolean" || typeof source.primary_record !== "boolean") throw new Error(`Source ${source.id} must declare enabled and primary_record booleans.`);
    if (source.require_date != null && typeof source.require_date !== "boolean") throw new Error(`Source ${source.id} has an invalid require_date value.`);
    if (source.include_listing_context != null && typeof source.include_listing_context !== "boolean") throw new Error(`Source ${source.id} has an invalid include_listing_context value.`);
  }
  return sources;
}
