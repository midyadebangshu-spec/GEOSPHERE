# Cloudflare Tunnel for GeoSphere

## Option A: Quick share (no DNS setup)
1. Start app stack:
   - `./start_all.sh`
2. Start quick tunnel:
   - `./start_tunnel_quick.sh`
3. Share the generated `https://*.trycloudflare.com` URL.

## Option B: Stable custom domain (recommended)
1. Install `cloudflared` and login:
   - `cloudflared tunnel login`
2. Create tunnel:
   - `cloudflared tunnel create geosphere`
3. Copy template and fill values:
   - `cp cloudflared/config.example.yml ~/.cloudflared/config.yml`
   - Replace `<TUNNEL-UUID>` and `<HOSTNAME>`.
4. Route DNS:
   - `cloudflared tunnel route dns geosphere <HOSTNAME>`
5. Run tunnel:
   - `cloudflared tunnel run geosphere`

## Notes
- This project serves frontend + API on `http://localhost:4000`, so only one tunnel origin is required.
- Keep `start_all.sh` running services first.
- If your host sleeps, tunnel disconnects.
