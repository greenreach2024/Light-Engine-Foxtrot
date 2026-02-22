import { db } from "../../db/index.js";
import dayjs from "dayjs";
import { env } from "../../config/env.js";
import { NotFoundError } from "../../shared/utils/errors.js";
import { generateRouteNumber } from "../../shared/utils/helpers.js";
import { solveVrptw, type VrpStop, type VrpConfig, type VrpRouteResult } from "./vrptw-solver.js";
import { computeRouteCost, type CostRates } from "./cost-calculator.js";
import type { Order, CustomerLocation, Route } from "../../shared/types/index.js";
import type { OptimizeRoutesInput } from "./routing.validation.js";

export class RoutingService {
  async optimizeForWave(input: OptimizeRoutesInput): Promise<Route[]> {
    // Get wave + its orders
    const wave = await db("waves").where("id", input.wave_id).first();
    if (!wave) throw new NotFoundError("Wave", input.wave_id);

    // Get confirmed orders for this wave's date
    const orders = await db("orders")
      .where({ requested_date: wave.wave_date, status: "confirmed" })
      .orderBy("window_open") as Order[];

    if (orders.length === 0) return [];

    // Get all delivery locations
    const locationIds = [...new Set(orders.map((o) => o.location_id))];
    const locations = await db("customer_locations").whereIn("id", locationIds) as CustomerLocation[];
    const locationMap = new Map(locations.map((l) => [l.id, l]));

    // Build VRP stops
    const vrpStops: VrpStop[] = orders.map((order) => {
      const loc = locationMap.get(order.location_id)!;
      return {
        id: order.id,
        locationId: order.location_id,
        lat: loc.lat,
        lng: loc.lng,
        windowOpen: new Date(order.window_open),
        windowClose: new Date(order.window_close),
        serviceTimeMin: loc.unload_time_min,
        weightKg: order.total_weight_kg,
        volumeL: order.total_volume_l,
        toteCount: order.tote_count,
        tempClass: order.temp_class,
      };
    });

    const vrpConfig: VrpConfig = {
      depot: { lat: input.depot_lat, lng: input.depot_lng },
      stops: vrpStops,
      vehicle: {
        maxStops: input.max_stops_per_route ?? env.ROUTE_MAX_STOPS,
        maxDurationMin: input.max_duration_min ?? env.ROUTE_MAX_DURATION_MIN,
        maxWeightKg: 2000,  // default, could be per-vehicle
        maxVolumeL: 5000,
        coldChainMaxMin: env.COLD_CHAIN_MAX_MIN,
      },
      avgSpeedKmh: 40,  // urban average
    };

    // Solve
    const vrpResults = solveVrptw(vrpConfig);

    // Get cost rates
    const rates: CostRates = {
      costPerKm: env.COST_PER_KM,
      costPerMin: env.COST_PER_MIN,
      costPerStop: env.COST_PER_STOP,
      costPerWaitMin: env.COST_PER_WAIT_MIN,
    };

    const datePart = dayjs().format("YYYYMMDD");
    const wavePart = wave.wave_label.includes("AM") ? "AM" : "PM";
    const routePrefix = `RT-${datePart}-${wavePart}-`;
    const existingResult = await db("routes")
      .where("route_number", "like", `${routePrefix}%`)
      .count("id as count");
    const existingCount = Number(existingResult[0]?.count || 0);

    // Persist routes
    const routes: Route[] = [];
    for (let i = 0; i < vrpResults.length; i++) {
      const vrpRoute = vrpResults[i];
      const costResult = computeRouteCost(vrpRoute, rates);
      const routeNumber = generateRouteNumber(wave.wave_label, existingCount + i + 1);

      const [route] = await db("routes")
        .insert({
          wave_id: input.wave_id,
          route_number: routeNumber,
          status: "planned",
          planned_km: vrpRoute.totalKm,
          planned_duration_min: Math.round(vrpRoute.totalDurationMin),
          planned_stops: vrpRoute.stops.length,
          planned_wait_min: Math.round(vrpRoute.totalWaitMin),
          route_cost: costResult.totalCost,
          max_weight_kg: vrpRoute.totalWeightKg,
          max_volume_l: vrpRoute.totalVolumeL,
          temp_class: this.highestTempClass(vrpRoute),
        })
        .returning("*");

      // Persist stops with marginal contributions
      const totalMarginalKm = vrpRoute.stops.reduce((s, st) => s + st.marginalKm, 0);
      const totalMarginalMin = vrpRoute.stops.reduce((s, st) => s + st.marginalMin, 0);
      const totalVol = vrpRoute.stops.reduce((s, st) => s + st.stop.volumeL, 0);

      for (const stopResult of vrpRoute.stops) {
        await db("route_stops").insert({
          route_id: route.id,
          order_id: stopResult.stop.id,
          location_id: stopResult.stop.locationId,
          stop_sequence: stopResult.sequence,
          window_open: stopResult.stop.windowOpen,
          window_close: stopResult.stop.windowClose,
          service_time_min: stopResult.stop.serviceTimeMin,
          marginal_km: stopResult.marginalKm,
          marginal_min: stopResult.marginalMin,
          volume_share: totalVol > 0 ? stopResult.stop.volumeL / totalVol : 1 / vrpRoute.stops.length,
        });

        // Update order status to dispatched
        await db("orders").where("id", stopResult.stop.id).update({ status: "dispatched" });
      }

      routes.push(route);
    }

    return routes;
  }

  async getRoute(id: string): Promise<Route & { stops: any[] }> {
    const route = await db("routes").where("id", id).first();
    if (!route) throw new NotFoundError("Route", id);
    const stops = await db("route_stops")
      .where("route_id", id)
      .join("customer_locations", "customer_locations.id", "route_stops.location_id")
      .select("route_stops.*", "customer_locations.label", "customer_locations.lat", "customer_locations.lng", "customer_locations.address_line1", "customer_locations.city")
      .orderBy("stop_sequence");
    return { ...route, stops };
  }

  async listRoutes(waveId?: string) {
    let query = db("routes").orderBy("created_at", "desc");
    if (waveId) query = query.where("wave_id", waveId);
    return query;
  }

  async updateRouteStatus(id: string, status: string): Promise<Route> {
    const [route] = await db("routes")
      .where("id", id)
      .update({ status, updated_at: new Date() })
      .returning("*");
    if (!route) throw new NotFoundError("Route", id);
    return route;
  }

  private highestTempClass(route: VrpRouteResult): string {
    const priority: Record<string, number> = { ambient: 0, chilled: 1, frozen: 2 };
    let highest = "ambient";
    for (const s of route.stops) {
      if ((priority[s.stop.tempClass] ?? 0) > (priority[highest] ?? 0)) {
        highest = s.stop.tempClass;
      }
    }
    return highest;
  }
}

export const routingService = new RoutingService();
