/**
 * Claude integration for --from-openapi and --from-docs.
 *
 * We call Claude with a single tightly-scoped prompt and ask for
 * JSON output matching the same shape the interactive flow produces.
 * That keeps render.mjs unaware of how the config got built — it
 * just renders whatever shape is handed in.
 *
 * Why JSON-mode output:
 *   * Easier to parse than YAML or freeform text.
 *   * Anthropic's tool-use mode would technically be cleaner, but
 *     this is a one-shot extraction, not a multi-turn conversation,
 *     and JSON-in-the-message is faster + cheaper.
 *
 * Failure modes the caller MUST handle:
 *   * The vendor URL is unreachable or returns non-spec content.
 *   * Claude returns text that isn't valid JSON.
 *   * The extracted config fails downstream validation when the
 *     marketplace's sync TRUST runs.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ORCHET_CLI_MODEL ?? "claude-sonnet-4-6";
const MAX_TOKENS = 8000;

async function callClaude({ system, user }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [{ role: "user", content: user }],
  });
  const block = res.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude returned no text content");
  }
  const text = block.text;
  // Find the first JSON object in the response. Claude sometimes
  // wraps JSON in markdown code fences — strip those.
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text);
  const raw = fenced ? fenced[1] : text;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Claude returned text that wasn't valid JSON. Got: ${text.slice(0, 400)}…`,
    );
  }
}

const CONFIG_SHAPE_DOC = `
Return a single JSON object matching this exact shape:

{
  "agentId": string,            // lowercase, [a-z][a-z0-9-]{2,31}
  "displayName": string,         // capitalized vendor name
  "oneLiner": string,            // one short sentence
  "category": string,            // one of: Travel, Food, Productivity, Communication, Developer Tools, Payments, Shopping, Entertainment, Other
  "authModel": "oauth2"|"api_key"|"none",
  "authorizeUrl": string,        // if oauth2, the vendor's authorize endpoint URL; otherwise ""
  "tokenUrl": string,            // if oauth2, the vendor's token endpoint URL; otherwise ""
  "revocationUrl": string,       // optional; "" if not provided
  "scopes": string[],            // OAuth2 scopes required (e.g., ["read", "write"])
  "hasMoneyTools": boolean,      // true if any tool charges users
  "vendorApiBase": string,       // base URL for vendor REST calls
  "contactEmail": string,        // leave "" if unknown
  "tools": [                     // array of tool definitions
    {
      "name": string,            // snake_case operation_id (e.g., "lyft_get_estimates")
      "summary": string,         // one short sentence
      "method": "POST",          // always POST for Orchet tools
      "path": string,            // e.g., "/lyft_get_estimates"
      "readonly": boolean,
      "requestSchema": object,   // JSON Schema for the request body
      "responseSchema": object,  // JSON Schema for the success response
      "implBody": string         // TypeScript code body for the route handler (returns NextResponse.json(...)).
                                 // Use the bearer extracted from req via extractBearer(req).
                                 // Call the vendor API at \${VENDOR_API_BASE}/<path>.
                                 // Handle UberApiError-style errors (status, body, message).
    }
  ]
}

CRITICAL RULES:
- Do NOT include OAuth client_id or client_secret values anywhere. We use env-var NAMES only.
- Money tools (hasMoneyTools=true) MUST include a "simulate" boolean in their requestSchema and route through it like this:
    if (body.simulate) return NextResponse.json({ simulated: true, ...preview });
    // else call vendor API
- Every implBody must extract the bearer with extractBearer(req) and 401 cleanly when missing.
- Schema field names must match the vendor's API exactly so the generated client wrapper compiles.
- Output JSON only. No markdown, no commentary.
`;

export async function generateFromOpenAPI({ agentId, openapiUrl }) {
  const res = await fetch(openapiUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch OpenAPI: HTTP ${res.status}`);
  }
  const specText = await res.text();
  // Cap spec at ~80k chars to fit in Claude's context cleanly with our
  // prompt overhead. Larger specs need a tool-by-tool walk; treating
  // that as a Horizon 1.5 enhancement.
  const spec = specText.slice(0, 80_000);

  const system = `You are an Orchet agent scaffolder. Given a vendor's OpenAPI spec, you extract a complete Orchet agent configuration as JSON.\n\n${CONFIG_SHAPE_DOC}`;
  const user = `Vendor: ${agentId}\nOpenAPI URL: ${openapiUrl}\n\nOpenAPI spec (possibly truncated):\n\n${spec}\n\nExtract the Orchet agent config. Pick the 3-5 most useful tools — not every endpoint. Prefer GET-style reads + the top 1-2 write operations the agent's user would invoke. Output the JSON config now.`;

  const config = await callClaude({ system, user });
  config.agentId = agentId;
  return config;
}

export async function generateFromDocs({ agentId, docsUrl }) {
  const res = await fetch(docsUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch docs: HTTP ${res.status}`);
  }
  const html = await res.text();
  // Crude HTML → text to keep the prompt focused. Production version
  // should use a real HTML→text library, but this is enough for
  // Claude to extract intent from a docs page.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 60_000);

  const system = `You are an Orchet agent scaffolder. Given a vendor's docs page (plain text, HTML-stripped), you propose a complete Orchet agent configuration as JSON.\n\n${CONFIG_SHAPE_DOC}`;
  const user = `Vendor: ${agentId}\nDocs URL: ${docsUrl}\n\nDocs (HTML-stripped):\n\n${text}\n\nPropose the Orchet agent config. If OAuth URLs aren't explicit in the docs, leave them as empty strings — the human will fill them in. Output the JSON config now.`;

  const config = await callClaude({ system, user });
  config.agentId = agentId;
  return config;
}
