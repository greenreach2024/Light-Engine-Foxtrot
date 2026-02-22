import dayjs from "dayjs";
import { db } from "../../db/index.js";
import { NotFoundError, BadRequestError } from "../../shared/utils/errors.js";
import type { Wave, Order, TempClass } from "../../shared/types/index.js";
import type { CreateWaveInput } from "./dispatch.validation.js";
import { TEMP_CLASS_PRIORITY } from "../../shared/constants/index.js";

interface WaveGroup {
  waveLabel: string;
  orders: Order[];
  tempClass: TempClass;
  totalWeight: number;
  totalVolume: number;
  toteCount: number;
}

export class WavePlannerService {
  /**
   * Group confirmed orders into waves based on:
   *  - cutoff time
   *  - time windows (AM vs PM)
   *  - temperature class (don't mix frozen + ambient if possible)
   */
  async planWaves(date: string): Promise<WaveGroup[]> {
    const orders = await db("orders")
      .where({ requested_date: date, status: "confirmed" })
      .orderBy("window_open") as Order[];

    if (orders.length === 0) return [];

    // Split into AM / PM based on window_open
    const noon = dayjs(`${date}T12:00:00`);
    const amOrders = orders.filter((o) => dayjs(o.window_open).isBefore(noon));
    const pmOrders = orders.filter((o) => !dayjs(o.window_open).isBefore(noon));

    const groups: WaveGroup[] = [];

    if (amOrders.length > 0) {
      groups.push(...this.subGroupByTemp(amOrders, `${date} AM`));
    }
    if (pmOrders.length > 0) {
      groups.push(...this.subGroupByTemp(pmOrders, `${date} PM`));
    }

    return groups;
  }

  /** Further split by temp class if mixed */
  private subGroupByTemp(orders: Order[], baseLabel: string): WaveGroup[] {
    const grouped = new Map<TempClass, Order[]>();
    for (const order of orders) {
      const tc = order.temp_class;
      if (!grouped.has(tc)) grouped.set(tc, []);
      grouped.get(tc)!.push(order);
    }

    // If only one temp class, single wave
    if (grouped.size === 1) {
      const [tempClass, groupOrders] = [...grouped.entries()][0];
      return [this.buildGroup(baseLabel, groupOrders, tempClass)];
    }

    // Multiple temp classes — separate waves
    return [...grouped.entries()].map(([tc, groupOrders]) =>
      this.buildGroup(`${baseLabel} [${tc}]`, groupOrders, tc),
    );
  }

  private buildGroup(label: string, orders: Order[], tempClass: TempClass): WaveGroup {
    return {
      waveLabel: label,
      orders,
      tempClass,
      totalWeight: orders.reduce((s, o) => s + o.total_weight_kg, 0),
      totalVolume: orders.reduce((s, o) => s + o.total_volume_l, 0),
      toteCount: orders.reduce((s, o) => s + o.tote_count, 0),
    };
  }

  /** Persist planned waves into DB */
  async createWaves(groups: WaveGroup[], cutoffAt: string): Promise<Wave[]> {
    const waves: Wave[] = [];
    for (const group of groups) {
      const [wave] = await db("waves")
        .insert({
          wave_date: group.orders[0].requested_date,
          wave_label: group.waveLabel,
          cutoff_at: cutoffAt,
          status: "planning",
        })
        .returning("*");
      waves.push(wave);
    }
    return waves;
  }

  /** Estimate how many routes a wave will need */
  estimateRouteCount(
    totalWeight: number,
    totalVolume: number,
    toteCount: number,
    orderCount: number,
    maxStops: number,
    avgCapacityKg: number,
    avgCapacityL: number,
  ): number {
    const byStops = Math.ceil(orderCount / maxStops);
    const byWeight = Math.ceil(totalWeight / avgCapacityKg);
    const byVolume = Math.ceil(totalVolume / avgCapacityL);
    return Math.max(byStops, byWeight, byVolume, 1);
  }
}

export const wavePlannerService = new WavePlannerService();
