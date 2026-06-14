# Free PC Remote Control from Android — Architecture Plan

Status: **APPROVED — v1 implemented.** Decisions D1–D5 accepted as recommended.
See [README.md](README.md) to run. Signaling + full WebRTC handshake verified by
automated tests; screen-capture + input injection ready for manual run on a PC.

---

## 1. Goal

Control a Windows PC (screen view + mouse + keyboard) from an Android phone, over the
internet, for **$0 recurring cost** in the common case.

- Live screen video PC → phone.
- Touch/keyboard input phone → PC.
- Direct peer-to-peer; control traffic never transits any server we pay for.
- Works across NATs without port-forwarding.

---

## 2. Why WebRTC (the core idea)

WebRTC opens a direct, encrypted P2P link between two devices behind home routers,
using free public **STUN** servers to discover each device's public IP:port. Once the
link is up, **all video + input flows directly phone ↔ PC** — nothing we host sees it.

The only thing that needs a server is the one-time **signaling handshake**: the two
peers must swap connection metadata (SDP offer/answer + ICE candidates) *before* the
direct link exists. That swap is tiny and bursty → perfect for Cloudflare Workers' free
tier.

Encryption is built in: WebRTC media is DTLS-SRTP, data channels are DTLS. The signaling
server only ever sees opaque SDP blobs, never screen content or keystrokes.

---

## 3. Architecture overview

```
                       ┌─────────────────────────────┐
                       │   Cloudflare (free tier)     │
                       │                              │
   ┌──────────┐  WS    │  Worker + Durable Object     │   WS   ┌──────────────┐
   │ PC Agent │◄──────►│  "signaling room"            │◄──────►│  Android Web │
   │ (Electron)│ SDP/ICE│  pair by 6-digit code        │SDP/ICE │  Controller  │
   └────┬─────┘        └─────────────────────────────┘        └──────┬───────┘
        │                                                            │
        │                  STUN (Google, free)                       │
        │           discover public IP:port for both                 │
        │                                                            │
        │════════════ WebRTC P2P (DTLS-SRTP, direct) ════════════════│
        │   video track:  PC screen ───────────────────► phone       │
        │   data channel: phone input ─────────────────► PC          │
        │                                                            │
        └──── TURN relay (ONLY if symmetric NAT — see §6) ───────────┘
```

Three pieces to build + two free external services (STUN, optional TURN).

---

## 4. Components

### 4.1 Signaling server — Cloudflare Worker + Durable Object
- **Job:** match two peers and relay SDP/ICE between them. Nothing else.
- **Durable Object** = one instance per "room" (keyed by pairing code). Holds the two
  WebSocket connections and forwards messages PC↔phone.
- **Pairing:** PC agent generates a short code (e.g. `483-921`), shows it on screen.
  Phone enters it → both join the same DO → handshake relayed.
- **Lifecycle:** room dies after handshake completes (or short TTL). Stateless otherwise.
- **Cost:** handshake is a few KB, a few messages. Free tier (100k req/day) ≈ never hit.

### 4.2 PC Agent — Electron desktop app (Windows)
Why Electron: bundles Chromium (full WebRTC `RTCPeerConnection` + `getDisplayMedia`
screen capture, hardware video encode) **and** Node.js (native input injection) in one
process. No separate native WebRTC stack to maintain.
- **Screen capture:** Chromium `desktopCapturer` / `getDisplayMedia` → WebRTC video track.
- **Input injection:** [`nut.js`](https://nutjs.dev) in the main process — moves mouse,
  clicks, types, key combos. (robotjs is unmaintained; nut.js is the live successor.)
- **Renderer ↔ main:** data-channel input messages arrive in renderer, IPC to main →
  nut.js executes.
- **Runs as:** tray app, "waiting for connection", shows pairing code.

### 4.3 Android Controller — Web PWA on Cloudflare Pages
Why web, not native: Android Chrome has full WebRTC. A hosted web page = **zero install,
zero Play Store, zero signing, truly free**, instant updates.
- Open page in Chrome → enter pairing code → connect.
- `<video>` element renders the incoming screen track.
- Touch → mouse move/click; on-screen keyboard / hardware keyboard → key events; both
  serialized over the data channel to the PC.
- Installable to home screen as PWA (fullscreen, feels like an app).
- *(Native Kotlin app = possible v2 for better latency / hardware decode / background;
  not needed for v1.)*

### 4.4 STUN — Google public servers (free)
`stun:stun.l.google.com:19302` (+ a couple backups). NAT traversal succeeds here for
most home networks.

### 4.5 TURN — optional fallback (the one paid-ish case)
Only needed under **symmetric NAT** (some carriers/CGNAT) where P2P can't be punched and
traffic must be relayed. Options, decide later (§8):
- **Cloudflare Realtime TURN** — has a free allotment, stays in-ecosystem.
- **Self-host coturn** on a cheap VPS — fixed low cost, you control it.
- **Skip for v1** — accept it won't connect on symmetric NAT; add later.

---

## 5. Connection flow (sequence)

1. PC agent starts → WebSocket to Worker → DO creates room → returns pairing code.
2. PC shows code. User types code into Android web page.
3. Phone → WebSocket to Worker → joins same DO room.
4. PC creates SDP **offer** (with screen video track + input data channel) → DO → phone.
5. Phone sets remote, creates SDP **answer** → DO → PC.
6. Both gather ICE candidates (via STUN) → exchanged through DO as they trickle.
7. WebRTC negotiates direct path → DTLS handshake → **P2P link live**.
8. DO/room closes. Video + input now flow directly, encrypted, server-free.
9. If no direct path found (symmetric NAT) → relay via TURN if configured.

---

## 6. Security

- **Transport:** all P2P traffic is DTLS-SRTP encrypted end-to-end. Server sees only SDP.
- **Pairing code:** short-lived, single-use; room rejects 3rd joiner. Prevents drive-by.
- **Optional PIN/secret:** require a PIN confirmed on the PC before input is honored, so a
  guessed code alone can't drive the machine.
- **This is full remote control of your PC** — treat the pairing code like a password.
  v1 trust model = "whoever has the live code this minute." Harden in §9 hardening phase.
- Worker has no auth store, holds no secrets, sees no content → small attack surface.

---

## 7. Tech stack & repo layout

```
remote-controlpc/
├── signaling/          # Cloudflare Worker + Durable Object (TypeScript, wrangler)
│   ├── src/index.ts
│   ├── src/room.ts     # Durable Object
│   └── wrangler.jsonc
├── pc-agent/           # Electron app (Windows)
│   ├── src/main/       # main process: tray, nut.js input injection, IPC
│   ├── src/renderer/   # renderer: RTCPeerConnection, getDisplayMedia
│   └── package.json
├── android-web/        # PWA controller, deploys to Cloudflare Pages
│   ├── index.html
│   ├── src/            # RTCPeerConnection, video render, input capture
│   └── manifest.webmanifest
├── shared/             # shared TS types: signaling msgs, input event schema
└── PLAN.md
```

- Language: **TypeScript** across all three (one mental model, shared message types).
- Signaling deploy: `wrangler`. Android deploy: Cloudflare Pages. PC: `electron-builder`.

---

## 8. Decision points — need your call before building

| # | Decision | Recommended | Alternatives |
|---|----------|-------------|--------------|
| D1 | **PC agent runtime** | Electron (WebRTC + input in one) | Pure Node (`werift`/`node-datachannel` + ffmpeg) · Rust (`webrtc-rs`) |
| D2 | **Android side** | Web PWA (zero install) | Native Kotlin app (better latency, v2) |
| D3 | **TURN for v1** | Skip — STUN only, add TURN later | Cloudflare Realtime TURN · self-host coturn |
| D4 | **Security for v1** | Pairing code + PC-side PIN confirm | Code only (simpler, weaker) |
| D5 | **Cloudflare account** | Use your existing one | New dedicated account |

---

## 9. Build phases (milestones)

1. **Signaling** — Worker + DO, pairing-code rooms, WS relay. Test with two browser tabs.
2. **P2P proof** — two browser tabs establish data channel through signaling + STUN; echo.
3. **PC agent screen out** — Electron captures screen → video track → renders in a tab.
4. **Input path** — phone/tab input over data channel → nut.js drives PC mouse/keyboard.
5. **Android web controller** — real touch/keyboard mapping, video render, PWA polish.
6. **Hardening** — PIN confirm, reconnect, code expiry, quality/bitrate tuning.
7. **TURN fallback** — only if symmetric-NAT testing demands it.

Each phase is independently demoable.

---

## 10. Cost summary

| Item | Cost |
|------|------|
| Signaling (CF Worker + DO) | $0 (free tier, far under limits) |
| Android hosting (CF Pages) | $0 |
| STUN (Google) | $0 |
| Direct P2P traffic | $0 (peer-to-peer, no server) |
| TURN relay | $0 *unless* symmetric NAT → small bandwidth cost if added |

**Common case: fully free.** Only symmetric-NAT users incur optional relay cost.

---

## 11. Known risks / limits

- **Symmetric NAT / CGNAT** → no direct P2P → needs TURN (the one not-free path).
- **nut.js native build** on Windows needs build tools / prebuilt binaries — verify early.
- **Latency** depends on encode + network; fine for desktop use, not twitch gaming.
- **Electron size** (~100–150MB installer). Acceptable for a PC agent; native is leaner.
- **UAC / elevated windows** — injecting input into admin windows may need the agent
  elevated. Note for hardening phase.
