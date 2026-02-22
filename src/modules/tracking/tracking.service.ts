import { db } from "../../db/index.js";
import { NotFoundError } from "../../shared/utils/errors.js";

export class TrackingService {
  /**
   * Get the full timeline for a shipment — all delivery events in order.
   */
  async getTimeline(shipmentId: string) {
    const shipment = await db("shipments").where("id", shipmentId).first();
    if (!shipment) throw new NotFoundError("Shipment", shipmentId);

    const events = await db("delivery_events")
      .where("shipment_id", shipmentId)
      .orderBy("created_at", "asc");

    return {
      shipment_id: shipmentId,
      shipment_number: shipment.shipment_number,
      current_status: shipment.status,
      events,
    };
  }

  /**
   * Get the latest location for a driver (most recent GPS ping or location_update event).
   */
  async getDriverLocation(driverId: string) {
    // First try delivery_events for location_update
    const event = await db("delivery_events")
      .where("driver_id", driverId)
      .where("event_type", "driver.location_update")
      .whereNotNull("lat")
      .whereNotNull("lng")
      .orderBy("created_at", "desc")
      .first();

    if (event) {
      return {
        driver_id: driverId,
        lat: event.lat,
        lng: event.lng,
        timestamp: event.created_at,
        source: "delivery_event",
      };
    }

    // Fall back to gps_pings
    const ping = await db("gps_pings")
      .where("driver_id", driverId)
      .orderBy("recorded_at", "desc")
      .first();

    if (!ping) throw new NotFoundError("Driver location", driverId);

    return {
      driver_id: driverId,
      lat: ping.lat,
      lng: ping.lng,
      timestamp: ping.recorded_at,
      source: "gps_ping",
    };
  }

  /**
   * Get ETA for the next stop on a route.
   */
  async getRouteEta(routeId: string) {
    const route = await db("routes").where("id", routeId).first();
    if (!route) throw new NotFoundError("Route", routeId);

    // Find next undelivered stop
    const nextStop = await db("route_stops")
      .where("route_id", routeId)
      .whereNull("actual_arrival")
      .orderBy("stop_sequence", "asc")
      .first();

    if (!nextStop) {
      return { route_id: routeId, eta: null, message: "All stops completed" };
    }

    return {
      route_id: routeId,
      next_stop_id: nextStop.id,
      next_stop_sequence: nextStop.stop_sequence,
      planned_arrival: nextStop.planned_arrival,
      window_open: nextStop.window_open,
      window_close: nextStop.window_close,
    };
  }

  /**
   * Get all active routes for a specific driver.
   */
  async getActiveRoutes(driverId: string) {
    return db("routes")
      .where("driver_id", driverId)
      .whereIn("status", ["accepted", "in_progress"])
      .orderBy("created_at", "desc");
  }

  /**
   * Geofence check: is the driver within radius of a stop location?
   */
  async checkGeofence(
    driverId: string,
    stopId: string,
    radiusMeters = 200,
  ): Promise<{ within: boolean; distanceMeters: number }> {
    const loc = await this.getDriverLocation(driverId);
    const stop = await db("route_stops")
      .where("route_stops.id", stopId)
      .join("customer_locations", "customer_locations.id", "route_stops.location_id")
      .select("customer_locations.lat", "customer_locations.lng")
      .first();

    if (!stop) throw new NotFoundError("Stop", stopId);

    const distance = haversineMeters(loc.lat, loc.lng, stop.lat, stop.lng);
    return { within: distance <= radiusMeters, distanceMeters: Math.round(distance) };
  }
}

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export const trackingService = new TrackingService();
