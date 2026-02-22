import { z } from "zod";

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "receiver", "viewer"]),
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
});

export const updateMemberRoleSchema = z.object({
  role: z.enum(["admin", "receiver", "viewer"]),
});

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
