export const STORYQUEUE_ADDRESS = "storyqueue@shockedbutnotsurprised.news";
export const STORYQUEUE_SCHEMA_VERSION = "1";
export const MAX_STORYQUEUE_TEXT = 12_000;
export const MAX_STORYQUEUE_URLS = 10;

const TRACKING_PARAMETERS = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "ref", "ref_src"]);

function clean(value, max) {
  if (value == null) return null;
  const text = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

export function normalizeStoryUrl(value) {
  const url = new URL(String(value));
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) throw new Error("Story URL must be credential-free HTTP or HTTPS.");
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (lower.startsWith("utm_") || TRACKING_PARAMETERS.has(lower)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

export function extractStoryUrls(text, supplied = []) {
  const found = [];
  const pattern = /https?:\/\/[^\s<>"')\]}]+/gi;
  for (const match of String(text || "").matchAll(pattern)) found.push(match[0].replace(/[.,;:!?]+$/, ""));
  if (Array.isArray(supplied)) found.push(...supplied);
  const unique = [];
  const seen = new Set();
  for (const value of found) {
    try {
      const normalized = normalizeStoryUrl(value);
      if (!seen.has(normalized)) { seen.add(normalized); unique.push(normalized); }
    } catch { /* invalid or unsafe URL is ignored */ }
    if (unique.length >= MAX_STORYQUEUE_URLS) break;
  }
  return unique;
}

export function senderAllowed(sender, policy) {
  const email = String(sender || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return false;
  const rules = String(policy || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!rules.length) return false;
  if (rules.includes("*")) return true;
  return rules.some((rule) => rule === email || (rule.startsWith("*@") && email.endsWith(rule.slice(1))));
}

export function normalizeStoryqueuePayload(input = {}) {
  if (input.schema_version !== STORYQUEUE_SCHEMA_VERSION) throw new Error("Unsupported storyqueue schema version.");
  const recipient = clean(input.recipient, 320)?.toLowerCase();
  const sender = clean(input.sender, 320)?.toLowerCase();
  if (recipient !== STORYQUEUE_ADDRESS) throw new Error("Unexpected storyqueue recipient.");
  if (!sender || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) throw new Error("Valid sender email is required.");
  const subject = clean(input.subject, 500);
  const messageId = clean(input.message_id, 500);
  const received = input.received_at ? new Date(input.received_at) : new Date();
  if (Number.isNaN(received.valueOf())) throw new Error("Valid received_at is required.");
  const plainText = clean(input.plain_text, MAX_STORYQUEUE_TEXT) || "";
  const attachmentCount = Number.isInteger(input.attachment_count) && input.attachment_count >= 0 ? Math.min(input.attachment_count, 100) : 0;
  const urls = extractStoryUrls(plainText, input.urls);
  return {
    recipient,
    sender,
    subject,
    message_id: messageId,
    received_at: received.toISOString(),
    plain_text: plainText,
    note_excerpt: plainText ? plainText.slice(0, 2_000) : null,
    attachment_count: attachmentCount,
    urls,
  };
}

export async function storyqueueMessageKey(payload) {
  const canonical = JSON.stringify({
    message_id: payload.message_id || null,
    sender: payload.sender,
    recipient: payload.recipient,
    received_at: payload.received_at,
    subject: payload.subject || null,
    urls: payload.urls,
  });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function bearerMatches(value, expected) {
  const token = String(value || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || !expected) return false;
  const digest = async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [left, right] = await Promise.all([digest(token), digest(String(expected))]);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left[i] ^ right[i];
  return mismatch === 0;
}
