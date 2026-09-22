import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  cacheKey,
  CACHE_TTL,
  cache,
  cachedFetch,
  cachedFetchOne,
  lastFetchMeta,
} from "../src/cache.js";
import { RecursoAusenteError } from "../src/retry.js";
import { mockResponse } from "./helpers.js";

describe("cacheKey", () => {
  it("should return base URL when no params provided", () => {
    expect(cacheKey("https://api.example.com/data")).toBe(
      "https://api.example.com/data"
    );
  });

  it("should return base URL when params is undefined", () => {
    expect(cacheKey("https://api.example.com/data", undefined)).toBe(
      "https://api.example.com/data"
    );
  });

  it("should return base URL when params is empty", () => {
    expect(cacheKey("https://api.example.com/data", {})).toBe(
      "https://api.example.com/data"
    );
  });

  it("should append params as query string", () => {
    const result = cacheKey("https://api.example.com/data", {
      a: "1",
      b: "2",
    });
    expect(result).toBe("https://api.example.com/data?a=1&b=2");
  });

  it("should sort params alphabetically", () => {
    const result = cacheKey("https://api.example.com/data", {
      z: "last",
      a: "first",
      m: "middle",
    });
    expect(result).toBe("https://api.example.com/data?a=first&m=middle&z=last");
  });

  it("should filter out undefined values", () => {
    const result = cacheKey("https://api.example.com/data", {
      a: "1",
      b: undefined,
      c: "3",
    });
    expect(result).toBe("https://api.example.com/data?a=1&c=3");
  });

  it("should handle number and boolean values", () => {
    const result = cacheKey("https://api.example.com/data", {
      num: 42,
      bool: true,
    });
    expect(result).toBe("https://api.example.com/data?bool=true&num=42");
  });
});

describe("CACHE_TTL", () => {
  it("should have STATIC TTL of 24 hours", () => {
    expect(CACHE_TTL.STATIC).toBe(60 * 24);
  });

  it("should have MEDIUM TTL of 1 hour", () => {
    expect(CACHE_TTL.MEDIUM).toBe(60);
  });

  it("should have SHORT TTL of 15 minutes", () => {
    expect(CACHE_TTL.SHORT).toBe(15);
  });

  it("should have REALTIME TTL of 1 minute", () => {
    expect(CACHE_TTL.REALTIME).toBe(1);
  });
});

describe("cache instance", () => {
  beforeEach(() => {
    cache.clear();
  });

  it("should store and retrieve values", () => {
    cache.set("test-key", { value: 123 });
    expect(cache.get("test-key")).toEqual({ value: 123 });
  });

  it("should return null for non-existent keys", () => {
    expect(cache.get("non-existent")).toBe(null);
  });

  it("should check if key exists", () => {
    cache.set("exists", "value");
    expect(cache.has("exists")).toBe(true);
    expect(cache.has("not-exists")).toBe(false);
  });

  it("should delete keys", () => {
    cache.set("to-delete", "value");
    cache.delete("to-delete");
    expect(cache.get("to-delete")).toBe(null);
  });

  it("should clear all values", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    cache.clear();
    expect(cache.get("key1")).toBe(null);
    expect(cache.get("key2")).toBe(null);
  });

  it("should return stats", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");
    const stats = cache.stats();
    expect(stats.size).toBe(2);
    expect(stats.keys).toContain("key1");
    expect(stats.keys).toContain("key2");
  });

  it("should handle TTL expiration", async () => {
    // Set a very short TTL (0.001 minutes = 60ms)
    cache.set("expires", "value", 0.001);

    // Should exist immediately
    expect(cache.get("expires")).toBe("value");

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should be expired now
    expect(cache.get("expires")).toBe(null);
  });
});

describe("fetch metadata (retrieved_at real + served_from_cache)", () => {
  beforeEach(() => {
    cache.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse({ ok: true })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null for keys never fetched", () => {
    expect(lastFetchMeta("never-fetched")).toBe(null);
  });

  it("records a real fetch with servedFromCache=false", async () => {
    const before = Date.now();
    await cachedFetch("https://api.example.com/x", "key-1", 1);
    const meta = lastFetchMeta("key-1");
    expect(meta).not.toBe(null);
    expect(meta!.servedFromCache).toBe(false);
    expect(meta!.retrievedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(meta!.retrievedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("preserves the original fetch instant on cache hits and flags servedFromCache", async () => {
    await cachedFetch("https://api.example.com/x", "key-1", 1);
    const original = lastFetchMeta("key-1")!.retrievedAt.getTime();

    await new Promise((resolve) => setTimeout(resolve, 15));
    await cachedFetch("https://api.example.com/x", "key-1", 1);

    const meta = lastFetchMeta("key-1")!;
    expect(meta.servedFromCache).toBe(true);
    expect(meta.retrievedAt.getTime()).toBe(original);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("resets to a fresh fetch after expiry", async () => {
    await cachedFetch("https://api.example.com/x", "key-1", 0.0001);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await cachedFetch("https://api.example.com/x", "key-1", 1);

    const meta = lastFetchMeta("key-1")!;
    expect(meta.servedFromCache).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("clears metadata on cache.clear() and cache.delete()", async () => {
    await cachedFetch("https://api.example.com/x", "key-1", 1);
    await cachedFetch("https://api.example.com/y", "key-2", 1);
    cache.delete("key-1");
    expect(lastFetchMeta("key-1")).toBe(null);
    cache.clear();
    expect(lastFetchMeta("key-2")).toBe(null);
  });
});

/**
 * A ausência que a fonte responde com `[]` e HTTP 200.
 *
 * Medido nas APIs do IBGE em 22/09/2026: `/cnae/classes/4721`,
 * `/cnae/subclasses/4721101`, `/localidades/municipios/9999999` e
 * `/localidades/estados/99` respondem todas `200 []` para identificador
 * inexistente. Sem esta borda o array seguia com o tipo do chamador e estourava
 * no formatador.
 */
describe("cachedFetchOne", () => {
  beforeEach(() => {
    cache.clear();
    vi.restoreAllMocks();
  });

  it("throws RecursoAusenteError when the source answers 200 with an empty array", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse([]));

    await expect(
      cachedFetchOne("https://api.example.com/classes/4721", "k-vazio", "Classe CNAE", "4721")
    ).rejects.toBeInstanceOf(RecursoAusenteError);
  });

  // Array NÃO vazio também é ausência aqui: estes endpoints devolvem UM objeto
  // quando o id existe. Qualquer array é a forma "não achei" da fonte.
  it("treats any array as absence on a single-id endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse([{ id: "x" }]));

    await expect(
      cachedFetchOne("https://api.example.com/municipios/1", "k-array", "Município", "1")
    ).rejects.toBeInstanceOf(RecursoAusenteError);
  });

  it("carries the resource and the id asked, for the message to the caller", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse([]));

    const erro = await cachedFetchOne(
      "https://api.example.com/classes/9999",
      "k-msg",
      "Classe CNAE",
      "9999"
    ).catch((e: unknown) => e as RecursoAusenteError);

    expect(erro.recurso).toBe("Classe CNAE");
    expect(erro.id).toBe("9999");
    expect(erro.message).toContain("nenhum registro encontrado");
  });

  it("returns the object untouched when the id exists", async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse({ id: "47211", descricao: "Padaria" }));

    const data = await cachedFetchOne<{ id: string }>(
      "https://api.example.com/classes/47211",
      "k-ok",
      "Classe CNAE",
      "47211",
      CACHE_TTL.STATIC
    );

    expect(data.id).toBe("47211");
  });
});
