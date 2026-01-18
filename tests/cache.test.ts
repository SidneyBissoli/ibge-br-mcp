import { describe, it, expect, beforeEach } from "vitest";
import { cacheKey, CACHE_TTL, cache } from "../src/cache.js";

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

// Note: cachedFetch tests would require mocking fetch, which is more complex
// Consider adding integration tests separately
