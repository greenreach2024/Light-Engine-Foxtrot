// ─── In-process event bus (pub/sub) ──────────────────────────
// Lightweight EventEmitter-based bus for decoupled module communication.
// In production this would be backed by Redis Streams, NATS, or SQS.

import { EventEmitter } from "events";
import { logger } from "../../shared/utils/logger.js";
import type { DeliveryEventTopic, DeliveryEventPayload } from "../../shared/types/delivery-events.js";

export interface BusEvent {
  topic: DeliveryEventTopic;
  payload: DeliveryEventPayload;
  timestamp: Date;
}

type BusHandler = (event: BusEvent) => void | Promise<void>;

class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many listeners (one per subscriber module)
    this.emitter.setMaxListeners(50);
  }

  /** Publish an event to all subscribers */
  publish(topic: DeliveryEventTopic, payload: DeliveryEventPayload): void {
    const event: BusEvent = { topic, payload, timestamp: new Date() };
    logger.debug({ topic, payload }, "event_bus.publish");
    // Emit on the specific topic and on a wildcard "*" channel
    this.emitter.emit(topic, event);
    this.emitter.emit("*", event);
  }

  /** Subscribe to a specific event topic */
  subscribe(topic: DeliveryEventTopic | "*", handler: BusHandler): void {
    this.emitter.on(topic, handler);
  }

  /** Unsubscribe a handler */
  unsubscribe(topic: DeliveryEventTopic | "*", handler: BusHandler): void {
    this.emitter.off(topic, handler);
  }

  /** Subscribe to a topic, auto-unsubscribe after first event */
  once(topic: DeliveryEventTopic, handler: BusHandler): void {
    this.emitter.once(topic, handler);
  }
}

/** Singleton event bus instance */
export const eventBus = new EventBus();
