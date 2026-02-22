import { db } from "../../db/index.js";
import { logger } from "../../shared/utils/logger.js";
import type { SendNotificationInput } from "./notification.validation.js";

export class NotificationService {
  async send(input: SendNotificationInput): Promise<void> {
    // Persist notification record
    await db("notifications").insert({
      user_id: input.user_id,
      channel: input.channel,
      title: input.title,
      body: input.body,
      data: input.data ? JSON.stringify(input.data) : null,
      sent_at: new Date(),
    });

    // Dispatch to channel (stub — integrate Twilio/SendGrid/Firebase in production)
    switch (input.channel) {
      case "sms":
        logger.info({ to: input.user_id, body: input.body }, "SMS notification (stub)");
        break;
      case "email":
        logger.info({ to: input.user_id, subject: input.title }, "Email notification (stub)");
        break;
      case "push":
        logger.info({ to: input.user_id, title: input.title }, "Push notification (stub)");
        break;
    }
  }

  /** Send batch notifications (e.g., ETA updates to all customers on a route) */
  async sendBatch(inputs: SendNotificationInput[]): Promise<void> {
    for (const input of inputs) {
      await this.send(input);
    }
  }

  async listForUser(userId: string, unreadOnly = false) {
    let query = db("notifications")
      .where("user_id", userId)
      .orderBy("created_at", "desc")
      .limit(50);
    if (unreadOnly) query = query.where("is_read", false);
    return query;
  }

  async markRead(notificationId: string): Promise<void> {
    await db("notifications").where("id", notificationId).update({ is_read: true });
  }

  async markAllRead(userId: string): Promise<void> {
    await db("notifications")
      .where({ user_id: userId, is_read: false })
      .update({ is_read: true });
  }

  // ─── Domain-specific notification helpers ───────────────

  async notifyEta(userId: string, routeNumber: string, etaMin: number): Promise<void> {
    await this.send({
      user_id: userId,
      channel: "push",
      title: "Delivery ETA Update",
      body: `Route ${routeNumber} — estimated arrival in ${etaMin} minutes`,
      data: { type: "eta_update", routeNumber, etaMin },
    });
  }

  async notifyRouteOffer(userId: string, routeNumber: string, pay: number): Promise<void> {
    await this.send({
      user_id: userId,
      channel: "push",
      title: "New Route Available",
      body: `Route ${routeNumber} — $${pay.toFixed(2)} estimated pay`,
      data: { type: "route_offer", routeNumber, pay },
    });
  }

  async notifyDelivered(userId: string, orderNumber: string): Promise<void> {
    await this.send({
      user_id: userId,
      channel: "push",
      title: "Order Delivered",
      body: `Order ${orderNumber} has been delivered successfully`,
      data: { type: "delivered", orderNumber },
    });
  }
}

export const notificationService = new NotificationService();
