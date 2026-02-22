// ─── Delivery event types & topics ───────────────────────────

export const DELIVERY_EVENT_TOPICS = {
  // Shipment lifecycle
  SHIPMENT_CREATED: "shipment.created",
  SHIPMENT_ASSIGNED: "shipment.assigned",
  SHIPMENT_PICKUP_STARTED: "shipment.pickup_started",
  SHIPMENT_PICKUP_COMPLETE: "shipment.pickup_complete",
  SHIPMENT_IN_TRANSIT: "shipment.in_transit",
  SHIPMENT_ARRIVING: "shipment.arriving",
  SHIPMENT_DELIVERED: "shipment.delivered",
  SHIPMENT_EXCEPTION: "shipment.exception",
  SHIPMENT_CANCELLED: "shipment.cancelled",
  // Stop-level
  STOP_ARRIVING: "stop.arriving",
  STOP_DELIVERED: "stop.delivered",
  STOP_EXCEPTION: "stop.exception",
  // POD
  POD_UPLOADED: "pod.uploaded",
  POD_ACCEPTED: "pod.accepted",
  POD_REJECTED: "pod.rejected",
  // Route
  ROUTE_STARTED: "route.started",
  ROUTE_COMPLETED: "route.completed",
  // Driver
  DRIVER_LOCATION_UPDATE: "driver.location_update",
} as const;

export type DeliveryEventTopic = (typeof DELIVERY_EVENT_TOPICS)[keyof typeof DELIVERY_EVENT_TOPICS];

/** Payload shapes for specific event types */
export interface DeliveryEventPayload {
  shipment_id?: string;
  route_id?: string;
  stop_id?: string;
  driver_id?: string;
  order_id?: string;
  lat?: number;
  lng?: number;
  actor_id?: string;

  // Event-specific data
  eta?: string;
  exception_code?: string;
  exception_notes?: string;
  pod_id?: string;
  photo_urls?: string[];
  signature_url?: string;
  recipient_name?: string;
  temp_reading?: number;
  tote_count?: number;
  weight_kg?: number;
  [key: string]: unknown;
}

/** Full event record as stored in delivery_events */
export interface DeliveryEvent {
  id: string;
  event_type: DeliveryEventTopic;
  shipment_id: string | null;
  route_id: string | null;
  stop_id: string | null;
  driver_id: string | null;
  order_id: string | null;
  payload: DeliveryEventPayload;
  lat: number | null;
  lng: number | null;
  actor_id: string | null;
  created_at: Date;
}

/** Who can see which events — visibility matrix */
export const EVENT_VISIBILITY: Record<string, string[]> = {
  "shipment.created": ["ops", "buyer_admin"],
  "shipment.assigned": ["ops", "driver", "buyer_admin"],
  "shipment.pickup_started": ["ops", "driver", "buyer_admin", "buyer_receiver"],
  "shipment.pickup_complete": ["ops", "driver", "buyer_admin", "buyer_receiver"],
  "shipment.in_transit": ["ops", "driver", "buyer_admin", "buyer_receiver"],
  "shipment.arriving": ["ops", "driver", "buyer_admin", "buyer_receiver"],
  "shipment.delivered": ["ops", "driver", "buyer_admin", "buyer_receiver"],
  "shipment.exception": ["ops", "driver", "buyer_admin"],
  "shipment.cancelled": ["ops", "buyer_admin"],
  "stop.arriving": ["ops", "driver", "buyer_receiver"],
  "stop.delivered": ["ops", "driver", "buyer_receiver"],
  "stop.exception": ["ops", "driver", "buyer_admin"],
  "pod.uploaded": ["ops", "driver"],
  "pod.accepted": ["ops", "driver", "buyer_admin"],
  "pod.rejected": ["ops", "driver"],
  "route.started": ["ops", "driver"],
  "route.completed": ["ops", "driver"],
  "driver.location_update": ["ops"],
};
