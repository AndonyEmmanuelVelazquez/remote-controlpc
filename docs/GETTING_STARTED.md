# Getting Started — install & run from scratch

This guide takes a brand-new user from "just cloned the repo" to "controlling my PC from
my phone." No prior Cloudflare or WebRTC knowledge needed.

You run **your own** instance: your own signaling server (on your free Cloudflare
account), your own controller page, your own PC agent. Nothing is shared with the project
author, and the author's deployment is not used.

---

## What you'll end up with

| Piece | Where it runs | Cost |
|-------|---------------|------|
| Signaling Worker | Your Cloudflare account (`*.workers.dev`) | Free |
| Controller (web app) | Cloudflare Pages (`*.pages.dev`) or your laptop | Free |
| PC agent | The Windows PC you want to control | Free |

See [README.md](../README.md) for the architecture and [SECURITY.md](../SECURITY.md) for
the trust model before you expose your PC.

---

## 0. Prerequisites

1. **Node.js 20 or newer** (tested on 26). Check: `node --version`.
   Get it from <https://nodejs.org>.
2. **A Cloudflare account** (free): <https://dash.cloudflare.com/sign-up>.
3. **Windows** for the PC agent (input injection uses Windows APIs).
4. **Git** to clone the repo.

```bash
git clone https://github.com/<you>/remote-controlpc.git
cd remote-controlpc
```

> All commands below are shown for **PowerShell** (Windows). Where an environment variable
> is needed, the bash form is given too.

---

## 1. Deploy your signaling server

The signaling server only relays the one-time connection handshake — it never sees your
screen or input.

```powershell
cd signaling
npm install
npx wrangler login        # opens a browser, one time
npm run deploy
```

At the end wrangler prints a URL like:

```
https://remote-control-signaling.<your-subdomain>.workers.dev
```

**Write it down.** Its WebSocket form (swap `https` → `wss`) is your **signaling URL**:

```
wss://remote-control-signaling.<your-subdomain>.workers.dev
```

Sanity check: open the `https://…workers.dev/` URL in a browser — it should say
`signaling up`.

---

## 2. Deploy the phone controller

You can host it (recommended, gives HTTPS so the PWA installs) or run it locally for a
quick test.

### Option A — Cloudflare Pages (recommended)

```powershell
cd ../android-web
npm install
$env:VITE_SIGNALING_URL="wss://remote-control-signaling.<your-subdomain>.workers.dev"
npm run build
npx wrangler pages project create pc-remote --production-branch main   # first time only
npx wrangler pages deploy dist --project-name pc-remote --branch main
```

bash form of the env line:
`VITE_SIGNALING_URL="wss://…workers.dev" npm run build`

You get a URL like `https://pc-remote.pages.dev`. Open it on your phone.

### Option B — run locally (testing only)

```powershell
cd ../android-web
npm install
npm run dev    # serves on http://<your-LAN-ip>:5173
```

Open it from a browser; type the signaling URL into the app's "Signaling server" box.
(Local HTTP won't offer PWA install — use Option A for that.)

---

## 3. Run the PC agent

```powershell
cd ../pc-agent
npm install
$env:SIGNALING_URL="wss://remote-control-signaling.<your-subdomain>.workers.dev"
npm start
```

bash form: `SIGNALING_URL="wss://…workers.dev" npm start`

A window opens showing a **6-digit pairing code**. Leave it running.

> The agent persists its pairing code and trusted devices under its userData folder
> (`%APPDATA%\Remote Control PC Agent\` on Windows), so the code stays the same across
> restarts.

---

## 4. Connect from the phone

1. Open the controller URL (from step 2) in **Android Chrome**.
2. Optional: tap **⬇ Install app** to add it to your home screen (standalone, fullscreen).
3. Type the 6-digit code shown on the PC, tap **Connect**.
4. On the PC, click **Allow once** (this session) or **Always allow** (remember this
   phone — skips the prompt next time).
5. You're controlling the PC. Gestures:
   - tap = click · two-finger tap = right click · drag = drag
   - pinch = zoom · two-finger drag = scroll (or pan when zoomed)
   - **Mode** button switches Direct ↔ Trackpad (precise cursor) · **⌨ Keys** = type

After **Always allow**, future sessions are hands-free: open PWA → Connect → in.

---

## Quick local-only test (no deploy at all)

Validates the whole stack on one machine.

```powershell
# terminal 1 — signaling on localhost
cd signaling; npm install; npm run dev          # http://127.0.0.1:8787

# terminal 2 — headless end-to-end handshake test
cd e2e; npm install; npm test                   # expect 4x PASS
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `wrangler: command not found` | Use `npx wrangler …` (it's a local dependency, not global). |
| `Electron failed to install correctly` | `cd pc-agent; rm -r node_modules/electron; npm install electron`. If a binary still won't extract, see the cached zip note in the repo history; `npm start` uses a launcher that handles `ELECTRON_RUN_AS_NODE`. |
| Agent window opens but is blank / runs as Node | Caused by a machine-wide `ELECTRON_RUN_AS_NODE=1`. `npm start` strips it automatically; if launching electron directly, unset it first. |
| Phone says "Waiting for PC to accept…" forever | Make sure the agent is running and you clicked **Allow**. Confirm both used the same signaling URL. |
| Stuck at "Negotiating connection…" | Likely symmetric NAT/CGNAT — direct P2P can't be punched. Add a TURN server to `ICE_SERVERS` in [shared/types.ts](../shared/types.ts). Test phone on mobile data vs Wi-Fi to compare. |
| PWA won't offer install | Must be served over HTTPS (use Pages, not local HTTP). Reload once after first visit. |
| Pairing code changed unexpectedly | Delete `code.json` in the agent userData folder to regenerate. |

---

## Updating

```bash
git pull
# rebuild whatever changed:
cd signaling && npm run deploy
cd ../android-web && npm run build && npx wrangler pages deploy dist --project-name pc-remote --branch main
cd ../pc-agent && npm start
```
