"""Confira o chat com perguntas e gabaritos calculados das datas da base Olist."""

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from fractions import Fraction
import json
from pathlib import Path
import time
from urllib.error import URLError
from urllib.request import Request, urlopen


DATA = Path(__file__).resolve().parents[1] / "data" / "deliveries.json"
PANEL = dict(state="MA", month="2018-08", status="all", sort="recent", minDelay=0)


@dataclass
class Case:
    name: str
    question: str
    text: str
    panel: dict
    expected_view: dict | None = None
    rows: list | None = None

    def check(self, response):
        issues = []
        if self.text not in response.get("answer", ""):
            issues.append("resposta divergente")
        evidence = response.get("evidence")
        if self.rows is None:
            if evidence is not None:
                issues.append("devolveu pedidos em uma pergunta sem recorte válido")
            return issues
        if not isinstance(evidence, dict):
            return issues + ["sem pedidos de evidência"]
        if evidence.get("view") != self.expected_view:
            issues.append("recorte dos pedidos divergente")
        if evidence.get("total") != len(self.rows):
            issues.append("total de pedidos divergente")
        if evidence.get("orders") != self.rows[:3]:
            issues.append("amostra de pedidos divergente")
        return issues


def orders_in(rows, view):
    selected = [row for row in rows if row[1] == view["state"]
                and row[3][:7] == view["month"]]
    if view["status"] == "byDate":
        selected = [row for row in selected if row[4] <= 0]
    elif view["status"] == "onDate":
        selected = [row for row in selected if row[4] == 0]
    elif view["status"] == "late":
        selected = [row for row in selected if row[4] >= max(view["minDelay"], 1)]
    selected.sort(key=lambda row: (row[3], row[0]), reverse=True)
    if view["sort"] == "delay":
        selected.sort(key=lambda row: row[4], reverse=True)
    return selected


def compare_months(rows, state):
    by_month = defaultdict(list)
    for row in rows:
        if row[1] == state:
            by_month[row[3][:7]].append(row[4])
    counts = {month: (sum(day > 0 for day in delays), len(delays))
              for month, delays in by_month.items()}
    months = sorted(counts)
    return (
        max(months, key=lambda month: counts[month][0]),
        max(months, key=lambda month: Fraction(*counts[month])),
        counts,
    )


def pt_integer(number):
    return f"{number:,}".replace(",", ".")


def make_cases(rows):
    on_time = dict(PANEL, status="byDate")
    exact_day = dict(PANEL, state="SP", month="2018-05", status="onDate")
    over_week = dict(PANEL, status="late", minDelay=8, sort="delay")
    table = dict(PANEL, status="late", minDelay=5, sort="delay")
    comparison_panel = dict(PANEL, state="RJ")
    count_month, rate_month, counts = compare_months(rows, comparison_panel["state"])
    assert count_month != rate_month, "O caso de comparação precisa de dois vencedores distintos."

    def grounded(name, question, text, view, panel=PANEL):
        return Case(name, question, text, panel, view, orders_in(rows, view))

    def ranking(name, question, month):
        late, delivered = counts[month]
        rate = f"{100 * late / delivered:.1f}".rstrip("0").rstrip(".").replace(".", ",")
        view = dict(comparison_panel, month=month, status="late", sort="delay")
        return grounded(name, question,
                        f"{pt_integer(late)} atrasos em {pt_integer(delivered)} entregas ({rate}%)",
                        view, comparison_panel)

    exact_total = len(orders_in(rows, dict(exact_day, status="all")))
    exact_hits = len(orders_in(rows, exact_day))

    return [
        grounded("Prazo com filtros do painel", "Quantas chegaram no prazo?",
                 f"{len(orders_in(rows, on_time))} de {len(orders_in(rows, PANEL))}", on_time),
        grounded("UF, mês e data exata", "Quantas chegaram exatamente na data prometida em São Paulo em maio de 2018?",
                 f"{pt_integer(exact_hits)} de {pt_integer(exact_total)}", exact_day),
        grounded("Limiar estrito de atraso", "Mostre os pedidos com mais de 7 dias de atraso, do maior para o menor.",
                 f"pelo menos 8 dias de atraso: {len(orders_in(rows, over_week))}.", over_week),
        ranking("Ranking por volume", "Qual mês de todo o histórico teve o maior número de atrasos?",
                count_month),
        ranking("Ranking por taxa", "Qual mês de todo o histórico teve a maior taxa de atraso?",
                rate_month),
        grounded("Filtros da tabela", "Mostre os pedidos deste recorte.",
                 f"pelo menos 5 dias de atraso: {len(orders_in(rows, table))}.", table, table),
        Case("Mês sem ano", "Quantas entregas chegaram no prazo em agosto?",
             "De qual ano", dict(PANEL, month="")),
        Case("Transportadora fora da base", "Qual transportadora mais atrasou no Maranhão?",
             "Posso consultar a pontualidade por estado e mês", PANEL),
    ]


def run_case(base, case):
    request = Request(f"{base.rstrip('/')}/api/chat", method="POST",
                      headers={"Content-Type": "application/json"},
                      data=json.dumps({"question": case.question, "view": case.panel, "history": []}).encode())
    try:
        with urlopen(request, timeout=40) as response:
            payload = json.load(response)
    except (URLError, TimeoutError, ValueError) as error:
        return {"falhas": [str(error)]}
    return {"resposta": payload.get("answer"), "falhas": case.check(payload)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", help="URL base do Copiloto. Sem URL, apenas calcula o gabarito.")
    args = parser.parse_args()
    data = json.loads(DATA.read_text(encoding="utf-8"))
    rows = [[key, state, promised, delivered,
             (date.fromisoformat(delivered) - date.fromisoformat(promised)).days]
            for key, state, promised, delivered, _ in data["deliveries"]]
    cases = make_cases(rows)
    print(json.dumps({"entregas_base": len(rows), "sha256_arquivo_olist": data["archiveSha256"]}), flush=True)
    failures = 0
    for index, case in enumerate(cases):
        result = {"caso": case.name, "pergunta": case.question, "painel": case.panel,
                  "gabarito": case.text, "recorte_esperado": case.expected_view,
                  "pedidos_esperados": None if case.rows is None else len(case.rows)}
        if args.url:
            if index == 4:
                print("Aguardando a janela de 60 s do limite público.", flush=True)
                time.sleep(62)
            outcome = run_case(args.url, case)
            result.update(outcome)
            failures += bool(outcome["falhas"])
        print(json.dumps(result, ensure_ascii=False), flush=True)
    if args.url:
        print(f"{len(cases) - failures}/{len(cases)} casos aprovados.", flush=True)
    return int(failures > 0)


if __name__ == "__main__":
    raise SystemExit(main())
