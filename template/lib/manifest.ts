/**
 * {{DISPLAY_NAME}} agent manifest.
 *
 * Served at /.well-known/agent.json. Conforms to @orchet/agent-sdk's
 * AgentManifestSchema (v{{SDK_VERSION}}).
 *
 * OAuth client_id/secret are NEVER in this manifest — they're env-var
 * names that resolve at runtime per ADR-015's hard credential boundary.
 */
import { defineManifest } from "@orchet/agent-sdk/manifest";

const BASE_URL =
  process.env.{{AGENT_BASE_URL_ENV}} ?? "https://{{AGENT_ID}}.orchet.ai";

export const manifest = defineManifest({
  agent_id: "{{AGENT_ID}}",
  version: "0.1.0",
  domain: BASE_URL,
  display_name: "{{DISPLAY_NAME}}",
  one_liner: "{{ONE_LINER}}",
  intents: ["{{AGENT_ID}}"],
  example_utterances: [],
  openapi_url: `${BASE_URL}/openapi.json`,
  health_url: `${BASE_URL}/health`,
  ui: { components: [] },
  sla: {
    p50_latency_ms: 800,
    p95_latency_ms: 2500,
    availability_target: 0.99,
  },
  pii_scope: ["name", "email"],
  requires_payment: {{REQUIRES_PAYMENT}},
  supported_regions: ["US"],
  capabilities: {
    sdk_version: "{{SDK_VERSION}}",
    supports_compound_bookings: {{HAS_MONEY_TOOLS}},
    implements_cancellation: {{HAS_MONEY_TOOLS}},
  },
{{#IF AUTH_MODEL}}
  connect:
{{/IF}}
{{#IF AUTHORIZE_URL}}
    {
      model: "oauth2",
      authorize_url: "{{AUTHORIZE_URL}}",
      token_url: "{{TOKEN_URL}}",
      revocation_url: "{{REVOCATION_URL}}",
      scopes: {{SCOPES_JSON}},
      client_id_env: "{{CLIENT_ID_ENV}}",
      client_secret_env: "{{CLIENT_SECRET_ENV}}",
      client_type: "confidential",
    },
{{/IF}}
  listing: {
    category: "{{CATEGORY}}",
    homepage_url: BASE_URL,
    pricing_note: "{{#IF HAS_MONEY_TOOLS}}Pay-per-use to {{DISPLAY_NAME}} directly. No platform fee from Orchet.{{/IF}}{{#IF HAS_MONEY_TOOLS}}{{/IF}}",
  },
  on_call_escalation: "{{CONTACT_EMAIL}}",
});
