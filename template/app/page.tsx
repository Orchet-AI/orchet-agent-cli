/**
 * Public landing page for the {{DISPLAY_NAME}}-for-Orchet agent.
 */
export default function Home() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0a", color: "#e5e5e5", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", padding: "48px 24px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>
          {{DISPLAY_NAME}} for Orchet
        </h1>
        <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 32 }}>
          {{ONE_LINER}}
        </p>
        <p style={{ marginTop: 16 }}>
          <a href="https://www.orchet.ai/marketplace/{{AGENT_ID}}" style={{ display: "inline-block", background: "#fff", color: "#000", padding: "10px 16px", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 500 }}>
            Add to Orchet →
          </a>
        </p>
        <p style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.6, marginTop: 32 }}>
          Manifest: <a href="/.well-known/agent.json" style={{ color: "#7aa6ff" }}>/.well-known/agent.json</a><br />
          OpenAPI: <a href="/openapi.json" style={{ color: "#7aa6ff" }}>/openapi.json</a><br />
          Health: <a href="/health" style={{ color: "#7aa6ff" }}>/health</a>
        </p>
        <footer style={{ fontSize: 12, opacity: 0.5, marginTop: 64 }}>
          Built with @orchet/agent-cli. Not affiliated with {{DISPLAY_NAME}}.
        </footer>
      </div>
    </main>
  );
}
