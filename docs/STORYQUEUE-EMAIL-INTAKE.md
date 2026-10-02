# SBNS Story Queue Email Intake

Story Queue is ordinary editorial email intake, not a publication path or confidential-source system.

Public mailbox: `storyqueue@shockedbutnotsurprised.news`<br>
Private Cloudflare ingress: `storyqueue@intake.shockedbutnotsurprised.news`

## Mail path

`GreenGeeks retained mailbox → cPanel forwarder → Cloudflare Email Routing on the intake subdomain → sbns-admin Email Worker → existing Story Queue intake/dedupe/audit/analysis path`

The publisher-facing mailbox remains a real GreenGeeks mailbox. The cPanel forwarder sends a copy to the private intake address; it must not replace the mailbox or discard its retained copy. Cloudflare Email Routing is configured only for `intake.shockedbutnotsurprised.news`. Do not enable Email Routing for the apex domain or change apex MX, ordinary editorial mail, or other mail records.

The admin Worker parses bounded RFC 5322/MIME input in its native Email Worker handler. It extracts only sender/recipient metadata, subject, message ID/date, bounded plain text, and attachment count. It does not retain or forward raw MIME, HTML, or attachment bytes. The private intake address is not a public submission mailbox and should not be advertised.

The prior shared-token HTTP bridge and GreenGeeks PHP pipe are retired. Do not restore them, retrieve their former token, or reuse that credential. Production ingress no longer depends on `STORYQUEUE_INGEST_TOKEN`.

## Channel and authority boundaries

`storyqueue@shockedbutnotsurprised.news` is ordinary editorial email. It is not anonymous, confidential, Secure Source/GlobaLeaks, or authorization to send unpublished sensitive material. Confidential-source material remains outside ordinary email automation.

The sender policy is exactly:

`*@shockedbutnotsurprised.news,jthiltgen@gmail.com,justin@jthiltgen.com`

The policy is a routing/noise control, not proof of identity or truth. The worker checks the RFC 5322 From address while retaining the mail transport envelope sender as separate provenance. Missing policy denies ingestion. Do not broaden the policy or place sender addresses in repository secrets/configuration files.

An allowed email addressed to the public mailbox may create intakes only for qualifying public HTTP(S) URLs. No safe URL means no intake and no analysis job. Relevance, reliability, and accuracy are handled downstream by normal retrieval, analysis, evidence, and human review; the mail layer is not an accuracy detector.

## Bounded processing

- Maximum raw email: 256 KiB.
- Maximum normalized plain text: 12,000 characters.
- Maximum retained intake note: 2,000 characters.
- Maximum URLs per email: 10.
- Only credential-free public HTTP(S) URLs qualify; local/private hosts are rejected.
- Common tracking parameters, fragments, default ports, and duplicate normalized URLs are removed.
- Attachments are counted for provenance and ignored; attachment bytes never enter intake or AI analysis.
- HTML-only or attachment-only content does not become text/source ingestion.

Message and URL dedupe reuse the existing persistence path. Each new URL creates a normal intake and analysis job. Existing URLs are linked rather than duplicated. Email provenance is recorded through the existing append-only audit ledger; raw MIME and attachment contents are not stored.

## Status and acceptance

The authenticated `GET /api/admin/storyqueue/status` reports whether the Email Worker handler and sender policy are configured, bounded operational counts, and recent intake identifiers. It does not reveal secrets. The Story Queue panel explicitly states that attachments are not processed and the channel is not Secure Source.

Production activation and verification are separate from code deployment:

1. Confirm the deployed admin Worker is healthy and the real GreenGeeks mailbox still receives and retains ordinary mail.
2. Configure Cloudflare Email Routing only for the `intake` subdomain and the exact private address above; verify apex MX and other mail records remain unchanged.
3. Add a cPanel forwarder from the existing public mailbox to the private intake address while retaining normal mailbox delivery.
4. Verify the exact sender policy is active and status reports the Email Worker configured.
5. Test inbound allowed one-URL email, duplicate, multiple URLs/notes, harmless attachment exclusion, unauthorized sender denial, and an allowed no-URL message.
6. Verify one admitted URL follows email → intake → analysis job → Story File, and verify the source email remains in the GreenGeeks mailbox.
7. Separately test outbound email from the real Story Queue mailbox through GreenGeeks.
8. Once the new route is verified, remove the retired HTTP-bridge secret and any installed PHP relay/configuration. Never display, retrieve, or reuse the former credential.

Do not publish a test story. Retain controlled acceptance records if there is no safe auditable cleanup operation.

## Stop conditions

Stop activation if the cPanel forwarder cannot preserve the original mailbox copy, Cloudflare setup would alter apex MX or unrelated records, unauthorized senders can create intakes, attachments/raw MIME are persisted, dedupe fails, or the ordinary mailbox/outbound service is impaired. Keep manual URL intake available if email intake fails.
