# A real analysis, end to end

This is a transcript of one real question answered with `ibge-br-mcp`, kept
verbatim: every figure below came back from the live IBGE APIs on
**2026-08-28**, and every tool call is reproducible as written.

The point is not that the server can fetch a number. It is what changes when
an assistant can *chain* exact numbers into an analysis — and cite where each
one came from.

**The question:** *Which Brazilian state grew the most between the 2010 and
2022 Censuses — and what drove it?*

---

## Why an LLM alone gets this wrong

Ask a model this question with no tools and it answers from training data. The
2022 Census results were published in stages through 2023, so the answer is
either stale, averaged with 2010 figures, or confidently invented. Nothing in
the reply tells you which.

The failure is not that the model is bad at arithmetic. It is that it has no
way to *check* — and no source to hand you.

---

## Step 1 — Population by state, 2022 Census

```
ibge_censo(ano="2022", tema="populacao", nivel_territorial="3",
           estatisticas=true, topN=5)
```

The server resolved this to **SIDRA table 9514** and computed the distribution
over all 27 rows before any truncation:

| | |
|---|---|
| n | 27 |
| Sum | **203,080,756** |
| Mean | 7,521,509.48 |
| Median | 3,941,613 |
| Min / Max | 636,707 (Roraima) / 44,411,238 (São Paulo) |

The sum is Brazil's 2022 Census population — a first sanity check that the
query really covered every state.

## Step 2 — Population by state, 2010 Census

```
ibge_censo(ano="2010", tema="populacao", nivel_territorial="3",
           estatisticas=true, topN=5)
```

| | |
|---|---|
| n | 27 |
| Sum | **190,755,799** |
| Median | 3,514,952 |
| Min / Max | 450,479 (Roraima) / 41,262,199 (São Paulo) |

Note what the server absorbed here: the 2010 figures do not live in table 9514.
They come from **table 1378**, a different survey with a different dimensional
layout. The caller asked for "the 2010 Census"; picking the table was the
server's job, and the provenance block names the one it used.

## Step 3 — The comparison

The two calls above return figures. The *comparison* is arithmetic on top of
them — done by the assistant, not by the server, and worth stating plainly:

| Rank | State | 2010 | 2022 | Change |
|---|---|---|---|---|
| 1 | Roraima | 450,479 | 636,707 | **+41.34%** |
| 2 | Santa Catarina | 6,248,436 | 7,610,361 | +21.80% |
| 3 | Mato Grosso | 3,035,122 | 3,658,649 | +20.54% |
| 4 | Goiás | 6,003,788 | 7,056,495 | +17.53% |
| 5 | Acre | 733,559 | 830,018 | +13.15% |
| … | | | | |
| 24 | Rondônia | 1,562,409 | 1,581,196 | +1.20% |
| 25 | Bahia | 14,016,906 | 14,141,626 | +0.89% |
| 26 | Rio de Janeiro | 15,989,929 | 16,055,174 | +0.41% |
| 27 | Alagoas | 3,120,494 | 3,127,683 | **+0.23%** |

**Brazil: 190,755,799 → 203,080,756 (+6.46% in twelve years.)**

Two things stand out. The national figure is a historically low intercensal
growth rate. And the spread is enormous: Roraima grew almost 180 times faster
than Alagoas.

## Step 4 — Drilling into Roraima

```
ibge_municipios(uf="RR")
```

15 municipalities, with their 7-digit codes. Feeding those codes back in:

```
ibge_censo(ano="2022", tema="populacao", nivel_territorial="6",
           localidades="1400050,1400027,1400100,…", campos="Município,Valor")
ibge_censo(ano="2010", …)
```

| Municipality | 2010 | 2022 | Change |
|---|---|---|---|
| Pacaraima | 10,433 | 19,305 | **+85.04%** |
| Uiramutã | 8,375 | 13,751 | +64.19% |
| Normandia | 8,940 | 13,986 | +56.44% |
| Amajari | 9,327 | 13,927 | +49.32% |
| **Boa Vista** | 284,313 | 413,486 | +45.43% |
| Rorainópolis | 24,279 | 32,647 | +34.47% |
| Cantá | 13,902 | 18,682 | +34.38% |
| Caroebe | 8,114 | 10,656 | +31.33% |
| São João da Baliza | 6,769 | 8,858 | +30.86% |
| Alto Alegre | 16,448 | 21,096 | +28.26% |
| Bonfim | 10,943 | 13,923 | +27.23% |
| Mucajaí | 14,792 | 18,095 | +22.33% |
| Iracema | 8,696 | 10,023 | +15.26% |
| Caracaraí | 18,398 | 20,957 | +13.91% |
| São Luiz do Anauá | 6,750 | 7,315 | +8.37% |

**Every single municipality grew** — there is no internal redistribution
hiding inside the state total. Two facts sharpen the picture:

- The capital, **Boa Vista**, accounts for **69.4%** of the state's absolute
  growth (+129,173 of +186,228).
- The steepest *rate*, +85%, is **Pacaraima** — the municipality on the
  Venezuelan border.

## Step 5 — The check that costs nothing

The 15 municipalities sum to **450,479** in 2010 and **636,707** in 2022 —
exactly the state totals from Steps 1 and 2, which came from different tables
and separate requests.

That is the check worth running on any analysis, and here it is free: two
independent paths through the data agree to the last digit.

---

## What the server did, and what it did not

**It did:** resolve a plain question to the right SIDRA table for each year;
compute the full distribution over all rows before pagination; return exact
figures with the table code, reference period, canonical URL, real fetch
timestamp, and a ready-to-paste citation on every response.

**It did not:** explain anything. The +85% in Pacaraima is a measurement. That
Pacaraima sits on the Venezuelan border is geography. Connecting the two is a
hypothesis this data neither confirms nor rules out — you would need migration
statistics to test it, and the honest move is to say so rather than let a
tidy narrative close the gap.

That division is the whole design. The server is responsible for figures being
exact and traceable. Interpretation stays with the analyst.

---

## Provenance, verbatim

Every response carries a block like this one:

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

`retrieved_at` is the real fetch instant, not the time the answer was written —
so a cached figure is honest about its age.

---

## Reproduce it

Five calls, in order:

```
ibge_censo(ano="2022", tema="populacao", nivel_territorial="3", estatisticas=true)
ibge_censo(ano="2010", tema="populacao", nivel_territorial="3", estatisticas=true)
ibge_municipios(uf="RR")
ibge_censo(ano="2022", tema="populacao", nivel_territorial="6", localidades="<15 codes>")
ibge_censo(ano="2010", tema="populacao", nivel_territorial="6", localidades="<15 codes>")
```

Census figures are final, so the numbers above will not drift. Anything drawn
from a running survey will — which is exactly why `retrieved_at` is in the
response.

🇧🇷 [Leia em português](demo.pt-BR.md) · [More examples](../examples/README.md)
