import {DailyPlanSchema, RefreshEnvelopeSchema, type DailyPlan, type RefreshEnvelope} from "@lifeos/contracts";

export interface PlanRepository {
  nextRevision(userId: string, localDate: string): Promise<number>;
  save(plan: DailyPlan, userId: string): Promise<void>;
  getLatest(userId: string, localDate: string): Promise<DailyPlan | null>;
  getRefreshEnvelope(userId: string, afterRevision: number): Promise<RefreshEnvelope | null>;
}

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

const validateLocalDate = (value: string): void => {
  if (!isoDatePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new RangeError("localDate must be a valid ISO date");
  }
};

export const createPlanRepository = (db: D1Database): PlanRepository => ({
  async nextRevision(userId, localDate) {
    validateLocalDate(localDate);
    const row = await db.prepare(
      `INSERT INTO daily_plan_revisions (user_id, local_date, next_revision)
       VALUES (?, ?, 2)
       ON CONFLICT(user_id, local_date) DO UPDATE SET next_revision = daily_plan_revisions.next_revision + 1
       RETURNING next_revision - 1 AS revision`,
    ).bind(userId, localDate).first<{revision: number}>();
    if (!row || !Number.isInteger(row.revision) || row.revision < 1) throw new Error("Daily plan revision allocation failed");
    return row.revision;
  },

  async save(value, userId) {
    const plan = DailyPlanSchema.parse(value);
    await db.prepare(
      `INSERT INTO daily_plans (id, user_id, local_date, revision, generated_at, plan_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(plan.id, userId, plan.localDate, plan.revision, plan.generatedAt, JSON.stringify(plan)).run();
  },

  async getLatest(userId, localDate) {
    validateLocalDate(localDate);
    const row = await db.prepare(
      `SELECT plan_json
       FROM daily_plans
       WHERE user_id = ? AND local_date = ?
       ORDER BY revision DESC
       LIMIT 1`,
    ).bind(userId, localDate).first<{plan_json: string}>();
    if (!row) return null;
    return DailyPlanSchema.parse(JSON.parse(row.plan_json) as unknown);
  },

  async getRefreshEnvelope(userId, afterRevision) {
    if (!Number.isInteger(afterRevision) || afterRevision < 0) throw new RangeError("afterRevision must be a nonnegative integer");
    const rows = await db.prepare(
      `SELECT result_json
       FROM agent_runs
       WHERE user_id = ?
         AND status IN ('completed', 'degraded')
         AND result_json IS NOT NULL
       ORDER BY completed_at DESC, id DESC
       LIMIT 20`,
    ).bind(userId).all<{result_json: string}>();
    for (const row of rows.results) {
      const value: unknown = JSON.parse(row.result_json);
      if (typeof value !== "object" || value === null || !("envelope" in value)) continue;
      const parsed = RefreshEnvelopeSchema.parse((value as {envelope: unknown}).envelope);
      if (parsed.revision > afterRevision) return parsed;
    }
    return null;
  },
});
