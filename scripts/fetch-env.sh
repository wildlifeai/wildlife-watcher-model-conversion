#!/usr/bin/env bash
# Fetch the shared dev .env from Azure Key Vault (ww-kv-dev-ae, resource group WW-AE).
# Usage: bash scripts/fetch-env.sh [--force]
# Requires: az login (Entra ID account with vault access — see readme "Secrets & Access")
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f .env && "${1:-}" != "--force" ]]; then
  echo ".env already exists — rerun with --force to overwrite" >&2
  exit 1
fi
value="$(az keyvault secret show --vault-name ww-kv-dev-ae --name ww-website-dotenv --query value -o tsv)"
[[ -n "$value" ]] || { echo "empty secret or no access — check 'az login' and vault permissions" >&2; exit 1; }
printf '%s\n' "$value" > .env
echo ".env written ($(wc -c < .env) bytes) from ww-kv-dev-ae/ww-website-dotenv"
