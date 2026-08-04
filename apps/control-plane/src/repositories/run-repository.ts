import {DailyPlanSchema, type DailyPlan} from "@lifeos/contracts";

export type StoredRun = {
  id: string;
  userId: string;
  mode: "full" | "delta";
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "degraded" | "failed";
  result: unknown;
  errorCode: string | null;
};

export type RunCompletion = {
  id: string;
  status: "completed" | "degraded" | "failed";
  result: unknown;
  completedAt: string;
  errorCode?: string | null;
};

export type AtomicRefreshCommit = {
  userId: string;
  plan: DailyPlan;
  notification: {
    id: string;
    dedupeKey: string;
    severity: "routine" | "high" | "critical";
    safeSummary: string;
    createdAt: string;
  };
  run: Omit<RunCompletion, "status"> & {status: "completed" | "degraded"};
};

export interface RunRepository {
  begin(input: {id: string; userId: string; mode: "full" | "delta"; startedAt: string}): Promise<"started" | "exists">;
  restart(input: {id: string; startedAt: string}): Promise<boolean>;
  acquireUserLease(userId: string, runId: string, now: string, expiresAt: string): Promise<boolean>;
  releaseUserLease(userId: string, runId: string): Promise<void>;
  complete(input: RunCompletion): Promise<void>;
  completeWithPlan(input: AtomicRefreshCommit): Promise<void>;
  find(id: string): Promise<StoredRun | null>;
}

type RunRow = {
  id: string;
  user_id: string;
  mode: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  result_json: string | null;
  error_code: string | null;
};

const toStoredRun = (row: RunRow): StoredRun => {
  if (row.mode !== "full" && row.mode !== "delta") throw new Error("Stored refresh mode is invalid");
  if (!(["running", "completed", "degraded", "failed"] as const).includes(row.status as StoredRun["status"])) {
    throw new Error("Stored refresh status is invalid");
  }
  return {
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    status: row.status as StoredRun["status"],
    result: row.result_json === null ? null : JSON.parse(row.result_json) as unknown,
    errorCode: row.error_code,
  };
};

export const createRunRepository = (db: D1Database): RunRepository => ({
  async begin(input) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO agent_runs
        (id, user_id, agent, mode, started_at, completed_at, status, input_refs_json, result_json, error_code)
       VALUES (?, ?, 'refresh', ?, ?, NULL, 'running', '[]', NULL, NULL)`,
    ).bind(input.id, input.userId, input.mode, input.startedAt).run();
    return (result.meta.changes ?? 0) === 1 ? "started" : "exists";
  },

  async restart(input) {
    const result = await db.prepare(
      `UPDATE agent_runs
       SET status = 'running', started_at = ?, completed_at = NULL, result_json = NULL, error_code = NULL
       WHERE id = ? AND status = 'failed'`,
    ).bind(input.startedAt, input.id).run();
    return (result.meta.changes ?? 0) === 1;
  },

  async acquireUserLease(userId, runId, now, expiresAt) {
    const row = await db.prepare(
      `INSERT INTO refresh_leases (user_id, run_id, expires_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         run_id = excluded.run_id,
         expires_at = excluded.expires_at
       WHERE refresh_leases.expires_at <= ?
       RETURNING run_id`,
    ).bind(userId, runId, expiresAt, now).first<{run_id: string}>();
    return row?.run_id === runId;
  },

  async releaseUserLease(userId, runId) {
    await db.prepare("DELETE FROM refresh_leases WHERE user_id = ? AND run_id = ?").bind(userId, runId).run();
  },

  async complete(input) {
    const result = await db.prepare(
      `UPDATE agent_runs
       SET completed_at = ?, status = ?, result_json = ?, error_code = ?
       WHERE id = ? AND status = 'running'`,
    ).bind(input.completedAt, input.status, JSON.stringify(input.result), input.errorCode ?? null, input.id).run();
    if ((result.meta.changes ?? 0) !== 1) throw new Error("Refresh run completion failed");
  },

  async completeWithPlan(input) {
    const plan = DailyPlanSchema.parse(input.plan);
    if (plan.generatedAt !== input.run.completedAt) throw new Error("Plan and run completion timestamps must match");
    const safeSummary = input.notification.safeSummary.trim();
    if (!safeSummary || safeSummary.length > 200) throw new Error("Notification summary is invalid");
    const [planResult, _notificationResult, runResult] = await db.batch([
      db.prepare(
        `INSERT INTO daily_plans (id, user_id, local_date, revision, generated_at, plan_json)
         SELECT ?, ?, ?, ?, ?, ?
         FROM agent_runs
         WHERE id = ? AND user_id = ? AND status = 'running'`,
      ).bind(
        plan.id,
        input.userId,
        plan.localDate,
        plan.revision,
        plan.generatedAt,
        JSON.stringify(plan),
        input.run.id,
        input.userId,
      ),
      db.prepare(
        `INSERT INTO notifications (id, user_id, severity, dedupe_key, safe_summary, created_at, acknowledged_at)
         SELECT ?, ?, ?, ?, ?, ?, NULL
         FROM agent_runs
         WHERE id = ? AND user_id = ? AND status = 'running'
         ON CONFLICT(user_id, dedupe_key) DO NOTHING`,
      ).bind(
        input.notification.id,
        input.userId,
        input.notification.severity,
        input.notification.dedupeKey,
        safeSummary,
        input.notification.createdAt,
        input.run.id,
        input.userId,
      ),
      db.prepare(
        `UPDATE agent_runs
         SET completed_at = ?, status = ?, result_json = ?, error_code = NULL
         WHERE id = ? AND user_id = ? AND status = 'running'`,
      ).bind(input.run.completedAt, input.run.status, JSON.stringify(input.run.result), input.run.id, input.userId),
    ]);
    if ((planResult.meta.changes ?? 0) !== 1 || (runResult.meta.changes ?? 0) !== 1) {
      throw new Error("Refresh run no longer owns the running claim");
    }
  },

  async find(id) {
    const row = await db.prepare(
      `SELECT id, user_id, mode, started_at, completed_at, status, result_json, error_code
       FROM agent_runs WHERE id = ?`,
    ).bind(id).first<RunRow>();
    return row ? toStoredRun(row) : null;
  },
});
