/**
 * Centralized formatting utilities for IBGE MCP Server
 * Reduces code duplication across tools
 */

/**
 * Format a number with Brazilian locale
 */
export function formatNumber(
  value: number,
  options?: {
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    compact?: boolean;
  }
): string {
  if (isNaN(value) || value === null || value === undefined) {
    return "-";
  }

  const locale = options?.locale ?? "pt-BR";
  const compact = options?.compact ?? false;

  // Compact formatting for large numbers
  if (compact) {
    if (Math.abs(value) >= 1_000_000_000) {
      return (
        (value / 1_000_000_000).toLocaleString(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 2,
        }) + " bi"
      );
    }
    if (Math.abs(value) >= 1_000_000) {
      return (
        (value / 1_000_000).toLocaleString(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 2,
        }) + " mi"
      );
    }
    if (Math.abs(value) >= 1_000) {
      return (
        (value / 1_000).toLocaleString(locale, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 2,
        }) + " mil"
      );
    }
  }

  return value.toLocaleString(locale, {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  });
}

/**
 * Format a percentage value
 */
export function formatPercent(
  value: number,
  options?: { decimals?: number; showSign?: boolean }
): string {
  if (isNaN(value)) return "-";

  const decimals = options?.decimals ?? 2;
  const formatted = value.toFixed(decimals).replace(".", ",");

  if (options?.showSign && value > 0) {
    return `+${formatted}%`;
  }

  return `${formatted}%`;
}

/**
 * Format currency in Brazilian Real
 */
export function formatCurrency(
  value: number,
  options?: { showSymbol?: boolean; decimals?: number }
): string {
  if (isNaN(value)) return "-";

  const showSymbol = options?.showSymbol ?? true;
  const decimals = options?.decimals ?? 2;

  const formatted = value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return showSymbol ? `R$ ${formatted}` : formatted;
}

/**
 * Parse a numeric string (handles Brazilian format)
 */
export function parseNumber(value: string | number): number {
  if (typeof value === "number") return value;
  if (!value || value === "-" || value === "...") return NaN;

  // Handle Brazilian format (1.234,56)
  const normalized = value.replace(/\./g, "").replace(",", ".");

  return parseFloat(normalized);
}

/**
 * Alignment options for table columns
 */
export type TableAlignment = "left" | "right" | "center";

/**
 * Create a Markdown table from headers and rows
 */
export function createMarkdownTable(
  headers: string[],
  rows: (string | number)[][],
  options?: {
    alignment?: TableAlignment[];
    maxRows?: number;
    showRowCount?: boolean;
  }
): string {
  if (headers.length === 0 || rows.length === 0) {
    return "_Sem dados disponíveis._\n";
  }

  const alignment = options?.alignment ?? headers.map(() => "left" as TableAlignment);
  const maxRows = options?.maxRows;
  const showRowCount = options?.showRowCount ?? true;

  // Build header
  let output = "| " + headers.join(" | ") + " |\n";

  // Build alignment row
  output +=
    "|" +
    alignment
      .map((a) => {
        switch (a) {
          case "left":
            return ":---";
          case "right":
            return "---:";
          case "center":
            return ":---:";
          default:
            return "---";
        }
      })
      .join("|") +
    "|\n";

  // Build rows
  const displayRows = maxRows ? rows.slice(0, maxRows) : rows;

  for (const row of displayRows) {
    const cells = row.map((cell) => {
      if (cell === null || cell === undefined) return "-";
      return String(cell);
    });
    output += "| " + cells.join(" | ") + " |\n";
  }

  // Show count if truncated
  if (maxRows && rows.length > maxRows && showRowCount) {
    output += `\n_Mostrando ${maxRows} de ${rows.length} registros._\n`;
  }

  return output;
}

/**
 * Create a key-value table (2 columns)
 */
export function createKeyValueTable(
  data: Record<string, string | number | undefined>,
  options?: { keyHeader?: string; valueHeader?: string }
): string {
  const keyHeader = options?.keyHeader ?? "Campo";
  const valueHeader = options?.valueHeader ?? "Valor";

  const rows = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)]);

  return createMarkdownTable([keyHeader, valueHeader], rows, {
    alignment: ["left", "right"],
  });
}

/**
 * Format a date string
 */
export function formatDate(
  dateStr: string,
  options?: { format?: "short" | "long" | "iso" }
): string {
  if (!dateStr) return "-";

  const format = options?.format ?? "short";

  // Try to parse the date
  let date: Date;

  // Handle different input formats
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    // DD/MM/YYYY
    const [day, month, year] = dateStr.split("/");
    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  } else if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
    // MM-DD-YYYY (IBGE calendar format)
    const [month, day, year] = dateStr.split("-");
    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    // ISO format YYYY-MM-DD
    date = new Date(dateStr);
  } else {
    // Try native parsing
    date = new Date(dateStr);
  }

  if (isNaN(date.getTime())) {
    return dateStr; // Return original if parsing fails
  }

  switch (format) {
    case "iso":
      return date.toISOString().split("T")[0];
    case "long":
      return date.toLocaleDateString("pt-BR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    case "short":
    default:
      return date.toLocaleDateString("pt-BR");
  }
}

/**
 * Build a URL query string from parameters
 */
export function buildQueryString(
  params: Record<string, string | number | boolean | undefined | null>
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, String(value));
    }
  }

  return searchParams.toString();
}

/**
 * Decode common HTML entities
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return "";

  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
  };

  let decoded = text;

  // Replace named entities
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, "g"), char);
  }

  // Replace numeric entities (&#123;)
  decoded = decoded.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

  // Remove HTML tags
  decoded = decoded.replace(/<[^>]*>/g, "");

  return decoded.trim();
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Normalize text for comparison (remove accents, lowercase)
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Format a section header
 */
export function formatHeader(title: string, level: 1 | 2 | 3 | 4 = 2): string {
  const prefix = "#".repeat(level);
  return `${prefix} ${title}\n\n`;
}

/**
 * Create a summary statistics section
 */
export function createStatsSummary(
  values: number[],
  options?: { label?: string; unit?: string }
): string {
  if (values.length === 0) {
    return "_Sem dados para calcular estatísticas._\n";
  }

  const validValues = values.filter((v) => !isNaN(v));
  if (validValues.length === 0) {
    return "_Sem valores válidos._\n";
  }

  const label = options?.label ?? "Valor";
  const unit = options?.unit ?? "";

  const sum = validValues.reduce((a, b) => a + b, 0);
  const avg = sum / validValues.length;
  const min = Math.min(...validValues);
  const max = Math.max(...validValues);

  const formatVal = (v: number) => {
    const formatted = formatNumber(v, { maximumFractionDigits: 2 });
    return unit ? `${formatted} ${unit}` : formatted;
  };

  return createKeyValueTable({
    [`**${label} mínimo**`]: formatVal(min),
    [`**${label} máximo**`]: formatVal(max),
    [`**${label} médio**`]: formatVal(avg),
    "**Total de registros**": String(validValues.length),
  });
}
