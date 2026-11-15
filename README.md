# Copiloto de Entregas

Painel de pontualidade baseado em pedidos históricos do e-commerce brasileiro. A primeira tela abre no Maranhão. Quem acompanha a operação vê quantas entregas chegaram até a data prometida, onde os atrasos se concentraram e quanto duraram. Quem investiga pode selecionar um mês, abrir os pedidos de cada situação e ordenar pelos maiores atrasos.

[Portfólio no GitHub Pages](https://asccjr.github.io/portfolio/) · [Copiloto de Entregas na Vercel](https://portfolio-antonio-sergio.vercel.app/copiloto)

## Rodar localmente

Com Node.js 24, pnpm e Python 3 instalados, execute na raiz do repositório.

```sh
python scripts/prepare_data.py
pnpm install --frozen-lockfile
pnpm dev
```

O painel abre em `http://localhost:3000/copiloto`. A rota `/` redireciona para o portfólio no GitHub Pages. Em máquinas com uv, o primeiro comando pode ser `uv run python scripts/prepare_data.py`. Se já tiver o ZIP original, use `python scripts/prepare_data.py --archive caminho/do/arquivo.zip`. O script prepara uma cópia local contendo data prometida, data real, UF e ID de pedido. A cópia gerada fica fora do versionamento.

## Fonte e cálculo

O painel cruza os CSVs de pedidos e clientes pelo ID de cliente e usa os pedidos com status `delivered`, UF identificada e as duas datas preenchidas. O mês corresponde à **data real** de entrega. A diferença em dias corridos separa as entregas feitas antes, no próprio dia e após a data estimada. A proporção de cada grupo usa o total elegível do recorte. [Brazilian E-Commerce Public Dataset by Olist](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce) · [Licença dos dados derivados, CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.pt-br)

A edição conferida contém 99.441 pedidos na fonte e 96.470 entregas elegíveis no Brasil. No Maranhão, são **576 antes da data, 16 na data e 125 atrasadas, de 717 entregas**. A mediana dos 125 atrasos é de oito dias, e 63 passaram de sete dias.

O destaque de investigação usa o **volume de atrasos** e exibe o número de entregas e a taxa do mesmo grupo. Com todos os estados selecionados, compara as UFs. Com uma UF e todo o histórico, compara os meses.

## API local

- `GET /api/indicadores?state=MA&month=2018-08` retorna total, contagem das três situações, taxa de atraso, gravidade e série mensal. Use `timeline=true` para incluir também a série de todos os meses da UF ao selecionar um mês.
- `GET /api/pedidos?state=MA&month=2018-08&status=early&page=1` retorna os pedidos e a paginação. A situação pode ser `all`, `early`, `onDate` ou `late`. Use `sort=delay` para ordenar pela diferença em dias, da maior para a menor.
- `state` e `month` vazios incluem todos os valores dessa dimensão. Um recorte vazio retorna taxa nula.

## Chat do Copiloto

Crie uma chave em **API keys** do projeto **Copiloto de Entregas**, na [plataforma da OpenAI](https://platform.openai.com/api-keys). Na raiz deste app, salve a chave em `.env.local`, na linha `OPENAI_API_KEY=...`. O Git ignora esse arquivo. Reinicie o servidor para carregar a variável. No desenvolvimento local, `OPENAI_MODEL` pode trocar o modelo padrão `gpt-5.4-mini`. Na Vercel, o servidor usa `gpt-5.4-mini-2026-03-17` no processamento padrão para aplicar o preço esperado no cálculo do teto.

Abra **Perguntar** no painel. O modelo interpreta a pergunta e seleciona uma consulta conforme os filtros ativos ou o recorte explícito na pergunta. O servidor calcula o resultado com a base local e compõe a resposta com esses números. O modelo recebe apenas a pergunta, um histórico curto de perguntas e os filtros. As linhas de pedidos aparecem na resposta da aplicação. **Ver pedidos no painel** aplica o mesmo recorte e abre a tabela.

- **Quantas chegaram no prazo?** Soma as que chegaram antes e no próprio dia prometido.
- **Quais pedidos atrasaram mais de 7 dias?** Abre os pedidos com atraso de oito dias corridos ou mais.
- **Qual mês do histórico teve mais atrasos?** Mantém a UF do painel e abre os atrasados do mês que teve o maior volume. Para comparar por percentual, peça a maior taxa.

## Publicação no Vercel

A publicação usa a CLI a partir da raiz deste repositório. O projeto existente na Vercel chama-se `portfolio-antonio-sergio` e serve o Copiloto em `/copiloto`.

Em um clone novo, prepare os dados com o comando da seção **Rodar localmente**. Depois de autenticar a CLI, vincule a pasta ao projeto existente e confira os arquivos do deploy.

```sh
pnpm dlx vercel link --project portfolio-antonio-sergio
pnpm dlx vercel deploy --dry --format=json
```

O arquivo `.vercelignore` permite enviar o código usado no build e a base derivada `data/deliveries.json`. A chave de produção fica nas variáveis sensíveis da Vercel. Para preparar uma nova versão e conferir antes de trocar a URL pública, execute `pnpm dlx vercel deploy --prod --skip-domain`. Após a conferência, execute `pnpm dlx vercel promote <id-do-deploy>`.

Em produção, a API do chat responde com `503` até que `COPILOTO_PUBLIC_CHAT=enabled`, `OPENAI_API_KEY` e a Blob privada estejam configuradas no servidor. A integração da Vercel fornece `BLOB_STORE_ID` e autenticação de curta duração por OIDC. O servidor bloqueia as chamadas se o contador estiver indisponível.

- **Teto do servidor.** O orçamento é de US$ 5 por mês civil em UTC para as chamadas do Copiloto. Cada solicitação reserva o custo máximo antes da chamada à OpenAI, com atualização condicional do contador para proteger contra concorrência. Se a OpenAI retorna o uso, o servidor ajusta a reserva para o custo contabilizado. Uma resposta incerta conserva a reserva. Preços da entrada em cache são contabilizados como entrada comum. [Preço e janela do modelo](https://developers.openai.com/api/docs/models/gpt-5.4-mini) · [Escrita condicional na Vercel Blob](https://vercel.com/docs/vercel-blob#conditional-writes)
- **Firewall da Vercel.** Regra publicada para `POST /api/chat`, agrupada por IP, com janela fixa de 60 segundos, máximo de cinco requisições e resposta `429`. Teste seis perguntas sem chave real na prévia e verifique que o painel continua acessível. [Rate limiting da Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)

Os testes locais usam Node.js 24. Execute `node --experimental-strip-types --test tests/budget.test.mjs` para conferir concorrência no saldo final, ajuste da reserva, troca de mês e armazenamento indisponível. Use `vercel deploy --environment preview` para escolher a prévia explicitamente em um projeto com sua primeira implantação. Confira o ambiente e a proteção do endereço antes de enviar tráfego.
