# Medições do vocabulário da CNAE

Scripts da medição feita em **22/09/2026** para o item `ibge:cnae-vocabulario`
do painel: a busca do `ibge_cnae` casa o rótulo do IBGE por substring contígua
e **sem tirar acento**, então a palavra de todo dia devolve quase nada — sem dar
erro.

Ficam versionados porque a medição é o insumo caro da tarefa, e porque a regra
da casa é que **só entra par MEDIDO** na tabela de vocabulário
(`src/vocabulario.ts`): a palavra perguntada ausente do catálogo E a palavra da
fonte presente, com as duas contagens. Sem os scripts, a tabela vira opinião.

## Como rodar

Baixar o catálogo (cinco GETs, sem chave):

```bash
for n in secoes divisoes grupos classes subclasses; do
  curl -s "https://servicodados.ibge.gov.br/api/v2/cnae/$n" -o "cnae-$n.json"
done
```

Em 22/09/2026: 21 seções, 87 divisões, 285 grupos, 673 classes, 1.332
subclasses.

- `medir-vocabulario-cnae.mjs <termo>...` — para cada termo, quantas subclasses
  a busca ATUAL acha (`toLowerCase`, com acento) contra quantas acha
  normalizada. É o que mede o ganho do acento sozinho: `comercio` sai de **2**
  para **211**, `servicos` de **0** para **95**.
- `achar-cnae.mjs <padrão>...` — imprime as descrições que casam cada padrão
  (normalizado). Serve para descobrir COMO o IBGE escreve o que a pessoa
  perguntou.
- `tabela-pares.mjs` — a tabela de pares candidatos com as duas contagens, que
  é o formato em que o par entra (ou não entra) em `src/vocabulario.ts`.

## Armadilha medida

`uber` casa **1** subclasse, e é falso positivo: está dentro de `TUBÉRCULOS`.
Substring sem fronteira de palavra inventa resultado — vale como caso de teste.
