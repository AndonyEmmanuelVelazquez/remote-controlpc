import { Room } from "./room";

export { Room };

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }

    if (url.pathname === "/") {
      return new Response("signaling up", { headers: CORS });
    }

    if (url.pathname === "/ws") {
      const code = url.searchParams.get("code");
      const role = url.searchParams.get("role");

      if (!code || !/^\d{6}$/.test(code)) {
        return new Response("invalid code (expect 6 digits)", { status: 400, headers: CORS });
      }
      if (role !== "host" && role !== "controller") {
        return new Response("invalid role (host|controller)", { status: 400, headers: CORS });
      }
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426, headers: CORS });
      }

      // One Durable Object instance per pairing code = the "room".
      const id = env.ROOM.idFromName(code);
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
};
