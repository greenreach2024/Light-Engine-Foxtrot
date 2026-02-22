import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../../db/index.js";
import { env } from "../../config/env.js";
import { ConflictError, UnauthorizedError, NotFoundError } from "../../shared/utils/errors.js";
import type { User } from "../../shared/types/index.js";
import type { AuthPayload } from "../../shared/types/common.js";
import type { RegisterInput, LoginInput } from "./auth.validation.js";

export class AuthService {
  async register(input: RegisterInput): Promise<{ user: Omit<User, "password_hash">; token: string }> {
    // Check uniqueness
    const existing = await db("users").where("email", input.email).first();
    if (existing) throw new ConflictError("Email already registered");

    const password_hash = await bcrypt.hash(input.password, 12);

    const [user] = await db("users")
      .insert({
        email: input.email,
        password_hash,
        role: input.role,
        first_name: input.first_name,
        last_name: input.last_name,
        phone: input.phone ?? null,
      })
      .returning("*") as User[];

    // Link to customer if applicable
    if (input.customer_id && (input.role === "customer_admin" || input.role === "customer_user")) {
      await db("customer_users").insert({ user_id: user.id, customer_id: input.customer_id });
    }

    const token = this.signToken(user, input.customer_id);

    const { password_hash: _, ...safeUser } = user;
    return { user: safeUser, token };
  }

  async login(input: LoginInput): Promise<{ user: Omit<User, "password_hash">; token: string }> {
    const user = await db("users").where("email", input.email).first() as User | undefined;
    if (!user) throw new UnauthorizedError("Invalid credentials");
    if (!user.is_active) throw new UnauthorizedError("Account disabled");

    const valid = await bcrypt.compare(input.password, user.password_hash);
    if (!valid) throw new UnauthorizedError("Invalid credentials");

    // Look up customer link
    let customerId: string | undefined;
    if (user.role === "customer_admin" || user.role === "customer_user") {
      const link = await db("customer_users").where("user_id", user.id).first();
      customerId = link?.customer_id;
    }

    // Look up driver link
    let driverId: string | undefined;
    if (user.role === "driver") {
      const driver = await db("drivers").where("user_id", user.id).first();
      driverId = driver?.id;
    }

    const token = this.signToken(user, customerId, driverId);

    const { password_hash: _, ...safeUser } = user;
    return { user: safeUser, token };
  }

  async getProfile(userId: string): Promise<Omit<User, "password_hash">> {
    const user = await db("users").where("id", userId).first() as User | undefined;
    if (!user) throw new NotFoundError("User", userId);
    const { password_hash: _, ...safeUser } = user;
    return safeUser;
  }

  private signToken(user: User, customerId?: string, driverId?: string): string {
    const payload: AuthPayload = {
      userId: user.id,
      role: user.role,
      ...(customerId && { customerId }),
      ...(driverId && { driverId }),
    };
    return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
  }

  async logAudit(userId: string, action: string, entityType: string, entityId?: string, details?: unknown, ip?: string) {
    await db("audit_logs").insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      details: details ? JSON.stringify(details) : null,
      ip_address: ip ?? null,
    });
  }
}

export const authService = new AuthService();
