/**
 * Shared test helpers for mocking the global fetch used by every tool.
 */

/** Builds a minimal Response-shaped object for `global.fetch` mocks. */
export function mockResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
    redirected: false,
    statusText: status === 200 ? "OK" : "Error",
    type: "basic",
    url: "",
    clone: () => mockResponse(data, status),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

/**
 * A SIDRA-shaped response: the first element is the header/label row, the rest
 * are data rows. Mirrors what the Aggregates API v3 returns with `view=flat`
 * (the same layout apisidra.ibge.gov.br/values had).
 */
export function sidraResponse(
  header: Record<string, string>,
  ...rows: Record<string, string>[]
): Record<string, string>[] {
  return [header, ...rows];
}
