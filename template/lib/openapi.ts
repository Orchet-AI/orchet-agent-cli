/**
 * OpenAPI 3.1 spec for {{DISPLAY_NAME}}'s tools.
 *
 * Served at /openapi.json. Generated from the agent's per-tool
 * configuration at scaffold time. Edit lib/openapi.ts to add new
 * tools or refine request/response schemas after generation.
 */

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "{{DISPLAY_NAME}} for Orchet — REST tool surface",
    version: "0.1.0",
    description:
      "Tools that wrap {{DISPLAY_NAME}}'s API under the @orchet/agent-sdk contract.",
  },
  servers: [
    {
      url: "{base}/tools",
      variables: { base: { default: "https://{{AGENT_ID}}.orchet.ai" } },
    },
  ],
  components: {
    securitySchemes: {
      bearer: {
        type: "http",
        scheme: "bearer",
        description:
          "User-scoped {{DISPLAY_NAME}} access token, attached by the Orchet router after resolving the user's connection.",
      },
    },
  },
  paths: {{OPENAPI_PATHS}},
} as const;
