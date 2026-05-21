# @orchet/agent-cli

Scaffold Orchet specialist agents in seconds.

```bash
# Interactive — 6 questions, full repo
npx create-orchet-agent init lyft

# Claude-assisted from vendor's OpenAPI spec
ANTHROPIC_API_KEY=… npx create-orchet-agent init lyft \
  --from-openapi https://api.lyft.com/v1/openapi.yaml

# Claude-assisted from a docs page (HTML)
ANTHROPIC_API_KEY=… npx create-orchet-agent init doordash \
  --from-docs https://developer.doordash.com/en-US/docs/drive

# Non-interactive (CI / design-partner onboarding)
npx create-orchet-agent init stripe --config ./stripe.config.json
```

## What you get

A complete Next.js repo ready to deploy on Vercel:

```
<agent>/
  app/
    .well-known/agent.json/route.ts   # Orchet manifest
    openapi.json/route.ts             # OpenAPI 3.1 spec
    health/route.ts                   # liveness
    tools/<name>/route.ts             # one per tool
    page.tsx                          # public landing page
    layout.tsx
  lib/
    manifest.ts                       # defineManifest() call
    openapi.ts                        # OpenAPI doc
    vendor-client.ts                  # thin HTTP wrapper
    auth.ts                           # bearer extraction
  scripts/validate-manifest.mjs       # local pre-flight
  package.json, tsconfig.json, next.config.mjs, vercel.json
  .env.example, .gitignore, README.md
```

## Three modes, one config shape

All three modes (interactive, --from-openapi, --from-docs) converge on the same JSON config shape:

```jsonc
{
  "agentId": "lyft",                          // lowercase, [a-z][a-z0-9-]{2,31}
  "displayName": "Lyft",
  "oneLiner": "Get rides via Lyft.",
  "category": "Travel",
  "authModel": "oauth2",                       // or "api_key" or "none"
  "authorizeUrl": "https://api.lyft.com/oauth/authorize",
  "tokenUrl":     "https://api.lyft.com/oauth/token",
  "revocationUrl": "",
  "scopes": ["public", "profile", "rides.read", "rides.request"],
  "hasMoneyTools": true,
  "vendorApiBase": "https://api.lyft.com/v1",
  "contactEmail": "developer@example.com",
  "tools": [
    {
      "name": "lyft_get_estimates",
      "summary": "Ride cost + ETA estimates.",
      "method": "POST",
      "path": "/lyft_get_estimates",
      "readonly": true,
      "requestSchema": { /* JSON Schema */ },
      "responseSchema": { /* JSON Schema */ },
      "implBody": "/* generated TS code body */"
    }
  ]
}
```

`--config <path>` reads this JSON directly. `--from-openapi` and `--from-docs` ask Claude to produce it. Interactive prompts the user for the top-level fields and leaves you with a stub tool to edit.

## Command reference

```bash
orchet-agent init weather --config ./weather.config.json
orchet-agent dev
orchet-agent validate
orchet-agent validate --manifest-url https://weather.example.com/.well-known/agent.json
ORCHET_SIGNING_SECRET=... orchet-agent sign --bundle ./bundle.tgz --out .orchet/signature.json
ORCHET_DEVELOPER_TOKEN=... orchet-agent submit \
  --manifest-url https://weather.example.com/.well-known/agent.json \
  --bundle ./bundle.tgz \
  --signature-file .orchet/signature.json \
  --contact-email developer@example.com
ORCHET_DEVELOPER_TOKEN=... orchet-agent submit-mcp \
  --server-id linear \
  --display-name Linear \
  --mcp-url https://mcp.linear.app \
  --authorize-url https://linear.app/oauth/authorize \
  --token-url https://api.linear.app/oauth/token \
  --transport streamable_http \
  --scopes issues:read,issues:write \
  --contact-email developer@example.com
ORCHET_DEVELOPER_TOKEN=... orchet-agent submit-a2a \
  --agent-card-url https://agent.example.com/.well-known/agent.json \
  --contact-email developer@example.com
ORCHET_DEVELOPER_TOKEN=... orchet-agent status <submission_id>
```

`ORCHET_API_BASE` defaults to `https://api.orchet.ai`. `submit` also accepts
`--manifest-file`, `--tools`, `--requested-tier`, and `--api-base`.
`submit-mcp` and `submit-a2a` accept `--requested-tier`, `--api-base`, and
`ORCHET_CONTACT_EMAIL`.

### SDK/API submissions

Use `orchet-agent submit` when you host an HTTP agent built with
`@orchet/agent-sdk`. The payload carries your manifest, bundle bytes, optional
tool contracts, and signing metadata.

### Remote MCP submissions

Use `orchet-agent submit-mcp` when your app already exposes a remote MCP server.
The payload maps directly to `POST /marketplace/submissions/mcp`:

- `--server-id`: stable lowercase id for the Orchet Store row.
- `--display-name`: user-facing name.
- `--mcp-url`: HTTPS MCP endpoint.
- `--authorize-url` / `--token-url`: OAuth endpoints.
- `--transport`: `streamable_http` or `sse`.
- `--scopes`: comma- or space-separated scope names.

Do not pass OAuth client secrets. Orchet admins provision the OAuth client env
var names during review.

### A2A submissions

Use `orchet-agent submit-a2a` when your app exposes a Google A2A-compatible
Agent Card. The payload maps directly to `POST /marketplace/submissions/a2a`
and only needs the public Agent Card URL plus contact metadata.

## Hard credential boundary

The generated manifest carries **env-var NAMES**, never values. `client_id_env: "ORCHET_<AGENT>_CLIENT_ID"`. The actual OAuth secrets live on Vercel as production env vars. Per ADR-015, the Orchet Store submission service never accepts secrets in submissions.

## Why this exists

Manually writing one agent like Uber takes 2 hours and 1,200 LoC. At 100 agents that's 200 hours plus 100 vendor OAuth registrations plus QA — multiple engineer-weeks for code that's 80% boilerplate. The CLI takes that 80% to zero. Build the next agent in 15 minutes (interactive) or 5 minutes (--from-openapi with Claude).

The CLI is the thing that lets the Orchet Store scale — internally for the top 20 official integrations, externally for the long-tail developer ecosystem.

## License

Apache-2.0.
