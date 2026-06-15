# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project aims to follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Nothing yet.

## [0.3.0] — 2026-06-14

First tagged release with a Windows installer
([download](https://github.com/AndonyEmmanuelVelazquez/remote-controlpc/releases/tag/v0.3.0)).

### Added
- **Per-user signaling**: the PC agent has a **first-run setup screen** to enter your own
  signaling URL (persisted to `config.json`; changeable via "⚙ Change signaling server").
  Resolution order: `SIGNALING_URL` env → saved config → baked default. Distributable
  builds ship without a baked URL so each user points at their own Cloudflare deployment,
  avoiding a shared pairing-code space. See [SECURITY.md](SECURITY.md#multi-user).
- **Packaging**: `npm run pack` (portable app via `@electron/packager`) and `npm run dist`
  (NSIS installer via electron-builder). The portable folder ships a
  `Start Remote Control.cmd` launcher. Signaling URL can be **baked at build time** from
  `SIGNALING_URL` (a runtime env/config still overrides).
- **App icon**: `npm run icon` generates `build/icon.ico` (zero-dep); PWA 192/512 icons via
  `android-web/scripts/gen-icons.mjs`.
- **Remember this device** — the controller has a persistent device ID and sends a `hello`
  over signaling. The agent's approval prompt gained **Always allow**, which records the
  device in `trusted.json`; a trusted phone is auto-approved on later connects (no prompt).
- **Persistent pairing code** on the agent (`code.json`) so the phone remembers it.
- **Installable PWA** — 192/512 PNG icons (+ maskable), `display: standalone`, in-app
  **Install** button (`beforeinstallprompt`).
- Reliable Electron launcher (`pc-agent/scripts/start.mjs`) that strips
  `ELECTRON_RUN_AS_NODE` so the GUI always launches.
- Docs: [GETTING_STARTED](docs/GETTING_STARTED.md) (deploy + build/installer, incl. the
  Windows Developer-Mode requirement for NSIS), [SECURITY](SECURITY.md), CONTRIBUTING,
  LICENSE (MIT).

### Security
- An **unknown** device always triggers the manual Allow prompt; a guessed pairing code
  alone cannot drive the PC.
- Per-user signaling avoids a shared pairing-code space across users. Full model + residual
  risks in [SECURITY.md](SECURITY.md).

## [0.2.0] — 2026-06-14

### Added
- **Touch ergonomics** modeled on Chrome Remote Desktop / Microsoft Remote Desktop:
  pinch-to-zoom (1×–4×) with focal point under the fingers, two-finger pan when zoomed,
  two-finger drag = scroll, two-finger tap = right click.
- **Trackpad mode** — a relative virtual cursor (with on-screen ring) for pixel-precise
  control without fingertip occlusion; double-tap-then-hold = drag.

### Changed
- View zoom/pan is pure CSS transform; tap-to-pixel mapping stays correct via
  `getBoundingClientRect`, so the host needs no changes.

## [0.1.0] — 2026-06-14

### Added
- **Signaling** — Cloudflare Worker + SQLite-backed Durable Object. Pairs two peers by a
  6-digit code, relays SDP/ICE opaquely, rejects a third peer. Runs on the Workers Free
  plan.
- **PC agent** — Electron host. Captures the screen via Chromium, injects mouse/keyboard
  via nut.js, gated behind an explicit **Allow**.
- **Android controller** — web PWA. Renders the screen and sends touch/keyboard input.
- **Shared** signaling client + message types.
- **Tests** — signaling relay unit test and a headless end-to-end WebRTC handshake test
  (pairing → SDP → ICE → DTLS → data channel → input round-trip).
