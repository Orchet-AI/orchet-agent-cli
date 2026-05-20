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
  create-orchet-agent <name>                       # interactive
  create-orchet-agent <name> --from-openapi <url>  # Claude-assisted from spec
  create-orchet-agent <name> --from-docs <url>     # Claude-assisted from docs
  create-orchet-agent <name> --config <path>       # non-interactive (JSON)

Examples:
  npx create-orchet-agent lyft --from-openapi https://api.lyft.com/v1/openapi.yaml
  npx create-orchet-agent doordash --from-docs https://developer.doordash.com/en-US/docs/drive
  npx create-orchet-agent stripe --config ./stripe.config.json`);
}

// ─── prompt-driven interactive flow ─────────────────────────────────

async function runInteractive(name) {
  console.log(`\nScaffolding Orchet agent: ${name}\n`);
  const answers = await prompts(
    [
      {
        type: "text",
        name: "displayName",
        message: "Display name (shown in marketplace)",
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
        message: "Marketplace category",
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

// ─── main ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agentId = args._[0];

  if (!agentId || args.flags.help) {
    usage();
    process.exit(agentId ? 0 : 1);
  }
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(agentId)) {
    console.error(`error: agent name "${agentId}" must match /^[a-z][a-z0-9-]{1,31}$/`);
    process.exit(1);
  }

  const outDir = path.resolve(process.cwd(), agentId);
  try {
    await fs.access(outDir);
    console.error(`error: directory ${outDir} already exists`);
    process.exit(1);
  } catch {
    /* ok — directory doesn't exist */
  }

  // Decide mode + collect config.
  let config;
  if (args.flags["from-openapi"]) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("error: --from-openapi requires ANTHROPIC_API_KEY in env");
      process.exit(1);
    }
    console.log(`Fetching OpenAPI spec from ${args.flags["from-openapi"]}…`);
    config = await generateFromOpenAPI({
      agentId,
      openapiUrl: args.flags["from-openapi"],
    });
  } else if (args.flags["from-docs"]) {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("error: --from-docs requires ANTHROPIC_API_KEY in env");
      process.exit(1);
    }
    console.log(`Fetching docs from ${args.flags["from-docs"]}…`);
    config = await generateFromDocs({
      agentId,
      docsUrl: args.flags["from-docs"],
    });
  } else if (args.flags.config) {
    const raw = await fs.readFile(args.flags.config, "utf8");
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
  npm run validate-manifest
  npm run dev
`);
}

main().catch((err) => {
  console.error("\nfailed:", err);
  process.exit(1);
});
