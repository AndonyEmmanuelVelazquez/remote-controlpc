# Remote Control PC — from Android, free, P2P

Control your Windows PC (screen + mouse + keyboard) from an Android phone over the
internet. Video and input flow **directly peer-to-peer** over WebRTC (DTLS-encrypted);
the only server is a tiny Cloudflare Worker that relays the one-time connection
handshake. **$0/month** for the common case.

## Documentation

- **[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** — new here? Start-to-finish
  install & run guide (clone → deploy → connect).
- **[SECURITY.md](SECURITY.md)** — trust model. *Read before exposing a PC.* Answers
  "can anyone access my PC without the code?"
- **[PLAN.md](PLAN.md)** — full architecture & design decisions.
- **[CHANGELOG.md](CHANGELOG.md)** — version history.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — repo layout, build/test per package.

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
npx wrangler pages deploy dist --project-name <your-project>
```

Open the resulting `*.pages.dev` URL in **Android Chrome** → tap **⬇ Install app** (or
menu → "Install app" / "Add to Home screen") to install it standalone.

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

> Prefer a double-clickable app or a Setup.exe instead of `npm start`? See
> [packaging](docs/GETTING_STARTED.md#packaging-the-agent-as-a-desktop-app-optional)
> (`npm run pack` / `npm run dist`).

### 4. Connect

1. On the phone, open the controller PWA, type the pairing code, tap **Connect**.
2. On the PC, click **Allow** when prompted. Screen sharing + control begin.

### Touch controls (modeled on Chrome Remote Desktop / Microsoft Remote Desktop)

| Gesture | Action |
|---------|--------|
| Tap | Left click |
| Two-finger tap | Right click |
| One-finger drag | Drag (press-and-move) |
| Two-finger drag (at 1×) | Scroll wheel |
| Pinch | Zoom the view 1×–4× (focal point under fingers) |
| Two-finger drag (zoomed in) | Pan the view |
| **Zoom** button | Cycle 100→200→300→100% · **Reset view** clears zoom |
| **⌨ Keys** | Open keyboard / type |

**Mode** toggle:
- **Direct** (default) — tap where you want to click (absolute). Fast.
- **Trackpad** — drag a virtual cursor (the blue ring) like a laptop trackpad; tap =
  click, double-tap-then-hold-drag = drag. Pixel-precise, no fingertip occlusion — use
  it for small targets. Combine with pinch-zoom for the tightest precision.

### Remember this device (skip the Allow prompt)

The phone has a persistent device ID (stored in its browser). On the PC, the approval
prompt offers **Allow once** or **Always allow**:

- **Always allow** records that device ID in `trusted.json` under the agent's userData
  folder. Next time that phone connects, the agent **auto-approves** — no prompt.
- The PC's pairing code is **persisted** (`code.json`), so the phone remembers it too
  and you don't retype it. Net result after the first pairing: open the PWA → Connect →
  you're in, hands-free.
- This relies on the phone's device ID, which travels via signaling. A stranger who
  guesses the code still can't drive the PC: an **unknown** device always triggers the
  manual prompt, which only you can approve at the keyboard.
- Reset trust: delete `trusted.json` in the agent's userData folder (or call the agent's
  `forget-devices`).

### Install on the phone (PWA)

Open the controller URL in Android Chrome → tap **⬇ Install app** (or browser menu →
"Install app" / "Add to Home screen"). It installs standalone (its own icon, fullscreen,
no browser chrome). Icons + manifest are served from `android-web/public`.

---

## Configuration

| Where | Var | Purpose |
|-------|-----|---------|
| pc-agent | `SIGNALING_URL` | WebSocket base of the Worker (default `ws://127.0.0.1:8787`) |
| android-web (build) | `VITE_SIGNALING_URL` | default signaling URL baked into the PWA |
| android-web (runtime) | "Signaling server" field | overrides the baked URL; remembered in localStorage |

## Security

- All P2P traffic is DTLS-SRTP encrypted end-to-end. The Worker only ever sees opaque SDP.
- The PC agent injects input **only after approval**, and only while a controller is
  connected (`armed` gate in the main process).
- An **unknown** device always triggers the manual Allow prompt; a guessed pairing code
  alone cannot drive the PC. "Always allow" remembers a device (`trusted.json`).
- This grants **full control of your PC**. Run the agent only when you intend to.

**Full model, residual risks, and how to reset trust: [SECURITY.md](SECURITY.md).**

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

## License

[MIT](LICENSE) © Andony Velazquez.
