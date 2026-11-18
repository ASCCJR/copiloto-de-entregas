# Glossário de indicadores de entrega

## Entrega elegível

O painel considera pedidos com status entregue, UF identificada e as datas estimada e real de entrega preenchidas. O total de entregas elegíveis é a população do indicador no recorte consultado.

## Mês da entrega

Os filtros mensais usam a data real de entrega, no formato AAAA-MM. A data da compra e a data prometida ficam fora da definição do mês do painel. A UF corresponde ao estado do comprador.

## Entrega atrasada

Uma entrega é atrasada quando a data real ocorre depois da data prometida. O atraso é medido em dias corridos. Se o pedido chega no próprio dia prometido ou antes, a entrega está dentro do prazo.

## Volume de atrasos

O volume de atrasos é a contagem de entregas atrasadas dentro da UF e do período selecionados. O resultado é expresso em número de entregas.

## Taxa de atraso

A taxa de atraso é o percentual de entregas atrasadas entre todas as entregas elegíveis no mesmo recorte. Divida os atrasos pelo total elegível e multiplique por 100. Se o recorte estiver vazio, a taxa fica indisponível.

## Cobertura da API de indicadores

A API de indicadores permite filtrar por UF e mês de entrega. A origem dos dados é o histórico da Olist. Campos como tipo de veículo, transportadora, modalidade de frete e causa de atraso ficam fora das dimensões disponíveis para consulta.
