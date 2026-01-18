// ============================================================================
// IBGE API Types - Localidades
// ============================================================================

export interface Regiao {
  id: number;
  sigla: string;
  nome: string;
}

export interface UF {
  id: number;
  sigla: string;
  nome: string;
  regiao: Regiao;
}

export interface Mesorregiao {
  id: number;
  nome: string;
  UF: UF;
}

export interface Microrregiao {
  id: number;
  nome: string;
  mesorregiao: Mesorregiao;
}

export interface RegiaoImediata {
  id: number;
  nome: string;
  "regiao-intermediaria": RegiaoIntermediaria;
}

export interface RegiaoIntermediaria {
  id: number;
  nome: string;
  UF: UF;
}

export interface Municipio {
  id: number;
  nome: string;
  microrregiao: Microrregiao;
  "regiao-imediata": RegiaoImediata;
}

export interface MunicipioSimples {
  id: number;
  nome: string;
}

export interface Distrito {
  id: number;
  nome: string;
  municipio: Municipio;
}

export interface Subdistrito {
  id: number;
  nome: string;
  distrito: Distrito;
}

// ============================================================================
// IBGE API Types - Nomes
// ============================================================================

export interface NomeFrequencia {
  nome: string;
  sexo: string | null;
  localidade: string;
  res: NomePeriodo[];
}

export interface NomePeriodo {
  periodo: string;
  frequencia: number;
}

export interface NomeRanking {
  localidade: string;
  sexo: string | null;
  res: NomeRankingItem[];
}

export interface NomeRankingItem {
  nome: string;
  frequencia: number;
  ranking: number;
}

// ============================================================================
// IBGE API Types - SIDRA (Agregados)
// ============================================================================

export interface Agregado {
  id: string;
  nome: string;
  URL: string;
  pesquisa: string;
  assunto: string;
  periodicidade: {
    frequencia: string;
    inicio: number;
    fim: number;
  };
  nivelTerritorial: {
    Administrativo: string[];
    Especial: string[];
    IBGE: string[];
  };
  variaveis: Variavel[];
}

export interface Variavel {
  id: number;
  nome: string;
  unidade: string;
  supimaId?: number;
  classificacoes?: Classificacao[];
}

export interface Classificacao {
  id: number;
  nome: string;
  categorias: Categoria[];
}

export interface Categoria {
  id: number;
  nome: string;
  unidade?: string;
  nivel?: number;
}

export interface SidraResultado {
  [key: string]: string | number;
}

export interface Pesquisa {
  id: string;
  nome: string;
  agregados: AgregadoSimples[];
}

export interface AgregadoSimples {
  id: string;
  nome: string;
}

// ============================================================================
// IBGE API Types - Notícias
// ============================================================================

export interface Noticia {
  id: number;
  tipo: string;
  titulo: string;
  introducao: string;
  data_publicacao: string;
  produto_id: number;
  produtos: string;
  editorias: string;
  imagens: string;
  produtos_relacionados: string;
  destaque: boolean;
  link: string;
}

export interface NoticiasResponse {
  count: number;
  page: number;
  totalPages: number;
  nextPage: number;
  previousPage: number;
  showingFrom: number;
  showingTo: number;
  items: Noticia[];
}

// ============================================================================
// IBGE API Types - População
// ============================================================================

export interface PopulacaoEstimativa {
  localidade: string;
  horario: string;
  projecao: {
    populacao: number;
    periodoMedio: {
      incrementoPopulacional: number;
      nascimento: number;
      obito: number;
    };
  };
}

// ============================================================================
// IBGE API Types - Países (Countries)
// ============================================================================

export interface PaisLocalizacao {
  regiao: {
    id: number;
    nome: string;
  };
  "sub-regiao"?: {
    id: number;
    nome: string;
  };
  "regiao-intermediaria"?: {
    id: number;
    nome: string;
  };
}

export interface Pais {
  id: {
    M49: number;
    "ISO-ALPHA-2": string;
    "ISO-ALPHA-3": string;
  };
  nome: string;
  area?: {
    total?: string;
    unidade?: {
      id: string;
      classe: string;
      multiplicador: number;
    };
  };
  localizacao?: PaisLocalizacao;
  linguas?: Array<{
    nome: string;
  }>;
  "unidades-monetarias"?: Array<{
    id: string;
    nome: string;
  }>;
  historico?: string;
}

export interface PaisIndicador {
  id: number;
  indicador: string;
  unidade?: {
    id: string;
    classe: string;
    multiplicador: number;
  };
}

export interface PaisIndicadorResultado {
  id: number;
  indicador: string;
  series: Array<{
    pais: string;
    serie: Record<string, string | number>;
  }>;
}

// ============================================================================
// IBGE API Types - Pesquisas/Cidades
// ============================================================================

export interface PesquisaIndicador {
  id: number;
  posicao: string;
  indicador: string;
  classe?: string;
  unidade?: {
    id: string;
    classe: string;
    multiplicador: number;
  };
  children?: PesquisaIndicador[];
}

export interface PesquisaResultado {
  id: number;
  indicador?: string;
  posicao?: string;
  unidade?: {
    id: string;
    classe: string;
    multiplicador: number;
  };
  res: Array<{
    localidade: string;
    res: Record<string, string | number | null>;
  }>;
}

export interface PesquisaDetalhe {
  id: string;
  nome: string;
  periodicidade?: string;
  periodos?: Array<{
    id: string;
    nome?: string;
  }>;
}

// ============================================================================
// API Base URLs (re-exported from config.ts for backward compatibility)
// ============================================================================

import { API_ENDPOINTS } from "./config.js";

/**
 * IBGE API endpoints - unified source from config.ts
 * @deprecated Import from config.ts directly for new code
 */
export const IBGE_API = {
  // Core IBGE APIs
  LOCALIDADES: API_ENDPOINTS.IBGE.LOCALIDADES,
  NOMES: API_ENDPOINTS.IBGE.NOMES,
  AGREGADOS: API_ENDPOINTS.IBGE.AGREGADOS,
  NOTICIAS: API_ENDPOINTS.IBGE.NOTICIAS,
  POPULACAO: API_ENDPOINTS.IBGE.POPULACAO,
  MALHAS: API_ENDPOINTS.IBGE.MALHAS,
  CNAE: API_ENDPOINTS.IBGE.CNAE,
  CALENDARIO: API_ENDPOINTS.IBGE.CALENDARIO,
  PAISES: API_ENDPOINTS.IBGE.PAISES,
  PESQUISAS: API_ENDPOINTS.IBGE.PESQUISAS,
  // SIDRA (external)
  SIDRA: API_ENDPOINTS.SIDRA,
} as const;

// Re-export BCB API for convenience
export const BCB_API = API_ENDPOINTS.BCB;

// ============================================================================
// Helper Types
// ============================================================================

export type SexoFilter = "M" | "F" | null;

export interface FetchOptions {
  timeout?: number;
}

export type NivelTerritorial =
  | "N1" // Brasil
  | "N2" // Região
  | "N3" // UF
  | "N6" // Município
  | "N7" // Região Metropolitana
  | "N8" // Mesorregião
  | "N9" // Microrregião
  | "N10" // Distrito
  | "N11" // Subdistrito
  | "N13" // Região Metropolitana
  | "N14" // Região Integrada de Desenvolvimento
  | "N15"; // Aglomeração Urbana
