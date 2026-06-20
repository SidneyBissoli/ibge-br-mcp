// Export all tools
export { ibgeEstados, estadosSchema, estadosOutputSchema } from "./estados.js";
export { ibgeMunicipios, municipiosSchema, municipiosOutputSchema } from "./municipios.js";
export { ibgeLocalidade, localidadeSchema, localidadeOutputSchema } from "./localidade.js";
export { ibgePopulacao, populacaoSchema, populacaoOutputSchema } from "./populacao.js";
export { ibgeSidra, sidraSchema, sidraOutputSchema } from "./sidra.js";
export { ibgeNomes, nomesSchema, nomesOutputSchema } from "./nomes.js";
export { ibgeNoticias, noticiasSchema } from "./noticias.js";

// SIDRA tools
export { ibgeSidraTabelas, sidraTabelasSchema } from "./sidra-tabelas.js";
export { ibgeSidraMetadados, sidraMetadadosSchema } from "./sidra-metadados.js";
export { ibgeMalhas, malhasSchema } from "./malhas.js";
export { ibgePesquisas, pesquisasSchema } from "./pesquisas.js";
export { ibgeCenso, censoSchema, censoOutputSchema } from "./censo.js";

// Phase 1 tools (v1.4.0)
export { ibgeIndicadores, indicadoresSchema, indicadoresOutputSchema } from "./indicadores.js";
export { ibgeCnae, cnaeSchema, cnaeOutputSchema } from "./cnae.js";
export { ibgeGeocodigo, geocodigoSchema, geocodigoOutputSchema } from "./geocodigo.js";

// Phase 2 tools (v1.5.0)
export { ibgeCalendario, calendarioSchema } from "./calendario.js";
export { ibgeComparar, compararSchema, compararOutputSchema } from "./comparar.js";

// Phase 3 tools (v1.6.0)
export { ibgeMalhasTema, malhasTemaSchema } from "./malhas-tema.js";
export { ibgeVizinhos, vizinhosSchema, vizinhosOutputSchema } from "./vizinhos.js";
export { ibgeDatasaude, datasaudeSchema, datasaudeOutputSchema } from "./datasaude.js";

// Phase 4 tools (v1.9.0)
export { ibgePaises, paisesSchema, paisesOutputSchema } from "./paises.js";
export { ibgeCidades, cidadesSchema, cidadesOutputSchema } from "./cidades.js";
