import { db } from "../../db/index.js";
import { NotFoundError } from "../../shared/utils/errors.js";
import type { Driver } from "../../shared/types/index.js";
import type { CreateDriverInput } from "./driver.validation.js";
import { DRIVER_SCORE_WEIGHTS } from "../../shared/constants/index.js";
import { haversineKm, clamp } from "../../shared/utils/helpers.js";

export class DriverService {
  async list(page: number, perPage: number, offset: number) {
    const [drivers, [{ count }]] = await Promise.all([
      db("drivers")
        .join("users", "users.id", "drivers.user_id")
        .select("drivers.*", "users.first_name", "users.last_name", "users.email", "users.phone")
        .where("drivers.is_active", true)
        .orderBy("users.last_name")
        .limit(perPage)
        .offset(offset),
      db("drivers").where("is_active", true).count("id as count"),
    ]);
    return { drivers, total: Number(count) };
  }

  async getById(id: string): Promise<Driver> {
    const driver = await db("drivers").where("id", id).first();
    if (!driver) throw new NotFoundError("Driver", id);
    return driver;
  }

  async create(input: CreateDriverInput): Promise<Driver> {
    const [driver] = await db("drivers").insert(input).returning("*");
    return driver;
  }

  async update(id: string, updates: Partial<CreateDriverInput>): Promise<Driver> {
    const [driver] = await db("drivers")
      .where("id", id)
      .update({ ...updates, updated_at: new Date() })
      .returning("*");
    if (!driver) throw new NotFoundError("Driver", id);
    return driver;
  }

  async setAvailability(id: string, isAvailable: boolean): Promise<Driver> {
    return this.update(id, { is_available: isAvailable } as any);
  }

  /** Get drivers available for a route (eligible + available) */
  async getAvailableDrivers(opts: {
    tempClass: string;
    minWeightKg: number;
    minVolumeL: number;
    pickupLat: number;
    pickupLng: number;
  }): Promise<Driver[]> {
    let query = db("drivers")
      .where("is_active", true)
      .where("is_available", true)
      .where("capacity_weight_kg", ">=", opts.minWeightKg)
      .where("capacity_volume_l", ">=", opts.minVolumeL);

    // If chilled/frozen, require refrigerated vehicle
    if (opts.tempClass === "chilled" || opts.tempClass === "frozen") {
      query = query.whereIn("vehicle_type", ["refrigerated_van", "refrigerated_truck"]);
    }

    // Insurance/license must be valid
    query = query
      .where(function () {
        this.whereNull("insurance_expiry").orWhere("insurance_expiry", ">=", new Date());
      })
      .where(function () {
        this.whereNull("license_expiry").orWhere("license_expiry", ">=", new Date());
      });

    return query;
  }

  /**
   * Score a driver for a specific route.
   * Score(driver, route) = a·Reliability + b·(1/ETA_to_pickup) + c·VehicleFit + d·AcceptanceRate − e·RiskFlags
   */
  scoreDriver(
    driver: Driver,
    pickupLat: number,
    pickupLng: number,
    requiredTempClass: string,
  ): number {
    const w = DRIVER_SCORE_WEIGHTS;

    // Reliability (0..1)
    const reliability = driver.reliability_score;

    // Proximity: inverse of distance, capped
    const dist = haversineKm(
      driver.home_zone_lat ?? pickupLat,
      driver.home_zone_lng ?? pickupLng,
      pickupLat,
      pickupLng,
    );
    const proximity = clamp(1 / Math.max(dist, 1), 0, 1);

    // Vehicle fit: 1 if exact match or better, 0.5 for okay, 0 for disqualified
    let vehicleFit = 0.5;
    if (requiredTempClass === "frozen" || requiredTempClass === "chilled") {
      vehicleFit = driver.vehicle_type.includes("refrigerated") ? 1.0 : 0;
    } else {
      vehicleFit = 1.0; // ambient — any vehicle works
    }

    const acceptanceRate = driver.acceptance_rate;
    const riskPenalty = Math.min(driver.risk_flags * 0.1, 1);

    const score =
      w.reliability * reliability +
      w.proximity * proximity +
      w.vehicleFit * vehicleFit +
      w.acceptanceRate * acceptanceRate -
      w.riskPenalty * riskPenalty;

    return Math.round(score * 1000) / 1000;
  }

  /** Update driver metrics after a completed route */
  async updateMetrics(driverId: string, wasOnTime: boolean, accepted: boolean): Promise<void> {
    const driver = await this.getById(driverId);
    // Exponential moving average
    const alpha = 0.1;
    const newReliability = driver.reliability_score * (1 - alpha) + (wasOnTime ? 1 : 0) * alpha;
    const newAcceptance = driver.acceptance_rate * (1 - alpha) + (accepted ? 1 : 0) * alpha;

    await db("drivers").where("id", driverId).update({
      reliability_score: Math.round(newReliability * 1000) / 1000,
      acceptance_rate: Math.round(newAcceptance * 1000) / 1000,
      updated_at: new Date(),
    });
  }
}

export const driverService = new DriverService();
