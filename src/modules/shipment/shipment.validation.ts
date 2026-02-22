import { z } from "zod";

export const createShipmentSchema = z.object({
  order_ids: z.array(z.string().uuid()).min(1),
  route_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
});

export const updateShipmentStatusSchema = z.object({
  status: z.enum([
    "pending", "assigned", "pickup_started", "pickup_complete",
    "in_transit", "arriving", "delivered", "exception", "cancelled",
  ]),
  lat: z.number().optional(),
  lng: z.number().optional(),
  notes: z.string().optional(),
});

export const recordEventSchema = z.object({
  event_type: z.enum([
    "shipment.created", "shipment.assigned", "shipment.pickup_started",
    "shipment.pickup_complete", "shipment.in_transit", "shipment.arriving",
    "shipment.delivered", "shipment.exception", "shipment.cancelled",
    "stop.arriving", "stop.delivered", "stop.exception",
    "pod.uploaded", "pod.accepted", "pod.rejected",
    "route.started", "route.completed", "driver.location_update",
  ]),
  shipment_id: z.string().uuid().optional(),
  route_id: z.string().uuid().optional(),
  stop_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(),
  order_id: z.string().uuid().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  payload: z.record(z.unknown()).optional(),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
export type UpdateShipmentStatusInput = z.infer<typeof updateShipmentStatusSchema>;
export type RecordEventInput = z.infer<typeof recordEventSchema>;
