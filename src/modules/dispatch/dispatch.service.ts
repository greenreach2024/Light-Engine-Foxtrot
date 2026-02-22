import { db } from "../../db/index.js";
import { env } from "../../config/env.js";
import { NotFoundError, BadRequestError } from "../../shared/utils/errors.js";
import { driverService } from "../driver/driver.service.js";
import type { Wave, Route, DriverOffer } from "../../shared/types/index.js";
import type { CreateWaveInput, OfferRouteInput } from "./dispatch.validation.js";
import dayjs from "dayjs";

export class DispatchService {
  // ─── Waves ──────────────────────────────────────────────

  async listWaves(filters: { date?: string; status?: string }) {
    let query = db("waves").orderBy("wave_date", "desc").orderBy("wave_label");
    if (filters.date) query = query.where("wave_date", filters.date);
    if (filters.status) query = query.where("status", filters.status);
    return query;
  }

  async getWave(id: string): Promise<Wave> {
    const wave = await db("waves").where("id", id).first();
    if (!wave) throw new NotFoundError("Wave", id);
    return wave;
  }

  async createWave(input: CreateWaveInput): Promise<Wave> {
    const [wave] = await db("waves").insert(input).returning("*");
    return wave;
  }

  async updateWaveStatus(id: string, status: string): Promise<Wave> {
    const [wave] = await db("waves")
      .where("id", id)
      .update({ status, updated_at: new Date() })
      .returning("*");
    if (!wave) throw new NotFoundError("Wave", id);
    return wave;
  }

  // ─── Route offers to drivers ────────────────────────────

  async offerRoute(input: OfferRouteInput): Promise<DriverOffer[]> {
    const route = await db("routes").where("id", input.route_id).first() as Route | undefined;
    if (!route) throw new NotFoundError("Route", input.route_id);
    if (route.status !== "published") {
      throw new BadRequestError("Route must be in 'published' status to offer");
    }

    const expiresAt = dayjs().add(input.expires_in_min, "minute").toISOString();

    // Score and rank drivers
    const drivers = await db("drivers").whereIn("id", input.driver_ids);
    const farmLat = env.DEPOT_LAT;
    const farmLng = env.DEPOT_LNG;

    const scored = drivers
      .map((d: any) => ({
        driver: d,
        score: driverService.scoreDriver(d, farmLat, farmLng, route.temp_class),
      }))
      .sort((a: any, b: any) => b.score - a.score);

    // Create offers
    const offers: DriverOffer[] = [];
    for (const { driver, score } of scored) {
      const [offer] = await db("driver_offers")
        .insert({
          route_id: input.route_id,
          driver_id: driver.id,
          status: "pending",
          offered_pay: route.driver_pay ?? 0,
          score,
          expires_at: expiresAt,
        })
        .returning("*");
      offers.push(offer);
    }

    // Update route status
    await db("routes").where("id", input.route_id).update({ status: "offered" });

    return offers;
  }

  async respondToOffer(offerId: string, driverId: string, accept: boolean): Promise<DriverOffer> {
    const offer = await db("driver_offers").where("id", offerId).first() as DriverOffer | undefined;
    if (!offer) throw new NotFoundError("DriverOffer", offerId);
    if (offer.driver_id !== driverId) throw new BadRequestError("Not your offer");
    if (offer.status !== "pending") throw new BadRequestError("Offer no longer pending");
    if (dayjs().isAfter(offer.expires_at)) {
      await db("driver_offers").where("id", offerId).update({ status: "expired" });
      throw new BadRequestError("Offer has expired");
    }

    const newStatus = accept ? "accepted" : "declined";
    const [updated] = await db("driver_offers")
      .where("id", offerId)
      .update({ status: newStatus, responded_at: new Date() })
      .returning("*");

    if (accept) {
      // Assign driver to route, cancel other offers for same route
      await db("routes").where("id", offer.route_id).update({
        driver_id: driverId,
        status: "accepted",
        updated_at: new Date(),
      });
      await db("driver_offers")
        .where("route_id", offer.route_id)
        .whereNot("id", offerId)
        .where("status", "pending")
        .update({ status: "cancelled" });
    }

    // Update driver acceptance rate
    await driverService.updateMetrics(driverId, true, accept);

    return updated;
  }

  /** Get pending offers for a driver */
  async getDriverOffers(driverId: string): Promise<(DriverOffer & { route: Route })[]> {
    const offers = await db("driver_offers")
      .where({ driver_id: driverId, status: "pending" })
      .where("expires_at", ">", new Date())
      .orderBy("score", "desc");

    // Attach route summaries
    const routeIds = offers.map((o: any) => o.route_id);
    const routes = await db("routes").whereIn("id", routeIds);
    const routeMap = new Map(routes.map((r: any) => [r.id, r]));

    return offers.map((o: any) => ({ ...o, route: routeMap.get(o.route_id) }));
  }
}

export const dispatchService = new DispatchService();
