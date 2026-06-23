# OpenClaw Installation

OpenClaw is the agent host that runs alongside this MCP server. The basket tools work without any checkout credentials — only the `create-order`, `check-order`, and `get-usd-balance` tools require Crossmint API keys and wallet configuration.

## 1. Prerequisites

```bash
# Node.js 20+ required
node --version
# OpenClaw installed and in PATH
openclaw --version
```

## 2. Clone and Build

```bash
git clone https://github.com/gordo-labs/mcp-crossmint-checkout.git
cd mcp-crossmint-checkout
npm install
npm run build
```

Keep the repository in a stable location. The MCP configuration below uses an absolute build path.

## 3. Register the MCP Server

Use `openclaw mcp set` with an absolute path to the compiled entrypoint. The MCP server communicates over stdio — no port needed for the MCP process itself.

```bash
openclaw mcp set crossmint-checkout '{
  "command": "node",
  "args": ["/absolute/path/to/mcp-crossmint-checkout/build/index.js"],
  "env": {
    "CROSSMINT_BASKET_PORT": "4377",
    "CROSSMINT_BASKET_STORE_PATH": "/absolute/path/to/mcp-crossmint-checkout/.crossmint-agent-basket/basket.json"
  }
}'
```

### With Crossmint Checkout (optional)

To enable real purchases through Crossmint, add the required environment variables:

```bash
openclaw mcp set crossmint-checkout '{
  "command": "node",
  "args": ["/absolute/path/to/mcp-crossmint-checkout/build/index.js"],
  "env": {
    "CROSSMINT_API_KEY": "your-crossmint-api-key",
    "AGENT_WALLET_ADDRESS": "0x...",
    "RECIPIENT_EMAIL": "user@example.com",
    "RECIPIENT_NAME": "Jane Doe",
    "RECIPIENT_ADDRESS_LINE1": "123 Main St",
    "RECIPIENT_CITY": "New York",
    "RECIPIENT_STATE": "NY",
    "RECIPIENT_POSTAL_CODE": "10001",
    "RECIPIENT_COUNTRY": "US",
    "CROSSMINT_BASKET_PORT": "4377",
    "CROSSMINT_BASKET_STORE_PATH": "/absolute/path/to/mcp-crossmint-checkout/.crossmint-agent-basket/basket.json",
    "CROSSMINT_BASKET_PUBLIC_HOST": "http://127.0.0.1:4377"
  }
}'
```

### Verify

```bash
openclaw mcp show crossmint-checkout
```

Restart OpenClaw for changes to take effect. The agent will discover the basket and checkout tools automatically on the next turn.

## 4. Start the Basket Viewer

The viewer is a separate process that exposes a local HTTP API and an inspection UI on `http://127.0.0.1:4377`.

```bash
npm run basket-viewer
```

Run this in a terminal session or background process:

```bash
nohup npm run basket-viewer > /tmp/basket-viewer.log 2>&1 &
```

Verify it is up:

```bash
curl http://127.0.0.1:4377/health
# {"ok": true, "viewerUrl": "http://127.0.0.1:4377", ...}
```

The viewer reads `CROSSMINT_BASKET_STORE_PATH` from the environment. If not set, it falls back to `.crossmint-agent-basket/basket.json` in the current working directory. Make sure both the MCP server and the viewer use **the same absolute path**.

## 5. Smoke Test

Ask the agent to research a product:

> "Find me a good mechanical keyboard under $150 on Amazon."

Confirm that:
- The agent calls `basket-set-context` and `basket-upsert-product`
- Products appear in the viewer at `http://127.0.0.1:4377`
- `basket-list-products` returns the candidates

Then, with Crossmint credentials configured:

> "Buy the first candidate."

This triggers `create-order` which will only succeed when the Crossmint env vars are set.

## Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `CROSSMINT_BASKET_PORT` | No | `4377` | Viewer HTTP port |
| `CROSSMINT_BASKET_STORE_PATH` | No | `.crossmint-agent-basket/basket.json` | Absolute path to shared basket JSON |
| `CROSSMINT_BASKET_PUBLIC_HOST` | No | `http://127.0.0.1:4377` | Viewer URL returned to agent |
| `CROSSMINT_API_KEY` | For checkout | — | Crossmint server-side API key |
| `AGENT_WALLET_ADDRESS` | For checkout | — | Agent wallet address |
| `RECIPIENT_*` | For checkout | — | Shipping/delivery details |
| `ENVIRONMENT` | For checkout | `test` | `test` or `prod` |

## Without Crossmint

The basket tools work entirely without Crossmint credentials. The agent can research, compare, and shortlist products using only the basket MCP tools. You can skip steps that mention API keys and wallet addresses — the viewer and basket persist locally without any external service.
