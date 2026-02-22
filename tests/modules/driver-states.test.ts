import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  ALLOWED_TRANSITIONS,
  DRIVER_TRANSITIONS,
  REQUIRED_DOC_TYPES,
  ONBOARDING_STEPS,
  type DriverOnboardingStatus,
} from "../../src/shared/types/driver-states.js";

describe("Driver State Machine", () => {
  describe("isValidTransition", () => {
    it("allows applicant → docs_pending", () => {
      expect(isValidTransition("applicant", "docs_pending")).toBe(true);
    });

    it("allows the happy-path onboarding sequence", () => {
      const happyPath: [DriverOnboardingStatus, DriverOnboardingStatus][] = [
        ["applicant", "docs_pending"],
        ["docs_pending", "bg_check"],
        ["bg_check", "banking"],
        ["banking", "agreement"],
        ["agreement", "active"],
      ];
      for (const [from, to] of happyPath) {
        expect(isValidTransition(from, to)).toBe(true);
      }
    });

    it("allows agreement → training (optional training path)", () => {
      expect(isValidTransition("agreement", "training")).toBe(true);
    });

    it("allows training → active", () => {
      expect(isValidTransition("training", "active")).toBe(true);
    });

    it("allows active → suspended", () => {
      expect(isValidTransition("active", "suspended")).toBe(true);
    });

    it("allows suspended → active (reinstatement)", () => {
      expect(isValidTransition("suspended", "active")).toBe(true);
    });

    it("allows active → deactivated", () => {
      expect(isValidTransition("active", "deactivated")).toBe(true);
    });

    it("allows suspended → deactivated", () => {
      expect(isValidTransition("suspended", "deactivated")).toBe(true);
    });

    it("rejects going backwards: docs_pending → applicant", () => {
      expect(isValidTransition("docs_pending", "applicant")).toBe(false);
    });

    it("rejects skipping steps: applicant → bg_check", () => {
      expect(isValidTransition("applicant", "bg_check")).toBe(false);
    });

    it("rejects deactivated → anything", () => {
      const allStates: DriverOnboardingStatus[] = [
        "applicant", "docs_pending", "bg_check", "banking",
        "agreement", "training", "active", "suspended", "deactivated",
      ];
      for (const to of allStates) {
        expect(isValidTransition("deactivated", to)).toBe(false);
      }
    });

    it("rejects self-transitions", () => {
      expect(isValidTransition("active", "active")).toBe(false);
      expect(isValidTransition("applicant", "applicant")).toBe(false);
    });
  });

  describe("ALLOWED_TRANSITIONS coverage", () => {
    it("covers every status", () => {
      const allStates: DriverOnboardingStatus[] = [
        "applicant", "docs_pending", "bg_check", "banking",
        "agreement", "training", "active", "suspended", "deactivated",
      ];
      for (const s of allStates) {
        expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
      }
    });

    it("deactivated has no transitions", () => {
      expect(ALLOWED_TRANSITIONS.deactivated).toEqual([]);
    });
  });

  describe("DRIVER_TRANSITIONS", () => {
    it("every transition has a guard description", () => {
      for (const t of DRIVER_TRANSITIONS) {
        expect(t.guard).toBeTruthy();
      }
    });

    it("has at least 10 transitions defined", () => {
      expect(DRIVER_TRANSITIONS.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("REQUIRED_DOC_TYPES", () => {
    it("includes licence and insurance", () => {
      expect(REQUIRED_DOC_TYPES).toContain("licence");
      expect(REQUIRED_DOC_TYPES).toContain("insurance");
    });
  });

  describe("ONBOARDING_STEPS", () => {
    it("has 5 steps", () => {
      expect(ONBOARDING_STEPS).toHaveLength(5);
    });

    it("first step is verification", () => {
      expect(ONBOARDING_STEPS[0].key).toBe("verification");
    });

    it("last step gates active status", () => {
      expect(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1].gatesStatus).toBe("active");
    });
  });
});
