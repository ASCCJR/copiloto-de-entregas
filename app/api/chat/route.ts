import OpenAI from "openai";
import { blobBudgetStore, BudgetUnavailable, monthlyBudgetKey, reserveChatBudget } from "../../../lib/budget";
import { answerQuestion, parseChatRequest } from "../../../lib/chat";

function hasBudgetStore() {
  return Boolean(process.env.BLOB_STORE_ID?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function getChatKey() {
  if (process.env.NODE_ENV === "production"
    && (process.env.COPILOTO_PUBLIC_CHAT !== "enabled" || !hasBudgetStore())) return undefined;
  return process.env.OPENAI_API_KEY?.trim();
}

export function GET() {
  return Response.json({ configured: Boolean(getChatKey()) });
}

export async function POST(request: Request) {
  const apiKey = getChatKey();
  if (!apiKey) return Response.json({ error: "O chat está indisponível no momento." }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 6_000) return Response.json({ error: "A pergunta excede o tamanho aceito." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Pergunta inválida." }, { status: 400 });
  }
  const input = parseChatRequest(body);
  if (!input) return Response.json({ error: "Revise a pergunta e os filtros do painel." }, { status: 400 });
  try {
    const settle = hasBudgetStore() ? await reserveChatBudget(blobBudgetStore(),
      monthlyBudgetKey(process.env.VERCEL_ENV === "preview" ? "preview" : "production")) : undefined;
    if (settle === null) return Response.json({ error: "O chat atingiu seu limite mensal de uso. Você ainda pode explorar os filtros e pedidos no painel." }, { status: 429 });
    return Response.json(await answerQuestion(input, apiKey, settle));
  } catch (error) {
    if (error instanceof BudgetUnavailable) {
      return Response.json({ error: "O chat está indisponível no momento. Os filtros e pedidos continuam funcionando." }, { status: 503 });
    }
    if (error instanceof OpenAI.APIError) {
      if (error.code === "project_spend_limit_exceeded" || error.code === "organization_spend_limit_exceeded") {
        return Response.json({ error: "O chat atingiu seu limite mensal de uso. Você ainda pode explorar os filtros e pedidos no painel." }, { status: 429 });
      }
      if (error.status === 401 || error.status === 403) {
        return Response.json({ error: "A OpenAI recusou a credencial ou a permissão. Confira a chave do projeto." }, { status: 502 });
      }
      if (error.status === 429) {
        return Response.json({ error: "A OpenAI atingiu um limite. Confira o saldo e os limites do projeto." }, { status: 429 });
      }
    }
    return Response.json({ error: "Não foi possível consultar a OpenAI agora. Tente novamente." }, { status: 502 });
  }
}
