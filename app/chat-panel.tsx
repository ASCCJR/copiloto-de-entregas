"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, MessageCircle, Send, X } from "lucide-react";
import { dateLabel, describeDifference, integers } from "../lib/presentation";
import type { ChatAnswer, OrderView } from "../lib/types";

const suggestions = [
  "Quantas entregas chegaram no prazo?",
  "Quais pedidos atrasaram mais de 7 dias?",
  "Qual mês do histórico teve mais atrasos?",
];

type Turn = {
  question: string;
  answer?: ChatAnswer;
  error?: string;
};

export function ChatPanel({
  open, scope, view, onClose, onShowOrders,
}: {
  open: boolean;
  scope: string;
  view: OrderView;
  onClose: () => void;
  onShowOrders: (view: OrderView) => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const messages = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch("/api/chat", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as { configured: boolean };
        setConfigured(result.configured);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (open && messages.current) messages.current.scrollTop = messages.current.scrollHeight;
  }, [open, turns]);

  async function send(value: string) {
    const question = value.trim();
    if (!question || busy || configured === false) return;
    setBusy(true);
    setDraft("");
    const history = turns.filter((turn) => turn.answer).slice(-3).map((turn) => turn.question);
    setTurns((previous) => [...previous, { question }]);
    let result: Partial<Turn>;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, view, history }),
      });
      if (response.ok) {
        result = { answer: await response.json() as ChatAnswer };
      } else {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        const fallback = response.status === 429
          ? "Limite de perguntas atingido. Aguarde um minuto para tentar novamente."
          : "Não foi possível enviar a pergunta.";
        result = { error: typeof body?.error === "string" ? body.error : fallback };
        if (response.status === 503) setConfigured(false);
      }
    } catch {
      result = { error: "A conexão foi interrompida. Envie a pergunta novamente." };
    }
    setTurns((previous) => previous.map((turn, index) => index === previous.length - 1 ? { ...turn, ...result } : turn));
    setBusy(false);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  return (
    <aside
      id="copiloto-chat"
      className="chat-panel"
      aria-labelledby="chat-title"
      hidden={!open}
      onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}
    >
      <header className="chat-header">
        <span className="chat-mark"><MessageCircle size={19} aria-hidden="true" /></span>
        <div><h2 id="chat-title">Copiloto</h2><p>{scope}</p></div>
        <button type="button" className="icon-button" aria-label="Fechar chat" onClick={onClose}><X size={19} /></button>
      </header>

      <div className="chat-messages" ref={messages} role="log" aria-label="Conversa com o Copiloto">
        {configured === false && (
          <div className="chat-notice">O chat está indisponível no momento. Os filtros e a tabela de pedidos continuam disponíveis no painel.</div>
        )}
        {!turns.length && (
          <div className="chat-welcome">
            <p>Pergunte sobre as entregas dos filtros atuais ou indique outro estado e mês.</p>
            {suggestions.map((question) => (
              <button type="button" key={question} disabled={configured === false || busy} onClick={() => void send(question)}>
                {question}<ArrowRight size={14} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        {turns.map(({ question, answer, error }, index) => (
          <div className="chat-turn" key={index}>
            <p className="chat-question">{question}</p>
            {error && <p className="chat-notice" role="alert">{error}</p>}
            {answer && (
              <article className="chat-answer">
                <p>{answer.answer}</p>
                {answer.evidence && answer.evidence.total > 0 && (
                  <div className="chat-evidence">
                    <h3>Pedidos do recorte</h3>
                    <ul>
                      {answer.evidence.orders.map(([id, uf, promised, delivered, days]) => (
                        <li key={id}>
                          <span><code title={id}>{id.slice(0, 8)}</code> · {uf}</span>
                          <span>{dateLabel(promised)} → {dateLabel(delivered)}</span>
                          <span>{describeDifference(days)}</span>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="show-evidence" onClick={() => {
                      if (answer.evidence) onShowOrders(answer.evidence.view);
                    }}>
                      Ver {integers.format(answer.evidence.total)} {answer.evidence.total === 1 ? "pedido" : "pedidos"} no painel
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </article>
            )}
            {!error && !answer && <p className="chat-loading" role="status">Consultando entregas…</p>}
          </div>
        ))}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <label className="sr-only" htmlFor="chat-question">Pergunta sobre as entregas</label>
        <input id="chat-question" value={draft} onChange={(event) => setDraft(event.target.value)}
          placeholder="Pergunte sobre as entregas" maxLength={500} disabled={configured === false} />
        <button type="submit" aria-label="Enviar pergunta" disabled={busy || configured === false || !draft.trim()}><Send size={17} /></button>
      </form>
    </aside>
  );
}
