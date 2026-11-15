export type Delivery = [id: string, state: string, promised: string, delivered: string, days: number];

export type Filters = {
  state: string;
  month: string;
};

export type Counts = {
  delivered: number;
  early: number;
  onDate: number;
  late: number;
  rate: number | null;
};

export type DeliveryStatus = "all" | "early" | "onDate" | "byDate" | "late";
export type OrderSort = "recent" | "delay";

export type OrderView = Filters & {
  status: DeliveryStatus;
  sort: OrderSort;
  minDelay: number;
};

export type Summary = Counts & {
  monthly: (Counts & { month: string })[];
  timeline?: (Counts & { month: string })[];
  severity: { medianDays: number | null; overWeek: number };
  hotspot: (Counts & { dimension: "state" | "month"; key: string }) | null;
};

export type OrderPage = {
  orders: Delivery[];
  total: number;
  page: number;
  pages: number;
};

export type DataInfo = {
  source: string;
  sourceOrders: number;
  firstDelivery: string;
  lastDelivery: string;
  stateOptions: string[];
  monthOptions: string[];
};

export type ChatAnswer = {
  answer: string;
  evidence?: {
    view: OrderView;
    total: number;
    orders: Delivery[];
  };
};
