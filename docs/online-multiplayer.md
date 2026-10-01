# Online 1v1

Private invite-code matches for Arena. There is no matchmaking, account, or ranking. One server process keeps every room in memory. Restarting that process ends every match.

## Two computers

1. Build and start the server: `npm run build && npm run build:server && npm run start:online`
2. Open the printed URL on each computer. The page and the socket stay on that same origin.
3. One player chooses **Online 1v1**, then **Create a room**.
4. Send the 8-character code, or the invite link, to the other player.
5. The other player chooses **Online 1v1** and joins. The host picks the arena and items. Each player picks a fighter. Both press **Ready**.

Both people use Player 1 keys (WASD, V, B, N, M) or their first controller. The match does not pause when you press Esc. That menu is local: your fighter holds still until you return. **Forfeit** gives the other player the win. A dropped connection stops the round and names no winner. The seat can be resumed for about 10 seconds, and the round starts over from the lobby.

## Two browsers on one Windows PC

Run `npm run dev:online`. That starts the game on port 5173 and the room relay on port 8787. Vite proxies `/ws` to the relay.

Open `http://127.0.0.1:5173/` in two profiles, or one normal window and one private window. Create a room in the first and join from the second. A normal local match, the CPU, arcade, and training stay on **Enter the arena** and do not use the network.

## Production

`npm run build:server` writes `dist-server/`. `npm start:online` serves the built game and the socket from one port (`PORT`, default 8787). Put TLS in front of that port if players connect over the public internet. The browser then uses `wss` on the same host. Do not run a second copy of the server behind a load balancer: rooms are not shared between processes.

On Fly.io, `fly.toml` holds the settings. Deploy with `fly deploy --ha=false` so only one machine runs. Fly handles TLS, and a machine with no players stops and wakes on the next visit. `TRUST_PROXY=fly` makes the per-address limits read Fly's `Fly-Client-IP` header. Do not set it anywhere else, because there a client could send that header itself.

`ALLOWED_ORIGINS` is an optional comma-separated list. Browsers on the same host, and on localhost, are accepted either way. `BASE_PATH` prefixes both the site and the `/ws` route. `ROOM_TTL_MS` and `REJOIN_GRACE_MS` change how long an idle lobby and a dropped seat last.

The portable `PLAY.html` build never opens a socket. Its content security policy keeps `connect-src 'none'`. Online play is hidden there. A hosted link appears only when `VITE_PUBLIC_GAME_URL` is an `http` or `https` address set at build time.

## Match sync

Both players step the same Arena simulation at 60 Hz. Input delay is 2 frames. Each client may predict up to 8 frames ahead and keeps about 180 snapshots so it can roll back. Frame F is the input applied by the step that advances the tick from F to F+1. The snapshot at F is the state before that input. Hits, sounds, and the winner come only from frames both sides have confirmed, and each of those plays once. Pressing Esc opens a menu on your screen only. The fight keeps going, and your fighter holds still.

Each client sends a checksum of its confirmed state on every 30th frame, so both sides check the same frames twice a second. If the confirmed checksums disagree, or one client falls more than 3 seconds behind, the round stops and names no winner. A dropped connection does the same, then holds the seat for about 10 seconds. Rejoining starts a fresh round from the lobby. Forfeit is a separate action and names the other player the winner.

## Limits the server enforces

Each connection may send 150 messages a second. A playing client sends one input batch per rendered frame that has new input (about 60 a second), a checksum every 30 frames and a heartbeat ping every 5 seconds, so it stays well under that. Keep it that way: an input batch the server refuses is never resent, and the match stalls. The server also pings every socket every 10 seconds and closes one that did not answer the previous ping, so a connection that died without closing (Wi-Fi drop, sleeping laptop) becomes a normal disconnect and the player can resume their seat. Room creation and joining are limited per address, and a message may be at most 8 KB.

## What is checked

Checksums compare confirmed simulation frames. The digest is a 64-bit FNV-1a hash of canonical JSON. It was checked with Node and Chromium. It is not a cryptographic signature, and other JavaScript engines were not compared.

`npm run test:online` covers the snapshot round trip, the rollback session (including the checksum schedule), the room rules, a client sending at full rate, and the static file server (a malformed address answers 400 and nothing outside the game folder is served). `npm run test:online:e2e` drives two browsers through create, join, ready, a match, forfeit and rematch, rejects a bad code and a third player, checks a disconnect, and plays a 15-second exchange with real key presses that must stay confirmed, in sync and uninterrupted. Pass `SVS_EVIDENCE=1` to that command to refresh the screenshots in `docs/evidence/online/`.

Package version 1.1.0 is not the compatibility check. Clients also exchange a fingerprint of the fighter tables, stage geometry, protocol version, input delay, and prediction window.
