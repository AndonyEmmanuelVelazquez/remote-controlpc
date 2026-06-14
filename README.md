# Remote Control PC — from Android, free, P2P

Control your Windows PC (screen + mouse + keyboard) from an Android phone over the
internet. Video and input flow **directly peer-to-peer** over WebRTC (DTLS-encrypted);
the only server is a tiny Cloudflare Worker that relays the one-time connection
handshake. **$0/month** for the common case. See [PLAN.md](PLAN.md) for the full design.

```
PC Agent (Electron) ──┐                                ┌── Android (web PWA)
  screen + nut.js     │   Cloudflare Worker + DO       │   video + touch/keys
                      ├──►  signaling (handshake only) ◄┤
                      │                                │
                      └════ WebRTC P2P, encrypted ═════┘
                            (STUN: Google, free)
```

## Repo layout

| Folder | What |
|--------|------|
| [signaling/](signaling/) | Cloudflare Worker + Durable Object. Pairs peers by 6-digit code, relays SDP/ICE, then gets out of the way. |
| [pc-agent/](pc-agent/) | Electron host (Windows). Captures the screen via Chromium, injects mouse/keyboard via `nut.js`. Requires you click **Allow** before any control. |
| [android-web/](android-web/) | Controller PWA. Renders the screen, sends touch/keyboard. Deploys to Cloudflare Pages. Zero install. |
| [shared/](shared/) | Shared TypeScript message types + signaling client. |
| [e2e/](e2e/) | Headless WebRTC handshake test (proves the full path). |

## Prerequisites

- Node.js 20+ (tested on 26), npm
- A Cloudflare account (free) + `wrangler` (bundled as a dev dep)
- Windows for the PC agent (input injection uses Windows APIs via nut.js)

---

## Quick local test (no deploy, two browser tabs)

Validates the whole pipeline on one machine.

```bash
# 1. signaling
cd signaling && npm install && npm run dev      # -> http://127.0.0.1:8787

# 2. headless end-to-end handshake test (separate terminal)
cd e2e && npm install && npm test               # expect 4x PASS
```

For an interactive test, run the controller dev server and the PC agent against the
local signaling (`ws://127.0.0.1:8787`) — see below.

---

## Run for real

### 1. Deploy the signaling Worker

```bash
cd signaling
npx wrangler login          # one time
npm run deploy
```

Note the deployed URL, e.g. `https://remote-control-signaling.<your-sub>.workers.dev`.
Its WebSocket URL is the same host with `wss://`.

### 2. Deploy the Android controller (Cloudflare Pages)

```bash
cd android-web
# bake in the signaling URL (or paste it in the app's "Signaling server" box at runtime)
VITE_SIGNALING_URL="wss://remote-control-signaling.<your-sub>.workers.dev" npm run build
npx wrangler pages deploy dist --project-name pc-remote
```

Open the resulting `*.pages.dev` URL in **Android Chrome** → "Add to Home screen" to
install as a fullscreen app.

> On Windows PowerShell, set the env var first:
> `$env:VITE_SIGNALING_URL="wss://…workers.dev"; npm run build`

### 3. Run the PC agent

```bash
cd pc-agent
npm install
# point it at your deployed signaling Worker:
#   PowerShell:  $env:SIGNALING_URL="wss://…workers.dev"; npm start
#   bash:        SIGNALING_URL="wss://…workers.dev" npm start
npm start
```

The agent window shows a **6-digit pairing code**.

### 4. Connect

1. On the phone, open the controller PWA, type the pairing code, tap **Connect**.
2. On the PC, click **Allow** when prompted. Screen sharing + control begin.
3. Touch = move/click, drag = drag, **Scroll** toggle = wheel, **Right-click** toggle =
   next tap is a right click, **⌨ Keyboard** = type.

---

## Configuration

| Where | Var | Purpose |
|-------|-----|---------|
| pc-agent | `SIGNALING_URL` | WebSocket base of the Worker (default `ws://127.0.0.1:8787`) |
| android-web (build) | `VITE_SIGNALING_URL` | default signaling URL baked into the PWA |
| android-web (runtime) | "Signaling server" field | overrides the baked URL; remembered in localStorage |

## Security

- All P2P traffic is DTLS-SRTP encrypted end-to-end. The Worker only ever sees opaque SDP.
- The PC agent injects input **only after you click Allow**, and only while a controller
  is connected (`armed` gate in the main process).
- The pairing code is the gate — treat it like a password while a session is pending.
- This grants **full control of your PC**. Run the agent only when you intend to.

## Known limits

- **Symmetric NAT / CGNAT**: direct P2P can't always be punched. v1 is STUN-only; if your
  network needs it, add a TURN server to `ICE_SERVERS` in [shared/types.ts](shared/types.ts)
  (Cloudflare Realtime TURN has a free allotment, or self-host coturn).
- Input into **elevated (admin) windows** may require running the agent elevated.
- Android soft-keyboard key reporting varies; printable text uses `input` events, special
  keys/shortcuts use `keydown`.

## Verifying changes

- `signaling/`: `node test-relay.mjs` (relay unit test) + `e2e/ npm test` (full handshake).
- `pc-agent/` & `android-web/`: `npm run typecheck` then `npm run build`.
