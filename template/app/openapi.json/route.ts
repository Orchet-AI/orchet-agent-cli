import { NextResponse } from "next/server";
import { openapi } from "@/lib/openapi";

export const runtime = "edge";
export const revalidate = 60;

export function GET() {
  return NextResponse.json(openapi, {
    headers: {
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
