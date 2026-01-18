import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isNetworkError,
  isRetryableStatus,
  calculateDelay,
  RETRY_PRESETS,
  type RetryOptions,
} from "../src/retry.js";

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

describe("isRetryableStatus", () => {
  const defaultRetryableCodes = [429, 500, 502, 503, 504];

  it("should return true for 429 (Too Many Requests)", () => {
    expect(isRetryableStatus(429, defaultRetryableCodes)).toBe(true);
  });

  it("should return true for 500 (Internal Server Error)", () => {
    expect(isRetryableStatus(500, defaultRetryableCodes)).toBe(true);
  });

  it("should return true for 502 (Bad Gateway)", () => {
    expect(isRetryableStatus(502, defaultRetryableCodes)).toBe(true);
  });

  it("should return true for 503 (Service Unavailable)", () => {
    expect(isRetryableStatus(503, defaultRetryableCodes)).toBe(true);
  });

  it("should return true for 504 (Gateway Timeout)", () => {
    expect(isRetryableStatus(504, defaultRetryableCodes)).toBe(true);
  });

  it("should return false for 200 (OK)", () => {
    expect(isRetryableStatus(200, defaultRetryableCodes)).toBe(false);
  });

  it("should return false for 400 (Bad Request)", () => {
    expect(isRetryableStatus(400, defaultRetryableCodes)).toBe(false);
  });

  it("should return false for 401 (Unauthorized)", () => {
    expect(isRetryableStatus(401, defaultRetryableCodes)).toBe(false);
  });

  it("should return false for 403 (Forbidden)", () => {
    expect(isRetryableStatus(403, defaultRetryableCodes)).toBe(false);
  });

  it("should return false for 404 (Not Found)", () => {
    expect(isRetryableStatus(404, defaultRetryableCodes)).toBe(false);
  });

  it("should work with custom retryable codes", () => {
    const customCodes = [408, 425, 500];
    expect(isRetryableStatus(408, customCodes)).toBe(true);
    expect(isRetryableStatus(425, customCodes)).toBe(true);
    expect(isRetryableStatus(429, customCodes)).toBe(false);
  });
});

describe("calculateDelay", () => {
  const defaultOptions: Required<RetryOptions> = {
    maxRetries: 4,
    initialDelayMs: 2000,
    maxDelayMs: 16000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    isRetryable: isNetworkError,
  };

  it("should return initial delay for first attempt", () => {
    expect(calculateDelay(1, defaultOptions)).toBe(2000);
  });

  it("should double the delay for each attempt (exponential backoff)", () => {
    expect(calculateDelay(1, defaultOptions)).toBe(2000); // 2000 * 2^0
    expect(calculateDelay(2, defaultOptions)).toBe(4000); // 2000 * 2^1
    expect(calculateDelay(3, defaultOptions)).toBe(8000); // 2000 * 2^2
    expect(calculateDelay(4, defaultOptions)).toBe(16000); // 2000 * 2^3
  });

  it("should cap at maxDelayMs", () => {
    expect(calculateDelay(5, defaultOptions)).toBe(16000); // would be 32000, capped at 16000
    expect(calculateDelay(10, defaultOptions)).toBe(16000);
  });

  it("should work with custom initial delay", () => {
    const customOptions: Required<RetryOptions> = {
      ...defaultOptions,
      initialDelayMs: 1000,
    };
    expect(calculateDelay(1, customOptions)).toBe(1000);
    expect(calculateDelay(2, customOptions)).toBe(2000);
    expect(calculateDelay(3, customOptions)).toBe(4000);
  });

  it("should work with custom backoff multiplier", () => {
    const customOptions: Required<RetryOptions> = {
      ...defaultOptions,
      initialDelayMs: 1000,
      backoffMultiplier: 3,
    };
    expect(calculateDelay(1, customOptions)).toBe(1000); // 1000 * 3^0
    expect(calculateDelay(2, customOptions)).toBe(3000); // 1000 * 3^1
    expect(calculateDelay(3, customOptions)).toBe(9000); // 1000 * 3^2
  });
});

describe("RETRY_PRESETS", () => {
  describe("DEFAULT preset", () => {
    it("should have maxRetries of 4", () => {
      expect(RETRY_PRESETS.DEFAULT.maxRetries).toBe(4);
    });

    it("should have initialDelayMs of 2000", () => {
      expect(RETRY_PRESETS.DEFAULT.initialDelayMs).toBe(2000);
    });
  });

  describe("AGGRESSIVE preset", () => {
    it("should have maxRetries of 6", () => {
      expect(RETRY_PRESETS.AGGRESSIVE.maxRetries).toBe(6);
    });

    it("should have initialDelayMs of 1000", () => {
      expect(RETRY_PRESETS.AGGRESSIVE.initialDelayMs).toBe(1000);
    });

    it("should have maxDelayMs of 30000", () => {
      expect(RETRY_PRESETS.AGGRESSIVE.maxDelayMs).toBe(30000);
    });
  });

  describe("QUICK preset", () => {
    it("should have maxRetries of 2", () => {
      expect(RETRY_PRESETS.QUICK.maxRetries).toBe(2);
    });

    it("should have initialDelayMs of 500", () => {
      expect(RETRY_PRESETS.QUICK.initialDelayMs).toBe(500);
    });

    it("should have maxDelayMs of 2000", () => {
      expect(RETRY_PRESETS.QUICK.maxDelayMs).toBe(2000);
    });
  });

  describe("NONE preset", () => {
    it("should have maxRetries of 0", () => {
      expect(RETRY_PRESETS.NONE.maxRetries).toBe(0);
    });
  });
});
