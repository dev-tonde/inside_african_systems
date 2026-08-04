import {z} from "zod";

export const AccountContextSchema = z.enum(["personal", "work"]);
export type AccountContext = z.infer<typeof AccountContextSchema>;

export const AccountSchema = z.object({
  id: z.string().min(1),
  googleSubject: z.string().min(1),
  email: z.email(),
  context: AccountContextSchema,
  connectedAt: z.iso.datetime(),
  scopes: z.array(z.string()),
});
export type Account = z.infer<typeof AccountSchema>;
