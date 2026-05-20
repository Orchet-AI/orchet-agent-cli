#!/usr/bin/env node
/**
 * Smoke test: render the template with a sample Lyft config and verify
 * the output is well-formed. Doesn't run the generator's full prompt
 * UI — exercises render.mjs directly with a known-good config.
 *
 * Usage: node test-smoke.mjs
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { renderTemplate } from "./lib/render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, "template");
const OUT_DIR = path.resolve(__dirname, ".smoke-out", "lyft");
const NONE_OUT_DIR = path.resolve(__dirname, ".smoke-out", "public-weather");
const execFile = promisify(execFileCb);

// Clean previous run.
await fs.rm(path.resolve(__dirname, ".smoke-out"), { recursive: true, force: true });

const config = {
  agentId: "lyft",
  displayName: "Lyft",
  oneLiner: "Request rides and check ride history through Lyft.",
  category: "Travel",
  authModel: "oauth2",
  authorizeUrl: "https://api.lyft.com/oauth/authorize",
  tokenUrl: "https://api.lyft.com/oauth/token",
  revocationUrl: "",
  scopes: ["public", "profile", "rides.read", "rides.request"],
  hasMoneyTools: true,
  vendorApiBase: "https://api.lyft.com/v1",
  contactEmail: "developer@example.com",
  tools: [
    {
      name: "lyft_get_estimates",
      summary: "Get Lyft ride cost + ETA estimates.",
      method: "POST",
      path: "/lyft_get_estimates",
      readonly: true,
      implBody:
        'const data = await vendorFetch<{ cost_estimates: unknown[] }>({\n      bearer,\n      method: "GET",\n      path: "/cost",\n      query: {\n        start_lat: (body as any).origin.latitude,\n        start_lng: (body as any).origin.longitude,\n        end_lat: (body as any).destination.latitude,\n        end_lng: (body as any).destination.longitude,\n      },\n    });\n    return NextResponse.json({ offers: data.cost_estimates });',
    },
    {
      name: "lyft_request_ride",
      summary: "Request a Lyft ride. Money tool — two-step confirm.",
      method: "POST",
      path: "/lyft_request_ride",
      readonly: false,
      implBody:
        'if ((body as any).simulate) {\n      return NextResponse.json({ simulated: true, request_id: "preview" });\n    }\n    const result = await vendorFetch({\n      bearer,\n      method: "POST",\n      path: "/rides",\n      body,\n    });\n    return NextResponse.json(result);',
    },
    {
      name: "lyft_get_ride_history",
      summary: "List recent Lyft rides.",
      method: "POST",
      path: "/lyft_get_ride_history",
      readonly: true,
      implBody:
        'const result = await vendorFetch<{ ride_history: unknown[] }>({\n      bearer,\n      method: "GET",\n      path: "/rides",\n      query: { limit: (body as any).limit ?? 10 },\n    });\n    return NextResponse.json({ rides: result.ride_history });',
    },
  ],
};

console.log("rendering template → .smoke-out/lyft/");
await renderTemplate({ templateDir: TEMPLATE_DIR, outDir: OUT_DIR, config });

// Verify expected files exist.
const expected = [
  "package.json",
  "tsconfig.json",
  "next.config.mjs",
  "vercel.json",
  "README.md",
  ".env.example",
  ".gitignore",
  "lib/manifest.ts",
  "lib/openapi.ts",
  "lib/vendor-client.ts",
  "lib/auth.ts",
  "scripts/validate-manifest.mjs",
  "app/layout.tsx",
  "app/page.tsx",
  "app/health/route.ts",
  "app/.well-known/agent.json/route.ts",
  "app/openapi.json/route.ts",
  "app/tools/lyft_get_estimates/route.ts",
  "app/tools/lyft_request_ride/route.ts",
  "app/tools/lyft_get_ride_history/route.ts",
];

let pass = 0;
let fail = 0;
for (const f of expected) {
  try {
    await fs.access(path.join(OUT_DIR, f));
    pass += 1;
  } catch {
    console.error(`  ✗ missing: ${f}`);
    fail += 1;
  }
}

// Spot-check placeholder substitution.
const manifestSrc = await fs.readFile(path.join(OUT_DIR, "lib/manifest.ts"), "utf8");
const checks = [
  { needle: 'agent_id: "lyft"', label: "manifest agent_id" },
  { needle: 'display_name: "Lyft"', label: "manifest display_name" },
  { needle: 'authorize_url: "https://api.lyft.com/oauth/authorize"', label: "manifest authorize_url" },
  { needle: 'client_id_env: "ORCHET_LYFT_CLIENT_ID"', label: "client_id_env shouted" },
  { needle: 'process.env.ORCHET_LYFT_AGENT_BASE_URL', label: "base url env" },
  { needle: 'requires_payment: true', label: "money flag" },
];
for (const c of checks) {
  if (manifestSrc.includes(c.needle)) {
    pass += 1;
  } else {
    console.error(`  ✗ manifest missing: ${c.label} (needle: ${c.needle})`);
    fail += 1;
  }
}

// Spot-check tool route generation.
const requestRideSrc = await fs.readFile(
  path.join(OUT_DIR, "app/tools/lyft_request_ride/route.ts"),
  "utf8",
);
if (requestRideSrc.includes("simulated: true")) {
  pass += 1;
} else {
  console.error("  ✗ tool body for lyft_request_ride missing simulate branch");
  fail += 1;
}
if (requestRideSrc.includes('POST /tools/lyft_request_ride')) {
  pass += 1;
} else {
  console.error("  ✗ tool route header for lyft_request_ride missing");
  fail += 1;
}

// Verify Uber's vendor name doesn't leak into Lyft-rendered files.
let leaks = 0;
for (const f of expected) {
  const full = path.join(OUT_DIR, f);
  try {
    const content = await fs.readFile(full, "utf8");
    if (/Uber|uber\.com|UBER/.test(content) && !f.includes("uber_get_estimates")) {
      // Allow "/Uber" only inside README context that intentionally mentions it.
      console.error(`  ✗ vendor leak in ${f}: contains 'Uber'`);
      leaks += 1;
    }
  } catch {
    // already counted as fail above
  }
}
if (leaks === 0) pass += 1;
else fail += leaks;

// Auth model "none" must not render a dangling TypeScript `connect:` label.
await renderTemplate({
  templateDir: TEMPLATE_DIR,
  outDir: NONE_OUT_DIR,
  config: {
    agentId: "public-weather",
    displayName: "Public Weather",
    oneLiner: "Public weather lookup with no user auth.",
    category: "Weather",
    authModel: "none",
    hasMoneyTools: false,
    vendorApiBase: "https://api.weather.example.com",
    contactEmail: "developer@example.com",
    tools: [
      {
        name: "public_weather_lookup",
        summary: "Look up public weather.",
        method: "POST",
        path: "/public_weather_lookup",
        readonly: true,
      },
    ],
  },
});
const publicManifestSrc = await fs.readFile(
  path.join(NONE_OUT_DIR, "lib/manifest.ts"),
  "utf8",
);
if (!publicManifestSrc.includes("\n  connect:\n  listing:")) {
  pass += 1;
} else {
  console.error("  ✗ authModel=none rendered a dangling connect block");
  fail += 1;
}

// CLI command smoke: help exits cleanly and validate can inspect a manifest file.
try {
  const { stdout } = await execFile(process.execPath, [
    path.join(__dirname, "bin/create-orchet-agent.mjs"),
    "--help",
  ]);
  if (stdout.includes("orchet-agent validate") && stdout.includes("orchet-agent submit")) {
    pass += 1;
  } else {
    console.error("  ✗ help output missing command reference");
    fail += 1;
  }
} catch (err) {
  console.error(`  ✗ --help failed: ${err instanceof Error ? err.message : String(err)}`);
  fail += 1;
}

const manifestJsonPath = path.join(__dirname, ".smoke-out", "manifest.json");
await fs.writeFile(
  manifestJsonPath,
  JSON.stringify({
    agent_id: "public-weather",
    version: "0.1.0",
    display_name: "Public Weather",
    one_liner: "Public weather lookup with no user auth.",
    intents: ["weather"],
    openapi_url: "https://public-weather.example.com/openapi.json",
    health_url: "https://public-weather.example.com/health",
  }),
  "utf8",
);
try {
  const { stdout } = await execFile(process.execPath, [
    path.join(__dirname, "bin/create-orchet-agent.mjs"),
    "validate",
    "--manifest-file",
    manifestJsonPath,
  ]);
  if (stdout.includes("manifest shape valid")) {
    pass += 1;
  } else {
    console.error("  ✗ validate command did not report success");
    fail += 1;
  }
} catch (err) {
  console.error(`  ✗ validate command failed: ${err instanceof Error ? err.message : String(err)}`);
  fail += 1;
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
