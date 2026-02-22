import { Router } from "express";
import { trackingController } from "./tracking.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { sseStream } from "../../middleware/sse.js";

export const trackingRouter = Router();

trackingRouter.use(authenticate);

// SSE stream (real-time delivery events)
trackingRouter.get("/stream", sseStream);

// Shipment timeline
trackingRouter.get("/shipments/:shipmentId/timeline", trackingController.getTimeline);

// Driver location
trackingRouter.get("/drivers/:driverId/location", trackingController.getDriverLocation);

// Active routes for a driver
trackingRouter.get("/drivers/:driverId/routes", trackingController.getActiveRoutes);

// Route ETA
trackingRouter.get("/routes/:routeId/eta", trackingController.getRouteEta);

// Geofence check
trackingRouter.get(
  "/drivers/:driverId/geofence/:stopId",
  trackingController.checkGeofence,
);
