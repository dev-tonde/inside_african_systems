import {z} from "zod";

export const RefreshEnvelopeSchema = z.object({
  revision: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime(),
  importance: z.enum(["routine", "high", "critical"]),
  changedCounts: z.object({
    email: z.number().int().nonnegative(),
    calendar: z.number().int().nonnegative(),
  }),
});
export type RefreshEnvelope = z.infer<typeof RefreshEnvelopeSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
