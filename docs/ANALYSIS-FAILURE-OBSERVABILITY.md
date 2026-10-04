# Analysis failure observability

The analyzer continues to reject malformed, schema-invalid, semantically invalid, misattributed, or unqualified output. This change does not repair, coerce, or retry invalid model output.

For newly observed analysis failures, bounded diagnostic metadata is appended to the existing intake `audit_events.metadata_json` alongside `analysis.failed` or `analysis.retrying`. The editor-safe message and broad `analysis_jobs.last_error_code` remain unchanged. No schema migration is required. A later manual retry is linked to the preceding job by its `analysis.retry_requested` audit event; historical rows are not backfilled.

Stable analyzer substages include `response_not_json`, `response_not_object`, `schema_validation_failed`, `semantic_validation_failed`, `intake_metadata_mismatch`, `invented_source_reference`, `model_unavailable`, `analysis_configuration`, and `qualification_validation_failed`. Validation diagnostics retain only a constrained analysis path, phase, and reason category. Provider metadata is captured only when available and accepted by a bounded allow-list.

The diagnostic record may contain job ID, attempt, retryability, timestamp, model/gateway/request identifiers, finish/completion reason, output token count, response length/type/wrapper, and—only for unparsable JSON—character count plus opening/closing character categories. It never contains generated response text, prompt text, retrieved source text, credentials, or raw provider exceptions. The Story File shows these fields only on authenticated internal failure panels, using text rendering.

Existing broad retry decisions are unchanged. `model_unavailable` remains retryable; structured-output and validation failures remain non-retryable. Historical failures retain only the safe details already stored because their discarded output cannot be reconstructed.
