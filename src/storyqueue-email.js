import PostalMime from "postal-mime";
import {
  STORYQUEUE_ROUTING_ADDRESS,
  normalizeStoryqueuePayload,
} from "./storyqueue.js";

export const MAX_STORYQUEUE_RAW_BYTES = 262_144;

async function boundedRaw(message) {
  if (Number.isFinite(message.rawSize) && message.rawSize > MAX_STORYQUEUE_RAW_BYTES) {
    throw new Error("MESSAGE_TOO_LARGE");
  }
  if (message.raw instanceof Uint8Array) {
    if (message.raw.byteLength > MAX_STORYQUEUE_RAW_BYTES) throw new Error("MESSAGE_TOO_LARGE");
    return message.raw;
  }
  if (typeof message.raw === "string") {
    const bytes = new TextEncoder().encode(message.raw);
    if (bytes.byteLength > MAX_STORYQUEUE_RAW_BYTES) throw new Error("MESSAGE_TOO_LARGE");
    return bytes;
  }
  if (!message.raw?.getReader) throw new Error("MESSAGE_UNAVAILABLE");

  const reader = message.raw.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_STORYQUEUE_RAW_BYTES) {
        await reader.cancel();
        throw new Error("MESSAGE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function parseStoryqueueEmail(message) {
  const recipient = String(message?.to || "").trim().toLowerCase();
  if (recipient !== STORYQUEUE_ROUTING_ADDRESS) throw new Error("UNEXPECTED_RECIPIENT");

  const raw = await boundedRaw(message);
  const parsed = await PostalMime.parse(raw, {
    attachmentEncoding: "base64",
    maxNestingDepth: 12,
    maxHeadersSize: 32_768,
    maxRfc822NestingDepth: 1,
    rfc822Attachments: true,
  });
  const sender = parsed.from?.address;
  if (!sender) throw new Error("SENDER_UNAVAILABLE");

  return normalizeStoryqueuePayload({
    schema_version: "1",
    recipient,
    sender,
    envelope_sender: message.from || null,
    subject: parsed.subject || null,
    message_id: parsed.messageId || null,
    received_at: parsed.date || new Date().toISOString(),
    plain_text: parsed.text || "",
    attachment_count: Array.isArray(parsed.attachments) ? parsed.attachments.length : 0,
  });
}
