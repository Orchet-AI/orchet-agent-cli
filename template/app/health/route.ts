/**
 * GET /health — liveness probe.
 *
 * Conforms to @orchet/agent-sdk's HealthReportSchema:
 *   { status: 'ok' | 'degraded' | 'down',
 *     agent_id: string,
 *     version: string,
 *     checked_at: number   // Unix ms (NOT an ISO string!) }
 *
 * orchet-backend polls this every 10s; non-conforming responses fail
 * Zod parsing and the agent's health_score decays to 0, at which point
 * filterBridgeForUser silently excludes the agent's tools from Claude's
 * tool list. Discovered the hard way during orchet-splitwise-agent's
 * bring-up — the chat saw splitwise as installed+connected but had no
 * way to call its tools.
 */
import { NextResponse } from "next/server";

export const runtime = "edge";

export function GET() {
  return NextResponse.json({
    status: "ok",
    agent_id: "{{AGENT_ID}}",
    version: "0.1.0",
    checked_at: Date.now(),
  });
}
