"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { portfolioUrl } from "../lib/portfolio";
import {
  ArrowUpRight, CalendarDays, ChevronDown, ChevronLeft, ChevronRight,
  CircleHelp, Clock3, LocateFixed, MessageCircle, PackageCheck,
} from "lucide-react";
import { dateLabel, decimals, describeDifference, integers, monthLabel, rateLabel, share, stateNames } from "../lib/presentation";
import type { DataInfo, DeliveryStatus, Filters, OrderPage, OrderSort, OrderView, Summary } from "../lib/types";
import { ChatPanel } from "./chat-panel";

const deliveryStatuses = [
  { id: "early", label: "Antes da data" },
  { id: "onDate", label: "Na data prometida" },
  { id: "late", label: "Após a data" },
] as const;

function MonthlyChart({
  summary, month, onSelect,
}: { summary: Summary; month: string; onSelect: (month: string) => void }) {
  const values = summary.timeline ?? summary.monthly;
  if (!values.length) {
    return <div className="chart-empty">Sem entregas no recorte. Experimente outro estado ou período.</div>;
  }

  const ticks = [100, 75, 50, 25, 0];
  return (
    <div className="plot-scroll">
      <div className="plot" style={{ minWidth: Math.max(240, 46 + values.length * 26) }}>
        <div className="plot-lines" aria-hidden="true">
          {ticks.map((tick) => <div key={tick}><span>{tick}%</span><i /></div>)}
        </div>
        <div className="plot-bars" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
          {values.map((row, index) => {
            const label = row.rate === null
              ? `${monthLabel(row.month)} · sem entregas`
              : `${monthLabel(row.month)} · ${row.delivered} entregas · ${row.early} antes da data · ${row.onDate} na data · ${row.late} atrasadas (${rateLabel(row.rate)})`;
            const [year, numericMonth] = row.month.split("-");
            const showLabel = values.length <= 9 || index % 3 === 0 || index === values.length - 1;
            return (
              <button
                type="button"
                key={row.month}
                className={row.rate === null ? "plot-column no-data" : "plot-column"}
                aria-label={label}
                title={label}
                aria-pressed={row.month === month}
                onClick={() => onSelect(row.month === month ? "" : row.month)}
              >
                <span className="bar" aria-hidden="true">
                  {deliveryStatuses.map(({ id }) => (
                    <span key={id} className={`status-fill ${id}`} style={{ height: `${share(row[id], row.delivered) ?? 0}%` }} />
                  ))}
                </span>
                {showLabel && <span className="month-label">{numericMonth}/{year.slice(2)}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Dashboard({
  dataInfo, initialFilters, initialSummary, initialOrders,
}: {
  dataInfo: DataInfo;
  initialFilters: Filters;
  initialSummary: Summary;
  initialOrders: OrderPage;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>("late");
  const [orderSort, setOrderSort] = useState<OrderSort>("recent");
  const [minDelay, setMinDelay] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState(initialSummary);
  const [orders, setOrders] = useState(initialOrders);
  const [status, setStatus] = useState<"ready" | "loading" | "error">("ready");
  const [retry, setRetry] = useState(0);
  const [loadedKey, setLoadedKey] = useState(`${initialFilters.state}|${initialFilters.month}|late|recent|0|1|0`);
  const { state, month } = filters;
  const requestKey = `${state}|${month}|${deliveryStatus}|${orderSort}|${minDelay}|${page}|${retry}`;

  useEffect(() => {
    if (loadedKey === requestKey) {
      setStatus("ready");
      return;
    }
    const controller = new AbortController();
    const summaryParams = new URLSearchParams({ state, month, timeline: "true" });
    const orderParams = new URLSearchParams({ state, month, status: deliveryStatus, sort: orderSort, minDelay: String(minDelay), page: String(page) });

    async function refresh() {
      setStatus("loading");
      try {
        const [summaryResponse, orderResponse] = await Promise.all([
          fetch(`/api/indicadores?${summaryParams}`, { signal: controller.signal }),
          fetch(`/api/pedidos?${orderParams}`, { signal: controller.signal }),
        ]);
        if (!summaryResponse.ok || !orderResponse.ok) throw new Error("Falha ao consultar entregas");
        const [nextSummary, nextOrders]: [Summary, OrderPage] = await Promise.all([
          summaryResponse.json(), orderResponse.json(),
        ]);
        if (controller.signal.aborted) return;
        setSummary(nextSummary);
        setOrders(nextOrders);
        setLoadedKey(requestKey);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }

    void refresh();
    return () => controller.abort();
  }, [deliveryStatus, loadedKey, minDelay, month, orderSort, page, requestKey, state]);

  function setFilter(nextFilters: Filters) {
    setFilters(nextFilters);
    setPage(1);
  }

  function showOrders(status: DeliveryStatus, sort: OrderSort = "recent", delay = 0) {
    setDeliveryStatus(status);
    setOrderSort(sort);
    setMinDelay(delay);
    setPage(1);
  }

  const scope = [state ? stateNames[state] : "Brasil", month ? monthLabel(month) : "todo o histórico"].join(" · ");
  const { hotspot, severity } = summary;

  function showEvidence(view: OrderView) {
    setFilter({ state: view.state, month: view.month });
    showOrders(view.status, view.sort, view.minDelay);
    setChatOpen(false);
    document.getElementById("pedidos")?.scrollIntoView({ block: "start" });
  }

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <Link className="brand" href="/copiloto" aria-label="Copiloto de Entregas, início do painel">
            <Image className="brand-mark" src="/icon.svg" alt="" width={40} height={40} unoptimized />
            <span>Copiloto de Entregas</span>
          </Link>
          <div className="header-actions">
            <a className="source-link" href={dataInfo.source} target="_blank" rel="noreferrer" aria-label="Dados da Olist">
              <span>Dados da Olist</span> <ArrowUpRight size={15} aria-hidden="true" />
            </a>
            <button type="button" className="chat-toggle" aria-expanded={chatOpen} aria-controls="copiloto-chat" onClick={() => setChatOpen((open) => !open)}>
              <MessageCircle size={16} aria-hidden="true" /> Perguntar
            </button>
          </div>
        </div>
      </header>

      <main className="shell">
        <section className="intro" aria-labelledby="dashboard-title">
          <div className="intro-copy">
            <h1 id="dashboard-title">Pontualidade das entregas</h1>
            <p>Compare o prazo prometido com a entrega real dos pedidos da Olist.</p>
          </div>
        </section>

        <div className="filters" role="group" aria-label="Filtros do painel">
          <label>
            <span>Estado de destino</span>
            <span className="select-wrap">
              <LocateFixed size={17} aria-hidden="true" />
              <select value={state} onChange={(event) => setFilter({ ...filters, state: event.target.value })}>
                <option value="">Brasil · todos os estados</option>
                {[...dataInfo.stateOptions].sort((a, b) => stateNames[a].localeCompare(stateNames[b], "pt-BR"))
                  .map((code) => <option key={code} value={code}>{stateNames[code]} ({code})</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </span>
          </label>
          <label>
            <span>Mês da entrega</span>
            <span className="select-wrap">
              <CalendarDays size={17} aria-hidden="true" />
              <select value={month} onChange={(event) => setFilter({ ...filters, month: event.target.value })}>
                <option value="">Todo o histórico</option>
                {[...dataInfo.monthOptions].reverse()
                  .map((value) => <option key={value} value={value}>{monthLabel(value)}</option>)}
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </span>
          </label>
          <div className="historical-range">
            <CalendarDays size={19} aria-hidden="true" />
            <div>
              <span>Histórico disponível</span>
              <p><time dateTime={dataInfo.firstDelivery}>{dateLabel(dataInfo.firstDelivery)}</time> a <time dateTime={dataInfo.lastDelivery}>{dateLabel(dataInfo.lastDelivery)}</time></p>
            </div>
          </div>
        </div>

        {status === "error" && (
          <div className="feedback" role="alert">
            Não foi possível atualizar o recorte.
            <button type="button" onClick={() => setRetry((value) => value + 1)}>Tentar de novo</button>
          </div>
        )}
        {status === "loading" && <span className="sr-only" role="status">Atualizando os dados do painel.</span>}

        <div className="results" aria-busy={status === "loading"} data-status={status} hidden={status === "error"}>
          <section aria-labelledby="summary-title">
            <h2 id="summary-title" className="section-title">Resumo das entregas</h2>
            <div className="metrics" aria-live="polite">
              <article className="metric metric-total">
                <h3><PackageCheck size={17} aria-hidden="true" /> Entregas analisadas</h3>
                <strong>{integers.format(summary.delivered)}</strong>
                {summary.delivered > 0 && <p>{rateLabel(share(summary.early + summary.onDate, summary.delivered))} até a data prometida</p>}
              </article>
              {deliveryStatuses.map(({ id, label }) => (
                <article className={`metric metric-${id}`} key={id}>
                  <h3><span className={`status-fill metric-dot ${id}`} aria-hidden="true" />{label}</h3>
                  <strong>{rateLabel(share(summary[id], summary.delivered))}</strong>
                  <a href="#pedidos" onClick={() => showOrders(id)}>
                    {integers.format(summary[id])} {summary[id] === 1 ? "entrega" : "entregas"} <ArrowUpRight size={13} aria-hidden="true" />
                  </a>
                </article>
              ))}
            </div>
          </section>

          <div className="analysis-grid">
            <section className="card chart-card" aria-labelledby="chart-title">
              <div className="card-heading">
                <div>
                  <h2 id="chart-title">Pontualidade por mês de entrega</h2>
                  <p>Selecione uma coluna para filtrar os pedidos por mês.</p>
                </div>
              </div>
              <div className="chart-legend">
                {deliveryStatuses.map(({ id, label }) => (
                  <span className="legend" key={id}><i className={`status-fill ${id}`} aria-hidden="true" /> {label}</span>
                ))}
              </div>
              <MonthlyChart summary={summary} month={month} onSelect={(value) => setFilter({ state, month: value })} />
            </section>

            <section className="card investigation" aria-labelledby="investigation-title">
              <div className="card-heading"><h2 id="investigation-title">Onde investigar</h2><Clock3 size={18} aria-hidden="true" /></div>
              {hotspot && (
                <div className="hotspot">
                  <p>{hotspot.dimension === "state" ? "Estado com mais atrasos" : "Mês com mais atrasos"}</p>
                  <button type="button" onClick={() => {
                    setFilter(hotspot.dimension === "state" ? { state: hotspot.key, month } : { state, month: hotspot.key });
                    showOrders("late");
                  }}>
                    {hotspot.dimension === "state" ? stateNames[hotspot.key] : monthLabel(hotspot.key)}
                    <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                  <span>{integers.format(hotspot.late)} atrasos em {integers.format(hotspot.delivered)} entregas · {rateLabel(hotspot.rate)}</span>
                </div>
              )}
              {severity.medianDays === null ? <p className="investigation-empty">Nenhum atraso nas entregas do recorte.</p> : (
                <div className="severity">
                  <div><strong>{decimals.format(severity.medianDays)} {severity.medianDays === 1 ? "dia" : "dias"}</strong><span>Atraso mediano</span></div>
                  <div><strong>{integers.format(severity.overWeek)}</strong><span>Mais de 7 dias de atraso</span></div>
                  <a href="#pedidos" onClick={() => showOrders("late", "delay")}>Ver maiores atrasos <ArrowUpRight size={14} aria-hidden="true" /></a>
                </div>
              )}
            </section>
          </div>

          <section className="card records" id="pedidos" aria-labelledby="records-title">
            <div className="card-heading">
              <div>
                <h2 id="records-title">Pedidos do recorte</h2>
                <p>{scope}</p>
              </div>
              <div className="record-controls">
                <label><span>Situação</span>
                  <select value={deliveryStatus} onChange={(event) => showOrders(event.target.value as DeliveryStatus, orderSort)}>
                    <option value="all">Todas</option>
                    {deliveryStatuses.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                    <option value="byDate">Até a data prometida</option>
                  </select>
                </label>
                <label><span>Ordenar por</span>
                  <select value={orderSort} onChange={(event) => showOrders(deliveryStatus, event.target.value as OrderSort, minDelay)}>
                    <option value="recent">Entrega mais recente</option>
                    <option value="delay">Maior atraso</option>
                  </select>
                </label>
              </div>
            </div>
            {minDelay > 0 && (
              <div className="active-delay">
                <span>Atraso mínimo de {integers.format(minDelay)} {minDelay === 1 ? "dia" : "dias"}</span>
                <button type="button" onClick={() => showOrders(deliveryStatus, orderSort)}>Limpar</button>
              </div>
            )}
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabela de pedidos do recorte">
              <table>
                <thead><tr><th scope="col">Pedido</th><th scope="col">UF</th><th scope="col">Data prometida</th><th scope="col">Data real</th><th scope="col">Diferença</th></tr></thead>
                <tbody>
                  {orders.orders.map(([id, uf, promised, delivered, days]) => (
                    <tr key={id}>
                      <td><code title={id}>{id.slice(0, 8)}</code></td>
                      <td>{uf}</td>
                      <td>{dateLabel(promised)}</td>
                      <td>{dateLabel(delivered)}</td>
                      <td><span className={`delay ${days > 0 ? "late" : days === 0 ? "onDate" : "early"}`}>{describeDifference(days)}</span></td>
                    </tr>
                  ))}
                  {!orders.orders.length && <tr><td colSpan={5} className="empty-cell">Nenhum pedido com esses filtros.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>{integers.format(orders.total)} {orders.total === 1 ? "pedido" : "pedidos"}</span>
              <div className="pagination">
                <button type="button" aria-label="Página anterior" disabled={orders.page <= 1 || status === "loading"} onClick={() => setPage(orders.page - 1)}><ChevronLeft size={18} /></button>
                <span>{orders.page} de {orders.pages}</span>
                <button type="button" aria-label="Próxima página" disabled={orders.page >= orders.pages || status === "loading"} onClick={() => setPage(orders.page + 1)}><ChevronRight size={18} /></button>
              </div>
            </div>
          </section>
        </div>

        <footer className="method">
          <CircleHelp size={17} aria-hidden="true" />
          <p>O painel filtra pedidos entregues da Olist, agrega por UF e calcula a diferença em dias corridos entre a data real e a prometida. <a href={dataInfo.source}>Fonte dos dados</a> · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.pt-br">CC BY-NC-SA 4.0</a> · <a href={portfolioUrl}>Voltar ao portfólio</a></p>
        </footer>
      </main>
      <ChatPanel open={chatOpen} scope={scope} view={{ ...filters, status: deliveryStatus, sort: orderSort, minDelay }}
        onClose={() => setChatOpen(false)} onShowOrders={showEvidence} />
    </>
  );
}
