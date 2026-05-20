/**
 * Bearer extraction from the inbound Authorization header.
 *
 * The Orchet router resolves the user's {{DISPLAY_NAME}} connection
 * via OAuthTokenPort.resolveAuthHeader and attaches the result as
 * `Authorization: Bearer <token>` on every tool call.
 *
 * Returns null when no bearer is present so the route can 401 cleanly
 * (the orchestrator catches 401 and renders the inline Connect card).
 */
import type { NextRequest } from "next/server";

export function extractBearer(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1] ?? null;
}
