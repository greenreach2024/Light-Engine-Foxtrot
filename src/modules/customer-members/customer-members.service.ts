import { db } from "../../db/index.js";
import { NotFoundError, ConflictError, BadRequestError } from "../../shared/utils/errors.js";
import type { InviteMemberInput } from "./customer-members.validation.js";

export class CustomerMembersService {
  // ─── Invite ──────────────────────────────────────────────

  async invite(customerId: string, input: InviteMemberInput, invitedBy: string) {
    // Check if user exists or create a placeholder
    let user = await db("users").where("email", input.email).first();

    if (user) {
      // Check if already a member
      const existing = await db("customer_members")
        .where("customer_id", customerId)
        .where("user_id", user.id)
        .first();
      if (existing) throw new ConflictError("User is already a member of this organization");
    } else {
      // Create user placeholder (will set password on first login)
      const [newUser] = await db("users")
        .insert({
          email: input.email,
          password_hash: "pending_invite",
          role: "customer_user",
          first_name: input.first_name || "Invited",
          last_name: input.last_name || "User",
        })
        .returning("*");
      user = newUser;
    }

    const [member] = await db("customer_members")
      .insert({
        customer_id: customerId,
        user_id: user.id,
        role: input.role,
        invited_by: invitedBy,
      })
      .returning("*");

    return { ...member, email: user.email, first_name: user.first_name, last_name: user.last_name };
  }

  // ─── Accept invite ──────────────────────────────────────

  async accept(memberId: string, userId: string) {
    const [member] = await db("customer_members")
      .where("id", memberId)
      .where("user_id", userId)
      .update({ accepted_at: new Date(), is_active: true, updated_at: new Date() })
      .returning("*");
    if (!member) throw new NotFoundError("Membership", memberId);
    return member;
  }

  // ─── List members ──────────────────────────────────────

  async listMembers(customerId: string) {
    return db("customer_members")
      .where("customer_members.customer_id", customerId)
      .where("customer_members.is_active", true)
      .join("users", "users.id", "customer_members.user_id")
      .select(
        "customer_members.*",
        "users.email",
        "users.first_name",
        "users.last_name",
        "users.phone",
      );
  }

  // ─── Get member ────────────────────────────────────────

  async getMember(memberId: string) {
    const member = await db("customer_members")
      .where("customer_members.id", memberId)
      .join("users", "users.id", "customer_members.user_id")
      .select(
        "customer_members.*",
        "users.email",
        "users.first_name",
        "users.last_name",
      )
      .first();
    if (!member) throw new NotFoundError("Membership", memberId);
    return member;
  }

  // ─── Update role ───────────────────────────────────────

  async updateRole(memberId: string, role: string) {
    const [member] = await db("customer_members")
      .where("id", memberId)
      .update({ role, updated_at: new Date() })
      .returning("*");
    if (!member) throw new NotFoundError("Membership", memberId);
    return member;
  }

  // ─── Remove member ────────────────────────────────────

  async remove(memberId: string) {
    const [member] = await db("customer_members")
      .where("id", memberId)
      .update({ is_active: false, updated_at: new Date() })
      .returning("*");
    if (!member) throw new NotFoundError("Membership", memberId);
    return member;
  }

  // ─── Check permissions ────────────────────────────────

  async hasRole(customerId: string, userId: string, ...roles: string[]): Promise<boolean> {
    const member = await db("customer_members")
      .where("customer_id", customerId)
      .where("user_id", userId)
      .where("is_active", true)
      .first();

    if (!member) return false;
    return roles.includes(member.role);
  }

  // ─── Get user's organizations ─────────────────────────

  async getOrganizations(userId: string) {
    return db("customer_members")
      .where("customer_members.user_id", userId)
      .where("customer_members.is_active", true)
      .join("customers", "customers.id", "customer_members.customer_id")
      .select(
        "customer_members.id as membership_id",
        "customer_members.role",
        "customer_members.accepted_at",
        "customers.id as customer_id",
        "customers.name as customer_name",
      );
  }
}

export const customerMembersService = new CustomerMembersService();
