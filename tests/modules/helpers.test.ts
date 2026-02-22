import { describe, it, expect } from "vitest";
import { haversineKm, round, clamp, generateOrderNumber } from "../../src/shared/utils/helpers.js";

describe("Helpers", () => {
  describe("haversineKm", () => {
    it("Sydney CBD → Bondi Beach ≈ 7-8 km", () => {
      const dist = haversineKm(-33.8688, 151.2093, -33.8915, 151.2767);
      expect(dist).toBeGreaterThan(6);
      expect(dist).toBeLessThan(9);
    });

    it("same point → 0", () => {
      expect(haversineKm(0, 0, 0, 0)).toBe(0);
    });
  });

  describe("round", () => {
    it("rounds to 2 decimal places by default", () => {
      expect(round(1.555)).toBe(1.56);
      expect(round(1.554)).toBe(1.55);
    });
  });

  describe("clamp", () => {
    it("clamps below min", () => expect(clamp(-5, 0, 10)).toBe(0));
    it("clamps above max", () => expect(clamp(15, 0, 10)).toBe(10));
    it("passes through within range", () => expect(clamp(5, 0, 10)).toBe(5));
  });

  describe("generateOrderNumber", () => {
    it("generates formatted order number", () => {
      const num = generateOrderNumber(42);
      expect(num).toMatch(/^LE-\d{8}-042$/);
    });
  });
});
