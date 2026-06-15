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
npx wrangler pages project create <your-project> --production-branch main   # first time only
npx wrangler pages deploy dist --project-name <your-project> --branch main
```

bash form of the env line:
`VITE_SIGNALING_URL="wss://…workers.dev" npm run build`

You get a URL like `https://<your-project>.pages.dev`. Open it on your phone.

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
npm start
```

On **first run** the agent shows a **setup screen** — paste *your own* signaling URL
(`wss://…workers.dev` from step 1) and click **Save & start**. It's stored in the agent's
config, so you only do this once. (You can change it later via **⚙ Change signaling
server**.)

> You can skip the setup screen by baking the URL at build time
> (`$env:SIGNALING_URL="wss://…"; npm start`) or via the `SIGNALING_URL` env var — useful
> for your own machine. **For sharing the app with other people, leave it un-baked** so
> each person enters their own server (see [SECURITY.md](../SECURITY.md#multi-user)).

After setup, a window shows a **6-digit pairing code**. Leave it running.

> The agent persists its config, pairing code, and trusted devices under its userData
> folder (`%APPDATA%\Remote Control PC Agent\` on Windows), so they survive restarts.

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

## Packaging the agent as a desktop app (optional)

`npm start` runs the agent from source. To get a double-clickable app or an installer,
**bake your signaling URL in first** (so the app doesn't need an env var at runtime):

```powershell
cd pc-agent
$env:SIGNALING_URL="wss://remote-control-signaling.<your-subdomain>.workers.dev"
```

### Portable app (no admin needed)

```powershell
npm run pack
```

Output: `pc-agent/release/RemoteControlPCAgent-win32-x64/`. Run it with
**`RemoteControlPCAgent.exe`**, or double-click **`Start Remote Control.cmd`** (a launcher
that clears `ELECTRON_RUN_AS_NODE`, which on some machines would otherwise hide the
window). Zip the folder to share it. This is not a "Setup.exe" — it's a self-contained
folder.

### Windows installer / Setup.exe (NSIS)

```powershell
npm run dist
```

Output: `pc-agent/release/*.exe` (an installer with Start-menu entry, etc).

> **Privilege note:** electron-builder extracts a `winCodeSign` cache that contains macOS
> symlinks. Creating symlinks on Windows requires **Developer Mode** (Settings → Privacy &
> security → For developers → Developer Mode → On) **or** running the terminal **as
> Administrator**. Without one of those, `npm run dist` fails with
> *"Cannot create symbolic link: A required privilege is not held by the client."* Enable
> Developer Mode once, then re-run.

> The build is **unsigned**, so Windows SmartScreen will warn on first run ("More info →
> Run anyway"). Code signing needs a certificate (~$100–400/yr) and is optional for
> personal use.

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
cd ../android-web && npm run build && npx wrangler pages deploy dist --project-name <your-project> --branch main
cd ../pc-agent && npm start
```
