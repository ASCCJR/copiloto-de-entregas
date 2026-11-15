import { getOrders, isDelayThreshold, isOrderSort, isOrderStatus, readFilters } from "../../../lib/deliveries";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = readFilters(params);
  const page = Number(params.get("page") ?? "1");
  const lateOnly = params.get("lateOnly") ?? "true";
  const status = params.get("status") ?? (lateOnly === "true" ? "late" : "all");
  const sort = params.get("sort") ?? "recent";
  const minDelay = Number(params.get("minDelay") ?? "0");
  if (!filters || !Number.isSafeInteger(page) || page < 1 || !["true", "false"].includes(lateOnly)) {
    return Response.json({ error: "Filtros ou página inválidos." }, { status: 400 });
  }
  if (!isOrderStatus(status)) {
    return Response.json({ error: "Situação de entrega inválida." }, { status: 400 });
  }
  if (!isOrderSort(sort) || !isDelayThreshold(minDelay)) {
    return Response.json({ error: "Ordenação ou atraso mínimo inválido." }, { status: 400 });
  }
  return Response.json(getOrders(filters, status, page, sort, minDelay));
}
