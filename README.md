# Crew Conquest

A Twitch-connected strategy game for AI Soothsayer's crew, adapted from OpenFront. Danny hosts; Twitch viewers join with their names and profile pictures. Modes include host-placed solo bots, viewer-placed autonomous factions, and active multiplayer.

This is release candidate `CREW-20261012-9`. The game remains a local beta until its Linux build, public hosting and remote Twitch sign-in tests pass.

## Source layout

- `game/`: modified OpenFront source, resources, tests and dependency lockfile.
- `crew-runtime/`: Twitch identity, invite gate and HTTP/WebSocket gateway.
- `Dockerfile`: Node 24 build and single-port runtime.

See [hosting instructions](crew-runtime/HOSTING.md) for build commands, private environment setup and deployment checks. Configure the existing dedicated Danny Crew Strategy Twitch application privately; never commit its credentials.

The container builds the client and corresponding source download. Generated assets, archives, installed dependencies and private configuration are excluded from Git.

## Attribution and licenses

Retain [game LICENSE](game/LICENSE), [asset license](game/LICENSE-ASSETS), [credits](game/CREDITS.md), [licensing details](game/LICENSING.md), [Crew asset notice](game/resources/CREW-ASSETS.md) and [third-party notices](game/resources/public/crew-notices.txt). Original proprietary assets are excluded. The original upstream project is [OpenFront](https://github.com/openfrontio/OpenFrontIO).

Public hosting capacity, Linux/container execution and multi-device verification remain pending. No paid plan or reward/wallet integration is enabled by this source.
