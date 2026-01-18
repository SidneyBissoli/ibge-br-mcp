/**
 * Metrics and logging system for IBGE MCP Server
 *
 * Tracks:
 * - API call counts and timing
 * - Error rates by tool/API
 * - Cache hit/miss rates
 * - Response sizes
 */

export interface MetricEntry {
  timestamp: number;
  tool: string;
  api?: string;
  duration: number;
  success: boolean;
  cached: boolean;
  errorType?: string;
  responseSize?: number;
}

export interface ToolMetrics {
  calls: number;
  successes: number;
  failures: number;
  totalDuration: number;
  avgDuration: number;
  cacheHits: number;
  cacheMisses: number;
  lastCalled?: number;
  errors: Record<string, number>;
}

export interface GlobalMetrics {
  startTime: number;
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
  totalCacheHits: number;
  totalCacheMisses: number;
  byTool: Record<string, ToolMetrics>;
  byApi: Record<string, { calls: number; errors: number; avgDuration: number }>;
  recentErrors: Array<{ timestamp: number; tool: string; error: string }>;
}

class MetricsCollector {
  private metrics: GlobalMetrics;
  private maxRecentErrors = 50;
  private enabled = true;

  constructor() {
    this.metrics = this.initializeMetrics();
  }

  private initializeMetrics(): GlobalMetrics {
    return {
      startTime: Date.now(),
      totalCalls: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      totalCacheHits: 0,
      totalCacheMisses: 0,
      byTool: {},
      byApi: {},
      recentErrors: [],
    };
  }

  /**
   * Enable or disable metrics collection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Record a tool call
   */
  record(entry: MetricEntry): void {
    if (!this.enabled) return;

    this.metrics.totalCalls++;

    if (entry.success) {
      this.metrics.totalSuccesses++;
    } else {
      this.metrics.totalFailures++;
    }

    if (entry.cached) {
      this.metrics.totalCacheHits++;
    } else {
      this.metrics.totalCacheMisses++;
    }

    // Update tool metrics
    this.updateToolMetrics(entry);

    // Update API metrics
    if (entry.api) {
      this.updateApiMetrics(entry);
    }

    // Track errors
    if (!entry.success && entry.errorType) {
      this.metrics.recentErrors.push({
        timestamp: entry.timestamp,
        tool: entry.tool,
        error: entry.errorType,
      });

      // Keep only recent errors
      if (this.metrics.recentErrors.length > this.maxRecentErrors) {
        this.metrics.recentErrors.shift();
      }
    }
  }

  private updateToolMetrics(entry: MetricEntry): void {
    if (!this.metrics.byTool[entry.tool]) {
      this.metrics.byTool[entry.tool] = {
        calls: 0,
        successes: 0,
        failures: 0,
        totalDuration: 0,
        avgDuration: 0,
        cacheHits: 0,
        cacheMisses: 0,
        errors: {},
      };
    }

    const tool = this.metrics.byTool[entry.tool];
    tool.calls++;
    tool.totalDuration += entry.duration;
    tool.avgDuration = tool.totalDuration / tool.calls;
    tool.lastCalled = entry.timestamp;

    if (entry.success) {
      tool.successes++;
    } else {
      tool.failures++;
      if (entry.errorType) {
        tool.errors[entry.errorType] = (tool.errors[entry.errorType] || 0) + 1;
      }
    }

    if (entry.cached) {
      tool.cacheHits++;
    } else {
      tool.cacheMisses++;
    }
  }

  private updateApiMetrics(entry: MetricEntry): void {
    const api = entry.api ?? "unknown";

    if (!this.metrics.byApi[api]) {
      this.metrics.byApi[api] = {
        calls: 0,
        errors: 0,
        avgDuration: 0,
      };
    }

    const apiMetrics = this.metrics.byApi[api];
    const prevTotal = apiMetrics.avgDuration * apiMetrics.calls;
    apiMetrics.calls++;
    apiMetrics.avgDuration = (prevTotal + entry.duration) / apiMetrics.calls;

    if (!entry.success) {
      apiMetrics.errors++;
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics(): GlobalMetrics {
    return { ...this.metrics };
  }

  /**
   * Get formatted metrics report
   */
  getReport(): string {
    const m = this.metrics;
    const uptime = Date.now() - m.startTime;
    const uptimeMinutes = Math.floor(uptime / 60000);

    let report = "## IBGE MCP Server - Métricas\n\n";

    // Global stats
    report += "### Estatísticas Globais\n\n";
    report += "| Métrica | Valor |\n";
    report += "|:--------|------:|\n";
    report += `| **Uptime** | ${uptimeMinutes} minutos |\n`;
    report += `| **Total de chamadas** | ${m.totalCalls} |\n`;
    report += `| **Sucessos** | ${m.totalSuccesses} (${this.percentage(m.totalSuccesses, m.totalCalls)}) |\n`;
    report += `| **Falhas** | ${m.totalFailures} (${this.percentage(m.totalFailures, m.totalCalls)}) |\n`;
    report += `| **Cache hits** | ${m.totalCacheHits} (${this.percentage(m.totalCacheHits, m.totalCalls)}) |\n`;
    report += `| **Cache misses** | ${m.totalCacheMisses} |\n`;
    report += "\n";

    // By tool
    if (Object.keys(m.byTool).length > 0) {
      report += "### Por Ferramenta\n\n";
      report += "| Ferramenta | Chamadas | Sucesso | Tempo médio | Cache hit |\n";
      report += "|:-----------|:--------:|:-------:|:-----------:|:---------:|\n";

      const sortedTools = Object.entries(m.byTool).sort(([, a], [, b]) => b.calls - a.calls);

      for (const [name, stats] of sortedTools) {
        const successRate = this.percentage(stats.successes, stats.calls);
        const cacheRate = this.percentage(stats.cacheHits, stats.calls);
        const avgMs = Math.round(stats.avgDuration);
        report += `| ${name} | ${stats.calls} | ${successRate} | ${avgMs}ms | ${cacheRate} |\n`;
      }
      report += "\n";
    }

    // By API
    if (Object.keys(m.byApi).length > 0) {
      report += "### Por API\n\n";
      report += "| API | Chamadas | Erros | Tempo médio |\n";
      report += "|:----|:--------:|:-----:|:-----------:|\n";

      for (const [api, stats] of Object.entries(m.byApi)) {
        const avgMs = Math.round(stats.avgDuration);
        report += `| ${api} | ${stats.calls} | ${stats.errors} | ${avgMs}ms |\n`;
      }
      report += "\n";
    }

    // Recent errors
    if (m.recentErrors.length > 0) {
      report += "### Erros Recentes (últimos 10)\n\n";
      report += "| Horário | Ferramenta | Erro |\n";
      report += "|:--------|:-----------|:-----|\n";

      const recentErrors = m.recentErrors.slice(-10);
      for (const err of recentErrors) {
        const time = new Date(err.timestamp).toLocaleTimeString("pt-BR");
        report += `| ${time} | ${err.tool} | ${err.error} |\n`;
      }
    }

    return report;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = this.initializeMetrics();
  }

  private percentage(part: number, total: number): string {
    if (total === 0) return "0%";
    return Math.round((part / total) * 100) + "%";
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

/**
 * Helper to measure and record a tool execution
 */
export async function withMetrics<T>(
  tool: string,
  api: string | undefined,
  fn: () => Promise<T>,
  cached = false
): Promise<T> {
  const start = Date.now();
  let success = true;
  let errorType: string | undefined;

  try {
    return await fn();
  } catch (error) {
    success = false;
    errorType = error instanceof Error ? error.name : "UnknownError";
    throw error;
  } finally {
    metrics.record({
      timestamp: Date.now(),
      tool,
      api,
      duration: Date.now() - start,
      success,
      cached,
      errorType,
    });
  }
}

/**
 * Logger utility with levels
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

class Logger {
  private level: LogLevel = "info";
  private enabled = false; // Disabled by default in MCP context

  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabled && this.levels[level] >= this.levels[this.level];
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog("debug")) {
      console.error(`[DEBUG] ${message}`, data ? JSON.stringify(data) : "");
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog("info")) {
      console.error(`[INFO] ${message}`, data ? JSON.stringify(data) : "");
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog("warn")) {
      console.error(`[WARN] ${message}`, data ? JSON.stringify(data) : "");
    }
  }

  error(message: string, data?: unknown): void {
    if (this.shouldLog("error")) {
      console.error(`[ERROR] ${message}`, data ? JSON.stringify(data) : "");
    }
  }
}

export const logger = new Logger();
