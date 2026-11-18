"""Agente local que combina o glossário de entregas e a API de indicadores."""

import argparse
import json
import math
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
GLOSSARY = ROOT / "docs" / "glossario-entregas.md"
DEFAULT_URL = "http://127.0.0.1:3000"
MODEL = "gpt-5.4-mini-2026-03-17"
EMBEDDING_MODEL = "text-embedding-3-small"
METRICS = {
    "total_entregas": "Entregas elegíveis",
    "contagem_atrasos": "Quantidade de atrasos",
    "percentual_atrasos": "Percentual de atrasos",
    "entregas_no_prazo": "Entregas no prazo",
}
ACTIONS = ("responder", "esclarecer", "fora_da_base", "indisponivel")
MAX_TOOL_CALLS = 3
GENERIC_DELAY = re.compile(
    r"\b(?:indicador(?:es)? (?:de|do|dos) atrasos?|como (?:ficou|ficaram|está|estão) (?:os? )?atrasos?)\b",
    re.IGNORECASE,
)
EXPLICIT_MEASURE = re.compile(
    r"%|\b(?:taxa|percentual|porcentagem|proporção|por cento|contagem|quantidade|número|total|volume|quant[oa]s?)\b",
    re.IGNORECASE,
)

INSTRUCTIONS = """Você é um assistente de indicadores históricos de entregas da Olist.
Use buscar_glossario para consultar definições e consultar_indicadores para obter números.
Se a pergunta pedir regra e número, busque a regra primeiro e use o resultado na resposta.
Avalie cada retorno antes de decidir a próxima ação. Termine com concluir.

O mês é o da entrega efetiva e a UF é a do comprador. As expressões explícitas na
pergunta substituem os filtros correspondentes do painel. UF vazia representa Brasil
e mês vazio representa todo o histórico. Converta meses explícitos para AAAA-MM.
A API fornece total de entregas, contagem de atrasos, percentual de atrasos e entregas
no prazo. Seu esquema tem filtros de UF e mês. Para dimensões ausentes como tipo de
veículo, modalidade de frete ou transportadora, use fora_da_base e indique a dimensão
ausente, sem consultar números.

Esclareça recortes e medidas ambíguas antes de consultar ferramentas. Quando uma
pergunta sobre atrasos deixar em aberto a escolha entre quantidade e percentual,
use esclarecer e ofereça essas duas opções em uma pergunta curta.
Se uma ferramenta necessária falhar, use indisponivel e explique a falha.
Para explicar uma regra, use os trechos recuperados e cite os títulos exatos das
seções que sustentam a resposta em fontes. Se usou apenas a API, fontes é uma lista vazia.
Em resposta numérica, selecione a medida pedida e deixe a aplicação anexar o valor
e o recorte vindos da API. Para uma definição ou uma ação sem número, use medida nula.
Use mensagem concisa, em português do Brasil. Não invente dados, trechos ou fontes."""


def tool(name, description, properties):
    return {
        "type": "function", "name": name, "description": description, "strict": True,
        "parameters": {
            "type": "object", "properties": properties, "required": list(properties),
            "additionalProperties": False,
        },
    }


LOOKUP_TOOLS = [
    tool("buscar_glossario", "Recupera definições pelo significado da consulta.", {
        "consulta": {"type": "string"},
    }),
    tool("consultar_indicadores", "Obtém os indicadores agregados do recorte informado.", {
        "uf": {"type": "string", "description": "Sigla da UF ou vazio para Brasil."},
        "mes": {"type": "string", "description": "AAAA-MM ou vazio para todo o histórico."},
    }),
]


def conclusion_tool(sources):
    titles = list(sources)
    items = {"type": "string", "enum": titles} if titles else {"type": "string"}
    return tool("concluir", "Entrega a resposta final depois de examinar os resultados.", {
        "acao": {"type": "string", "enum": list(ACTIONS)},
        "mensagem": {"type": "string"},
        "medida": {"type": ["string", "null"], "enum": [*METRICS, None]},
        "fontes": {"type": "array", "items": items, "maxItems": len(titles)},
    })


class ServiceError(RuntimeError):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


def request_json(request, service, timeout):
    try:
        with urlopen(request, timeout=timeout) as response:
            value = json.load(response)
    except HTTPError as exc:
        exc.close()
        raise ServiceError(f"{service}: HTTP {exc.code}", exc.code) from None
    except (URLError, TimeoutError) as exc:
        raise ServiceError(f"{service}: {type(exc).__name__}") from None
    except (ValueError, UnicodeError):
        raise ServiceError(f"{service}: a resposta não é um JSON válido") from None
    if not isinstance(value, dict):
        raise ServiceError(f"{service}: formato de resposta inesperado")
    return value


def load_key():
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key and (ROOT / ".env.local").is_file():
        for line in (ROOT / ".env.local").read_text(encoding="utf-8-sig").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "OPENAI_API_KEY":
                key = value.strip().strip("'").strip('"')
                break
    if not key:
        raise ServiceError("Configure OPENAI_API_KEY no ambiente ou em .env.local.")
    return key


class OpenAI:
    def __init__(self, model=MODEL):
        self.key = load_key()
        self.model = model

    def post(self, path, payload):
        req = Request(
            f"https://api.openai.com/v1/{path}",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
        )
        try:
            return request_json(req, f"OpenAI {path}", timeout=35)
        except ServiceError as exc:
            if exc.status not in {408, 502, 503, 504} and not str(exc).endswith(("TimeoutError", "URLError")):
                raise
        return request_json(req, f"OpenAI {path}", timeout=35)

    def embed(self, texts):
        response = self.post("embeddings", {
            "model": EMBEDDING_MODEL, "input": texts, "encoding_format": "float",
        })
        return [row["embedding"] for row in sorted(response["data"], key=lambda row: row["index"])]

    def choose(self, messages, tools):
        response = self.post("responses", {
            "model": self.model, "instructions": INSTRUCTIONS, "input": messages,
            "tools": tools, "tool_choice": "required", "parallel_tool_calls": False,
            "reasoning": {"effort": "none"}, "include": ["reasoning.encrypted_content"],
            "max_output_tokens": 480, "store": False,
        })
        output = response.get("output", [])
        calls = [item for item in output if item["type"] == "function_call"]
        if response.get("status") != "completed" or len(calls) != 1:
            raise ServiceError("O modelo não retornou uma ação completa.")
        messages.extend(output)
        return calls[0], response["model"]


def unit_vector(vector):
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector]


class Glossary:
    def __init__(self, client):
        content = GLOSSARY.read_text(encoding="utf-8")
        parts = re.split(r"^## (.+)\s*$", content, flags=re.MULTILINE)[1:]
        self.entries = [{"secao": title, "trecho": body.strip()} for title, body in zip(parts[::2], parts[1::2])]
        if not self.entries:
            raise ValueError("O glossário precisa de seções com títulos de nível 2.")
        self.client = client
        texts = [f"{item['secao']}\n{item['trecho']}" for item in self.entries]
        self.vectors = [unit_vector(vector) for vector in client.embed(texts)]

    def search(self, consulta):
        query = unit_vector(self.client.embed([consulta])[0])
        ranked = sorted(
            zip(self.vectors, self.entries, strict=True),
            key=lambda pair: sum(a * b for a, b in zip(query, pair[0], strict=True)),
            reverse=True,
        )
        return [entry for _, entry in ranked[:2]]


def validate_filters(uf, mes):
    if (uf and not re.fullmatch(r"[A-Z]{2}", uf)) or (mes and not re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", mes)):
        raise ValueError("Informe a sigla da UF e o mês no formato AAAA-MM.")


def get_indicators(base_url, uf, mes):
    validate_filters(uf, mes)
    filters = urlencode({"state": uf, "month": mes})
    result = request_json(Request(f"{base_url.rstrip('/')}/api/indicadores?{filters}"), "API de indicadores", timeout=8)
    if any(type(result.get(name)) is not int for name in ("delivered", "late", "early", "onDate")):
        raise ServiceError("API de indicadores: total ou contagem ausente.")
    if "rate" not in result or (result["rate"] is not None and type(result["rate"]) not in (int, float)):
        raise ServiceError("API de indicadores: percentual ausente ou inválido.")
    return {
        "uf": uf, "mes": mes, "total_entregas": result["delivered"],
        "contagem_atrasos": result["late"], "percentual_atrasos": result["rate"],
        "entregas_no_prazo": result["early"] + result["onDate"],
    }


class Copiloto:
    def __init__(self, client):
        self.client = client
        self.glossary = Glossary(client)

    def answer(self, pergunta, uf="", mes="", base_url=DEFAULT_URL):
        validate_filters(uf, mes)
        if not pergunta.strip():
            raise ValueError("Informe uma pergunta.")
        if GENERIC_DELAY.search(pergunta) and not EXPLICIT_MEASURE.search(pergunta):
            return self.finish({
                "acao": "esclarecer", "medida": None, "fontes": [],
                "mensagem": "Você quer a quantidade de entregas atrasadas ou o percentual de atrasos?",
            }, [], {}, None, None)
        messages = [{"role": "user", "content": json.dumps({
            "pergunta": pergunta, "painel": {"uf": uf, "mes": mes},
        }, ensure_ascii=False)}]
        steps = []
        sources = {}
        indicators = None
        for index in range(MAX_TOOL_CALLS + 1):
            available = [conclusion_tool(sources)]
            if index < MAX_TOOL_CALLS:
                available = [*LOOKUP_TOOLS, *available]
            call, model = self.client.choose(messages, available)
            name, args = call["name"], json.loads(call["arguments"])
            if name == "concluir":
                return self.finish(args, steps, sources, indicators, model)
            try:
                if name == "buscar_glossario":
                    result = self.glossary.search(args["consulta"])
                    sources.update((entry["secao"], entry) for entry in result)
                else:
                    indicators = None
                    indicators = result = get_indicators(base_url, **args)
            except (ServiceError, ValueError) as exc:
                result = {"erro": str(exc)}
            steps.append({"ferramenta": name, "argumentos": args, "resultado": result})
            messages.append({
                "type": "function_call_output", "call_id": call["call_id"],
                "output": json.dumps(result, ensure_ascii=False),
            })
        raise ServiceError("O agente atingiu o limite de consultas sem concluir.")

    @staticmethod
    def finish(args, steps, sources, indicators, model):
        action, metric = args["acao"], args["medida"]
        if any(title not in sources for title in args["fontes"]):
            raise ServiceError("A resposta citou uma seção que não foi recuperada.")
        indicator = None
        if action == "responder" and metric is not None:
            if indicators is None:
                raise ServiceError("Uma resposta numérica exige uma consulta bem-sucedida.")
            indicator = {
                "medida": metric, "rotulo": METRICS[metric], "valor": indicators[metric],
                "uf": indicators["uf"], "mes": indicators["mes"],
                "entregas_elegiveis": indicators["total_entregas"],
            }
        return {
            "acao": action, "mensagem": args["mensagem"], "indicador": indicator,
            "fontes": [{"arquivo": "docs/glossario-entregas.md", **sources[title]}
                       for title in dict.fromkeys(args["fontes"])],
            "passos": steps, "modelo": model,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pergunta")
    parser.add_argument("--uf", default="")
    parser.add_argument("--mes", default="")
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args()
    try:
        answer = Copiloto(OpenAI()).answer(args.pergunta, args.uf, args.mes, args.url)
    except (ServiceError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
    print(json.dumps(answer, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
