// Shared message contracts used by signaling Worker, PC agent, and Android controller.

export type Role = "host" | "controller";

/**
 * Messages relayed through the signaling Durable Object during the WebRTC handshake.
 * The server treats `offer`/`answer`/`ice` as opaque and just forwards them to the peer.
 * `peer-joined`/`peer-left`/`full`/`error` are emitted by the server itself.
 */
export type SignalMessage =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit }
  | { type: "hello"; deviceId: string; name?: string } // controller -> host identity, for "remember this device"
  | { type: "peer-joined"; role: Role }
  | { type: "peer-left"; role: Role }
  | { type: "full" } // room already has two peers in this role-pair
  | { type: "error"; message: string };

/**
 * Input events sent controller -> host over the WebRTC data channel (label "input").
 * Coordinates are normalized 0..1 relative to the shared video frame so the host can
 * map them onto its own screen resolution.
 */
export type MouseButton = "left" | "right" | "middle";

export type InputEvent =
  | { t: "mm"; x: number; y: number } // mouse move (absolute, normalized)
  | { t: "md"; b: MouseButton; x: number; y: number } // mouse button down at pos
  | { t: "mu"; b: MouseButton; x: number; y: number } // mouse button up at pos
  | { t: "click"; b: MouseButton; x: number; y: number; double?: boolean }
  | { t: "scroll"; dx: number; dy: number } // wheel delta
  | { t: "kd"; key: string; mods?: KeyMods } // key down (event.key value)
  | { t: "ku"; key: string; mods?: KeyMods } // key up
  | { t: "type"; text: string }; // type a literal string

export interface KeyMods {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/** Optional user-supplied TURN relay. Needed when both peers are behind
 *  symmetric NAT / CGNAT (common on cellular) and STUN can't punch a path. */
export interface TurnConfig {
  url?: string; // e.g. "turn:turn.example.com:3478" or "turns:...:5349"
  username?: string;
  credential?: string;
}

/** Public STUN servers, always present (free, no auth). */
const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/** Build the ICE server list: STUN always, plus a TURN relay when configured. */
export function buildIceServers(turn?: TurnConfig): RTCIceServer[] {
  const servers = [...STUN_SERVERS];
  if (turn?.url) {
    servers.push({
      urls: turn.url,
      username: turn.username || undefined,
      credential: turn.credential || undefined,
    });
  }
  return servers;
}

/** Default STUN-only ICE config (no TURN). Kept for callers that don't configure TURN. */
export const ICE_SERVERS: RTCIceServer[] = buildIceServers();

/** A 6-digit pairing code formatted as "NNN-NNN". */
export function generatePairingCode(): string {
  const n = Math.floor(100000 + Math.random() * 900000); // 100000..999999
  const s = String(n);
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

/** Normalize user-typed code ("483 921", "483-921", "483921") to "483921". */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}
