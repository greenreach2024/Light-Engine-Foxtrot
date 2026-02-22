import { describe, it, expect } from "vitest";
import {
  DELIVERY_EVENT_TOPICS,
  EVENT_VISIBILITY,
  type DeliveryEventTopic,
} from "../../src/shared/types/delivery-events.js";

describe("Delivery Events", () => {
  describe("DELIVERY_EVENT_TOPICS", () => {
    it("has 18 event topics", () => {
      const count = Object.keys(DELIVERY_EVENT_TOPICS).length;
      expect(count).toBe(18);
    });

    it("all topics use dot-notation format", () => {
      const values = Object.values(DELIVERY_EVENT_TOPICS);
      for (const v of values) {
        expect(v).toMatch(/^[a-z]+\.[a-z_]+$/);
      }
    });

    it("includes core shipment lifecycle events", () => {
      expect(DELIVERY_EVENT_TOPICS.SHIPMENT_CREATED).toBe("shipment.created");
      expect(DELIVERY_EVENT_TOPICS.SHIPMENT_DELIVERED).toBe("shipment.delivered");
      expect(DELIVERY_EVENT_TOPICS.SHIPMENT_CANCELLED).toBe("shipment.cancelled");
    });

    it("includes POD events", () => {
      expect(DELIVERY_EVENT_TOPICS.POD_UPLOADED).toBe("pod.uploaded");
      expect(DELIVERY_EVENT_TOPICS.POD_ACCEPTED).toBe("pod.accepted");
      expect(DELIVERY_EVENT_TOPICS.POD_REJECTED).toBe("pod.rejected");
    });

    it("includes route events", () => {
      expect(DELIVERY_EVENT_TOPICS.ROUTE_STARTED).toBe("route.started");
      expect(DELIVERY_EVENT_TOPICS.ROUTE_COMPLETED).toBe("route.completed");
    });

    it("includes driver location update", () => {
      expect(DELIVERY_EVENT_TOPICS.DRIVER_LOCATION_UPDATE).toBe("driver.location_update");
    });
  });

  describe("EVENT_VISIBILITY", () => {
    it("defines visibility for all topics", () => {
      const topicValues = Object.values(DELIVERY_EVENT_TOPICS) as string[];
      for (const topic of topicValues) {
        expect(
          EVENT_VISIBILITY[topic as DeliveryEventTopic],
          `Missing visibility for ${topic}`,
        ).toBeDefined();
      }
    });

    it("ops can see shipment.created", () => {
      const vis = EVENT_VISIBILITY["shipment.created"];
      expect(vis).toContain("ops");
      expect(vis).toContain("buyer_admin");
    });

    it("ops can see all shipment events", () => {
      const shipmentEvents = Object.values(DELIVERY_EVENT_TOPICS).filter(
        (t) => t.startsWith("shipment."),
      );
      for (const topic of shipmentEvents) {
        expect(
          EVENT_VISIBILITY[topic],
          `ops should see ${topic}`,
        ).toContain("ops");
      }
    });

    it("driver location updates are ops-only", () => {
      const vis = EVENT_VISIBILITY["driver.location_update"];
      expect(vis).toEqual(["ops"]);
    });
  });
});
