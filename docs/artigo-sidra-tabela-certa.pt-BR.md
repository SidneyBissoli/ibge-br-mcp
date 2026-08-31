# Como achar a tabela certa no SIDRA — e como saber que é a certa

*Publicado em 31 de agosto de 2026. Todos os números deste texto foram capturados
ao vivo nas APIs do IBGE na data da publicação; nenhum é ilustrativo. As URLs de
origem estão ao lado de cada um.*

O SIDRA é o Banco de Tabelas Estatísticas do IBGE. Praticamente tudo o que o
instituto publica passa por lá: Censo, PNAD Contínua, PIB, produção industrial,
pesquisas agropecuárias. É a fonte primária brasileira de estatística pública, e
é aberta.

O problema não é o acesso. É que a pergunta que uma pessoa faz — *"quantos
domicílios têm ligação à rede de esgoto?"* — não se parece em nada com o que o
SIDRA entende, que é um código de tabela, um conjunto de variáveis, uma
classificação, um período e um nível territorial. Entre a pergunta e a consulta
existe um passo que quase todo tutorial pula: **descobrir qual é a tabela** — e,
mais difícil, **ter certeza de que é aquela mesmo**.

Este texto é sobre esse passo. Ele vale para quem consulta o SIDRA por qualquer
caminho: pelo site, pela API, pelo `sidrapy`, ou por um assistente de IA com o
[`ibge-br-mcp`](https://github.com/SidneyBissoli/ibge-br-mcp). O erro que ele
descreve não é do software — é da forma de procurar.

## O modelo do SIDRA em um parágrafo

Cada **pesquisa** (Censo Demográfico, PNAD Contínua, IPCA…) tem suas
**tabelas**, que a API chama de *agregados*. Cada tabela publica um conjunto de
**variáveis** (o que se mede, com sua unidade), zero ou mais **classificações**
(os cortes: sexo, cor ou raça, situação do domicílio…), uma lista de
**períodos** e uma lista de **níveis territoriais** (Brasil, região, UF,
município, e vários outros). Uma consulta é a escolha de um valor em cada um
desses eixos.

Duas consequências práticas, e as duas mordem:

1. **Uma tabela não cobre todos os níveis territoriais.** Existe tabela que só
   publica Brasil. Pedir UF nela devolve erro, não devolve zero.
2. **O nome da tabela não diz de qual pesquisa ela é.** E é daí que vem o erro
   que este texto quer evitar.

## Passo 1: procurar — e não confiar no resultado

A busca por nome é o ponto de partida óbvio:

```
GET https://servicodados.ibge.gov.br/api/v3/agregados?...
```

Procurando por *"esgotamento sanitário"* no catálogo, em 31/08/2026, voltaram
**108 tabelas**. As primeiras da lista são estas:

| Código | Nome (abreviado) |
|---|---|
| 2074 | Domicílios… por existência de banheiro ou sanitário e tipo de esgotamento sanitário |
| 10053 | Domicílios… em setores selecionados para a Pesquisa Urbanística do Entorno |
| 10099 | Domicílios… total e com pelo menos um morador quilombola… |
| 10230 | Domicílios… localizados em Unidades de Conservação… |
| 1453 | Domicílios particulares permanentes por tipo de esgotamento sanitário e abastecimento de água |

Nenhuma das quatro primeiras é a tabela geral. São recortes — entorno urbano,
quilombolas, unidades de conservação — que contêm o termo procurado porque
*também* classificam por esgotamento sanitário. A lista está correta; a
expectativa é que estava errada. **Buscar por nome devolve tudo o que menciona o
assunto, não o que é sobre o assunto.**

## Passo 2: os metadados são o que decide

O passo que separa um número certo de um número plausível é este:

```
GET https://servicodados.ibge.gov.br/api/v3/agregados/{tabela}/metadados
```

A resposta diz quatro coisas que a lista de busca não diz, e as quatro importam:

- **`pesquisa`** — de qual pesquisa a tabela é. Este é o campo decisivo.
- **`periodicidade`** — o intervalo de períodos que ela realmente cobre.
- **`nivelTerritorial`** — até onde ela desce.
- **`variaveis`** — o que ela mede, com a unidade.

Vale a pena ver o contraste em dois casos reais, os dois consultados em
31/08/2026.

**Tabela 6803**, a que responde a pergunta original:

```
pesquisa:        Censo Demográfico
periodicidade:   2022–2022
níveis:          N1 (Brasil), N2 (região), N3 (UF), N6 (município)
nome:            Domicílios particulares permanentes ocupados, por existência de
                 ligação à rede geral de distribuição de água…
```

**Tabela 9696**, cujo nome, num catálogo, passa fácil por "algo de domicílios":

```
pesquisa:        Pesquisa Nacional por Amostra de Domicílios Contínua anual
periodicidade:   2022–2025
níveis:          N1 (Brasil), N2 (Grande Região) — e só
nome:            Rendimento médio mensal real domiciliar per capita em domicílios
                 com televisão, por situação do domicílio e acesso a serviço de
                 televisão por assinatura no domicílio
```

As duas falam de domicílios. As duas têm dado de 2022. Uma é do Censo; a outra é
da PNAD Contínua e mede renda em domicílio com TV por assinatura. Trocar uma
pela outra não dá erro nenhum: dá uma tabela de números que parece resposta.

> **O autor deste texto cometeu exatamente esse erro, e em escala.** O
> `ibge-br-mcp` tem um atalho, a ferramenta `ibge_censo`, que traduz `tema` +
> `ano` em código de tabela para que ninguém precise saber isso tudo. O mapa
> desse atalho era escrito à mão. Em 31/08/2026 uma varredura contra o catálogo
> oficial encontrou **15 das 41 tabelas do mapa fora do Censo Demográfico ou
> fora do assunto do tema**: `saneamento`/2022 apontava justamente para a 9696;
> `fecundidade`/2010, para o **INPC** de 1990; `rendimento`/2000, para o Censo
> **Agropecuário**; `quilombolas`/2022, para uma tabela de uso de Internet. Cada
> uma respondia normalmente, com o rótulo escrito à mão no cabeçalho — dado de
> outra pesquisa sob um nome que mentia. Nada quebrava, e por isso nada
> aparecia. As tabelas foram corrigidas e o repositório passou a manter um
> espelho do catálogo do Censo e um teste que confere, uma a uma, se cada
> código é do Censo e do assunto que promete. A lição não é sobre esse produto:
> **código de tabela escrito à mão ao lado da descrição escrita à mão é uma
> combinação que apodrece em silêncio.** Confira contra a fonte.

## Passo 3: consultar

Com a tabela confirmada, a consulta é direta:

```
GET https://apisidra.ibge.gov.br/values/t/6803/n3/all/v/allxp/p/2022
```

Lendo os pedaços: tabela `t/6803`, nível territorial `n3` (UF) com `all` as
unidades, variáveis `v/allxp` (todas, exceto as de percentual), período
`p/2022`.

Resultado real, capturado em 31/08/2026 — 27 registros, um por UF mais o
Distrito Federal:

| | Domicílios particulares permanentes ocupados |
|---|---|
| **Total (soma das 27 unidades)** | 72.456.368 |
| Maior — São Paulo | 16.224.248 |
| Minas Gerais | 7.533.434 |
| Rio de Janeiro | 6.152.051 |
| Bahia | 5.088.635 |
| Rio Grande do Sul | 4.256.082 |
| … | |
| Rondônia | 555.099 |
| Tocantins | 513.796 |
| Acre | 261.001 |
| Amapá | 201.021 |
| Menor — Roraima | 177.418 |

E a distribuição, que é o que quase sempre interessa mais do que o topo da
lista: média **2.683.569**, mediana **1.372.108**, desvio-padrão **3.236.025**.
A média é quase o dobro da mediana. Isso não é curiosidade estatística: é o
retrato de uma federação em que uma unidade sozinha responde por 22% do total.
Um "top 10" esconderia isso; a distribuição inteira, não.

*Fonte: IBGE — SIDRA, Tabela 6803,
https://apisidra.ibge.gov.br/values/t/6803/n3/all/v/allxp/p/2022, extraído em
31/08/2026.*

## Quatro armadilhas que valem por si

**1. `allxp` mistura unidades.** Pedir todas as variáveis numa tabela que publica
valor absoluto *e* percentual devolve as duas coisas na mesma coluna `V`, sem
que nada avise. Somar isso dá um número sem significado. Ou peça a variável
explicitamente, ou separe por `Unidade de Medida` antes de qualquer conta.

**2. Ausência não é zero.** O SIDRA marca ausência com `-`, `..`, `...` e `X`,
cada um com um sentido diferente (não aplicável, não disponível, dado
suprimido). Um parser distraído converte tudo em `0` e produz uma série que
desce quando o que aconteceu foi a informação faltar.

**3. O código do município tem 7 dígitos, e o sétimo é verificador.** São Paulo
é `3550308`, não `355030`. Truncar o dígito verificador é um erro comum quando
se cruza tabela do IBGE com base de outra origem.

**4. Confira por dois caminhos.** A verificação que vale é a que usa uma tabela
diferente: some os municípios e compare com o total da UF; compare o total do
Censo com a estimativa do mesmo ano. Se os dois caminhos fecham, o número está
de pé. Se não fecham, você achou alguma coisa — e às vezes é a sua consulta.

## E onde entra um assistente de IA

Perguntar a um modelo *"quantos domicílios brasileiros têm ligação à rede de
esgoto?"* devolve um número plausível, tirado do treino: talvez certo, talvez de
outro censo, sem fonte. O ganho de plugar o SIDRA não é conveniência — é que a
resposta passa a ter **procedência**: a tabela, o período, a URL que reproduz a
consulta e a data da extração vêm junto com o valor, e qualquer pessoa pode
refazer o caminho.

É o que o [`ibge-br-mcp`](https://github.com/SidneyBissoli/ibge-br-mcp) faz: 21
ferramentas sobre as APIs do IBGE, com um bloco de procedência em toda resposta,
para clientes que falam [MCP](https://modelcontextprotocol.io) — Claude, ChatGPT
e afins. Os três passos deste texto viram `ibge_sidra_tabelas` →
`ibge_sidra_metadados` → `ibge_sidra`; e, para os assuntos mais comuns, os
atalhos `ibge_censo`, `ibge_indicadores`, `ibge_cidades` e `ibge_comparar`.

Mas o passo 2 continua sendo seu, com ou sem ferramenta. **Antes de publicar um
número, olhe de qual pesquisa a tabela é.** Foi a única coisa que faltava para
que quinze erros não tivessem existido.

---

*Servidor: [`ibge-br-mcp`](https://github.com/SidneyBissoli/ibge-br-mcp) ·
endpoint hospedado em `https://ibge.sidneybissoli.com/mcp` · pacote npm
[`ibge-br-mcp`](https://www.npmjs.com/package/ibge-br-mcp) · licença MIT. Dados
do IBGE sob o regime brasileiro de dados abertos (Lei 12.527/2011 e Decreto
8.777/2016): uso livre, com a obrigação de creditar a fonte.*
