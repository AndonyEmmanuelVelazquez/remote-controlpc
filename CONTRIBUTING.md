# Contributing

Thanks for your interest. This is a small TypeScript monorepo with four independent
packages plus shared code.

## Layout

| Path | What | Build / test |
|------|------|--------------|
| `signaling/` | Cloudflare Worker + Durable Object | `npm run typecheck` · `npm run dev` · `node test-relay.mjs` |
| `pc-agent/` | Electron host (Windows) | `npm run typecheck` · `npm run build` · `npm start` |
| `android-web/` | Controller PWA | `npm run typecheck` · `npm run build` · `npm run dev` |
| `e2e/` | Headless WebRTC handshake test | `npm test` (needs `signaling` dev running) |
| `shared/` | Message types + signaling client | imported by the above |

Each package has its own `package.json`; run `npm install` inside the one you're working
on.

## Before opening a PR

1. `npm run typecheck` passes in every package you touched.
2. `npm run build` passes for `pc-agent` and `android-web`.
3. Signaling changes: `node signaling/test-relay.mjs` and `e2e/ npm test` stay green
   (start `signaling` with `npm run dev` first).
4. Update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]`.
5. If you change the trust/approval flow or what the server sees, update
   [SECURITY.md](SECURITY.md).

## Conventions

- TypeScript everywhere; shared contracts live in `shared/types.ts`.
- The signaling server must stay **opaque** — it relays SDP/ICE/hello verbatim and never
  inspects WebRTC payloads.
- The PC agent must keep input **gated**: nothing is actuated until a session is approved
  and armed.
- Match the surrounding code style (no formatter is enforced; keep it consistent).

## Commits

Conventional, imperative subject lines (e.g. `feat: add trackpad mode`). Keep unrelated
changes in separate commits.
