import type { Metadata } from "next";
import { getDataInfo, getOrders, getSummary } from "../../lib/deliveries";
import { Dashboard } from "../dashboard";

export const metadata: Metadata = {
  title: "Copiloto de Entregas | Antonio Sergio",
  description: "Explore a pontualidade do e-commerce brasileiro com pedidos históricos da Olist.",
};

export const dynamic = "force-dynamic";

export default function CopilotoPage() {
  const filters = { state: "MA", month: "" };
  return (
    <Dashboard
      dataInfo={getDataInfo()}
      initialFilters={filters}
      initialSummary={getSummary(filters)}
      initialOrders={getOrders(filters, "late", 1)}
    />
  );
}
