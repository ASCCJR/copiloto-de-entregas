"""Avalie as seis perguntas com a OpenAI e a API de indicadores local."""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timezone
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import math
from pathlib import Path
import re
from threading import Thread

from copiloto_rag import DEFAULT_URL, EMBEDDING_MODEL, MODEL, ROOT, Copiloto, OpenAI, ServiceError


@dataclass(frozen=True)
class Case:
    nome: str
    pergunta: str
    uf: str
    mes_painel: str
    acao: str
    ferramentas: tuple[str, ...] = ()
    medida: str | None = None
    mes_pedido: str | None = None
    fonte: str | None = None
    texto: tuple[str, ...] = ()
    simular_falha: bool = False


CASES = (
    Case("definicao", "O que conta como entrega atrasada segundo as regras do painel?", "GO", "2018-06",
         "responder", ("buscar_glossario",), fonte="Entrega atrasada",
         texto=(r"depois|após|posterior", r"prometid[ao]|estimad[ao]|previst[ao]")),
    Case("recorte_explicito", "Qual foi o percentual de entregas atrasadas em Pernambuco em julho de 2018?",
         "PE", "2018-06", "responder", ("consultar_indicadores",), "percentual_atrasos", "2018-07"),
    Case("regra_e_dados", "O que conta como atraso e quantas entregas atrasaram em Goiás em junho de 2018?",
         "GO", "2018-06", "responder", ("buscar_glossario", "consultar_indicadores"),
         "contagem_atrasos", "2018-06", "Entrega atrasada",
         (r"depois|após|posterior", r"prometid[ao]|estimad[ao]|previst[ao]")),
    Case("ambiguidade", "Qual foi o indicador de atraso no recorte atual?", "GO", "2018-06",
         "esclarecer", texto=(r"quantidade|contagem|número|volume|quantas", r"percentual|taxa|proporção", r"\?")),
    Case("fora_da_base", "Qual foi o percentual de atraso por tipo de veículo em Goiás em junho de 2018?",
         "GO", "2018-06", "fora_da_base", texto=(r"veículo",)),
    Case("api_indisponivel", "Quantas entregas atrasaram no Maranhão em agosto de 2018?", "MA", "2018-08",
         "indisponivel", ("consultar_indicadores",), texto=(r"indispon|falh|erro|não consegui",), simular_falha=True),
)


def gold(case, rows):
    expected = {
        "acao": case.acao, "ferramentas": case.ferramentas, "fonte": case.fonte,
        "texto_esperado": case.texto, "indicador": None,
    }
    if case.medida:
        month = case.mes_pedido or case.mes_painel
        dates = [(date.fromisoformat(actual), date.fromisoformat(promised))
                 for _, state, promised, actual, _ in rows if state == case.uf and actual.startswith(month)]
        late = sum(actual > promised for actual, promised in dates)
        value = 100 * late / len(dates) if case.medida == "percentual_atrasos" else late
        expected["indicador"] = {
            "medida": case.medida, "uf": case.uf, "mes": month, "valor": value,
            "entregas_elegiveis": len(dates),
        }
    return expected


def check(answer, expected, case):
    errors = []
    if answer["acao"] != expected["acao"]:
        errors.append("ação diferente do gabarito")
    steps = answer["passos"]
    if tuple(step["ferramenta"] for step in steps) != expected["ferramentas"]:
        errors.append("sequência de ferramentas diferente do gabarito")
    if expected["fonte"] and expected["fonte"] not in {item["secao"] for item in answer["fontes"]}:
        errors.append("fonte esperada ausente")
    if any(not re.search(pattern, answer["mensagem"], flags=re.IGNORECASE) for pattern in case.texto):
        errors.append("explicação ou esclarecimento divergente")
    indicator, target = answer["indicador"], expected["indicador"]
    if target is None:
        if indicator is not None:
            errors.append("valor retornado indevidamente")
    elif indicator is None or indicator["valor"] is None:
        errors.append("valor esperado ausente")
    elif any(indicator[key] != target[key] for key in ("uf", "mes", "medida", "entregas_elegiveis")):
        errors.append("filtros, medida ou denominador divergentes")
    elif not math.isclose(indicator["valor"], target["valor"], rel_tol=1e-9, abs_tol=1e-9):
        errors.append("valor divergente")
    if case.simular_falha and not any(step["resultado"].get("erro", "").endswith("HTTP 503") for step in steps):
        errors.append("o caso não registrou a resposta HTTP 503")
    return errors


class UnavailableAPI(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_error(503)

    def log_message(self, *_):
        pass


def evaluate(agent, base_url, rows):
    entries = {}
    with HTTPServer(("127.0.0.1", 0), UnavailableAPI) as server:
        failure_url = f"http://127.0.0.1:{server.server_port}"
        listener = Thread(target=server.serve_forever, daemon=True)
        listener.start()

        def run(case):
            expected = gold(case, rows)
            entry = {
                "caso": case.nome, "pergunta": case.pergunta, "painel": {"uf": case.uf, "mes": case.mes_painel},
                "api_503_simulada": case.simular_falha, "gabarito": expected,
            }
            try:
                answer = agent.answer(case.pergunta, case.uf, case.mes_painel, failure_url if case.simular_falha else base_url)
                return {**entry, "resposta": answer, "erros": check(answer, expected, case)}
            except (ServiceError, ValueError) as exc:
                return {**entry, "resposta": None, "erros": [str(exc)]}

        try:
            with ThreadPoolExecutor(max_workers=5) as pool:
                tasks = [pool.submit(run, case) for case in CASES]
                for task in as_completed(tasks):
                    entry = task.result()
                    entries[entry["caso"]] = entry
                    result = "OK" if not entry["erros"] else "FALHOU: " + "; ".join(entry["erros"])
                    print(f"{entry['caso']}: {result}", flush=True)
        finally:
            server.shutdown()
            listener.join()
    return [entries[case.nome] for case in CASES]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.output and args.output.exists():
        parser.error("Use um caminho novo para gravar a execução.")
    snapshot = (ROOT / "data" / "deliveries.json").read_bytes()
    rows = json.loads(snapshot)["deliveries"]
    started = datetime.now(timezone.utc).isoformat()
    print("Indexando as seções do glossário...", flush=True)
    evaluations = evaluate(Copiloto(OpenAI()), args.url, rows)
    passed = sum(not case["erros"] for case in evaluations)
    print(f"{passed}/{len(CASES)} casos aprovados.")
    if args.output:
        evidence = {
            "inicio_utc": started, "modelo_solicitado": MODEL, "modelo_embeddings": EMBEDDING_MODEL,
            "api_indicadores": args.url, "entregas_elegiveis_na_base": len(rows),
            "sha256_base": sha256(snapshot).hexdigest(), "aprovados": passed, "casos": evaluations,
        }
        with args.output.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(evidence, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    return int(passed != len(CASES))


if __name__ == "__main__":
    raise SystemExit(main())
