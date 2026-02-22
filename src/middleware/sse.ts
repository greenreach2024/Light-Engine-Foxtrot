// ─── SSE (Server-Sent Events) middleware ─────────────────────
// Provides real-time delivery tracking via SSE streams.

import type { Request, Response, NextFunction } from "express";
import { eventBus, type BusEvent } from "../shared/events/index.js";
import { EVENT_VISIBILITY } from "../shared/types/delivery-events.js";
import type { AuthenticatedRequest } from "../shared/types/common.js";
import { logger } from "../shared/utils/logger.js";

/**
 * SSE middleware that streams delivery events to connected clients.
 *
 * Clients connect to GET /api/v1/tracking/stream?shipment_id=...
 * Events are filtered by:
 *   1. shipment_id (only events for the requested shipment)
 *   2. role-based visibility (driver vs buyer vs ops)
 */
export function sseStream(req: Request, res: Response, _next: NextFunction): void {
  const authReq = req as AuthenticatedRequest;
  const shipmentId = req.query.shipment_id as string | undefined;
  const routeId = req.query.route_id as string | undefined;
  const role = authReq.auth?.role ?? "viewer";

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable nginx buffering
  });

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ shipment_id: shipmentId, route_id: routeId })}\n\n`);

  // Heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`:heartbeat ${Date.now()}\n\n`);
  }, 30_000);

  // Event handler
  const handler = (event: BusEvent) => {
    // Filter by shipment/route if specified
    if (shipmentId && event.payload.shipment_id !== shipmentId) return;
    if (routeId && event.payload.route_id !== routeId) return;

    // Role-based visibility check
    const allowedRoles = EVENT_VISIBILITY[event.topic];
    if (allowedRoles && !allowedRoles.includes(role)) return;

    // Send event
    const data = JSON.stringify({
      topic: event.topic,
      payload: event.payload,
      timestamp: event.timestamp.toISOString(),
    });
    res.write(`event: ${event.topic}\ndata: ${data}\n\n`);
  };

  // Subscribe to all events (handler filters)
  eventBus.subscribe("*", handler);

  logger.info({ shipmentId, routeId, role }, "sse_stream.connected");

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    eventBus.unsubscribe("*", handler);
    logger.info({ shipmentId, routeId }, "sse_stream.disconnected");
  });
}
