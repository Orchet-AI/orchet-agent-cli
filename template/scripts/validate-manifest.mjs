#!/usr/bin/env node
import { parseManifest } from "@orchet/agent-sdk/manifest";
import { manifest } from "../lib/manifest.ts";

try {
  const parsed = parseManifest(manifest);
  console.log("✓ manifest valid");
  console.log(`  agent_id        ${parsed.agent_id}`);
  console.log(`  version         ${parsed.version}`);
  console.log(`  domain          ${parsed.domain}`);
  console.log(`  intents         ${parsed.intents.join(", ")}`);
  console.log(`  scopes          ${parsed.connect.model === "oauth2" ? parsed.connect.scopes.map((s) => s.name).join(", ") : "(no oauth2)"}`);
  console.log(`  sdk_version     ${parsed.capabilities.sdk_version}`);
} catch (err) {
  console.error("✗ manifest invalid:");
  console.error(err);
  process.exit(1);
}
