# Website admin / Crew control window

Open `/host-control` as a top-level child window. It authenticates using the existing Crew Twitch session, not the website's cookie. Signed-in viewers cannot control rooms. No new secrets, scopes or plan settings are required.

Allowed parents: `https://dannyisstuckonline.com` and `https://ai-soothsayer.aisoothsayer.chatgpt.site`. Only messages from `window.opener` are accepted. The first valid message must be `status`; it binds that parent origin and nonce until the window reloads.

Request envelope:

```json
{"channel":"danny-game-control","version":1,"game":"crew","nonce":"UUID","id":"UUID","action":"status","roomId":null,"mode":"active"}
```

`action` is `status`, `open`, `start` or `end`. UUID nonce/id required; mode is `active` or `viewer-bots` on every message. `roomId` is null for initial status/open or the last reported room ID. Start/end require the expected current ID. Reuse the id only for an identical retry. An End confirmation is the parent UI's responsibility; standalone child controls also confirm End.

Reply echoes channel/version/game/nonce/id and contains `ok`, optional `error` and:

```json
{"signedIn":true,"canHost":true,"room":{"id":"Abcd1234","phase":"lobby","players":1,"ready":1,"canStart":true,"lobbyUrl":"https://danny-crew-conquest.onrender.com/w0/game/Abcd1234?lobby"}}
```

Room is null when absent. Phases: lobby, countdown, live. Parent must validate exact child origin/source/nonce and bound the lobby URL to that origin and room route. No tokens or CSRF values appear in replies. Refresh/reopen the child after a parent reload if its prior nonce is no longer known.

The child uses same-origin GET `/crew-api/host-control/status` and POST `/crew-api/host-control/control`. POST has `{action,roomId,mode,requestId}` and session CSRF header; server requires configured origin and freshly validated host identity. Commands serialize and cache recent request IDs. Worker routes verify the signed Crew-host ticket and stable creator ownership independently.

Open returns an existing owned room; it does not replace a running one. New rooms use USA and ordinary game defaults; bot mode starts clean with only selected factions. Configure/place in the lobby. Start reuses roster/point guards, never auto-places and never cancels the countdown on retry. End rejects stale room IDs and closes without winner settlement, including later game-manager cleanup. Host sign-in remains valid after End. Solo, observer permissions and existing gameplay controls remain intact.

Local fixtures and tests are required before release. Do not create/start/end a production room for QA without an explicit rehearsal instruction. Check public room state immediately before a deployment; a service restart clears in-memory sessions and matches.
