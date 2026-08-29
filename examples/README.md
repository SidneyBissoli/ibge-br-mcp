# Practical examples

Seven things that are awkward without this server and quick with it. Every
result below is a real response captured on **2026-08-28** — nothing here is
illustrative or made up.

For a full analysis with the reasoning between the calls, see
[the end-to-end demo](../docs/demo.md).

---

## 1. Rank 5,570 municipalities in a single call

> *"Which Brazilian municipality is the densest — and what does the
> distribution look like?"*

```
ibge_sidra(tabela="4714", nivel_territorial="6", localidades="all",
           variaveis="614", estatisticas=true, topN=5)
```

The result set is **5,570 records — 56 pages**. Statistics mode computes over
all of them *before* pagination, so one call answers what would otherwise be
56 round trips and a spreadsheet:

| | Inhab./km² |
|---|---|
| n | 5,570 |
| Median | **24.29** |
| Mean | 116.00 |
| 90th percentile | 138.25 |
| 99th percentile | 2,226.77 |

**Densest:** Taboão da Serra (SP) 13,416.81 · Diadema (SP) 12,795.69 · São
João de Meriti (RJ) 12,521.64
**Sparsest:** Barcelos (AM) 0.15 · Japurá (AM) 0.16 · Atalaia do Norte (AM) 0.20

The gap between the extremes is a factor of ~89,000. Note also that the mean
(116) sits above the 75th percentile (53.61) — the kind of skew that a "top 10"
alone would hide, and the reason the full distribution comes back with it.

*Why it matters:* an assistant paging through results either gives up or
silently reports the max of page 1 as the max overall. This is the failure the
statistics mode exists to remove.

---

## 2. Numbers newer than any model's training data

> *"Which state has the highest unemployment right now?"*

```
ibge_indicadores(indicador="desemprego", nivel_territorial="3",
                 estatisticas=true, topN=5)
```

Reference period returned: **2nd quarter of 2026**.

| Highest | | Lowest | |
|---|---|---|---|
| Amapá | 9.8% | Santa Catarina | 2.1% |
| Bahia | 9.1% | Mato Grosso | 2.2% |
| Piauí | 8.3% | Espírito Santo | 2.3% |
| Pernambuco | 8.3% | Rondônia | 2.6% |
| Alagoas | 7.9% | Mato Grosso do Sul | 2.7% |

National median: 5.6%.

*Why it matters:* this is a running survey. No model knows this quarter's
figure from training data, and the `data_vintage` field states which quarter
answered — so a stale reply is detectable instead of plausible.

---

## 3. Name → code → data, without the code lookup dance

> *"List the municipalities of Roraima."*

```
ibge_geocodigo(nome="Espírito Santo")   → 32, Southeast region
ibge_municipios(uf="RR")                → 15 municipalities with 7-digit codes
```

IBGE codes are the join key for every other query, and looking them up by hand
is where manual analyses lose their afternoon. Both directions work: code →
locality, and name → code.

*Why it matters:* the codes returned feed straight into `ibge_censo`,
`ibge_sidra`, and `ibge_comparar` as the `localidades` argument. See
[the demo](../docs/demo.md), where this is the hinge of the whole analysis.

---

## 4. Compare localities side by side

> *"Compare population density across five capitals."*

```
ibge_comparar(localidades="3550308,3304557,4106902,2927408,1302603",
              indicador="densidade", formato="ranking")
```

| | Inhab./km² |
|---|---|
| São Paulo (SP) | 7,528.26 |
| Rio de Janeiro (RJ) | 5,174.60 |
| Curitiba (PR) | 4,078.53 |
| Salvador (BA) | 3,486.49 |
| Manaus (AM) | 181.01 |

Source: SIDRA table 4714, 2022 Census.

The same call shape, one indicator over:

```
ibge_comparar(localidades="3550308,3304557,4106902,2927408,1302603",
              indicador="pib", formato="ranking")
```

| | GDP, Mil Reais (2023) |
|---|---|
| São Paulo (SP) | 1,066,825,105 |
| Rio de Janeiro (RJ) | 418,462,360 |
| Manaus (AM) | 127,649,795 |
| Curitiba (PR) | 120,065,276 |
| Salvador (BA) | 76,698,777 |

São Paulo's municipal GDP is 13.9 times Salvador's. Note the unit — SIDRA
publishes this series in thousands of reais, and the response says so rather
than leaving you to infer it.

Manaus is the outlier by two orders of magnitude — its municipal boundary
encloses a vast area of forest, which is a fact about the denominator, not
about how the city is lived in. Density figures always carry that caveat, and
having the exact area behind the number is what lets you notice it.

---

## 5. The whole panel for one municipality

> *"Give me an overview of Boa Vista."*

```
ibge_cidades(tipo="panorama", municipio="1400100")
```

| Indicator | Value | Year |
|---|---|---|
| Estimated population | 500,965 | 2026 |
| Territorial area | 5,687.04 km² | 2025 |
| Population density | 49.99 inhab./km² | 2010 |
| GDP per capita | R$ 44,098.64 | 2023 |
| Infant mortality | 14.5 per 1,000 live births | 2025 |

One call, five surveys. Each row carries **its own year**, which matters more
than it looks: the density is a 2010 figure sitting next to a 2026 population
estimate, and a panel that hid the years would read as one coherent snapshot
when it is nothing of the sort.

*Why it matters:* this is the "tell me about this city" question, and answering
it by hand means five lookups across different IBGE surveys.

---

## 6. Census figures with the table they came from

> *"What was Boa Vista's population in the 2010 and 2022 Censuses?"*

```
ibge_censo(ano="2022", tema="populacao", nivel_territorial="6",
           localidades="1400100", campos="Município,Valor")
```

**Boa Vista (RR): 284,313 (2010) → 413,486 (2022), +45.43%.**

The two years come from different SIDRA tables — 1378 for 2010, 9514 for 2022
— and the server picks the right one. Each response names the table it used, so
the comparison can be audited rather than trusted.

---

## 7. Something lighter

> *"What were the most common names in Brazil in the 2010s?"*

```
ibge_nomes(tipo="ranking", decada=2010, limite=5)
```

| | Name | Registrations |
|---|---|---|
| 1 | Maria | 1,111,301 |
| 2 | Ana | 935,169 |
| 3 | João | 794,118 |
| 4 | Gabriel | 584,024 |
| 5 | Lucas | 505,306 |

From the 2010 Census names API. A good first query for showing someone what an
MCP server does, because the answer is instantly checkable against intuition.

---

## The pattern across all seven

Every response carries a provenance block — source, canonical URL, reference
period, the real fetch timestamp, a ready-to-paste citation, and the open-data
licence. That is the difference between an answer you can put in a report and
an answer you have to go verify.

```
Fonte: IBGE — SIDRA, Tabela 4714 (População, área territorial e densidade
(Censo 2022)), https://apisidra.ibge.gov.br/values/t/4714/n6/all/v/614/p/last,
extraído em 28/08/2026.
```

🇧🇷 [Leia em português](README.pt-BR.md) · [Full demo](../docs/demo.md) ·
[Tool reference](../README.md#available-tools)
