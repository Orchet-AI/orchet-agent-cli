/**
 * Template rendering.
 *
 * Walks the bundled template/ directory, copies every file into the
 * target, and replaces `{{PLACEHOLDER}}` tokens with values from the
 * config. The __TOOL__ directory is special — it's expanded once per
 * tool in config.tools[], using each tool as the template context.
 *
 * Why a hand-rolled renderer rather than a templating library:
 *   1. Zero deps in this hot path — keeps `npx create-orchet-agent`
 *      fast even on cold caches.
 *   2. The placeholder language is intentionally tiny ({{KEY}} and
 *      {{#IF KEY}}…{{/IF}} only). Anything more would invite logic
 *      drift between template and runtime.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const PLACEHOLDER = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;
const IF_BLOCK = /\{\{#IF ([A-Z_][A-Z0-9_]*)\}\}([\s\S]*?)\{\{\/IF\}\}/g;

function shoutCase(s) {
  return s.replace(/-/g, "_").toUpperCase();
}

function contactUrl(contactEmail) {
  const raw = String(contactEmail ?? "").trim();
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
  if (raw.includes("@")) return `mailto:${raw}`;
  return raw;
}

function normalizeToolHttpPath(tool) {
  if (typeof tool.path === "string" && tool.path.startsWith("/tools/")) {
    return tool.path;
  }
  if (typeof tool.path === "string" && tool.path.startsWith("/")) {
    return `/tools${tool.path}`;
  }
  return `/tools/${tool.name}`;
}

function toolCostTier(config, tool) {
  if (tool.costTier) return tool.costTier;
  if (tool.readonly) return "free";
  // The scaffold should stay publishable while the developer adds exact
  // confirmation/cancellation semantics. Hard "money" tools require an
  // explicit cancel counterpart in the SDK validator, so generated write
  // tools default to "metered" until the developer tightens the contract.
  if (config.hasMoneyTools) return "metered";
  return "low";
}

function toolConfirmation(config, tool) {
  if (Object.prototype.hasOwnProperty.call(tool, "requiresConfirmation")) {
    return tool.requiresConfirmation;
  }
  if (config.hasMoneyTools && !tool.readonly) return "structured-booking";
  return false;
}

function buildOpenApiPaths(config) {
  const paths = {};
  for (const tool of config.tools ?? []) {
    const path = normalizeToolHttpPath(tool);
    const operation = {
      operationId: tool.name,
      summary: tool.summary ?? `${tool.name} tool`,
      description: tool.description ?? tool.summary ?? `${tool.name} tool exposed to Orchet.`,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: tool.requestSchema ?? {
              type: "object",
              properties: {},
              additionalProperties: true,
            },
          },
        },
      },
      responses: {
        "200": {
          description: "Tool result",
          content: {
            "application/json": {
              schema: tool.responseSchema ?? {
                type: "object",
                additionalProperties: true,
              },
            },
          },
        },
      },
      "x-orchet-tool": true,
      "x-orchet-cost-tier": toolCostTier(config, tool),
      "x-orchet-requires-confirmation": toolConfirmation(config, tool),
      "x-orchet-pii-required": tool.piiRequired ?? [],
      "x-orchet-intent-tags": tool.intentTags ?? [config.agentId],
    };

    if (tool.cancels) operation["x-orchet-cancels"] = tool.cancels;
    if (tool.cancelFor) operation["x-orchet-cancel-for"] = tool.cancelFor;
    if (tool.compensationKind) operation["x-orchet-compensation-kind"] = tool.compensationKind;
    if (tool.reversibility) operation["x-orchet-reversibility"] = tool.reversibility;
    if (tool.compensatingTool) operation["x-orchet-compensating-tool"] = tool.compensatingTool;
    if (tool.compensatingInputsTemplate) {
      operation["x-orchet-compensating-inputs-template"] = tool.compensatingInputsTemplate;
    }
    if (typeof tool.compensatingWindowSeconds === "number") {
      operation["x-orchet-compensating-window-seconds"] = tool.compensatingWindowSeconds;
    }

    paths[path] = { post: operation };
  }
  return JSON.stringify(paths, null, 2);
}

function buildContext(config, extra = {}) {
  const shouted = shoutCase(config.agentId);
  return {
    AGENT_ID: config.agentId,
    AGENT_ID_SHOUT: shouted,
    DISPLAY_NAME: config.displayName,
    ONE_LINER: config.oneLiner ?? "",
    CATEGORY: config.category ?? "Other",
    AUTH_MODEL: config.authModel ?? "none",
    HAS_OAUTH: config.authModel === "oauth2" && config.authorizeUrl ? "true" : "false",
    AUTHORIZE_URL: config.authorizeUrl ?? "",
    TOKEN_URL: config.tokenUrl ?? "",
    REVOCATION_URL: config.revocationUrl ?? "",
    SCOPES_JSON: JSON.stringify(
      (config.scopes ?? []).map((name) => ({
        name,
        description: `Read/use ${name} on your behalf.`,
        required: true,
      })),
    ),
    SCOPES_LIST: (config.scopes ?? []).join(", "),
    // Defaults to ORCHET_* prefix. Older generated agents keep working through
    // SDK-side compatibility, while new scaffolds ship Orchet-branded.
    CLIENT_ID_ENV: `ORCHET_${shouted}_CLIENT_ID`,
    CLIENT_SECRET_ENV: `ORCHET_${shouted}_CLIENT_SECRET`,
    AGENT_BASE_URL_ENV: `ORCHET_${shouted}_AGENT_BASE_URL`,
    HAS_MONEY_TOOLS: config.hasMoneyTools ? "true" : "false",
    REQUIRES_PAYMENT: config.hasMoneyTools ? "true" : "false",
    PAYMENT_MODE: config.paymentMode ?? "agent_owned",
    VENDOR_API_BASE: config.vendorApiBase ?? "https://api.example.com",
    CONTACT_EMAIL: config.contactEmail ?? "",
    CONTACT_ESCALATION_URL: contactUrl(config.contactEmail),
    SDK_VERSION: "0.6.0",
    CLI_VERSION: "0.1.2",
    // Tool-rendering helpers (filled by renderTools at the time of
    // string replacement so we can append per-tool generated code
    // outside the per-file templates).
    TOOLS_JSON: JSON.stringify(config.tools ?? [], null, 2),
    OPENAPI_PATHS: buildOpenApiPaths(config),
    ...extra,
  };
}

function applyIfBlocks(text, ctx) {
  return text.replace(IF_BLOCK, (_, key, body) => {
    const v = ctx[key];
    if (!v || v === "false" || v === "0") return "";
    return body;
  });
}

function applyPlaceholders(text, ctx) {
  return text.replace(PLACEHOLDER, (_, key) => {
    if (key in ctx) return String(ctx[key]);
    return `{{${key}}}`; // leave unknown placeholders intact for now
  });
}

function renderString(text, ctx) {
  return applyPlaceholders(applyIfBlocks(text, ctx), ctx);
}

async function* walk(dir, root = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full);
    if (entry.isDirectory()) {
      yield { kind: "dir", relPath: rel, fullPath: full };
      yield* walk(full, root);
    } else {
      yield { kind: "file", relPath: rel, fullPath: full };
    }
  }
}

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js",
  ".json", ".md", ".yml", ".yaml", ".html", ".css",
  ".env", ".gitignore", ".npmrc",
]);

async function copyFile(srcAbs, dstAbs, ctx) {
  const ext = path.extname(srcAbs).toLowerCase();
  if (!TEXT_EXT.has(ext) && !srcAbs.endsWith(".example") && path.basename(srcAbs) !== ".gitignore" && path.basename(srcAbs) !== ".npmrc") {
    // Binary copy.
    await fs.copyFile(srcAbs, dstAbs);
    return;
  }
  const raw = await fs.readFile(srcAbs, "utf8");
  const rendered = renderString(raw, ctx);
  await fs.writeFile(dstAbs, rendered, "utf8");
}

/**
 * Expand the __TOOL__ subtree once per config.tools[] entry. Inside
 * the per-tool subtree the path component itself can contain
 * {{TOOL_NAME}}, which is interpreted with the per-tool context.
 */
async function expandToolSubtree({ toolDir, outAppToolsDir, baseCtx, tools }) {
  for (const tool of tools) {
    const toolCtx = {
      ...baseCtx,
      TOOL_NAME: tool.name,
      TOOL_SUMMARY: tool.summary ?? "",
      TOOL_METHOD: tool.method ?? "POST",
      TOOL_PATH: tool.path ?? `/${tool.name}`,
      TOOL_READONLY: tool.readonly ? "true" : "false",
      TOOL_REQUEST_SCHEMA: JSON.stringify(tool.requestSchema ?? {}, null, 2),
      TOOL_RESPONSE_SCHEMA: JSON.stringify(tool.responseSchema ?? {}, null, 2),
      TOOL_IMPL_BODY:
        tool.implBody ??
        `// TODO: implement ${tool.name} against the vendor API.\n  return NextResponse.json({ ok: true });`,
    };

    const outToolDir = path.join(outAppToolsDir, tool.name);
    await fs.mkdir(outToolDir, { recursive: true });

    for await (const node of walk(toolDir)) {
      if (node.kind === "dir") {
        await fs.mkdir(path.join(outToolDir, node.relPath), { recursive: true });
      } else {
        await copyFile(node.fullPath, path.join(outToolDir, node.relPath), toolCtx);
      }
    }
  }
}

export async function renderTemplate({ templateDir, outDir, config }) {
  await fs.mkdir(outDir, { recursive: true });
  const ctx = buildContext(config);
  const toolDir = path.join(templateDir, "app", "tools", "__TOOL__");
  const outAppToolsDir = path.join(outDir, "app", "tools");

  for await (const node of walk(templateDir)) {
    // Skip the __TOOL__ tree — we expand it per-tool below.
    if (
      node.relPath.startsWith(path.join("app", "tools", "__TOOL__")) ||
      node.relPath === path.join("app", "tools", "__TOOL__")
    ) {
      continue;
    }
    if (node.kind === "dir") {
      await fs.mkdir(path.join(outDir, node.relPath), { recursive: true });
    } else {
      await copyFile(node.fullPath, path.join(outDir, node.relPath), ctx);
    }
  }

  await fs.mkdir(outAppToolsDir, { recursive: true });
  await expandToolSubtree({
    toolDir,
    outAppToolsDir,
    baseCtx: ctx,
    tools: config.tools ?? [],
  });
}
