import OpenAI from "openai";
import type { FunctionTool } from "openai/resources/responses/responses";
import { MAX_CHAT_OUTPUT_TOKENS, PUBLIC_CHAT_MODEL } from "./budget";
import { compareDelays, getDataInfo, getOrders, getSummary, isDelayThreshold, isOrderSort, isOrderStatus } from "./deliveries";
import { decimals, integers, monthLabel, rateLabel, share, stateNames } from "./presentation";
import type { ChatAnswer, DeliveryStatus, OrderView } from "./types";

const maximumQuestionLength = 500;
const dataHelp = "Posso consultar a pontualidade por estado e mês de entrega, comparar atrasos e listar os pedidos do recorte.";

const scopeFields = {
  state: { type: ["string", "null"], description: "UF. Null herda a UF do painel. String vazia só quando o usuário pede Brasil ou todas as UFs." },
  month: { type: ["string", "null"], description: "Mês da entrega no formato AAAA-MM. Null herda o mês do painel. String vazia quando o usuário pede todo o histórico." },
};

function tool(name: string, description: string, properties: Record<string, object>): FunctionTool {
  return {
    type: "function", name, description, strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
  };
}

const tools = [
  tool("consultar_entregas", "Calcula indicadores ou lista pedidos no recorte. Use para limiares de atraso.", {
    ...scopeFields,
    mode: { type: "string", enum: ["summary", "orders", "severity"] },
    status: {
      type: ["string", "null"],
      enum: ["all", "early", "onDate", "byDate", "late", null],
      description: "early antes da data, onDate no próprio dia, byDate no prazo (antes ou no dia), late após a data. Null usa o contexto descrito nas instruções.",
    },
    minDelay: {
      type: ["integer", "null"],
      description: "Mínimo inclusivo de dias de atraso. Converta mais de 7 em 8. Null preserva filtro da tabela em listagens genéricas. 0 remove o limite.",
    },
    sort: {
      type: ["string", "null"], enum: ["recent", "delay", null],
      description: "Use delay para os maiores atrasos. Null preserva a ordem da tabela em listagens.",
    },
  }),
  tool("comparar_atrasos", "Encontra o mês ou a UF com mais atrasos no recorte.", {
    ...scopeFields,
    dimension: { type: "string", enum: ["state", "month"] },
    metric: {
      type: "string", enum: ["count", "rate"],
      description: "Use rate quando a pergunta mencionar taxa, proporção ou percentual. Em 'mais atrasos', use count.",
    },
  }),
  tool("pedir_esclarecimento", "Pede um detalhe ou informa que a pergunta não cabe nas dimensões da demo.", {
    reason: { type: "string", enum: ["month_year", "period", "unsupported"] },
  }),
];

const instructions = `Interprete perguntas em português sobre a base histórica de entregas da Olist.
Escolha exatamente uma ferramenta. A ferramenta consulta dados; nunca calcule ou invente números.
Use estado e mês do painel quando o usuário não indicar outro recorte. Um intervalo de vários meses,
ano inteiro, cidade, transportadora, causas e previsão não estão disponíveis; peça um recorte de UF,
um mês de entrega ou todo o histórico. Para um mês sem ano, use o ano do mês já selecionado, se houver,
ou peça o ano. Compare meses mantendo a UF. Quando o usuário pedir comparação de meses "do histórico",
use o período completo. Compare estados dentro do período pedido; só remova o filtro de UF quando pedirem
Brasil, todos os estados ou comparação entre estados.
Em resumo genérico use mode summary e status all. "No prazo" inclui antes e na data (byDate).
"Na data prometida" significa apenas a data exata (onDate). Em listagens genéricas, status e ordem nulos
herdam a tabela. Quando a pergunta definir outra situação, use essa situação e minDelay 0, a menos que
peça um mínimo. Toda pergunta com um mínimo de dias usa mode orders e status late.
Use mode severity para mediana ou gravidade dos atrasos. Em pedidos de ranking use comparar_atrasos.
Em perguntas que não podem ser respondidas, peça esclarecimento sem sugerir um resultado.`;

type ChatRequest = { question: string; view: OrderView; history: string[] };
type Fields = Record<string, unknown>;

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validFilters(state: unknown, month: unknown): state is string {
  const { stateOptions, monthOptions } = getDataInfo();
  return typeof state === "string" && (!state || stateOptions.includes(state))
    && typeof month === "string" && (!month || monthOptions.includes(month));
}

export function parseChatRequest(body: unknown): ChatRequest | null {
  if (!isRecord(body) || typeof body.question !== "string" || body.question.length > maximumQuestionLength) return null;
  const question = body.question.trim();
  const view = body.view;
  if (!question || !isRecord(view) || !validFilters(view.state, view.month) || typeof view.month !== "string"
    || !isOrderStatus(view.status) || !isOrderSort(view.sort) || !isDelayThreshold(view.minDelay)) return null;

  const history = Array.isArray(body.history)
    ? body.history.filter((item): item is string => typeof item === "string" && item.length <= maximumQuestionLength).slice(-3)
    : [];
  return { question, view: { state: view.state, month: view.month, status: view.status, sort: view.sort, minDelay: view.minDelay }, history };
}

const resultLabels: Record<DeliveryStatus, string> = {
  all: "entregas analisadas", early: "entregas antes da data", onDate: "entregas na data prometida",
  byDate: "entregas até a data prometida", late: "entregas após a data",
};

function scopeLabel({ state, month }: OrderView) {
  return `${state ? stateNames[state] : "Brasil"} · ${month ? monthLabel(month) : "todo o histórico"}`;
}

function groundedAnswer(answer: string, view: OrderView): ChatAnswer {
  const { orders, total } = getOrders(view, view.status, 1, view.sort, view.minDelay);
  return { answer, evidence: { view, total, orders: orders.slice(0, 3) } };
}

function applyTool(name: string, args: Fields, current: OrderView): ChatAnswer {
  if (name === "pedir_esclarecimento") {
    if (args.reason === "month_year") return { answer: "De qual ano é esse mês? Você também pode selecioná-lo no painel." };
    if (args.reason === "period") return { answer: "Escolha um mês de entrega ou todo o histórico para consultar os pedidos." };
    return { answer: dataHelp };
  }
  const state = args.state ?? current.state;
  const month = args.month ?? current.month;
  if (!validFilters(state, month) || typeof month !== "string") {
    return { answer: "Esse estado ou mês não aparece na base. Selecione um recorte no painel ou indique outro período do histórico." };
  }
  const scope = { ...current, state, month, minDelay: 0 };
  if (name === "comparar_atrasos") {
    const { dimension, metric } = args;
    if ((dimension !== "state" && dimension !== "month") || (metric !== "rate" && metric !== "count")) return { answer: dataHelp };
    if (dimension === "month" && month) return { answer: "O recorte tem um único mês. Para comparar os meses, peça uma comparação em todo o histórico." };
    if (dimension === "state" && state) return { answer: "O recorte tem um único estado. Para comparar as UFs, peça uma comparação no Brasil." };
    const winner = compareDelays(scope, { dimension, metric });
    if (!winner) return { answer: `${scopeLabel(scope)}. Nenhum atraso no recorte.` };
    const view: OrderView = {
      ...scope, status: "late", sort: "delay",
      ...(dimension === "month" ? { month: winner.key } : { state: winner.key }),
    };
    const title = dimension === "month" ? monthLabel(winner.key) : stateNames[winner.key];
    const criterion = metric === "rate" ? "Maior taxa de atraso" : "Maior volume de atrasos";
    return groundedAnswer(`${scopeLabel(scope)}. ${criterion}: ${title}, com ${integers.format(winner.late)} atrasos em ${integers.format(winner.delivered)} entregas (${rateLabel(winner.rate)}).`, view);
  }
  if (name !== "consultar_entregas") return { answer: dataHelp };
  if (args.mode === "orders") {
    const status = isOrderStatus(args.status) ? args.status : current.status;
    const minDelay = isDelayThreshold(args.minDelay) ? args.minDelay : args.status === null ? current.minDelay : 0;
    const view: OrderView = { ...scope, status: minDelay ? "late" : status, minDelay, sort: isOrderSort(args.sort) ? args.sort : current.sort };
    const answer = groundedAnswer("", view);
    const total = answer.evidence?.total ?? 0;
    const label = minDelay ? `entregas com pelo menos ${integers.format(minDelay)} dias de atraso` : resultLabels[view.status];
    return { ...answer, answer: `${scopeLabel(view)}. Total de ${label}: ${integers.format(total)}.` };
  }
  const summary = getSummary(scope);
  if (!summary.delivered) return { answer: `${scopeLabel(scope)}. Nenhuma entrega com as duas datas no recorte.` };
  if (args.mode === "severity") {
    if (summary.severity.medianDays === null) return { answer: `${scopeLabel(scope)}. Nenhuma entrega atrasada no recorte.` };
    return groundedAnswer(
      `${scopeLabel(scope)}. Entre ${integers.format(summary.late)} entregas atrasadas, a mediana foi de ${decimals.format(summary.severity.medianDays)} dias. ${integers.format(summary.severity.overWeek)} passaram de 7 dias de atraso.`,
      { ...scope, status: "late", sort: "delay" },
    );
  }
  const status = isOrderStatus(args.status) ? args.status : "all";
  const view: OrderView = { ...scope, status, sort: status === "late" ? "delay" : "recent" };
  if (status === "all") return groundedAnswer(
    `${scopeLabel(view)}. As ${integers.format(summary.delivered)} entregas se dividem em ${integers.format(summary.early)} antes da data, ${integers.format(summary.onDate)} na data e ${integers.format(summary.late)} após a data. ${rateLabel(share(summary.early + summary.onDate, summary.delivered))} chegaram até a data prometida.`, view,
  );
  const count = status === "byDate" ? summary.early + summary.onDate : summary[status];
  return groundedAnswer(
    `${scopeLabel(view)}. Total de ${resultLabels[status]}: ${integers.format(count)} de ${integers.format(summary.delivered)} (${rateLabel(share(count, summary.delivered))}).`, view,
  );
}

export async function answerQuestion(
  { question, view, history }: ChatRequest,
  apiKey: string,
  settleBudget?: (usage: { input_tokens: number; output_tokens: number } | undefined) => Promise<void>,
): Promise<ChatAnswer> {
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 25_000,
    ...(settleBudget ? { baseURL: "https://api.openai.com/v1" } : {}),
  });
  const result = await client.responses.create({
    model: settleBudget ? PUBLIC_CHAT_MODEL : process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
    instructions,
    input: JSON.stringify({ painel: view, perguntas_anteriores: history, pergunta: question }),
    tools,
    tool_choice: "required",
    parallel_tool_calls: false,
    reasoning: { effort: "low" },
    max_output_tokens: MAX_CHAT_OUTPUT_TOKENS,
    service_tier: "default",
    store: false,
  });
  // A failed settlement leaves the initial, larger reservation in place.
  await settleBudget?.(result.usage).catch(() => console.warn("Copiloto: monthly budget reservation retained"));
  const call = result.output.find((item) => item.type === "function_call");
  if (!call) return { answer: dataHelp };
  const args: unknown = JSON.parse(call.arguments);
  return isRecord(args) ? applyTool(call.name, args, view) : { answer: dataHelp };
}
