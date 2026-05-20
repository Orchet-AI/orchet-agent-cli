import { NextResponse } from "next/server";
import { manifest } from "@/lib/manifest";

export const runtime = "edge";
export const revalidate = 60;

export function GET() {
  return NextResponse.json(manifest, {
    headers: {
      "cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
