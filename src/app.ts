import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler.js";

// Module routers
import { authRouter } from "./modules/auth/auth.routes.js";
import { customerRouter } from "./modules/customer/customer.routes.js";
import { orderRouter } from "./modules/order/order.routes.js";
import { driverRouter } from "./modules/driver/driver.routes.js";
import { dispatchRouter } from "./modules/dispatch/dispatch.routes.js";
import { routingRouter } from "./modules/routing/routing.routes.js";
import { pricingRouter } from "./modules/pricing/pricing.routes.js";
import { podRouter } from "./modules/pod/pod.routes.js";
import { billingRouter } from "./modules/billing/billing.routes.js";
import { telemetryRouter } from "./modules/telemetry/telemetry.routes.js";
import { notificationRouter } from "./modules/notification/notification.routes.js";
// Phase 2: Delivery platform modules
import { driverOnboardingRouter } from "./modules/driver-onboarding/driver-onboarding.routes.js";
import { shipmentRouter } from "./modules/shipment/shipment.routes.js";
import { trackingRouter } from "./modules/tracking/tracking.routes.js";
import { settlementRouter } from "./modules/settlement/settlement.routes.js";
import { payoutRouter } from "./modules/payout/payout.routes.js";
import { customerMembersRouter } from "./modules/customer-members/customer-members.routes.js";

export function createApp() {
  const app = express();

  // ─── Global middleware ──────────────────────────────────
  app.use(helmet());
  app.use(cors());
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 200,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // ─── Health check ───────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ─── API routes ─────────────────────────────────────────
  const api = express.Router();
  api.use("/auth", authRouter);
  api.use("/customers", customerRouter);
  api.use("/orders", orderRouter);
  api.use("/drivers", driverRouter);
  api.use("/dispatch", dispatchRouter);
  api.use("/routing", routingRouter);
  api.use("/pricing", pricingRouter);
  api.use("/pod", podRouter);
  api.use("/billing", billingRouter);
  api.use("/telemetry", telemetryRouter);
  api.use("/notifications", notificationRouter);
  // Phase 2: Delivery platform
  api.use("/driver-onboarding", driverOnboardingRouter);
  api.use("/shipments", shipmentRouter);
  api.use("/tracking", trackingRouter);
  api.use("/settlement", settlementRouter);
  api.use("/payouts", payoutRouter);
  api.use("/members", customerMembersRouter);

  app.use("/api/v1", api);

  // ─── Error handler (must be last) ──────────────────────
  app.use(errorHandler);

  return app;
}
