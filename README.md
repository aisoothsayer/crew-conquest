# Crew Conquest

A Twitch-connected strategy game for AI Soothsayer's crew, adapted from OpenFront. Danny hosts; Twitch viewers join with their names and profile pictures. Modes include host-placed solo bots, viewer-placed autonomous factions, and active multiplayer.

This is public beta `CREW-20261012-11`, hosted at https://danny-crew-conquest.onrender.com/crew.html. Danny hosts; signed-in viewers join. Free-host capacity remains limited and unproven for a full audience.

## Source layout

- `game/`: modified OpenFront source, resources, tests and dependency lockfile.
- `crew-runtime/`: Twitch identity, invite gate and HTTP/WebSocket gateway.
- `Dockerfile`: Node 24 build and single-port runtime.

See [hosting instructions](crew-runtime/HOSTING.md) for build commands, private environment setup and deployment checks. Configure the existing dedicated Danny Crew Strategy Twitch application privately; never commit its credentials.

The container builds the client and corresponding source download. Generated assets, archives, installed dependencies and private configuration are excluded from Git.

## Attribution and licenses

Retain [game LICENSE](game/LICENSE), [asset license](game/LICENSE-ASSETS), [credits](game/CREDITS.md), [licensing details](game/LICENSING.md), [Crew asset notice](game/resources/CREW-ASSETS.md) and [third-party notices](game/resources/public/crew-notices.txt). Original proprietary assets are excluded. The original upstream project is [OpenFront](https://github.com/openfrontio/OpenFrontIO).

Linux/container deployment and a two-account Twitch rehearsal have passed. Full audience capacity and durable server replay storage remain pending. No paid plan or reward/wallet integration is enabled by this source.
