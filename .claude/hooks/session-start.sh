#!/bin/bash
set -euo pipefail

# Only run in remote Claude Code sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "[session-start] Installing dependencies..."

# Install API deps
if [ -f "$CLAUDE_PROJECT_DIR/api/package.json" ]; then
  echo "[session-start] Installing api/ dependencies..."
  npm install --prefix "$CLAUDE_PROJECT_DIR/api" --silent
fi

# Install web deps
if [ -f "$CLAUDE_PROJECT_DIR/web/package.json" ]; then
  echo "[session-start] Installing web/ dependencies..."
  npm install --prefix "$CLAUDE_PROJECT_DIR/web" --silent
fi

# Azure CLI auth — use service principal if env vars are available
if [ -n "${AZURE_CLIENT_ID:-}" ] && [ -n "${AZURE_CLIENT_SECRET:-}" ] && [ -n "${AZURE_TENANT_ID:-}" ]; then
  echo "[session-start] Logging in to Azure via service principal..."
  az login --service-principal \
    -u "$AZURE_CLIENT_ID" \
    -p "$AZURE_CLIENT_SECRET" \
    --tenant "$AZURE_TENANT_ID" \
    --output none

  if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
    az account set --subscription "$AZURE_SUBSCRIPTION_ID"
  fi

  echo "[session-start] Azure login complete."
else
  echo "[session-start] AZURE_CLIENT_ID not set — skipping Azure auth (run 'az login --use-device-code' manually if needed)."
fi

# Export storage connection string if available
if [ -n "${AZURE_STORAGE_CONNECTION_STRING:-}" ]; then
  echo "export AZURE_STORAGE_CONNECTION_STRING='${AZURE_STORAGE_CONNECTION_STRING}'" >> "$CLAUDE_ENV_FILE"
fi

echo "[session-start] Done."
