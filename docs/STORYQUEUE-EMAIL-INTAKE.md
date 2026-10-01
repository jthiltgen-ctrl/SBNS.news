# SBNS Story Queue Email Intake

Status: application integration in draft PR #46; mail-host activation remains external
Address: `storyqueue@shockedbutnotsurprised.news`
Purpose: ordinary-email submission of public story links into the authenticated Newsroom queue.

## 1. Role

Story Queue email is another Newsroom intake surface, not a publication path.

The intended flow is:

`email -> bounded mail-host relay -> authenticated Newsroom bridge -> dedupe -> visitor intake -> existing analysis queue -> human editorial review`

After analysis, an intake may also contribute to the Watchdesk learned-source candidate list. A source is never silently promoted into scheduled monitoring merely because someone emailed one of its links.

## 2. Channel classification

`storyqueue@shockedbutnotsurprised.news` is ordinary editorial email.

It is **not**:

- anonymous;
- a confidential-source channel;
- Secure Source / GlobaLeaks;
- an encrypted dropbox;
- authorization to send unpublished sensitive material;
- authorization for automatic publication.

Secure Source remains a separate human-governed system with no automatic transfer of raw confidential material into AI, Watchdesk, analytics, GitHub, or ordinary email workflows.

## 3. Existing mail-provider boundary

SBNS mail remains hosted through GreenGeeks. Do not enable Cloudflare Email Routing for the apex domain merely to automate Story Queue: Cloudflare Email Routing requires its own MX records and would conflict with the existing external mail provider.

The integration therefore preserves GreenGeeks mail delivery and uses GreenGeeks/cPanel's supported **Pipe to a program** capability for the Story Queue address/filter.

The repository includes:

`integrations/storyqueue/greengeeks-pipe.php`

The relay reads a single RFC 5322 message from standard input, extracts only bounded ordinary-email metadata, a plain-text note, and public HTTP(S) links, then sends a signed JSON payload to the Newsroom bridge.

Raw MIME and attachment bytes are not sent to the Newsroom.

## 4. Newsroom bridge

The admin Worker wrapper handles:

`POST /api/internal/storyqueue/email`

Authentication uses a bearer token stored as the admin Worker secret:

`STORYQUEUE_INGEST_TOKEN`

The endpoint is intentionally outside the human Cloudflare Access session path because the GreenGeeks relay is a machine client. It is protected by the dedicated high-entropy bearer secret and a sender policy.

The normal authenticated Newsroom status endpoint is:

`GET /api/admin/storyqueue/status`

The Newsroom UI shows:

- address;
- whether the bridge secret is configured;
- whether a sender policy is configured;
- number of email messages received;
- number of story links received;
- last received time;
- attachment-processing boundary;
- explicit reminder that the channel is not Secure Source.

## 5. Sender policy

The admin Worker secret/variable:

`STORYQUEUE_ALLOWED_SENDERS`

is a comma-separated list of exact addresses or bounded domain wildcards such as:

`editor@example.com,reporter@example.org,*@trusted-newsroom.org`

The safe default is **deny all** when this policy is absent.

A literal `*` is technically supported for a later deliberate public-opening decision, but it is not the initial recommended state.

This preserves the previously approved authorized-sender-first rollout while leaving room for a future public story-suggestion channel if editorial experience supports it.

## 6. Intake limits

Per email:

- maximum raw message accepted by the GreenGeeks relay: 256 KiB;
- maximum plain-text note sent onward: 12,000 bytes;
- maximum Newsroom note excerpt retained on each intake: 2,000 characters;
- maximum public story URLs: 10;
- only credential-free `http` and `https` URLs qualify;
- common tracking parameters and URL fragments are removed before dedupe;
- attachments are counted for provenance but ignored;
- HTML-only/attachment-only content does not become attachment ingestion.

If an authorized email contains no public story link, the email is recorded in the audit ledger as handled but no Newsroom story intake is created.

## 7. Dedupe and provenance

Story Queue uses the existing append-only `audit_events` ledger rather than a new message table.

Each accepted email creates one `storyqueue.email_received` audit event whose entity ID is a deterministic SHA-256 message key derived from:

- Message-ID when available;
- sender;
- recipient;
- received timestamp;
- subject;
- normalized public URLs.

The audit metadata stores bounded ordinary-email provenance and the resulting intake IDs. It does not store raw MIME or attachment bytes.

Each new story URL creates a normal `visitor` intake and pending analysis job. If the normalized URL already exists in the Newsroom, the email records the existing intake relationship rather than creating a duplicate intake.

## 8. Analysis and source learning

A Story Queue intake enters the same analysis path as other ordinary editorial submissions.

It does not receive a weaker evidence standard because it arrived by email.

After successful analysis, the existing source-learning control may observe the story host. Only an analyzed intake with a non-reject recommendation and a source state stronger than `unverified` can advance the host into an eligible learned-source candidate.

Even then, scheduled Watchdesk monitoring requires explicit human configuration/approval in the Newsroom.

## 9. GreenGeeks relay configuration

The relay expects a protected configuration file outside the public web root. Default path:

`~/.config/sbns/storyqueue.json`

Example structure:

```json
{
  "endpoint": "https://<admin-worker-host>/api/internal/storyqueue/email",
  "token": "<same high-entropy value as STORYQUEUE_INGEST_TOKEN>"
}
```

Protect the configuration file with owner-only permissions.

The cPanel pipe command should point to the installed executable PHP relay. Do not commit the token, mailbox password, server credentials, or real sender allowlist to GitHub.

## 10. Activation sequence

Activation is intentionally separate from merging the code.

1. Merge and deploy the validated Newsroom changes.
2. Apply the existing PR #46 database migrations required by the broader source-learning work.
3. Set `STORYQUEUE_INGEST_TOKEN` on the admin Worker.
4. Set an initial narrow `STORYQUEUE_ALLOWED_SENDERS` policy.
5. Verify `GET /api/admin/storyqueue/status` reports the bridge and sender policy configured.
6. Install the GreenGeeks relay outside the public web root.
7. Create the protected relay configuration file.
8. Configure the `storyqueue@...` cPanel email rule/forwarder to pipe to the relay while preserving the intended mailbox behavior.
9. Send one controlled test email containing one public story URL and no attachment.
10. Confirm one `visitor` intake appears, analysis queues once, the email audit event is present, and a resend does not duplicate it.
11. Send a second controlled test containing an attachment and verify the attachment is ignored.
12. Only then treat email-to-Newsroom automation as live.

If the GreenGeeks filter/forwarder configuration would unexpectedly eliminate desired mailbox retention, stop and resolve the mail-host behavior before activating the pipe.

## 11. Stop conditions

Disable the pipe or bridge if:

- duplicate email ingestion occurs;
- unauthorized senders pass the policy;
- attachments or raw MIME reach the Newsroom;
- mail delivery for other SBNS addresses changes;
- GreenGeeks MX/SPF/DKIM/DMARC behavior changes unexpectedly;
- the bridge creates substantial spam/noise burden;
- the channel is mistaken for Secure Source.

No change to apex MX records is part of this integration.
