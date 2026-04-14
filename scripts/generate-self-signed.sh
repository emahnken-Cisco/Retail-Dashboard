#!/usr/bin/env bash
# Generate a self-signed TLS certificate for lab / internal use.
# Usage: ./scripts/generate-self-signed.sh [output-dir]
# Requires: openssl
set -euo pipefail
OUT_DIR="${1:-./certs}"
mkdir -p "$OUT_DIR"
BASE="$OUT_DIR/retail-dashboard"
openssl req -x509 -newkey rsa:4096 -keyout "${BASE}.key" -out "${BASE}.crt" -days 825 -nodes \
  -subj "/CN=retail-dashboard.local/O=Retail Dashboard/C=US"
chmod 600 "${BASE}.key"
echo "Created:"
echo "  ${BASE}.crt"
echo "  ${BASE}.key"
echo "Set in .env: TLS_CERT_PATH=$(pwd)/${BASE}.crt  TLS_KEY_PATH=$(pwd)/${BASE}.key  HTTPS_ENABLED=true"
echo "Then restart the Node server (or place behind nginx/Caddy with these files)."
