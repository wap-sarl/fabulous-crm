#!/bin/sh
# Generate /srv/env.js from all VITE_* environment variables
{
  echo "window.__ENV__ = {"
  env | grep "^VITE_" | sort | while IFS='=' read -r key value; do
    escaped=$(printf '%s' "$value" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf '  "%s": "%s",\n' "$key" "$escaped"
  done
  echo "};"
} > /srv/env.js
# Start Caddy
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
