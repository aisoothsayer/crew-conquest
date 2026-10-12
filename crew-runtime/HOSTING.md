# Crew Conquest candidate — separate free-host rehearsal

Docker builds the frontend from extracted corresponding source and generates its source download inside the image. Git publication should include the extracted source/runtime/Dockerfile/.dockerignore, never the ZIPs, node_modules or compiled static directory. This Windows session has no Docker engine; Linux container execution must be verified by the separate host build. Local compiled-gateway tests are not a Linux-container certification.

Build CREW-20261012-9. Package layout: `game/` contains corresponding modified source, resources and compiled static build; `crew-runtime/` contains the Twitch identity service and single-port gateway; root Dockerfile copies these into a Node24 container. No private configuration, OAuth token, secret, certificate, installed dependency tree or original proprietary asset is included.

Public process: `node crew-runtime/start-hosted.cjs`. The hosting service exposes only `$PORT` (default10000). HTTP, lobby/game WebSockets and authentication use that same public HTTPS origin. Identity9120, master3000, worker3001 bind loopback. One worker is the beta default to reduce memory; this candidate supports at most two workers and is not a capacity certification.

Private host environment values required:

- `CREW_ORIGIN`: final exact HTTPS origin without trailing slash/path.
- `CREW_TWITCH_CLIENT_ID`, `CREW_TWITCH_CLIENT_SECRET`, `CREW_HOST_TWITCH_ID`: the existing dedicated Danny Crew Strategy application's configuration, privately entered by Danny in the new host's environment. Do not use website/Derby app keys.
- `PORT` is supplied by the host. `NUM_WORKERS=1` is the initial setting.

Register `<CREW_ORIGIN>/auth/callback` with that dedicated Twitch application before a real remote sign-in. The `/auth/login` route stores a validated relative lobby return destination in its browser-bound one-use state; signed-out direct room requests redirect before opening a socket. Lobby QR, room code and clickable/copy invitation encode the same room. Streamer hiding suppresses the visible code/link/QR.

Health endpoint `/health` checks master/lobby availability. Test public HTTPS, WSS, private-origin host/viewer admission, a real second device/account, reconnect, host-control denial, logout revocation, winner and rematch before replacing the site's pending card with a live link. Restarts discard in-memory sessions/lobbies; browsers sign back in. Free-host sleeping/restart behavior and CPU/RAM limits remain host constraints.

The backend uses the standalone development cluster configuration (with explicit Twitch-only admission, a fresh internal API key, no stock lobby coordinator/registry) under production Node runtime and compiled assets. This isolates the fork from the original OpenFront API. It is a beta release candidate, not the upstream fleet infrastructure.

Public source download: `/crew-source.zip` ships exact game/runtime source and asset notices for this candidate. Preserve LICENSE, LICENSE-ASSETS, CREDITS and Crew notices. CI/build source instructions: install Node24, `cd game`, `npm ci --ignore-scripts`, set `CREW_TWITCH_ONLY=true`, `CREW_BUILD_ID=CREW-20261012-9`, `GIT_COMMIT=CREW-20261012-9`, then `npm run build-prod`. Windows local launcher remains separately maintained in Danny HQ.

No paid plan, subscription, domain purchase or wallet/reward integration is approved by this package. Website Guy owns the website link and host coordination. Namazu Guy owns this candidate's game/identity source. Public service creation/configuration remains a separate concrete step; no successful remote deployment is claimed by local tests.
