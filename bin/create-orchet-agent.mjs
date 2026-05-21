#!/usr/bin/env node
/**
 * create-orchet-agent
 *
 * Two modes:
 *
 *   $ npx create-orchet-agent <name>
 *     Interactive — six prompts, generates a complete agent repo
 *     from the bundled template. ~15 minutes from `git init` to
 *     `vercel deploy`.
 *
 *   $ npx create-orchet-agent <name> --from-openapi <url>
 *     Claude-assisted — fetches the vendor's OpenAPI spec, asks
 *     Claude to extract the per-tool implementations, generates the
 *     full repo. ~5 minutes to a working repo (plus your review).
 *     Requires ANTHROPIC_API_KEY in env.
 *
 *   $ npx create-orchet-agent <name> --from-docs <url>
 *     Claude-assisted — fetches a vendor docs page (HTML), asks Claude
 *     to propose tool shapes + OAuth URLs from prose. Best for vendors
 *     without a public OpenAPI spec.
 *
 *   $ npx create-orchet-agent <name> --config <path/to/config.json>
 *     Non-interactive — reads all answers from JSON. Useful for CI
 *     and design-partner onboarding.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createHash, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import prompts from "prompts";

import { renderTemplate } from "../lib/render.mjs";
import { generateFromOpenAPI, generateFromDocs } from "../lib/claude.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_DIR = path.resolve(__dirname, "..", "template");

// ─── arg parsing ────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args.flags[key] = next;
        i += 1;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  create-orchet-agent init <name>                  # interactive scaffold
  create-orchet-agent <name>                       # same as init <name>
  create-orchet-agent init <name> --from-openapi <url>
  create-orchet-agent init <name> --from-docs <url>
  create-orchet-agent init <name> --config <path>
  orchet-agent dev                                 # run generated agent locally
  orchet-agent validate                            # run local manifest validation
  orchet-agent validate --manifest-url <url>        # validate deployed manifest shape
  orchet-agent sign --bundle <file> [--out <file>]  # HMAC-sign bundle metadata
  orchet-agent submit --manifest-url <url> --bundle <file> --contact-email <email>
  orchet-agent status <submission_id>

Examples:
  npx create-orchet-agent init lyft --from-openapi https://api.lyft.com/v1/openapi.yaml
  npx create-orchet-agent init doordash --from-docs https://developer.doordash.com/en-US/docs/drive
  npx create-orchet-agent init stripe --config ./stripe.config.json
  ORCHET_DEVELOPER_TOKEN=... orchet-agent submit --manifest-url https://agent.example.com/.well-known/agent.json --bundle ./bundle.tgz --contact-email dev@example.com`);
}

// ─── prompt-driven interactive flow ─────────────────────────────────

async function runInteractive(name) {
  console.log(`\nScaffolding Orchet agent: ${name}\n`);
  const answers = await prompts(
    [
      {
        type: "text",
        name: "displayName",
        message: "Display name (shown in Orchet Store)",
        initial: name.charAt(0).toUpperCase() + name.slice(1),
      },
      {
        type: "text",
        name: "oneLiner",
        message: "One-line description",
        initial: "",
      },
      {
        type: "select",
        name: "category",
        message: "Orchet Store category",
        choices: [
          { title: "Travel", value: "Travel" },
          { title: "Food", value: "Food" },
          { title: "Productivity", value: "Productivity" },
          { title: "Communication", value: "Communication" },
          { title: "Developer Tools", value: "Developer Tools" },
          { title: "Payments", value: "Payments" },
          { title: "Shopping", value: "Shopping" },
          { title: "Entertainment", value: "Entertainment" },
          { title: "Other", value: "Other" },
        ],
      },
      {
        type: "select",
        name: "authModel",
        message: "Authentication model",
        choices: [
          { title: "OAuth2 (most vendors)", value: "oauth2" },
          { title: "API key (per-user)", value: "api_key" },
          { title: "None (public/anonymous)", value: "none" },
        ],
      },
      {
        type: (prev) => (prev === "oauth2" ? "text" : null),
        name: "authorizeUrl",
        message: "OAuth authorize URL (e.g., https://auth.uber.com/oauth/v2/authorize)",
      },
      {
        type: (prev, vals) => (vals.authModel === "oauth2" ? "text" : null),
        name: "tokenUrl",
        message: "OAuth token URL",
      },
      {
        type: (prev, vals) => (vals.authModel === "oauth2" ? "list" : null),
        name: "scopes",
        message: "Required scopes (comma-separated)",
        initial: "",
        separator: ",",
      },
      {
        type: "confirm",
        name: "hasMoneyTools",
        message: "Does this agent move money (charges users)?",
        initial: false,
      },
      {
        type: "text",
        name: "vendorApiBase",
        message: "Vendor API base URL (for vendor-client.ts)",
        initial: "https://api.example.com",
      },
      {
        type: "text",
        name: "contactEmail",
        message: "Support contact email",
        initial: process.env.USER ? `${process.env.USER}@example.com` : "",
      },
    ],
    { onCancel: () => process.exit(1) },
  );

  return {
    agentId: name,
    displayName: answers.displayName,
    oneLiner: answers.oneLiner,
    category: answers.category,
    authModel: answers.authModel,
    authorizeUrl: answers.authorizeUrl ?? "",
    tokenUrl: answers.tokenUrl ?? "",
    revocationUrl: "",
    scopes: (answers.scopes ?? []).map((s) => s.trim()).filter(Boolean),
    hasMoneyTools: !!answers.hasMoneyTools,
    vendorApiBase: answers.vendorApiBase,
    contactEmail: answers.contactEmail,
    tools: [
      // Stub tool — the user will edit lib/<vendor>-client.ts and
      // app/tools/* by hand in the interactive flow.
      {
        name: `${name}_example`,
        summary: "Example tool — replace with real tools for your vendor.",
        method: "POST",
        path: "/example",
        readonly: true,
        requestSchema: { type: "object", properties: {} },
        responseSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    ],
  };
}

async function runInit(agentId, flags) {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(agentId)) {
    fail(`agent name "${agentId}" must match /^[a-z][a-z0-9-]{1,31}$/`);
  }

  const outDir = path.resolve(process.cwd(), agentId);
  try {
    await fs.access(outDir);
    fail(`directory ${outDir} already exists`);
  } catch {
    /* ok — directory doesn't exist */
  }

  let config;
  if (flags["from-openapi"]) {
    if (!process.env.ANTHROPIC_API_KEY) {
      fail("--from-openapi requires ANTHROPIC_API_KEY in env");
    }
    console.log(`Fetching OpenAPI spec from ${flags["from-openapi"]}…`);
    config = await generateFromOpenAPI({
      agentId,
      openapiUrl: flags["from-openapi"],
    });
  } else if (flags["from-docs"]) {
    if (!process.env.ANTHROPIC_API_KEY) {
      fail("--from-docs requires ANTHROPIC_API_KEY in env");
    }
    console.log(`Fetching docs from ${flags["from-docs"]}…`);
    config = await generateFromDocs({
      agentId,
      docsUrl: flags["from-docs"],
    });
  } else if (flags.config) {
    const raw = await fs.readFile(flags.config, "utf8");
    config = JSON.parse(raw);
    config.agentId = agentId;
  } else {
    config = await runInteractive(agentId);
  }

  console.log(`\nRendering template into ${outDir}…`);
  await renderTemplate({ templateDir: TEMPLATE_DIR, outDir, config });

  console.log(`
✓ Done.

Next steps:
  cd ${agentId}
  cp .env.example .env.local                  # paste OAuth client_id / secret
  npm install
  orchet-agent validate
  orchet-agent dev
`);
}

async function runDev(flags) {
  const script = flags.script || "dev";
  await runCommand("npm", ["run", script], { cwd: process.cwd() });
}

async function runValidate(flags) {
  if (flags["manifest-url"]) {
    const manifest = await fetchJson(flags["manifest-url"]);
    validateManifestShape(manifest);
    printManifestSummary(manifest);
    return;
  }
  if (flags["manifest-file"]) {
    const manifest = JSON.parse(await fs.readFile(flags["manifest-file"], "utf8"));
    validateManifestShape(manifest);
    printManifestSummary(manifest);
    return;
  }

  const pkgPath = path.resolve(process.cwd(), "package.json");
  try {
    const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    if (pkg.scripts?.["validate-manifest"]) {
      await runCommand("npm", ["run", "validate-manifest"], { cwd: process.cwd() });
      return;
    }
  } catch {
    // Fall through to the clearer error below.
  }
  fail("no manifest source found. Run inside a generated agent repo or pass --manifest-url/--manifest-file.");
}

async function runSign(flags) {
  const bundlePath = flags.bundle || flags._bundle;
  if (!bundlePath) fail("sign requires --bundle <file>");
  const secretEnv = flags["secret-env"] || "ORCHET_SIGNING_SECRET";
  const secret = process.env[secretEnv];
  if (!secret) fail(`sign requires ${secretEnv} in env`);

  const bytes = await fs.readFile(bundlePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const signature = createHmac("sha256", secret).update(bytes).digest("base64url");
  const envelope = {
    algorithm: "hmac-sha256",
    bundle_sha256: sha256,
    signature,
    signing_key_id: flags["signing-key-id"] || secretEnv,
    signed_at: new Date().toISOString(),
  };
  const json = JSON.stringify(envelope, null, 2);
  if (flags.out) {
    await fs.mkdir(path.dirname(path.resolve(flags.out)), { recursive: true });
    await fs.writeFile(flags.out, `${json}\n`, "utf8");
    console.log(`✓ wrote signature envelope: ${flags.out}`);
  } else {
    console.log(json);
  }
}

async function runSubmit(flags) {
  const token = developerToken();
  const manifest = await loadManifest(flags);
  validateManifestShape(manifest);
  const bundlePath = flags.bundle;
  if (!bundlePath) fail("submit requires --bundle <file>");
  const bundle_b64 = (await fs.readFile(bundlePath)).toString("base64");
  const contact_email = flags["contact-email"] || process.env.ORCHET_CONTACT_EMAIL;
  if (!contact_email) fail("submit requires --contact-email <email> or ORCHET_CONTACT_EMAIL");

  let signature = flags.signature;
  let signing_key_id = flags["signing-key-id"];
  if (flags["signature-file"]) {
    const envelope = JSON.parse(await fs.readFile(flags["signature-file"], "utf8"));
    signature = envelope.signature ?? signature;
    signing_key_id = envelope.signing_key_id ?? signing_key_id;
  }
  const tools = flags.tools ? JSON.parse(await fs.readFile(flags.tools, "utf8")) : undefined;
  const body = {
    manifest,
    bundle_b64,
    contact_email,
    ...(signature ? { signature } : {}),
    ...(signing_key_id ? { signing_key_id } : {}),
    ...(flags["requested-tier"] ? { requested_tier: flags["requested-tier"] } : {}),
    ...(tools ? { tools } : {}),
  };

  const res = await fetch(`${apiBase(flags)}/marketplace/submissions/sdk`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await safeResponseJson(res);
  if (!res.ok) {
    fail(`submit failed (${res.status}): ${JSON.stringify(payload)}`);
  }
  console.log("✓ submitted");
  console.log(JSON.stringify(payload, null, 2));
}

async function runStatus(id, flags) {
  if (!id) fail("status requires <submission_id>");
  const token = developerToken();
  const res = await fetch(`${apiBase(flags)}/marketplace/submissions/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const payload = await safeResponseJson(res);
  if (!res.ok) {
    fail(`status failed (${res.status}): ${JSON.stringify(payload)}`);
  }
  console.log(JSON.stringify(payload, null, 2));
}

async function loadManifest(flags) {
  if (flags["manifest-url"]) return fetchJson(flags["manifest-url"]);
  if (flags["manifest-file"]) {
    return JSON.parse(await fs.readFile(flags["manifest-file"], "utf8"));
  }
  fail("expected --manifest-url <url> or --manifest-file <path>");
}

function developerToken() {
  const token = process.env.ORCHET_DEVELOPER_TOKEN || process.env.ORCHET_API_TOKEN;
  if (!token) fail("set ORCHET_DEVELOPER_TOKEN before calling submit/status");
  return token;
}

function apiBase(flags) {
  return String(flags["api-base"] || process.env.ORCHET_API_BASE || "https://api.orchet.ai").replace(/\/+$/, "");
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await safeResponseJson(res);
  if (!res.ok) fail(`${url} returned HTTP ${res.status}`);
  return body;
}

async function safeResponseJson(res) {
  try {
    return await res.json();
  } catch {
    return { text: await res.text().catch(() => "") };
  }
}

function validateManifestShape(manifest) {
  const required = ["agent_id", "version", "display_name", "one_liner", "openapi_url", "health_url"];
  for (const key of required) {
    if (typeof manifest?.[key] !== "string" || manifest[key].trim().length === 0) {
      fail(`manifest.${key} must be a non-empty string`);
    }
  }
  if (!/^[a-z][a-z0-9-]{2,31}$/.test(manifest.agent_id)) {
    fail("manifest.agent_id must match /^[a-z][a-z0-9-]{2,31}$/");
  }
  if (!Array.isArray(manifest.intents) || manifest.intents.length === 0) {
    fail("manifest.intents must be a non-empty array");
  }
}

function printManifestSummary(manifest) {
  console.log("✓ manifest shape valid");
  console.log(`  agent_id     ${manifest.agent_id}`);
  console.log(`  version      ${manifest.version}`);
  console.log(`  display_name ${manifest.display_name}`);
  console.log(`  openapi_url  ${manifest.openapi_url}`);
}

async function runCommand(command, args, opts) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const commands = new Set(["init", "dev", "validate", "sign", "submit", "status"]);
  const first = args._[0];

  if (args.flags.help || args.flags.h) {
    usage();
    process.exit(0);
  }

  if (!first) {
    usage();
    process.exit(1);
  }

  const command = commands.has(first) ? first : "init";
  const positional = commands.has(first) ? args._.slice(1) : args._;
  args.flags._bundle = positional[0];

  switch (command) {
    case "init":
      await runInit(positional[0], args.flags);
      return;
    case "dev":
      await runDev(args.flags);
      return;
    case "validate":
      await runValidate(args.flags);
      return;
    case "sign":
      await runSign(args.flags);
      return;
    case "submit":
      await runSubmit(args.flags);
      return;
    case "status":
      await runStatus(positional[0], args.flags);
      return;
    default:
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("\nfailed:", err);
  process.exit(1);
});
