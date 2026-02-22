import { db } from "../../db/index.js";
import { NotFoundError, BadRequestError } from "../../shared/utils/errors.js";
import { eventBus } from "../../shared/events/index.js";
import { DELIVERY_EVENT_TOPICS } from "../../shared/types/delivery-events.js";
import type { DeliveryEventTopic } from "../../shared/types/delivery-events.js";
import type { CreateShipmentInput, UpdateShipmentStatusInput, RecordEventInput } from "./shipment.validation.js";

export class ShipmentService {
  // ─── CRUD ────────────────────────────────────────────────

  async create(input: CreateShipmentInput, actorId: string) {
    return db.transaction(async (trx) => {
      // Generate shipment number
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const countResult = await trx("shipments")
        .where("shipment_number", "like", `SH-${today}-%`)
        .count("id as count");
      const seq = String(Number(countResult[0].count) + 1).padStart(3, "0");
      const shipment_number = `SH-${today}-${seq}`;

      // Fetch orders
      const orders = await trx("orders").whereIn("id", input.order_ids);
      if (orders.length !== input.order_ids.length) {
        throw new BadRequestError("One or more order IDs are invalid");
      }

      // Compute aggregates
      const total_weight_kg = orders.reduce((s: number, o: any) => s + (o.total_weight_kg || 0), 0);
      const total_totes = orders.reduce((s: number, o: any) => s + (o.tote_count || 0), 0);

      const [shipment] = await trx("shipments")
        .insert({
          shipment_number,
          route_id: input.route_id,
          driver_id: input.driver_id,
          status: input.driver_id ? "assigned" : "pending",
          total_orders: orders.length,
          total_totes,
          total_weight_kg,
          total_stops: new Set(orders.map((o: any) => o.location_id)).size,
        })
        .returning("*");

      // Link orders
      await trx("shipment_orders").insert(
        input.order_ids.map((oid) => ({ shipment_id: shipment.id, order_id: oid })),
      );

      // Record event
      await this.recordEvent({
        event_type: DELIVERY_EVENT_TOPICS.SHIPMENT_CREATED,
        shipment_id: shipment.id,
        route_id: input.route_id,
        driver_id: input.driver_id,
      }, actorId, trx);

      return shipment;
    });
  }

  async getById(id: string) {
    const shipment = await db("shipments").where("id", id).first();
    if (!shipment) throw new NotFoundError("Shipment", id);

    const orders = await db("shipment_orders")
      .where("shipment_id", id)
      .join("orders", "orders.id", "shipment_orders.order_id")
      .select("orders.*");

    const events = await db("delivery_events")
      .where("shipment_id", id)
      .orderBy("created_at", "asc");

    return { ...shipment, orders, events };
  }

  async list(page: number, perPage: number, offset: number, filters?: { status?: string; driver_id?: string }) {
    let query = db("shipments").orderBy("created_at", "desc");
    if (filters?.status) query = query.where("status", filters.status);
    if (filters?.driver_id) query = query.where("driver_id", filters.driver_id);

    const [shipments, [{ count }]] = await Promise.all([
      query.clone().limit(perPage).offset(offset),
      query.clone().count("id as count"),
    ]);

    return { shipments, total: Number(count) };
  }

  // ─── Status Updates ──────────────────────────────────────

  async updateStatus(id: string, input: UpdateShipmentStatusInput, actorId: string) {
    const shipment = await db("shipments").where("id", id).first();
    if (!shipment) throw new NotFoundError("Shipment", id);

    // Update status
    const [updated] = await db("shipments")
      .where("id", id)
      .update({
        status: input.status,
        ...(input.status === "pickup_complete" ? { pickup_actual: new Date() } : {}),
        ...(input.status === "delivered" ? { complete_at: new Date() } : {}),
        updated_at: new Date(),
      })
      .returning("*");

    // Map status → event topic
    const topicMap: Record<string, DeliveryEventTopic> = {
      assigned: DELIVERY_EVENT_TOPICS.SHIPMENT_ASSIGNED,
      pickup_started: DELIVERY_EVENT_TOPICS.SHIPMENT_PICKUP_STARTED,
      pickup_complete: DELIVERY_EVENT_TOPICS.SHIPMENT_PICKUP_COMPLETE,
      in_transit: DELIVERY_EVENT_TOPICS.SHIPMENT_IN_TRANSIT,
      arriving: DELIVERY_EVENT_TOPICS.SHIPMENT_ARRIVING,
      delivered: DELIVERY_EVENT_TOPICS.SHIPMENT_DELIVERED,
      exception: DELIVERY_EVENT_TOPICS.SHIPMENT_EXCEPTION,
      cancelled: DELIVERY_EVENT_TOPICS.SHIPMENT_CANCELLED,
    };

    const topic = topicMap[input.status];
    if (topic) {
      await this.recordEvent({
        event_type: topic,
        shipment_id: id,
        route_id: shipment.route_id,
        driver_id: shipment.driver_id,
        lat: input.lat,
        lng: input.lng,
        payload: input.notes ? { notes: input.notes } : undefined,
      }, actorId);
    }

    return updated;
  }

  // ─── Events ──────────────────────────────────────────────

  async recordEvent(input: RecordEventInput, actorId: string, trx?: any) {
    const conn = trx || db;
    const [event] = await conn("delivery_events")
      .insert({
        event_type: input.event_type,
        shipment_id: input.shipment_id,
        route_id: input.route_id,
        stop_id: input.stop_id,
        driver_id: input.driver_id,
        order_id: input.order_id,
        payload: input.payload || {},
        lat: input.lat,
        lng: input.lng,
        actor_id: actorId,
      })
      .returning("*");

    // Publish to in-process event bus
    eventBus.publish(input.event_type as DeliveryEventTopic, {
      shipment_id: input.shipment_id,
      route_id: input.route_id,
      stop_id: input.stop_id,
      driver_id: input.driver_id,
      order_id: input.order_id,
      lat: input.lat,
      lng: input.lng,
      ...((input.payload as Record<string, unknown>) || {}),
    });

    return event;
  }

  async getEvents(shipmentId: string) {
    return db("delivery_events")
      .where("shipment_id", shipmentId)
      .orderBy("created_at", "asc");
  }

  async getEventsByRoute(routeId: string) {
    return db("delivery_events")
      .where("route_id", routeId)
      .orderBy("created_at", "asc");
  }
}

export const shipmentService = new ShipmentService();
