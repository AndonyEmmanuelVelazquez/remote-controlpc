// Durable Object: one instance per pairing code = a signaling "room".
// Holds at most one host + one controller WebSocket and relays raw messages
// between them. The server never parses SDP/ICE payloads -> stays opaque.

import { DurableObject } from "cloudflare:workers";

type Role = "host" | "controller";

const OTHER: Record<Role, Role> = { host: "controller", controller: "host" };

export class Room extends DurableObject {
  private get state(): DurableObjectState {
    return this.ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get("role") as Role | null;
    if (role !== "host" && role !== "controller") {
      return new Response("invalid role", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Last connection in a role slot wins. After an unclean drop (phone sleep,
    // Wi-Fi/cellular handoff) the old socket can linger here in hibernation and
    // would otherwise lock the same peer out of reconnecting. Evict it instead.
    // The eviction is marked so its close handler stays silent (no spurious
    // "peer-left" to the surviving peer, who is about to be re-paired).
    for (const stale of this.state.getWebSockets(role)) {
      stale.serializeAttachment({ evicted: true });
      try {
        stale.close(4001, "replaced by a newer connection");
      } catch {
        /* already closing */
      }
    }

    // Hibernatable accept: DO can sleep between messages, billed only when active.
    this.state.acceptWebSocket(server, [role]);

    // If the peer is already present, tell both sides the pair is complete.
    const peers = this.state.getWebSockets(OTHER[role]);
    if (peers.length > 0) {
      server.send(JSON.stringify({ type: "peer-joined", role: OTHER[role] }));
      const notice = JSON.stringify({ type: "peer-joined", role });
      for (const p of peers) p.send(notice);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const role = this.roleOf(ws);
    if (!role) return;
    // Relay verbatim to the peer in the other role.
    for (const p of this.state.getWebSockets(OTHER[role])) {
      p.send(message);
    }
  }

  webSocketClose(ws: WebSocket): void {
    const role = this.roleOf(ws);
    if (!role) return;
    // A socket we deliberately evicted (replaced by a fresh one in the same
    // role) must not tell the peer the role left — the slot is still occupied.
    const att = ws.deserializeAttachment() as { evicted?: boolean } | null;
    if (att?.evicted) return;
    const notice = JSON.stringify({ type: "peer-left", role });
    for (const p of this.state.getWebSockets(OTHER[role])) {
      p.send(notice);
    }
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws);
  }

  private roleOf(ws: WebSocket): Role | null {
    const tag = this.state.getTags(ws)[0];
    return tag === "host" || tag === "controller" ? tag : null;
  }
}
