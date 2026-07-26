import type { IncomingMessage, ServerResponse } from "node:http";

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-ancestors 'none'; img-src 'none'; script-src 'none'; style-src 'unsafe-inline'",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy":
    "accelerometer=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  "referrer-policy": "no-referrer",
  vary: "Accept",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

const CONNECTION_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Connect DeepTrace to your AI</title>
  <style>
    :root {
      color-scheme: light dark;
      --canvas: #f5f7fb;
      --surface: #ffffff;
      --surface-muted: #eef2f8;
      --text: #18202b;
      --muted: #566274;
      --border: #cbd4e1;
      --accent: #3659c9;
      --accent-strong: #2847ad;
      --code: #111827;
      --code-text: #f3f4f6;
      --success: #16734b;
      --shadow: 0 1rem 3rem rgb(24 32 43 / 0.08);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      min-block-size: 100dvh;
      margin: 0;
      color: var(--text);
      background: var(--canvas);
      font-size: 1rem;
      line-height: 1.6;
    }

    header,
    main,
    footer {
      inline-size: min(100% - 2rem, 68rem);
      margin-inline: auto;
    }

    header {
      padding-block: clamp(3rem, 8vw, 6rem) 2rem;
    }

    main {
      display: grid;
      gap: 1.5rem;
      padding-block-end: 3rem;
    }

    h1,
    h2,
    h3,
    p {
      margin-block-start: 0;
    }

    h1 {
      max-inline-size: 18ch;
      margin-block-end: 1rem;
      font-size: clamp(2.4rem, 1.7rem + 3vw, 4.5rem);
      line-height: 1.05;
      letter-spacing: -0.04em;
      text-wrap: balance;
    }

    h2,
    h3 {
      line-height: 1.25;
      text-wrap: balance;
    }

    h2 {
      font-size: clamp(1.45rem, 1.25rem + 0.7vw, 2rem);
    }

    h3 {
      font-size: 1.15rem;
    }

    p,
    li {
      text-wrap: pretty;
    }

    a {
      color: var(--accent);
      text-underline-offset: 0.18em;
    }

    a:hover {
      color: var(--accent-strong);
    }

    a:focus-visible,
    pre:focus-visible,
    summary:focus-visible {
      outline: 0.2rem solid var(--accent);
      outline-offset: 0.2rem;
    }

    code {
      font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
      font-size: 0.9em;
    }

    pre {
      max-inline-size: 100%;
      margin-block: 0.75rem 0;
      padding: 1rem;
      overflow: auto;
      color: var(--code-text);
      background: var(--code);
      border: 1px solid var(--border);
      border-radius: 0.7rem;
      line-height: 1.45;
      tab-size: 2;
    }

    .eyebrow {
      margin-block-end: 0.75rem;
      color: var(--accent);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .lede {
      max-inline-size: 60ch;
      margin-block-end: 0;
      color: var(--muted);
      font-size: clamp(1.1rem, 1rem + 0.35vw, 1.3rem);
    }

    .card,
    .notice {
      padding: clamp(1.25rem, 2.5vw, 2rem);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 1rem;
      box-shadow: var(--shadow);
    }

    .notice {
      border-inline-start: 0.35rem solid var(--success);
      box-shadow: none;
    }

    .notice strong {
      color: var(--success);
    }

    .client-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
      gap: 1rem;
    }

    .client-grid article {
      min-inline-size: 0;
      padding: 1.25rem;
      background: var(--surface-muted);
      border: 1px solid var(--border);
      border-radius: 0.8rem;
    }

    .steps {
      padding-inline-start: 1.4rem;
    }

    .steps li + li {
      margin-block-start: 0.55rem;
    }

    details {
      border-block-start: 1px solid var(--border);
      padding-block-start: 1rem;
    }

    summary {
      inline-size: fit-content;
      min-block-size: 1.5rem;
      cursor: pointer;
      color: var(--accent);
      font-weight: 700;
    }

    footer {
      padding-block: 0 3rem;
      color: var(--muted);
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --canvas: #0d1118;
        --surface: #151b24;
        --surface-muted: #1b2430;
        --text: #edf2f7;
        --muted: #a8b3c2;
        --border: #334154;
        --accent: #9ab0ff;
        --accent-strong: #c1ceff;
        --success: #6ed2a5;
        --shadow: 0 1rem 3rem rgb(0 0 0 / 0.22);
      }
    }

    @media (forced-colors: active) {
      .card,
      .notice,
      .client-grid article,
      pre {
        border-color: CanvasText;
      }
    }
  </style>
</head>
<body>
  <header>
    <p class="eyebrow">DeepTrace MCP</p>
    <h1>Connect pool research to your AI</h1>
    <p class="lede">One remote server gives Claude Code, OpenCode, or Codex read-only Graph metrics with separate Nuthatch freshness evidence.</p>
  </header>
  <main>
    <aside class="notice" aria-labelledby="connection-note">
      <h2 id="connection-note"><strong>Public connection.</strong> No Tailscale required.</h2>
      <p>Your AI connects only to <code>https://mcp.ikodo.dev</code>. DeepTrace reaches the subgraphs and Nuthatch on the server.</p>
    </aside>

    <section class="card" aria-labelledby="before-heading">
      <h2 id="before-heading">Before you connect</h2>
      <ol class="steps">
        <li>Ask the DeepTrace maintainer for a bearer token through a secure channel.</li>
        <li>Store it in <code>DEEPTRACE_TOKEN</code>; never place it in a URL, prompt, repository, or support log.</li>
        <li>Add the configuration for your client, launch it from the same shell, and verify <code>deeptrace</code> is connected.</li>
      </ol>
      <pre tabindex="0"><code>read -rsp "DeepTrace token: " DEEPTRACE_TOKEN
export DEEPTRACE_TOKEN</code></pre>
    </section>

    <section class="card" aria-labelledby="clients-heading">
      <h2 id="clients-heading">Choose your AI client</h2>
      <div class="client-grid">
        <article>
          <h3>Claude Code</h3>
          <p>Save as project-level <code>.mcp.json</code>, then run <code>claude mcp list</code>.</p>
          <pre tabindex="0"><code>{
  "mcpServers": {
    "deeptrace": {
      "type": "http",
      "url": "https://mcp.ikodo.dev",
      "headers": {
        "Authorization": "Bearer \${DEEPTRACE_TOKEN}"
      },
      "alwaysLoad": true
    }
  }
}</code></pre>
        </article>
        <article>
          <h3>OpenCode</h3>
          <p>Save in <code>~/.config/opencode/opencode.json</code>, then run <code>opencode mcp list</code>.</p>
          <pre tabindex="0"><code>{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "deeptrace": {
      "type": "remote",
      "url": "https://mcp.ikodo.dev",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:DEEPTRACE_TOKEN}"
      }
    }
  }
}</code></pre>
        </article>
        <article>
          <h3>Codex</h3>
          <p>Add to <code>~/.codex/config.toml</code>, then run <code>codex mcp list</code>.</p>
          <pre tabindex="0"><code>[mcp_servers.deeptrace]
url = "https://mcp.ikodo.dev"
bearer_token_env_var = "DEEPTRACE_TOKEN"</code></pre>
        </article>
      </div>
    </section>

    <section class="card" aria-labelledby="try-heading">
      <h2 id="try-heading">Try a pool comparison</h2>
      <p>After the client reports that <code>deeptrace</code> is connected, ask:</p>
      <pre tabindex="0"><code>Compare Base WETH/USDC pools over the last 24 hours by volume.
Tell me which sources answered, whether Nuthatch is fresh, and show any warnings.</code></pre>
      <p>A <code>partial</code> result can still contain useful evidence. Read its coverage, freshness, warnings, and provenance before relying on the ranking.</p>
    </section>

    <section class="card" aria-labelledby="skill-heading">
      <h2 id="skill-heading">Optional Agent Skill</h2>
      <p>The MCP server works without a skill: all three clients discover the <code>compare_pools</code> tool and its safety guidance automatically.</p>
      <details>
        <summary>What does SKILL.md add?</summary>
        <p>Install <code>skills/deeptrace-pool-research/SKILL.md</code> separately in clients that support Agent Skills. It teaches the AI to preserve exact decimal strings, distinguish Graph metrics from Nuthatch freshness facts, and surface partial coverage. Connecting MCP does not automatically install or load this file.</p>
        <p><a href="https://github.com/ikodo0/deeptrace/tree/develop/skills/deeptrace-pool-research">View the DeepTrace Pool Research skill</a>.</p>
      </details>
    </section>
  </main>
  <footer>
    <p>Canonical MCP URL: <code>https://mcp.ikodo.dev</code>. The older <code>/mcp</code> path remains available only for existing client configurations. <a href="https://github.com/ikodo0/deeptrace/blob/develop/docs/connect.md">Read the full setup guide</a>.</p>
  </footer>
</body>
</html>
`;

function accepts(request: IncomingMessage, mediaType: string): boolean {
  return (
    request.headers.accept?.split(",").some((value) => {
      const [type, ...parameters] = value.split(";").map((part) => part.trim().toLowerCase());
      if (type !== mediaType) {
        return false;
      }
      const quality = parameters.find((parameter) => parameter.startsWith("q="));
      return quality === undefined || Number(quality.slice(2)) > 0;
    }) ?? false
  );
}

/**
 * Treat only a plain HTML GET as a setup-page visit. MCP clients that ask for
 * the event-stream media type must continue through the transport auth path.
 */
export function acceptsConnectionPage(request: IncomingMessage): boolean {
  return (
    request.method === "GET" &&
    accepts(request, "text/html") &&
    !accepts(request, "text/event-stream")
  );
}

export function respondConnectionPage(response: ServerResponse): void {
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    "content-language": "en",
    "content-type": "text/html; charset=utf-8",
  });
  response.end(CONNECTION_PAGE);
}
