import { runWatchdeskScan } from "./watchdesk.js";

export const WATCHDESK_CRON = "0 14,23 * * *";
export const WATCHDESK_LEASE_MS = 30 * 60 * 1000;

const EMPTY_METRICS = Object.freeze({
  sources_checked: 0, sources_succeeded: 0, items_discovered: 0,
  deterministic_rejects: 0, duplicates_known: 0, fit_gate_survivors: 0,
  failed_fit_gate: 0, discovery_leads: 0, submission_ready: 0,
  submission_ready_gap: 0, submission_ready_aperture: 0,
  would_submit: 0, submitted_to_newsroom: 0,
  trusted_scanned: 0, trusted_candidates: 0, trusted_failures: 0, trusted_submissions: 0,
  open_sweep_queries_attempted: 0, open_sweep_queries_failed: 0, open_sweep_raw_hits: 0,
  open_sweep_normalized_urls: 0, open_sweep_deduped_hits: 0, open_sweep_event_clusters: 0,
  open_sweep_triaged_candidates: 0, open_sweep_eligible_leads: 0, open_sweep_human_burden_candidates: 0,
  open_sweep_fml_candidates: 0, open_sweep_no_action_discarded: 0,
  open_sweep_would_submit: 0, open_sweep_submissions: 0,
  combined_total_submissions: 0, combined_duplicate_suppressions: 0, combined_source_cluster_overlap: 0,
});

function concise(value, max = 200) {
  return String(value ?? "Unknown failure").replace(/[\r\n\t]+/g, " ").slice(0, max);
}

function publicRun(row) {
  if (!row) return null;
  return {
    run_id: row.id,
    trigger_type: row.trigger_type,
    dry_run: row.dry_run === 1,
    started_at: row.started_at,
    completed_at: row.completed_at,
    status: row.status,
    metrics: row.metrics_json ? JSON.parse(row.metrics_json) : { ...EMPTY_METRICS, submitted_to_newsroom: row.submitted_count },
    source_health: JSON.parse(row.source_health_json || "[]").map((source) => ({
      source_id: concise(source.source_id, 80),
      lane: source.lane === "open_sweep" ? "open_sweep" : "trusted_source",
      lens_id: source.lens_id ? concise(source.lens_id, 60) : null,
      checked_at: concise(source.checked_at, 40),
      status: source.status === "succeeded" ? "succeeded" : "failed",
      items_parsed: Number.isInteger(source.items_parsed) && source.items_parsed >= 0 ? source.items_parsed : 0,
      error: source.error ? concise(source.error, 120) : null,
    })),
    source_failure_count: row.source_failure_count,
    submitted_count: row.submitted_count,
    submitted_intake_ids: JSON.parse(row.submitted_ids_json || "[]"),
    error_class: row.error_class,
    error_message: row.error_message,
  };
}

export async function getWatchdeskStatus(env) {
  const latest = await env.SBNS_DB.prepare("SELECT * FROM watchdesk_runs ORDER BY started_at DESC, id DESC LIMIT 1").first();
  const lastCompleted = await env.SBNS_DB.prepare("SELECT * FROM watchdesk_runs WHERE status IN ('success', 'partial', 'failed') ORDER BY completed_at DESC, id DESC LIMIT 1").first();
  const recent = await env.SBNS_DB.prepare("SELECT * FROM watchdesk_runs ORDER BY started_at DESC, id DESC LIMIT 10").all();
  return { latest: publicRun(latest), last_completed: publicRun(lastCompleted), recent: recent.results.map(publicRun) };
}

export async function getWatchdeskMachineHealth(env) {
  const row = await env.SBNS_DB.prepare("SELECT id, completed_at, status, source_failure_count, submitted_count FROM watchdesk_runs ORDER BY started_at DESC, id DESC LIMIT 1").first();
  return {
    ok: true,
    worker: "sbns-admin",
    revision: env.SBNS_ADMIN_BUILD_SHA,
    schedule_configured: true,
    cron_utc: WATCHDESK_CRON,
    latest_run_id: row?.id ?? null,
    latest_run_time: row?.completed_at ?? null,
    latest_run_status: row?.status ?? null,
    source_failure_count: row?.source_failure_count ?? 0,
    submitted_count: row?.submitted_count ?? 0,
  };
}

export async function runWatchdeskOperation(env, options = {}) {
  const executeScan = options.executeScan || runWatchdeskScan;
  const clock = options.now || (() => new Date().toISOString());
  const startedAt = clock();
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) throw new Error("Watchdesk clock must return a valid date.");
  const runId = options.runId || `watchdesk_${crypto.randomUUID()}`;
  const triggerType = options.triggerType === "scheduled" ? "scheduled" : "manual";
  const requestedBy = triggerType === "scheduled" ? "system:watchdesk-schedule" : options.requestedBy;
  if (!requestedBy || typeof requestedBy !== "string") throw new Error("Watchdesk run provenance is required.");
  const dryRun = options.dryRun === true;
  const leaseUntil = new Date(startedMs + WATCHDESK_LEASE_MS).toISOString();
  const db = env.SBNS_DB;

  await db.prepare("INSERT INTO watchdesk_runs (id, trigger_type, dry_run, requested_by, started_at, status) VALUES (?, ?, ?, ?, ?, 'running')")
    .bind(runId, triggerType, Number(dryRun), requestedBy, startedAt).run();

  let acquired = false;
  const submittedIds = [];
  try {
    const lock = await db.prepare("INSERT INTO watchdesk_run_lock (name, run_id, acquired_at, expires_at) VALUES ('watchdesk', ?, ?, ?) ON CONFLICT(name) DO UPDATE SET run_id = excluded.run_id, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at WHERE watchdesk_run_lock.expires_at <= excluded.acquired_at")
      .bind(runId, startedAt, leaseUntil).run();
    acquired = lock.meta.changes === 1;
    if (!acquired) {
      await db.prepare("UPDATE watchdesk_runs SET status = 'skipped-overlap', completed_at = ? WHERE id = ?")
        .bind(clock(), runId).run();
      return { ok: true, run_id: runId, status: "skipped-overlap", dry_run: dryRun, metrics: EMPTY_METRICS, source_failures: [], source_health: [], discovery_leads: [], candidates: [], deferred_candidates: [], submitted: [], message: "A Watchdesk run is already active." };
    }

    // A crashed invocation cannot hold the lease indefinitely. Preserve its ledger row as failed.
    await db.prepare("UPDATE watchdesk_runs SET status = 'failed', completed_at = ?, error_class = 'STALE_LOCK_RECOVERED', error_message = 'The prior run exceeded the bounded lease.' WHERE status = 'running' AND id != ? AND started_at <= ?")
      .bind(clock(), runId, new Date(startedMs - WATCHDESK_LEASE_MS).toISOString()).run();

    const result = await executeScan(env, {
      ...(options.scanOptions || {}), dryRun, requestedBy, runId, leaseNow: options.now ? clock : null,
      beforeSubmit: async () => {
        const holder = await db.prepare("SELECT run_id, expires_at FROM watchdesk_run_lock WHERE name = 'watchdesk'").first();
        if (holder?.run_id !== runId || holder.expires_at <= clock()) throw new Error("WATCHDESK_LEASE_LOST");
      },
      onSubmitted: async (intake) => {
        // The intake, audit, and ledger row have already committed together.
        submittedIds.push(intake.id);
      },
    });
    if (submittedIds.length !== result.metrics.submitted_to_newsroom) throw new Error("WATCHDESK_SUBMISSION_COUNT_MISMATCH");
    const ledger = await db.prepare("SELECT submitted_count, submitted_ids_json FROM watchdesk_runs WHERE id = ?").bind(runId).first();
    if (ledger?.submitted_count !== submittedIds.length || JSON.stringify(JSON.parse(ledger.submitted_ids_json)) !== JSON.stringify(submittedIds)) throw new Error("WATCHDESK_SUBMISSION_COUNT_MISMATCH");
    const sourceHealth = (result.source_health || []).map((source) => ({
      source_id: source.source_id,
      lane: source.lane === "open_sweep" ? "open_sweep" : "trusted_source",
      lens_id: source.lens_id || null,
      checked_at: source.checked_at,
      status: source.status,
      error: source.error ? concise(source.error, 120) : null,
      items_parsed: source.items_parsed,
    }));
    const status = result.status === "partial" ? "partial" : "success";
    const holder = await db.prepare("SELECT run_id, expires_at FROM watchdesk_run_lock WHERE name = 'watchdesk'").first();
    if (holder?.run_id !== runId || holder.expires_at <= clock()) throw new Error("WATCHDESK_LEASE_LOST");
    const saved = await db.prepare("UPDATE watchdesk_runs SET status = ?, completed_at = ?, metrics_json = ?, source_health_json = ?, source_failure_count = ? WHERE id = ? AND status = 'running'")
      .bind(status, clock(), JSON.stringify(result.metrics), JSON.stringify(sourceHealth), result.source_failures?.length || 0, runId).run();
    if (saved.meta.changes !== 1) throw new Error("WATCHDESK_RUN_STATE_CONFLICT");
    return { ...result, status, trigger_type: triggerType };
  } catch (error) {
    await db.prepare("UPDATE watchdesk_runs SET status = 'failed', completed_at = ?, error_class = ?, error_message = ? WHERE id = ? AND status = 'running'")
      .bind(clock(), concise(error?.name || "Error", 80), concise(error?.message), runId).run();
    throw error;
  } finally {
    if (acquired) await db.prepare("DELETE FROM watchdesk_run_lock WHERE name = 'watchdesk' AND run_id = ?").bind(runId).run();
  }
}
