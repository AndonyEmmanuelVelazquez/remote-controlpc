# Security model

This tool grants **full control of a PC** (mouse, keyboard, live screen) to a remote
phone. Read this before exposing a machine.

---

## Can someone access my PC without the pairing code? — No.

To control your PC, an attacker needs **all** of the following at the same time:

1. **Your agent must be running.** If the PC agent is closed, there is no session to join
   and no access of any kind.
2. **The pairing code.** Joining a session means joining the signaling "room" keyed by
   your 6-digit code. Without the code, an attacker cannot reach your agent at all.
3. **Approval — one of:**
   - you physically click **Allow** on the PC, **or**
   - the connecting device is already in your **trusted** list (it previously got
     "Always allow").

A connection from an **unknown** device always stops at the manual Allow prompt, which
only someone at your keyboard can approve. **So a guessed or stolen pairing code, by
itself, cannot drive your PC.** The approval gate is the real lock.

> Note: "pairing code" is this tool's own code — it is **not** your Windows login
> password. This tool does not ask for your Windows password. Once a session is approved,
> it controls your already-logged-in desktop. Approve devices accordingly.

---

## What each party can see

| Party | Sees |
|-------|------|
| The signaling server (your Cloudflare Worker) | The pairing code, opaque SDP blobs, ICE candidates, the controller's device ID and name. **Never** your screen or input. |
| The peer-to-peer link (phone ↔ PC) | Screen video + input, **DTLS-SRTP encrypted end-to-end**. Not visible to the server or the network. |
| Network observers | Encrypted traffic only. |

Because screen and input flow strictly peer-to-peer and encrypted, neither Cloudflare nor
anyone on the network path can read them.

---

## Residual risks (be honest about these)

1. **Persistent pairing code + brute force.**
   The code is now stable across restarts (so your phone can remember it). A 6-digit code
   is ~1,000,000 combinations. An attacker who knows your signaling URL could script room
   joins to guess it. **They still cannot control the PC** without your Allow click or a
   trusted device ID — but they could:
   - consume your Worker's (free-tier) request quota, and
   - repeatedly trigger the Allow prompt on your PC (an annoyance / social-engineering
     vector — never click Allow for a device you didn't expect).

   Mitigations / hardening options:
   - Keep your signaling URL private (it is not committed to the repo).
   - Use a longer / higher-entropy persistent code (requires changing the worker's code
     validation and the clients).
   - Add per-code rate limiting in the Durable Object.
   - Revert to a random per-launch code if you don't need "remember the code."

2. **Trusted device ID is a bearer token.**
   It lives in the phone browser's `localStorage` and is sent over signaling (TLS to
   Cloudflare). Anyone who extracts it **and** knows the code could be auto-approved
   without a prompt. Treat the phone as trusted hardware; reset trust if the phone is
   lost (see below).

3. **No second factor on approval.** Approval is a single click. There is no PIN on the
   PC side by default. Consider adding one if the machine is sensitive.

4. **Elevated windows.** Injecting input into admin/UAC windows may require running the
   agent elevated; conversely, an approved session can do anything your logged-in user
   can.

---

## Resetting / revoking

- **Forget all trusted devices:** delete `trusted.json` in the agent's userData folder
  (`%APPDATA%\Remote Control PC Agent\` on Windows), or call the agent's `forget-devices`.
- **Rotate the pairing code:** delete `code.json` in the same folder; a new code is
  generated on next launch.
- **Cut all access immediately:** close the PC agent.

---

## Multi-user

**Each person should run their own signaling server.** The pairing room is keyed by the
6-digit code on a single Worker, so everyone who shares one signaling server also shares
that 6-digit code space. With persistent codes, two strangers can collide on the same
code — one person's phone could reach another person's PC's room.

> Control is still gated (an unknown device hits the Allow prompt; "Always allow" trusts
> by device ID, not by code), so a collision cannot silently take over a PC — but it is a
> real privacy/UX problem and it spends the server owner's free-tier quota.

Therefore the PC agent asks for **your own** signaling URL on first run, and the phone
controller has a **"Signaling server"** field. Distributable builds are shipped **without a
baked URL** so each user points at their own free Cloudflare deployment. Don't hand your
signaling URL (or a build that bakes it) to other people if you don't want to be their
shared host.

## Is it safe to publish this repo / can others use it?

Yes. The repository contains **no credentials**: no Cloudflare API token, no account ID,
and not even your deployed URLs (only `<placeholder>` examples). Your Cloudflare token is
stored by `wrangler` on your own machine, never in the repo. Anyone who clones the project
deploys their **own** independent instance against their **own** Cloudflare account.

---

## Reporting a vulnerability

This is a personal/educational project. If you find a security issue, open a GitHub issue
(for non-sensitive reports) or contact the repository owner directly for sensitive ones.
