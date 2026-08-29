# Uma análise real, ponta a ponta

Esta é a transcrição de uma pergunta real respondida com o `ibge-br-mcp`,
mantida como saiu: todos os números abaixo voltaram das APIs do IBGE ao vivo em
**28/08/2026**, e toda chamada de ferramenta é reproduzível como está escrita.

A questão não é o servidor conseguir buscar um número. É o que muda quando um
assistente consegue *encadear* números exatos numa análise — e dizer de onde
cada um veio.

**A pergunta:** *Qual estado brasileiro mais cresceu entre os Censos de 2010 e
2022 — e o que puxou esse crescimento?*

---

## Por que um LLM sozinho erra isso

Faça essa pergunta a um modelo sem ferramentas e ele responde a partir dos
dados de treinamento. Os resultados do Censo 2022 saíram por etapas ao longo de
2023, então a resposta vem desatualizada, misturada com números de 2010, ou
inventada com toda a confiança. Nada na resposta diz qual dos três você
recebeu.

O problema não é o modelo ser ruim de conta. É ele não ter como *conferir* — nem
fonte para lhe entregar.

---

## Passo 1 — População por UF, Censo 2022

```
ibge_censo(ano="2022", tema="populacao", nivel_territorial="3",
           estatisticas=true, topN=5)
```

O servidor resolveu isso para a **tabela SIDRA 9514** e computou a distribuição
sobre os 27 registros antes de qualquer truncamento:

| | |
|---|---|
| n | 27 |
| Soma | **203.080.756** |
| Média | 7.521.509,48 |
| Mediana | 3.941.613 |
| Mín. / Máx. | 636.707 (Roraima) / 44.411.238 (São Paulo) |

A soma é a população do Brasil no Censo 2022 — uma primeira conferência de que
a consulta realmente cobriu todas as unidades da federação.

## Passo 2 — População por UF, Censo 2010

```
ibge_censo(ano="2010", tema="populacao", nivel_territorial="3",
           estatisticas=true, topN=5)
```

| | |
|---|---|
| n | 27 |
| Soma | **190.755.799** |
| Mediana | 3.514.952 |
| Mín. / Máx. | 450.479 (Roraima) / 41.262.199 (São Paulo) |

Repare no que o servidor absorveu aqui: os números de 2010 não moram na tabela
9514. Vêm da **tabela 1378**, outra pesquisa, com outro arranjo de dimensões.
Quem perguntou pediu "o Censo 2010"; escolher a tabela foi trabalho do
servidor, e o bloco de proveniência nomeia qual ele usou.

## Passo 3 — A comparação

As duas chamadas acima devolvem números. A *comparação* é aritmética em cima
deles — feita pelo assistente, não pelo servidor, e vale dizer isso com todas
as letras:

| Posição | UF | 2010 | 2022 | Variação |
|---|---|---|---|---|
| 1 | Roraima | 450.479 | 636.707 | **+41,34%** |
| 2 | Santa Catarina | 6.248.436 | 7.610.361 | +21,80% |
| 3 | Mato Grosso | 3.035.122 | 3.658.649 | +20,54% |
| 4 | Goiás | 6.003.788 | 7.056.495 | +17,53% |
| 5 | Acre | 733.559 | 830.018 | +13,15% |
| … | | | | |
| 24 | Rondônia | 1.562.409 | 1.581.196 | +1,20% |
| 25 | Bahia | 14.016.906 | 14.141.626 | +0,89% |
| 26 | Rio de Janeiro | 15.989.929 | 16.055.174 | +0,41% |
| 27 | Alagoas | 3.120.494 | 3.127.683 | **+0,23%** |

**Brasil: 190.755.799 → 203.080.756 (+6,46% em doze anos.)**

Duas coisas saltam. O número nacional é uma taxa de crescimento intercensitário
historicamente baixa. E a dispersão é enorme: Roraima cresceu quase 180 vezes
mais rápido que Alagoas.

## Passo 4 — Descendo em Roraima

```
ibge_municipios(uf="RR")
```

15 municípios, com os códigos de 7 dígitos. Devolvendo esses códigos na
consulta:

```
ibge_censo(ano="2022", tema="populacao", nivel_territorial="6",
           localidades="1400050,1400027,1400100,…", campos="Município,Valor")
ibge_censo(ano="2010", …)
```

| Município | 2010 | 2022 | Variação |
|---|---|---|---|
| Pacaraima | 10.433 | 19.305 | **+85,04%** |
| Uiramutã | 8.375 | 13.751 | +64,19% |
| Normandia | 8.940 | 13.986 | +56,44% |
| Amajari | 9.327 | 13.927 | +49,32% |
| **Boa Vista** | 284.313 | 413.486 | +45,43% |
| Rorainópolis | 24.279 | 32.647 | +34,47% |
| Cantá | 13.902 | 18.682 | +34,38% |
| Caroebe | 8.114 | 10.656 | +31,33% |
| São João da Baliza | 6.769 | 8.858 | +30,86% |
| Alto Alegre | 16.448 | 21.096 | +28,26% |
| Bonfim | 10.943 | 13.923 | +27,23% |
| Mucajaí | 14.792 | 18.095 | +22,33% |
| Iracema | 8.696 | 10.023 | +15,26% |
| Caracaraí | 18.398 | 20.957 | +13,91% |
| São Luiz do Anauá | 6.750 | 7.315 | +8,37% |

**Todos os municípios cresceram** — não há redistribuição interna escondida
dentro do total do estado. Dois fatos afinam o quadro:

- A capital, **Boa Vista**, responde por **69,4%** do crescimento absoluto do
  estado (+129.173 de +186.228).
- A maior *taxa*, +85%, é a de **Pacaraima** — o município na fronteira com a
  Venezuela.

## Passo 5 — A conferência que não custa nada

Os 15 municípios somam **450.479** em 2010 e **636.707** em 2022 — exatamente
os totais estaduais dos Passos 1 e 2, que vieram de tabelas diferentes e de
requisições separadas.

Essa é a conferência que vale rodar em qualquer análise, e aqui ela sai de
graça: dois caminhos independentes pelos dados batem até o último dígito.

---

## O que o servidor fez, e o que ele não fez

**Fez:** resolver uma pergunta em linguagem comum para a tabela SIDRA certa de
cada ano; computar a distribuição completa sobre todos os registros antes da
paginação; devolver números exatos com o código da tabela, o período de
referência, a URL canônica, o instante real da extração e uma citação pronta
para colar, em toda resposta.

**Não fez:** explicar nada. Os +85% de Pacaraima são uma medição. Pacaraima
ficar na fronteira com a Venezuela é geografia. Ligar as duas coisas é uma
hipótese que estes dados não confirmam nem descartam — para testá-la seriam
necessárias estatísticas de migração, e o honesto é dizer isso em vez de deixar
uma narrativa bem-acabada fechar a lacuna.

Essa divisão é o projeto inteiro. O servidor responde pelo número ser exato e
rastreável. A interpretação continua com quem analisa.

---

## Proveniência, como ela sai

Toda resposta carrega um bloco como este:

```json
"provenance": {
  "source": "IBGE — SIDRA (Banco de Tabelas Estatísticas)",
  "source_url": "https://apisidra.ibge.gov.br/values/t/9514/n3/all/v/allxp/p/2022",
  "data_vintage": "2022",
  "retrieved_at": "2026-08-28T21:47:23-03:00",
  "citation": "Fonte: IBGE — SIDRA, Tabela 9514 (População residente por idade e sexo (universo)), https://apisidra.ibge.gov.br/values/t/9514/n3/all/v/allxp/p/2022, extraído em 28/08/2026.",
  "license": "Dados abertos do Poder Executivo federal (Lei 12.527/2011; Decreto 8.777/2016)"
}
```

`retrieved_at` é o instante real da busca, não a hora em que a resposta foi
escrita — então um número vindo do cache é honesto sobre a própria idade.

---

## Reproduza

Cinco chamadas, nesta ordem:

```
ibge_censo(ano="2022", tema="populacao", nivel_territorial="3", estatisticas=true)
ibge_censo(ano="2010", tema="populacao", nivel_territorial="3", estatisticas=true)
ibge_municipios(uf="RR")
ibge_censo(ano="2022", tema="populacao", nivel_territorial="6", localidades="<15 códigos>")
ibge_censo(ano="2010", tema="populacao", nivel_territorial="6", localidades="<15 códigos>")
```

Números de Censo são definitivos, então os valores acima não vão mudar. O que
vier de pesquisa em andamento muda — e é exatamente por isso que o
`retrieved_at` está na resposta.

🇺🇸 [Read in English](demo.md) · [Mais exemplos](../examples/README.pt-BR.md)
