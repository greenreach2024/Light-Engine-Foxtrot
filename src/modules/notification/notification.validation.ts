import { z } from "zod";

export const sendNotificationSchema = z.object({
  user_id: z.string().uuid(),
  channel: z.enum(["push", "sms", "email"]).default("push"),
  title: z.string().min(1),
  body: z.string().min(1),
  data: z.record(z.unknown()).optional(),
});

export type SendNotificationInput = z.infer<typeof sendNotificationSchema>;
