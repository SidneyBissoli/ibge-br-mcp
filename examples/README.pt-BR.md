# Exemplos práticos

Sete coisas que são trabalhosas sem este servidor e rápidas com ele. Todo
resultado abaixo é uma resposta real capturada em **28/08/2026** — não há nada
ilustrativo nem inventado aqui.

Para uma análise completa, com o raciocínio entre as chamadas, veja
[a demo ponta a ponta](../docs/demo.pt-BR.md).

---

## 1. Ranquear 5.570 municípios numa chamada só

> *"Qual é o município mais denso do Brasil — e como é a distribuição?"*

```
ibge_sidra(tabela="4714", nivel_territorial="6", localidades="all",
           variaveis="614", estatisticas=true, topN=5)
```

O conjunto tem **5.570 registros — 56 páginas**. O modo de estatísticas computa
sobre todos eles *antes* da paginação, então uma chamada responde o que de
outro modo seriam 56 idas à API e uma planilha:

| | Hab./km² |
|---|---|
| n | 5.570 |
| Mediana | **24,29** |
| Média | 116,00 |
| Percentil 90 | 138,25 |
| Percentil 99 | 2.226,77 |

**Mais densos:** Taboão da Serra (SP) 13.416,81 · Diadema (SP) 12.795,69 · São
João de Meriti (RJ) 12.521,64
**Menos densos:** Barcelos (AM) 0,15 · Japurá (AM) 0,16 · Atalaia do Norte (AM) 0,20

A distância entre os extremos é de um fator de ~89.000. Repare também que a
média (116) fica acima do percentil 75 (53,61) — o tipo de assimetria que um
"top 10" sozinho esconderia, e a razão de a distribuição completa vir junto.

*Por que importa:* um assistente paginando resultados ou desiste no meio ou
informa caladamente o máximo da página 1 como se fosse o máximo geral. É essa
falha que o modo de estatísticas existe para eliminar.

---

## 2. Números mais novos que o treinamento de qualquer modelo

> *"Qual estado tem o maior desemprego agora?"*

```
ibge_indicadores(indicador="desemprego", nivel_territorial="3",
                 estatisticas=true, topN=5)
```

Período de referência devolvido: **2º trimestre de 2026**.

| Maiores | | Menores | |
|---|---|---|---|
| Amapá | 9,8% | Santa Catarina | 2,1% |
| Bahia | 9,1% | Mato Grosso | 2,2% |
| Piauí | 8,3% | Espírito Santo | 2,3% |
| Pernambuco | 8,3% | Rondônia | 2,6% |
| Alagoas | 7,9% | Mato Grosso do Sul | 2,7% |

Mediana nacional: 5,6%.

*Por que importa:* esta é uma pesquisa em andamento. Nenhum modelo sabe o
número deste trimestre pelos dados de treinamento, e o campo `data_vintage` diz
qual trimestre respondeu — então uma resposta velha fica detectável em vez de
plausível.

---

## 3. Nome → código → dado, sem a dança da tabela de códigos

> *"Liste os municípios de Roraima."*

```
ibge_geocodigo(nome="Espírito Santo")   → 32, região Sudeste
ibge_municipios(uf="RR")                → 15 municípios com os códigos de 7 dígitos
```

Os códigos do IBGE são a chave de junção de todas as outras consultas, e
procurá-los na mão é onde uma análise manual perde a tarde. Os dois sentidos
funcionam: código → localidade e nome → código.

*Por que importa:* os códigos devolvidos entram direto no `ibge_censo`, no
`ibge_sidra` e no `ibge_comparar` como argumento `localidades`. Veja
[a demo](../docs/demo.pt-BR.md), onde isso é a dobradiça da análise inteira.

---

## 4. Comparar localidades lado a lado

> *"Compare a densidade demográfica de cinco capitais."*

```
ibge_comparar(localidades="3550308,3304557,4106902,2927408,1302603",
              indicador="densidade", formato="ranking")
```

| | Hab./km² |
|---|---|
| São Paulo (SP) | 7.528,26 |
| Rio de Janeiro (RJ) | 5.174,60 |
| Curitiba (PR) | 4.078,53 |
| Salvador (BA) | 3.486,49 |
| Manaus (AM) | 181,01 |

Fonte: tabela SIDRA 4714, Censo 2022.

A mesma chamada, um indicador adiante:

```
ibge_comparar(localidades="3550308,3304557,4106902,2927408,1302603",
              indicador="pib", formato="ranking")
```

| | PIB, Mil Reais (2023) |
|---|---|
| São Paulo (SP) | 1.066.825.105 |
| Rio de Janeiro (RJ) | 418.462.360 |
| Manaus (AM) | 127.649.795 |
| Curitiba (PR) | 120.065.276 |
| Salvador (BA) | 76.698.777 |

O PIB municipal de São Paulo é 13,9 vezes o de Salvador. Repare na unidade — o
SIDRA publica essa série em milhares de reais, e a resposta diz isso em vez de
deixar você deduzir.

Manaus é o ponto fora da curva por duas ordens de grandeza — o limite municipal
dela encerra uma vasta área de floresta, o que é um fato sobre o denominador,
não sobre como a cidade é vivida. Número de densidade sempre carrega essa
ressalva, e ter a área exata por trás dele é o que permite perceber isso.

---

## 5. O painel inteiro de um município

> *"Me dá um panorama de Boa Vista."*

```
ibge_cidades(tipo="panorama", municipio="1400100")
```

| Indicador | Valor | Ano |
|---|---|---|
| População estimada | 500.965 | 2026 |
| Área territorial | 5.687,04 km² | 2025 |
| Densidade demográfica | 49,99 hab/km² | 2010 |
| PIB per capita | R$ 44.098,64 | 2023 |
| Mortalidade infantil | 14,5 óbitos por mil nascidos vivos | 2025 |

Uma chamada, cinco pesquisas. Cada linha carrega **o ano dela**, o que importa
mais do que parece: a densidade é número de 2010 ao lado de uma estimativa
populacional de 2026, e um painel que escondesse os anos leria como um retrato
coerente, que não é.

*Por que importa:* esta é a pergunta "me fala dessa cidade", e respondê-la na
mão significa cinco consultas em pesquisas diferentes do IBGE.

---

## 6. Números de Censo com a tabela de onde saíram

> *"Qual era a população de Boa Vista nos Censos de 2010 e 2022?"*

```
ibge_censo(ano="2022", tema="populacao", nivel_territorial="6",
           localidades="1400100", campos="Município,Valor")
```

**Boa Vista (RR): 284.313 (2010) → 413.486 (2022), +45,43%.**

Os dois anos vêm de tabelas SIDRA diferentes — 1378 para 2010 e 9514 para 2022
— e o servidor escolhe a certa. Cada resposta nomeia a tabela que usou, então a
comparação pode ser auditada em vez de ter de ser acreditada.

---

## 7. Uma mais leve

> *"Quais foram os nomes mais comuns no Brasil nos anos 2010?"*

```
ibge_nomes(tipo="ranking", decada=2010, limite=5)
```

| | Nome | Registros |
|---|---|---|
| 1 | Maria | 1.111.301 |
| 2 | Ana | 935.169 |
| 3 | João | 794.118 |
| 4 | Gabriel | 584.024 |
| 5 | Lucas | 505.306 |

Da API de Nomes do Censo 2010. É uma boa primeira consulta para mostrar a
alguém o que um servidor MCP faz, porque a resposta é conferível na hora contra
a intuição.

---

## O padrão comum aos sete

Toda resposta carrega um bloco de proveniência — fonte, URL canônica, período
de referência, o instante real da extração, uma citação pronta para colar e a
licença de dados abertos. É essa a diferença entre uma resposta que se põe num
relatório e uma resposta que ainda precisa ser verificada.

```
Fonte: IBGE — SIDRA, Tabela 4714 (População, área territorial e densidade
(Censo 2022)), https://apisidra.ibge.gov.br/values/t/4714/n6/all/v/614/p/last,
extraído em 28/08/2026.
```

🇺🇸 [Read in English](README.md) · [Demo completa](../docs/demo.pt-BR.md) ·
[Referência das ferramentas](../README.pt-BR.md#ferramentas-disponíveis)
