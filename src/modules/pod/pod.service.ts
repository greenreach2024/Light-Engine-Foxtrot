import { db } from "../../db/index.js";
import { NotFoundError, ConflictError } from "../../shared/utils/errors.js";
import type { ProofOfDelivery } from "../../shared/types/index.js";
import type { CreatePodInput } from "./pod.validation.js";

export class PodService {
  async create(input: CreatePodInput, driverId: string): Promise<ProofOfDelivery> {
    // Verify stop exists and belongs to driver's route
    const stop = await db("route_stops").where("id", input.route_stop_id).first();
    if (!stop) throw new NotFoundError("RouteStop", input.route_stop_id);

    const route = await db("routes").where("id", stop.route_id).first();
    if (route?.driver_id !== driverId) {
      throw new ConflictError("Route is not assigned to this driver");
    }

    // Check for duplicate POD
    const existing = await db("proof_of_delivery").where("route_stop_id", input.route_stop_id).first();
    if (existing) throw new ConflictError("POD already submitted for this stop");

    const [pod] = await db("proof_of_delivery")
      .insert({
        route_stop_id: input.route_stop_id,
        driver_id: driverId,
        signature_url: input.signature_url ?? null,
        photo_urls: input.photo_urls,
        recipient_name: input.recipient_name ?? null,
        temp_reading: input.temp_reading ?? null,
        condition_notes: input.condition_notes ?? null,
        exception_code: input.exception_code,
        exception_notes: input.exception_notes ?? null,
      })
      .returning("*");

    // Update stop actual times
    await db("route_stops").where("id", input.route_stop_id).update({
      actual_departure: new Date(),
    });

    // Update order status
    const newStatus = input.exception_code === "none" ? "delivered" : "exception";
    await db("orders").where("id", stop.order_id).update({
      status: newStatus,
      updated_at: new Date(),
    });

    // Check if all stops on route are complete
    const remainingStops = await db("route_stops")
      .where("route_id", stop.route_id)
      .whereNotExists(
        db("proof_of_delivery").whereRaw("proof_of_delivery.route_stop_id = route_stops.id"),
      )
      .count("id as count");

    if (Number(remainingStops[0].count) === 0) {
      await db("routes").where("id", stop.route_id).update({
        status: "completed",
        actual_end_at: new Date(),
        updated_at: new Date(),
      });
    }

    return pod;
  }

  async getByStop(stopId: string): Promise<ProofOfDelivery> {
    const pod = await db("proof_of_delivery").where("route_stop_id", stopId).first();
    if (!pod) throw new NotFoundError("ProofOfDelivery");
    return pod;
  }

  async listByRoute(routeId: string): Promise<ProofOfDelivery[]> {
    return db("proof_of_delivery")
      .join("route_stops", "route_stops.id", "proof_of_delivery.route_stop_id")
      .where("route_stops.route_id", routeId)
      .select("proof_of_delivery.*")
      .orderBy("proof_of_delivery.delivered_at");
  }
}

export const podService = new PodService();
