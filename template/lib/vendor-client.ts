/**
 * Thin {{DISPLAY_NAME}} REST client.
 *
 * Pure HTTP. No auth — the bearer token is passed in. Each tool route
 * extracts the bearer from the incoming Authorization header (set by
 * the Orchet router after resolving the user's connection) and
 * forwards it here. We never touch refresh tokens — the Orchet auth
 * service owns the refresh lifecycle.
 */

const VENDOR_API_BASE = "{{VENDOR_API_BASE}}";

export class VendorApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "VendorApiError";
    this.status = status;
    this.body = body;
  }
}

interface VendorFetchOptions {
  bearer: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export async function vendorFetch<T>(options: VendorFetchOptions): Promise<T> {
  const { bearer, method = "GET", path, query, body } = options;
  const url = new URL(`${VENDOR_API_BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    throw new VendorApiError(
      res.status,
      parsed,
      `{{DISPLAY_NAME}} API ${method} ${path} → ${res.status}: ${text.slice(0, 240)}`,
    );
  }
  return parsed as T;
}
