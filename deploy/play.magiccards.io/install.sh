#!/bin/sh
# Run this on the Contabo VPS as root. It starts the Phase lobby on localhost:9374.
# DNS: play.magiccards.io  A  -> this machine's public IP.
# Then add the site block in Caddyfile (see Caddyfile in this folder) and reload Caddy.
set -eu
docker volume create phase-server-data
docker rm -f phase-server >/dev/null 2>&1 || true
docker pull ghcr.io/phase-rs/phase-server:latest
docker run -d \
  --name phase-server \
  --restart unless-stopped \
  -p 127.0.0.1:9374:9374 \
  -v phase-server-data:/var/lib/phase-server \
  -e PHASE_LOBBY_ONLY=true \
  -e PHASE_CORS_ORIGIN='*' \
  ghcr.io/phase-rs/phase-server:latest
echo "lobby listening on 127.0.0.1:9374 — public address is wss://play.magiccards.io/ws"
