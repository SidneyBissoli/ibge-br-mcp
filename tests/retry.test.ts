/**
 * A ida à origem sobre o `@sbissoli/mcp-upstream` (5.4.0): o pacote classifica,
 * `retry.ts` decide — e o que o resto do servidor lê (`TimeoutError`,
 * `UpstreamError` com o que a fonte disse, o sufixo "(after N retries)") não
 * muda de forma. Tudo offline: `global.fetch` dublado, esperas zeradas.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { currentCall } from "@sbissoli/mcp-upstream/als";
import type { RetryContext } from "@sbissoli/mcp-upstream";
import {
  comColetorDeRede,
  fetchJson,
  fetchWithRetry,
  isNetworkError,
  orcamentoTotalMs,
  repetir,
  RETRY_PRESETS,
  TimeoutError,
  UpstreamError,
  type RetryOptions,
} from "../src/retry.js";
import { RETRY_SIDRA } from "../src/sidra-agregados.js";

const URL = "https://servicodados.ibge.gov.br/api/v1/localidades/estados";
/** Esperas zeradas: os testes contam chamadas, não o relógio. */
const RAPIDO: RetryOptions = { initialDelayMs: 0, maxDelayMs: 0 };
const json = (dado: unknown, status = 200) =>
  new Response(JSON.stringify(dado), { status, headers: { "content-type": "application/json" } });
/** A `Response` só se lê uma vez: quem responde a mais de uma chamada fabrica uma nova a cada vez. */
const sempre = (fabrica: () => Response) => vi.fn(() => Promise.resolve(fabrica())) as unknown as typeof fetch;

describe("isNetworkError", () => {
  it("should detect ECONNREFUSED errors", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:3000");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect ECONNRESET errors", () => {
    const error = new Error("read ECONNRESET");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect ETIMEDOUT errors", () => {
    const error = new Error("connect ETIMEDOUT");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect ENOTFOUND errors", () => {
    const error = new Error("getaddrinfo ENOTFOUND api.example.com");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect fetch failed errors", () => {
    const error = new Error("fetch failed");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect network error messages", () => {
    const error = new Error("Network error occurred");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect timeout errors", () => {
    const error = new Error("Request timeout");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect socket hang up errors", () => {
    const error = new Error("socket hang up");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect connection refused errors", () => {
    const error = new Error("Connection refused");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should detect connection reset errors", () => {
    const error = new Error("Connection reset by peer");
    expect(isNetworkError(error)).toBe(true);
  });

  it("should not detect non-network errors", () => {
    const error = new Error("Invalid JSON response");
    expect(isNetworkError(error)).toBe(false);
  });

  it("should not detect validation errors", () => {
    const error = new Error("Invalid parameter");
    expect(isNetworkError(error)).toBe(false);
  });

  it("should not detect HTTP status errors", () => {
    const error = new Error("HTTP 404: Not Found");
    expect(isNetworkError(error)).toBe(false);
  });
});

describe("repetir — o pacote classifica, o servidor decide", () => {
  const politica: Required<RetryOptions> = {
    maxRetries: 4,
    initialDelayMs: 0,
    maxDelayMs: 0,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    timeoutMs: 1000,
  };
  const ctx = (parte: Partial<RetryContext>): RetryContext => ({
    url: URL,
    attempt: 1,
    kind: "http_5xx",
    status: undefined,
    response: undefined,
    body: undefined,
    ...parte,
  });

  it("tempo esgotado repete, nos cabeçalhos ou no corpo", () => {
    expect(repetir(ctx({ kind: "timeout" }), politica)).toBe(true);
    expect(repetir(ctx({ kind: "timeout", status: 200 }), politica)).toBe(true);
  });

  it("status: a lista da política decide", () => {
    expect(repetir(ctx({ kind: "http_5xx", status: 500 }), politica)).toBe(true);
    expect(repetir(ctx({ kind: "rate_limited", status: 429 }), politica)).toBe(true);
    expect(repetir(ctx({ kind: "http_4xx", status: 400 }), politica)).toBe(false);
  });

  // A API de Agregados responde 500 a parâmetro inválido — determinístico.
  it("RETRY_SIDRA tira o 500 da repetição e mantém 503, 429 e 408", () => {
    const sidra = { ...politica, ...RETRY_SIDRA } as Required<RetryOptions>;
    expect(repetir(ctx({ kind: "http_5xx", status: 500 }), sidra)).toBe(false);
    expect(repetir(ctx({ kind: "http_5xx", status: 503 }), sidra)).toBe(true);
    expect(repetir(ctx({ kind: "rate_limited", status: 429 }), sidra)).toBe(true);
    expect(repetir(ctx({ kind: "http_4xx", status: 408 }), sidra)).toBe(true);
  });

  // "O fetch lançou" não é sempre rede: os testes deste servidor simulam status
  // rejeitando o fetch com `Error("HTTP 500: ...")`, e isso nunca repetiu.
  it("o fetch lançou: só é rede se a mensagem for de rede", () => {
    expect(repetir(ctx({ kind: "network", cause: new Error("read ECONNRESET") }), politica)).toBe(true);
    expect(repetir(ctx({ kind: "network", cause: new TypeError("fetch failed") }), politica)).toBe(true);
    expect(repetir(ctx({ kind: "network", cause: new Error("HTTP 404: Not Found") }), politica)).toBe(false);
    expect(repetir(ctx({ kind: "network", cause: "string solta" }), politica)).toBe(false);
  });

  it("200 que não é JSON não repete (nunca medido nas APIs do IBGE — paridade)", () => {
    expect(repetir(ctx({ kind: "malformed_body", status: 200 }), politica)).toBe(false);
  });
});

describe("orcamentoTotalMs", () => {
  it("é o pior caso que a política padrão já gastava: 5 × 30 s + 2 + 4 + 8 + 16 s", () => {
    expect(orcamentoTotalMs()).toBe(5 * 30_000 + 30_000);
  });

  it("respeita o teto do backoff", () => {
    expect(
      orcamentoTotalMs({
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 1500,
        retryableStatusCodes: [],
        timeoutMs: 100,
      })
    ).toBe(4 * 100 + 1000 + 1500 + 1500);
  });
});

describe("RETRY_PRESETS", () => {
  it("DEFAULT: 4 retries from 2 s", () => {
    expect(RETRY_PRESETS.DEFAULT.maxRetries).toBe(4);
    expect(RETRY_PRESETS.DEFAULT.initialDelayMs).toBe(2000);
  });

  it("QUICK: 2 retries, 0.5 s to 2 s", () => {
    expect(RETRY_PRESETS.QUICK.maxRetries).toBe(2);
    expect(RETRY_PRESETS.QUICK.initialDelayMs).toBe(500);
    expect(RETRY_PRESETS.QUICK.maxDelayMs).toBe(2000);
  });

  it("NONE: no retry", () => {
    expect(RETRY_PRESETS.NONE.maxRetries).toBe(0);
  });
});

describe("TimeoutError", () => {
  it("carries the timeout value and a recognizable name", () => {
    const error = new TimeoutError(5000);
    expect(error).toBeInstanceOf(Error);
    expect(error.timeoutMs).toBe(5000);
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toContain("5000");
  });
});

describe("fetchJson — repetição, contagem e o erro que o servidor lê", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("500 repete até esgotar; o erro leva status, sufixo e o que a fonte disse", async () => {
    global.fetch = sempre(() => new Response("Tabela 99999: Tabela inválida", { status: 500 }));

    const erro = await fetchJson(URL, { ...RAPIDO, maxRetries: 2 }).catch((e: unknown) => e as UpstreamError);

    expect(erro).toBeInstanceOf(UpstreamError);
    expect(erro.status).toBe(500);
    expect(erro.detalhe).toBe("Tabela 99999: Tabela inválida");
    expect(erro.message).toMatch(/^HTTP 500: Internal Server Error \(after 2 retries\) — Tabela 99999/);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("400 não repete e chega com o corpo (é nele que a fonte diz qual parâmetro recusou)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        json({ message: "Parâmetro N3 (Nível territorial) incompatível com a tabela" }, 400)
      ) as unknown as typeof fetch;

    const erro = await fetchJson(URL, RAPIDO).catch((e: unknown) => e as UpstreamError);

    expect(erro).toBeInstanceOf(UpstreamError);
    expect(erro.status).toBe(400);
    expect(erro.detalhe).toBe("Parâmetro N3 (Nível territorial) incompatível com a tabela");
    expect(erro.message).toMatch(/^HTTP 400: Bad Request — /);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("404 não repete e é UpstreamError 404 (as APIs do IBGE quase nunca o usam, mas existe)", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 })) as unknown as typeof fetch;

    const erro = await fetchJson(URL, RAPIDO).catch((e: unknown) => e as UpstreamError);

    expect(erro).toBeInstanceOf(UpstreamError);
    expect(erro.status).toBe(404);
    expect(erro.message).toMatch(/^HTTP 404: Not Found/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // O que mudou com o pacote: 429 caía na regra do 4xx do apisidra? Não — já
  // estava na lista; o que é novo é honrar Retry-After (provado no pacote).
  it("429 repete e a ida sai contada como rate_limited contornado", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(json([{ id: 35 }])) as unknown as typeof fetch;

    await comColetorDeRede(async () => {
      expect(await fetchJson(URL, RAPIDO)).toEqual([{ id: 35 }]);
      expect(currentCall()?.retrieval()).toEqual({
        requests: 1,
        attempts: 2,
        anomalies: [{ kind: "rate_limited", count: 1 }],
      });
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejeição que NÃO é rede não repete: o Error de outra camada sobe como veio", async () => {
    const lancado = new Error("HTTP 404: Not Found");
    global.fetch = vi.fn().mockRejectedValue(lancado) as unknown as typeof fetch;

    await expect(fetchJson(URL, RAPIDO)).rejects.toBe(lancado);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("ECONNRESET repete e a ida seguinte responde", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("read ECONNRESET"))
      .mockResolvedValueOnce(json({ ok: 1 })) as unknown as typeof fetch;

    expect(await fetchJson(URL, RAPIDO)).toEqual({ ok: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("200 que não é JSON não repete e vira um erro que diz isso", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("<html>Just a moment...</html>", { status: 200 })) as unknown as typeof fetch;

    await expect(fetchJson(URL, RAPIDO)).rejects.toThrow(/não é JSON válido/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("RETRY_SIDRA: o 500 da API de Agregados não repete; o 503 repete", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("Internal server error", { status: 500 })) as unknown as typeof fetch;
    const e500 = await fetchJson(URL, { ...RETRY_SIDRA, ...RAPIDO }).catch((e: unknown) => e as UpstreamError);
    expect(e500.status).toBe(500);
    expect(e500.message).not.toContain("retries");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(json([1])) as unknown as typeof fetch;
    expect(await fetchJson(URL, { ...RETRY_SIDRA, ...RAPIDO })).toEqual([1]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("fetchWithRetry (Response inteira) e o timeout por tentativa", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  /** A fetch that never resolves on its own — only rejects when its signal aborts. */
  function hangingFetch() {
    return vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new Error("aborted")),
          { once: true }
        );
      });
    });
  }

  it("throws a TimeoutError when the request exceeds timeoutMs", async () => {
    global.fetch = hangingFetch() as unknown as typeof fetch;

    await expect(
      fetchWithRetry("https://example.test/slow", undefined, { maxRetries: 0, timeoutMs: 20 })
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("retries after a timeout and succeeds on a later attempt", async () => {
    let calls = 0;
    global.fetch = vi.fn((_url: string, init?: RequestInit) => {
      calls++;
      if (calls === 1) {
        // First attempt hangs until aborted by the timeout.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }) as unknown as typeof fetch;

    const response = await fetchWithRetry("https://example.test/flaky", undefined, {
      maxRetries: 1,
      timeoutMs: 20,
      initialDelayMs: 0,
    });

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("does not abort a fast request", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    ) as unknown as typeof fetch;

    const response = await fetchWithRetry("https://example.test/fast", undefined, {
      timeoutMs: 1000,
    });

    expect(response.status).toBe(200);
  });

  it("devolve a Response sem consumir o corpo; status de erro final lança UpstreamError com o texto do status", async () => {
    global.fetch = vi.fn().mockResolvedValue(json({ type: "Feature" })) as unknown as typeof fetch;
    const r = await fetchWithRetry(URL);
    expect(r.bodyUsed).toBe(false);
    expect(await r.json()).toEqual({ type: "Feature" });

    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 404, statusText: "Not Found" })) as unknown as typeof fetch;
    await expect(fetchWithRetry(URL, undefined, RAPIDO)).rejects.toMatchObject({ status: 404, statusText: "Not Found" });
  });
});

describe("comColetorDeRede — um coletor por chamada de tool", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("ida limpa: retrieval {1, 1, []}", async () => {
    global.fetch = vi.fn().mockResolvedValue(json([1])) as unknown as typeof fetch;
    await comColetorDeRede(async () => {
      await fetchJson(URL);
      expect(currentCall()?.retrieval()).toEqual({ requests: 1, attempts: 1, anomalies: [] });
    });
  });

  it("503 contornado: attempts 2, anomalia http_5xx — o sucesso não apaga a dificuldade", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(json([1])) as unknown as typeof fetch;
    await comColetorDeRede(async () => {
      await fetchJson(URL, RAPIDO);
      expect(currentCall()?.retrieval()).toEqual({
        requests: 1,
        attempts: 2,
        anomalies: [{ kind: "http_5xx", count: 1 }],
      });
    });
  });

  // `search`/`fetch` chamam as tools de verdade, e `ibge_nomes` mede sub-passos:
  // o coletor de fora tem de ver as idas de dentro, senão a contagem mente.
  it("chamada aninhada reusa o coletor aberto: a de fora vê as idas de dentro", async () => {
    global.fetch = sempre(() => json([1]));
    await comColetorDeRede(async () => {
      const fora = currentCall();
      await fetchJson(`${URL}/1`);
      await comColetorDeRede(async () => {
        expect(currentCall()).toBe(fora);
        await fetchJson(`${URL}/2`);
      });
      expect(fora?.retrieval()).toEqual({ requests: 2, attempts: 2, anomalies: [] });
    });
  });

  it("fora de um coletor a ida funciona e não há o que medir (currentCall undefined)", async () => {
    global.fetch = vi.fn().mockResolvedValue(json([1])) as unknown as typeof fetch;
    expect(currentCall()).toBeUndefined();
    expect(await fetchJson(URL)).toEqual([1]);
    expect(currentCall()).toBeUndefined();
  });

  it("duas chamadas concorrentes não misturam contagens", async () => {
    global.fetch = sempre(() => json([1]));
    const [a, b] = await Promise.all([
      comColetorDeRede(async () => {
        await fetchJson(`${URL}/a`);
        return currentCall()?.retrieval();
      }),
      comColetorDeRede(async () => {
        await fetchJson(`${URL}/b1`);
        await fetchJson(`${URL}/b2`);
        return currentCall()?.retrieval();
      }),
    ]);
    expect(a?.requests).toBe(1);
    expect(b?.requests).toBe(2);
  });
});
