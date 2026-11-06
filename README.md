# Magic Cards

Skinned Magic table for [magiccards.io](https://magiccards.io). The page, logo, and ladder live here. The rules client is proxied from phase.rs.

## Deploy

Vercel project connected to this repo. Build command: `npm run build`. Node 22.

The ladder file `data/phase-ladder.json` does not persist on Vercel. Run the multiplayer lobby on the VPS:

```bash
docker volume create phase-server-data
docker run -d --name phase-server --restart unless-stopped \
  -p 127.0.0.1:9374:9374 \
  -v phase-server-data:/var/lib/phase-server \
  -e PHASE_LOBBY_ONLY=true \
  -e PHASE_CORS_ORIGIN=https://magiccards.io \
  ghcr.io/phase-rs/phase-server:latest
```

Point `play.magiccards.io` at the VPS and use `wss://play.magiccards.io/ws` as the custom server in Online.
