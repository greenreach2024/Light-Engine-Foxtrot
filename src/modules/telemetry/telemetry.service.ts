import { db } from "../../db/index.js";
import { haversineKm } from "../../shared/utils/helpers.js";
import type { GpsPingInput } from "./telemetry.validation.js";

export class TelemetryService {
  async recordPing(driverId: string, input: GpsPingInput): Promise<void> {
    await db("gps_pings").insert({
      driver_id: driverId,
      route_id: input.route_id ?? null,
      lat: input.lat,
      lng: input.lng,
      speed_kmh: input.speed_kmh ?? null,
      heading: input.heading ?? null,
      accuracy_m: input.accuracy_m ?? null,
    });
  }

  async recordBatch(driverId: string, pings: GpsPingInput[]): Promise<void> {
    const rows = pings.map((p) => ({
      driver_id: driverId,
      route_id: p.route_id ?? null,
      lat: p.lat,
      lng: p.lng,
      speed_kmh: p.speed_kmh ?? null,
      heading: p.heading ?? null,
      accuracy_m: p.accuracy_m ?? null,
    }));
    await db("gps_pings").insert(rows);
  }

  async getLatestPosition(driverId: string) {
    return db("gps_pings")
      .where("driver_id", driverId)
      .orderBy("recorded_at", "desc")
      .first();
  }

  async getRouteTrack(routeId: string) {
    return db("gps_pings")
      .where("route_id", routeId)
      .orderBy("recorded_at");
  }

  /**
   * Estimate ETA to a destination based on latest GPS position and average speed.
   */
  async estimateEta(
    driverId: string,
    destLat: number,
    destLng: number,
  ): Promise<{ etaMinutes: number; distanceKm: number } | null> {
    const latest = await this.getLatestPosition(driverId);
    if (!latest) return null;

    const distKm = haversineKm(latest.lat, latest.lng, destLat, destLng);
    const speedKmh = latest.speed_kmh && latest.speed_kmh > 5 ? latest.speed_kmh : 30; // fallback
    const etaMin = (distKm / speedKmh) * 60;

    return {
      etaMinutes: Math.round(etaMin),
      distanceKm: Math.round(distKm * 10) / 10,
    };
  }

  /** Get on-time metrics for a route */
  async getRouteAdherence(routeId: string) {
    const stops = await db("route_stops").where("route_id", routeId).orderBy("stop_sequence");
    let onTimeCount = 0;
    let totalStops = 0;

    for (const stop of stops) {
      if (stop.actual_arrival) {
        totalStops++;
        const planned = new Date(stop.window_close).getTime();
        const actual = new Date(stop.actual_arrival).getTime();
        if (actual <= planned + 15 * 60_000) onTimeCount++; // 15 min grace
      }
    }

    return {
      totalStops,
      onTimeStops: onTimeCount,
      onTimeRate: totalStops > 0 ? Math.round((onTimeCount / totalStops) * 100) / 100 : null,
    };
  }
}

export const telemetryService = new TelemetryService();
