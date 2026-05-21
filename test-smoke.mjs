#!/usr/bin/env node
/**
 * Smoke test: render the template with a sample Lyft config and verify
 * the output is well-formed. Doesn't run the generator's full prompt
 * UI — exercises render.mjs directly with a known-good config.
 *
 * Usage: node test-smoke.mjs
 */
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
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
const CLI_PATH = path.join(__dirname, "bin/create-orchet-agent.mjs");

async function withSubmissionServer(run) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        contentType: req.headers["content-type"],
        body,
      });
      res.writeHead(202, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          submission_id: "sub_smoke_123",
          state: "pending",
          agent_type: "smoke",
          submitted_at: "2026-05-21T00:00:00.000Z",
          trust_results: [],
        }),
      );
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const baseUrl =
    typeof address === "object" && address
      ? `http://127.0.0.1:${address.port}`
      : "";

  try {
    await run({ baseUrl, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

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
  { needle: 'on_call_escalation: "mailto:developer@example.com"', label: "mailto escalation URL" },
  { needle: 'requires_payment: true', label: "money flag" },
  { needle: 'payment_mode: "agent_owned"', label: "payment mode" },
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

// OpenAPI must expose generated tools; Orchet Store review rejects empty paths.
const openapiSrc = await fs.readFile(path.join(OUT_DIR, "lib/openapi.ts"), "utf8");
const openapiChecks = [
  { needle: '"/tools/lyft_get_estimates"', label: "OpenAPI path for estimates" },
  { needle: '"operationId": "lyft_get_estimates"', label: "OpenAPI operationId for estimates" },
  { needle: '"x-orchet-tool": true', label: "OpenAPI x-orchet-tool marker" },
  { needle: '"x-orchet-cost-tier": "free"', label: "OpenAPI read-only cost tier" },
  { needle: '"x-orchet-requires-confirmation": "structured-booking"', label: "OpenAPI write confirmation" },
  { needle: "VERCEL_PROJECT_PRODUCTION_URL", label: "OpenAPI Vercel production URL fallback" },
  { needle: "variables: { base: { default: BASE_URL } }", label: "OpenAPI dynamic base server" },
];
for (const c of openapiChecks) {
  if (openapiSrc.includes(c.needle)) {
    pass += 1;
  } else {
    console.error(`  ✗ openapi missing: ${c.label} (needle: ${c.needle})`);
    fail += 1;
  }
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
const publicOpenapiSrc = await fs.readFile(path.join(NONE_OUT_DIR, "lib/openapi.ts"), "utf8");
if (
  publicOpenapiSrc.includes('"/tools/public_weather_lookup"') &&
  publicOpenapiSrc.includes('"x-orchet-tool": true')
) {
  pass += 1;
} else {
  console.error("  ✗ authModel=none OpenAPI did not expose public_weather_lookup");
  fail += 1;
}
const publicToolSrc = await fs.readFile(
  path.join(NONE_OUT_DIR, "app/tools/public_weather_lookup/route.ts"),
  "utf8",
);
if (!publicToolSrc.includes("missing_bearer")) {
  pass += 1;
} else {
  console.error("  ✗ authModel=none tool still requires a bearer token");
  fail += 1;
}

// CLI command smoke: help exits cleanly and validate can inspect a manifest file.
try {
  const { stdout } = await execFile(process.execPath, [
    CLI_PATH,
    "--help",
  ]);
  if (
    stdout.includes("orchet-agent validate") &&
    stdout.includes("orchet-agent submit") &&
    stdout.includes("orchet-agent submit-mcp") &&
    stdout.includes("orchet-agent submit-a2a")
  ) {
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
    CLI_PATH,
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

try {
  await withSubmissionServer(async ({ baseUrl, requests }) => {
    const { stdout } = await execFile(
      process.execPath,
      [
        CLI_PATH,
        "submit-mcp",
        "--server-id",
        "demo-mcp",
        "--display-name",
        "Demo MCP",
        "--description",
        "Demo remote MCP server",
        "--mcp-url",
        "https://mcp.example.com",
        "--authorize-url",
        "https://auth.example.com/oauth/authorize",
        "--token-url",
        "https://auth.example.com/oauth/token",
        "--transport",
        "streamable_http",
        "--scopes",
        "projects:read,clients:write",
        "--contact-email",
        "developer@example.com",
        "--requested-tier",
        "community",
        "--api-base",
        baseUrl,
      ],
      {
        env: { ...process.env, ORCHET_DEVELOPER_TOKEN: "smoke-token" },
      },
    );

    const req = requests[0];
    if (
      stdout.includes("submitted remote MCP server") &&
      requests.length === 1 &&
      req.method === "POST" &&
      req.url === "/marketplace/submissions/mcp" &&
      req.authorization === "Bearer smoke-token" &&
      req.body.server_id === "demo-mcp" &&
      req.body.display_name === "Demo MCP" &&
      req.body.description === "Demo remote MCP server" &&
      req.body.mcp_url === "https://mcp.example.com" &&
      req.body.authorize_url === "https://auth.example.com/oauth/authorize" &&
      req.body.token_url === "https://auth.example.com/oauth/token" &&
      req.body.transport === "streamable_http" &&
      Array.isArray(req.body.scopes) &&
      req.body.scopes.join(",") === "projects:read,clients:write" &&
      req.body.contact_email === "developer@example.com" &&
      req.body.requested_tier === "community"
    ) {
      pass += 1;
    } else {
      console.error("  ✗ submit-mcp did not send the expected payload");
      console.error(JSON.stringify({ stdout, requests }, null, 2));
      fail += 1;
    }
  });
} catch (err) {
  console.error(`  ✗ submit-mcp command failed: ${err instanceof Error ? err.message : String(err)}`);
  fail += 1;
}

try {
  await withSubmissionServer(async ({ baseUrl, requests }) => {
    const { stdout } = await execFile(
      process.execPath,
      [
        CLI_PATH,
        "submit-a2a",
        "--agent-card-url",
        "https://agents.example.com/.well-known/agent.json",
        "--contact-email",
        "developer@example.com",
        "--requested-tier",
        "community",
        "--api-base",
        baseUrl,
      ],
      {
        env: { ...process.env, ORCHET_DEVELOPER_TOKEN: "smoke-token" },
      },
    );

    const req = requests[0];
    if (
      stdout.includes("submitted A2A peer") &&
      requests.length === 1 &&
      req.method === "POST" &&
      req.url === "/marketplace/submissions/a2a" &&
      req.authorization === "Bearer smoke-token" &&
      req.body.agent_card_url === "https://agents.example.com/.well-known/agent.json" &&
      req.body.contact_email === "developer@example.com" &&
      req.body.requested_tier === "community"
    ) {
      pass += 1;
    } else {
      console.error("  ✗ submit-a2a did not send the expected payload");
      console.error(JSON.stringify({ stdout, requests }, null, 2));
      fail += 1;
    }
  });
} catch (err) {
  console.error(`  ✗ submit-a2a command failed: ${err instanceof Error ? err.message : String(err)}`);
  fail += 1;
}

try {
  await withSubmissionServer(async ({ baseUrl, requests }) => {
    const { stdout } = await execFile(
      process.execPath,
      [
        CLI_PATH,
        "status",
        "sub_smoke_123",
        "--api-base",
        baseUrl,
      ],
      {
        env: { ...process.env, ORCHET_DEVELOPER_TOKEN: "dev_test_token" },
      },
    );

    const req = requests[0];
    if (
      stdout.includes("sub_smoke_123") &&
      requests.length === 1 &&
      req.method === "GET" &&
      req.url === "/marketplace/submissions/sub_smoke_123" &&
      req.authorization === "Bearer dev_test_token"
    ) {
      pass += 1;
    } else {
      console.error("  ✗ status did not send the developer bearer token");
      console.error(JSON.stringify({ stdout, requests }, null, 2));
      fail += 1;
    }
  });
} catch (err) {
  console.error(`  ✗ status command failed: ${err instanceof Error ? err.message : String(err)}`);
  fail += 1;
}

try {
  await withSubmissionServer(async ({ baseUrl }) => {
    await execFile(
      process.execPath,
      [
        CLI_PATH,
        "status",
        "sub_missing_token",
        "--api-base",
        baseUrl,
      ],
      {
        env: {
          ...process.env,
          ORCHET_DEVELOPER_TOKEN: "",
          ORCHET_API_TOKEN: "",
        },
      },
    );
    console.error("  ✗ status without developer token unexpectedly succeeded");
    fail += 1;
  });
} catch (err) {
  const stderr = typeof err === "object" && err && "stderr" in err ? String(err.stderr) : "";
  if (
    stderr.includes("Missing developer token.") &&
    stderr.includes("Create one at https://www.orchet.ai/developer/keys") &&
    stderr.includes("export ORCHET_DEVELOPER_TOKEN=orchet_dev_...")
  ) {
    pass += 1;
  } else {
    console.error("  ✗ missing developer token error was not actionable");
    console.error(stderr);
    fail += 1;
  }
}

console.log(`\n${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
