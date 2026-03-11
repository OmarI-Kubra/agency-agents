#!/usr/bin/env bash
#
# setup-cursor-mcp.sh -- Build the Agency MCP server and register it in Cursor.
#
# After cloning the repo, run this once:
#   ./scripts/setup-cursor-mcp.sh
#
# What it does:
#   1. Installs npm dependencies in mcp-server/
#   2. Compiles TypeScript to dist/
#   3. Adds "agency-agents" to ~/.cursor/mcp.json (global Cursor MCP config)
#
# Requirements: Node.js >= 18, npm

set -euo pipefail

# ---------------------------------------------------------------------------
# Colours
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_GREEN=$'\033[0;32m'
  C_YELLOW=$'\033[1;33m'
  C_RED=$'\033[0;31m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RESET=$'\033[0m'
else
  C_GREEN='' C_YELLOW='' C_RED='' C_BOLD='' C_DIM='' C_RESET=''
fi

ok()   { printf "${C_GREEN}[OK]${C_RESET}  %s\n" "$*"; }
warn() { printf "${C_YELLOW}[!!]${C_RESET}  %s\n" "$*"; }
err()  { printf "${C_RED}[ERR]${C_RESET} %s\n" "$*" >&2; }
step() { printf "\n${C_BOLD}→ %s${C_RESET}\n" "$*"; }

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_DIR="$REPO_ROOT/mcp-server"
DIST_ENTRY="$MCP_DIR/dist/index.js"
CURSOR_MCP_JSON="${HOME}/.cursor/mcp.json"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
step "Checking prerequisites"

if ! command -v node >/dev/null 2>&1; then
  err "Node.js is required but not found. Install it from https://nodejs.org"
  exit 1
fi

NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 18 )); then
  err "Node.js >= 18 required (found v$(node -v)). Please upgrade."
  exit 1
fi
ok "Node.js $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  err "npm is required but not found."
  exit 1
fi
ok "npm $(npm -v)"

if [[ ! -f "$MCP_DIR/package.json" ]]; then
  err "mcp-server/package.json not found. Are you running from the repo root?"
  exit 1
fi
ok "Repository: $REPO_ROOT"

# ---------------------------------------------------------------------------
# Step 1: Install dependencies
# ---------------------------------------------------------------------------
step "Installing dependencies"

cd "$MCP_DIR"
npm install --no-fund --no-audit 2>&1 | tail -1
ok "Dependencies installed"

# ---------------------------------------------------------------------------
# Step 2: Build TypeScript
# ---------------------------------------------------------------------------
step "Building MCP server"

npm run build
ok "Built: $DIST_ENTRY"

# ---------------------------------------------------------------------------
# Step 3: Verify the server starts
# ---------------------------------------------------------------------------
step "Verifying server"

INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
RESPONSE="$(echo "$INIT" | node "$DIST_ENTRY" 2>/dev/null | head -1)"

if echo "$RESPONSE" | grep -q '"agency-agents"'; then
  ok "Server responds correctly"
else
  err "Server did not respond as expected. Output:"
  echo "  $RESPONSE"
  exit 1
fi

# ---------------------------------------------------------------------------
# Step 4: Register in Cursor global MCP config
# ---------------------------------------------------------------------------
step "Configuring Cursor"

mkdir -p "$(dirname "$CURSOR_MCP_JSON")"

SERVER_ENTRY=$(cat <<ENTRY_EOF
{
  "command": "node",
  "args": ["$DIST_ENTRY"]
}
ENTRY_EOF
)

if [[ ! -f "$CURSOR_MCP_JSON" ]]; then
  # No config yet -- create one
  cat > "$CURSOR_MCP_JSON" <<EOF
{
  "mcpServers": {
    "agency-agents": $SERVER_ENTRY
  }
}
EOF
  ok "Created $CURSOR_MCP_JSON"

elif ! command -v python3 >/dev/null 2>&1; then
  # No python3 for JSON manipulation -- give manual instructions
  warn "python3 not found; cannot auto-update mcp.json."
  echo ""
  echo "  Add this to ${C_BOLD}${CURSOR_MCP_JSON}${C_RESET} under \"mcpServers\":"
  echo ""
  echo "    \"agency-agents\": $SERVER_ENTRY"
  echo ""

else
  # Merge into existing config
  python3 - "$CURSOR_MCP_JSON" "$DIST_ENTRY" <<'PYEOF'
import json, sys

config_path = sys.argv[1]
dist_entry  = sys.argv[2]

with open(config_path, "r") as f:
    config = json.load(f)

if "mcpServers" not in config:
    config["mcpServers"] = {}

config["mcpServers"]["agency-agents"] = {
    "command": "node",
    "args": [dist_entry]
}

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PYEOF

  ok "Updated $CURSOR_MCP_JSON"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "  +------------------------------------------------+"
printf "  | ${C_GREEN}${C_BOLD}  The Agency MCP — installed for Cursor!       ${C_RESET} |\n"
echo "  +------------------------------------------------+"
echo ""
echo "  ${C_DIM}Restart Cursor (or reload the window) to activate.${C_RESET}"
echo ""
echo "  ${C_BOLD}Try it out:${C_RESET}"
echo "    \"List all engineering agents\""
echo "    \"Use the frontend-developer agent to review my code\""
echo "    \"Search for agents related to security\""
echo ""
