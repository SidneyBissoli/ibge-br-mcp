/**
 * Simple in-memory cache with TTL support for IBGE API requests
 */

import { fetchWithRetry, type RetryOptions } from "./retry.js";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Metadata of the last `cachedFetch` call for a cache key: the REAL instant the
 * data was extracted from the upstream (preserved across cache hits — it is the
 * legally relevant extraction date for the provenance block) and whether that
 * last call was served from cache.
 */
export interface FetchMeta {
  retrievedAt: Date;
  servedFromCache: boolean;
}

class RequestCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private fetchMeta: Map<string, { retrievedAt: number; servedFromCache: boolean }> = new Map();
  private defaultTTL: number;

  constructor(defaultTTLMinutes: number = 15) {
    this.defaultTTL = defaultTTLMinutes * 60 * 1000;
  }

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Store data in cache with optional TTL
   */
  set<T>(key: string, data: T, ttlMinutes?: number): void {
    const ttl = ttlMinutes ? ttlMinutes * 60 * 1000 : this.defaultTTL;
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Remove a specific key from cache
   */
  delete(key: string): void {
    this.cache.delete(key);
    this.fetchMeta.delete(key);
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
    this.fetchMeta.clear();
  }

  /** Records a real upstream fetch for a key (called by `cachedFetch` on a miss). */
  recordFetch(key: string, retrievedAt: number): void {
    this.fetchMeta.set(key, { retrievedAt, servedFromCache: false });
  }

  /**
   * Records a cache hit for a key, preserving the original fetch instant.
   * Entries seeded via `set()` directly (tests) have no recorded fetch; the hit
   * instant is the best available approximation then.
   */
  recordHit(key: string): void {
    const existing = this.fetchMeta.get(key);
    this.fetchMeta.set(key, {
      retrievedAt: existing?.retrievedAt ?? Date.now(),
      servedFromCache: true,
    });
  }

  /** Fetch metadata of the last `cachedFetch` call for this key, if any. */
  meta(key: string): FetchMeta | null {
    const m = this.fetchMeta.get(key);
    if (!m) return null;
    return { retrievedAt: new Date(m.retrievedAt), servedFromCache: m.servedFromCache };
  }

  /**
   * Remove all expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; keys: string[] } {
    this.cleanup();
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

// Global cache instance with 15 minute default TTL
export const cache = new RequestCache(15);

// Cache TTL presets (in minutes)
export const CACHE_TTL = {
  STATIC: 60 * 24, // 24 hours - for static data like states, municipalities
  MEDIUM: 60, // 1 hour - for semi-static data like CNAE, indicators list
  SHORT: 15, // 15 minutes - for data that changes occasionally
  REALTIME: 1, // 1 minute - for real-time data like population projection
} as const;

/**
 * Generate cache key from URL and parameters
 */
export function cacheKey(
  base: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  if (!params) return base;

  const sortedParams = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  return sortedParams ? `${base}?${sortedParams}` : base;
}

/**
 * Fetch with cache support and automatic retry on network failures
 */
export async function cachedFetch<T>(
  url: string,
  cacheKeyStr: string,
  ttlMinutes?: number,
  retryOptions?: RetryOptions
): Promise<T> {
  // Check cache first
  const cached = cache.get<T>(cacheKeyStr);
  if (cached !== null) {
    cache.recordHit(cacheKeyStr);
    return cached;
  }

  // Fetch from API with retry support
  const response = await fetchWithRetry(url, undefined, retryOptions);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as T;

  // Store in cache
  cache.set(cacheKeyStr, data, ttlMinutes);
  cache.recordFetch(cacheKeyStr, Date.now());

  return data;
}

/**
 * Fetch metadata of the last `cachedFetch` call for a cache key — the REAL
 * upstream extraction instant (`retrieved_at` of the provenance contract v1.0,
 * preserved across cache hits) and whether the last call was a cache hit.
 * Query it right after `cachedFetch` with the same key; the ~40 existing call
 * sites stay unchanged (parallel-map design, `ibge/docs/03` §3).
 */
export function lastFetchMeta(cacheKeyStr: string): FetchMeta | null {
  return cache.meta(cacheKeyStr);
}
