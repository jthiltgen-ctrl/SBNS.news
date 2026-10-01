PRAGMA foreign_keys = ON;

CREATE TABLE storyqueue_messages (
  id TEXT PRIMARY KEY,
  message_key TEXT NOT NULL UNIQUE CHECK (length(message_key) = 64 AND message_key NOT GLOB '*[^0-9a-f]*'),
  message_id TEXT,
  sender_email TEXT NOT NULL CHECK (length(trim(sender_email)) BETWEEN 3 AND 320),
  recipient_email TEXT NOT NULL CHECK (length(trim(recipient_email)) BETWEEN 3 AND 320),
  subject TEXT,
  received_at TEXT NOT NULL,
  note_excerpt TEXT,
  url_count INTEGER NOT NULL CHECK (url_count BETWEEN 1 AND 10),
  intake_ids_json TEXT NOT NULL CHECK (json_valid(intake_ids_json) AND json_type(intake_ids_json) = 'array'),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_storyqueue_messages_received ON storyqueue_messages(received_at DESC, id DESC);
CREATE INDEX idx_storyqueue_messages_sender ON storyqueue_messages(sender_email, received_at DESC);

UPDATE sbns_meta SET value = '7' WHERE key = 'schema_version' AND value = '6';
