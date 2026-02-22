import { describe, it, expect } from "vitest";
import { solveVrptw, type VrpConfig, type VrpStop } from "../../src/modules/routing/vrptw-solver.js";

function makeStop(id: string, lat: number, lng: number, openHour: number, closeHour: number, serviceMin = 15): VrpStop {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    id,
    locationId: `loc-${id}`,
    lat,
    lng,
    windowOpen: new Date(today.getTime() + openHour * 3600_000),
    windowClose: new Date(today.getTime() + closeHour * 3600_000),
    serviceTimeMin: serviceMin,
    weightKg: 50,
    volumeL: 100,
    toteCount: 5,
    tempClass: "ambient",
  };
}

describe("VRPTW Solver", () => {
  it("solves a simple 3-stop problem into 1 route", () => {
    const config: VrpConfig = {
      depot: { lat: -33.87, lng: 151.21 },
      stops: [
        makeStop("A", -33.88, 151.22, 6, 12),
        makeStop("B", -33.89, 151.20, 6, 12),
        makeStop("C", -33.86, 151.19, 6, 12),
      ],
      vehicle: {
        maxStops: 18,
        maxDurationMin: 270,
        maxWeightKg: 2000,
        maxVolumeL: 5000,
        coldChainMaxMin: 180,
      },
      avgSpeedKmh: 40,
    };

    const routes = solveVrptw(config);

    expect(routes.length).toBe(1);
    expect(routes[0].stops.length).toBe(3);
    expect(routes[0].totalKm).toBeGreaterThan(0);
    expect(routes[0].totalDurationMin).toBeGreaterThan(0);
  });

  it("splits into multiple routes when capacity exceeded", () => {
    const stops = Array.from({ length: 5 }, (_, i) =>
      makeStop(`S${i}`, -33.87 + i * 0.01, 151.21, 6, 18),
    );

    const config: VrpConfig = {
      depot: { lat: -33.87, lng: 151.21 },
      stops,
      vehicle: {
        maxStops: 2,  // force split
        maxDurationMin: 270,
        maxWeightKg: 2000,
        maxVolumeL: 5000,
        coldChainMaxMin: 180,
      },
      avgSpeedKmh: 40,
    };

    const routes = solveVrptw(config);
    expect(routes.length).toBeGreaterThanOrEqual(3);

    // All stops should be assigned
    const totalStops = routes.reduce((s, r) => s + r.stops.length, 0);
    expect(totalStops).toBe(5);
  });

  it("respects weight capacity", () => {
    const stops = [
      { ...makeStop("H1", -33.88, 151.22, 6, 18), weightKg: 600 },
      { ...makeStop("H2", -33.89, 151.20, 6, 18), weightKg: 600 },
      { ...makeStop("H3", -33.86, 151.19, 6, 18), weightKg: 600 },
    ];

    const config: VrpConfig = {
      depot: { lat: -33.87, lng: 151.21 },
      stops,
      vehicle: {
        maxStops: 18,
        maxDurationMin: 270,
        maxWeightKg: 1000, // can fit max 1 stop per route
        maxVolumeL: 50000,
        coldChainMaxMin: 180,
      },
      avgSpeedKmh: 40,
    };

    const routes = solveVrptw(config);
    expect(routes.length).toBe(3);
  });
});
