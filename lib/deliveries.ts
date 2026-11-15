import { readFileSync } from "node:fs";
import path from "node:path";
import type { Counts, DataInfo, Delivery, DeliveryStatus, Filters, OrderPage, OrderSort, Summary } from "./types";

type Totals = Omit<Counts, "rate">;
const reportStatus = (days: number) => days < 0 ? "early" : days === 0 ? "onDate" : "late";

export function isOrderStatus(value: unknown): value is DeliveryStatus {
  return value === "all" || value === "early" || value === "onDate" || value === "byDate" || value === "late";
}

export function isOrderSort(value: unknown): value is OrderSort {
  return value === "recent" || value === "delay";
}

export function isDelayThreshold(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

type Dataset = Pick<DataInfo, "source" | "sourceOrders" | "firstDelivery" | "lastDelivery"> & {
  deliveries: Delivery[];
};

let dataset: Dataset | undefined;

function getDataset() {
  dataset ??= JSON.parse(
    readFileSync(path.join(process.cwd(), "data", "deliveries.json"), "utf8"),
  ) as Dataset;
  return dataset;
}

export function getDataInfo(): DataInfo {
  const { source, sourceOrders, firstDelivery, lastDelivery, deliveries } = getDataset();
  return {
    source,
    sourceOrders,
    firstDelivery,
    lastDelivery,
    stateOptions: [...new Set(deliveries.map((order) => order[1]))].sort(),
    monthOptions: [...new Set(deliveries.map((order) => order[3].slice(0, 7)))].sort(),
  };
}

export function readFilters(params: URLSearchParams): Filters | null {
  const state = params.get("state") ?? "";
  const month = params.get("month") ?? "";
  if ((state && !/^[A-Z]{2}$/.test(state)) || (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
    return null;
  }
  return { state, month };
}

function selectedOrders({ state, month }: Filters): Delivery[] {
  return getDataset().deliveries.filter(
    (order) => (!state || order[1] === state) && (!month || order[3].startsWith(month)),
  );
}

function newTotals(): Totals {
  return { delivered: 0, early: 0, onDate: 0, late: 0 };
}

function addOrder(totals: Totals, days: number) {
  totals.delivered += 1;
  totals[reportStatus(days)] += 1;
}

function counts(totals: Totals): Counts {
  return { ...totals, rate: totals.delivered ? (totals.late / totals.delivered) * 100 : null };
}

function monthlySeries(grouped: Map<string, Totals>): Summary["monthly"] {
  const monthly: Summary["monthly"] = [];
  const populated = Array.from(grouped.keys()).sort();
  if (populated.length) {
    const current = new Date(`${populated[0]}-01T00:00:00Z`);
    const lastMonth = populated[populated.length - 1];
    for (let month = populated[0]; month <= lastMonth; month = current.toISOString().slice(0, 7)) {
      const group = grouped.get(month);
      monthly.push({ month, ...counts(group ?? newTotals()) });
      current.setUTCMonth(current.getUTCMonth() + 1);
    }
  }
  return monthly;
}

type Comparison = { dimension: "state" | "month"; metric: "count" | "rate" };

function largestDelayGroup(groups: Map<string, Totals>, { dimension, metric }: Comparison): Summary["hotspot"] {
  let largest: Summary["hotspot"] = null;
  let highest = 0;
  for (const [key, totals] of groups) {
    if (!totals.late) continue;
    const value = metric === "count" ? totals.late : (totals.late / totals.delivered) * 100;
    if (value > highest || (largest && value === highest && key < largest.key)) {
      largest = { key, dimension, ...counts(totals) };
      highest = value;
    }
  }
  return largest;
}

export function getSummary(filters: Filters, includeTimeline = false): Summary {
  const { state, month } = filters;
  const orders = selectedOrders(includeTimeline ? { state, month: "" } : filters);
  const byMonth = new Map<string, Totals>();
  const byState = new Map<string, Totals>();
  const totals = newTotals();
  const delays: number[] = [];
  let overWeek = 0;
  for (const [, uf, , delivered, days] of orders) {
    const orderMonth = delivered.slice(0, 7);
    const monthTotals = byMonth.get(orderMonth) ?? newTotals();
    addOrder(monthTotals, days);
    byMonth.set(orderMonth, monthTotals);

    if (month && month !== orderMonth) continue;
    addOrder(totals, days);
    if (days > 0) delays.push(days);
    if (days > 7) overWeek += 1;
    if (!state) {
      const stateTotals = byState.get(uf) ?? newTotals();
      addOrder(stateTotals, days);
      byState.set(uf, stateTotals);
    }
  }
  delays.sort((a, b) => a - b);
  const middle = Math.floor(delays.length / 2);
  const medianDays = delays.length ? (delays[middle] + delays[Math.floor((delays.length - 1) / 2)]) / 2 : null;
  const series = monthlySeries(byMonth);
  return {
    ...counts(totals),
    monthly: month ? series.filter((row) => row.month === month && row.delivered > 0) : series,
    ...(includeTimeline && month ? { timeline: series } : {}),
    severity: { medianDays, overWeek },
    hotspot: !state
      ? largestDelayGroup(byState, { dimension: "state", metric: "count" })
      : !month ? largestDelayGroup(byMonth, { dimension: "month", metric: "count" }) : null,
  };
}

export function compareDelays(filters: Filters, comparison: Comparison) {
  const groups = new Map<string, Totals>();
  for (const [, state, , delivered, days] of selectedOrders(filters)) {
    const key = comparison.dimension === "state" ? state : delivered.slice(0, 7);
    const totals = groups.get(key) ?? newTotals();
    addOrder(totals, days);
    groups.set(key, totals);
  }
  return largestDelayGroup(groups, comparison);
}

export function getOrders(filters: Filters, status: DeliveryStatus, requestedPage: number, sort: OrderSort = "recent", minDelay = 0): OrderPage {
  const pageSize = 8;
  const orders = selectedOrders(filters).filter(([, , , , days]) => (
    (!minDelay || days >= minDelay)
    && (status === "all" || (status === "byDate" ? days <= 0 : reportStatus(days) === status))
  ));
  if (sort === "delay") orders.sort((a, b) => b[4] - a[4]);
  const pages = Math.max(1, Math.ceil(orders.length / pageSize));
  const page = Math.min(requestedPage, pages);
  return { orders: orders.slice((page - 1) * pageSize, page * pageSize), total: orders.length, page, pages };
}
