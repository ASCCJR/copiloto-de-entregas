import { getSummary, readFilters } from "../../../lib/deliveries";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = readFilters(params);
  if (!filters) {
    return Response.json({ error: "Filtros inválidos. Use UF e período AAAA-MM." }, { status: 400 });
  }
  return Response.json(getSummary(filters, params.get("timeline") === "true"));
}
