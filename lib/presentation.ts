export const integers = new Intl.NumberFormat("pt-BR");
export const decimals = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const months = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

export const stateNames: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará",
  PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima",
  SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

export function monthLabel(month: string) {
  return months.format(new Date(`${month}-01T00:00:00Z`));
}

export function dateLabel(date: string) {
  return date.split("-").reverse().join("/");
}

export function rateLabel(rate: number | null) {
  return rate === null ? "—" : `${decimals.format(rate)}%`;
}

export function share(count: number, total: number) {
  return total ? count / total * 100 : null;
}

export function describeDifference(days: number) {
  if (days === 0) return "Na data prometida";
  const absolute = Math.abs(days);
  return `${absolute} ${absolute === 1 ? "dia" : "dias"} ${days > 0 ? "de atraso" : "antes"}`;
}
