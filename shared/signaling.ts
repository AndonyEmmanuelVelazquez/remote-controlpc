// Thin WebSocket transport to the Cloudflare signaling Worker.
// Runs in any DOM environment (Electron renderer + Android Chrome).

import type { Role, SignalMessage } from "./types";

export interface SignalingHandlers {
  onOpen?: () => void;
  onMessage?: (msg: SignalMessage) => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
}

export class SignalingClient {
  private ws?: WebSocket;

  /**
   * @param baseUrl e.g. "wss://remote-control-signaling.<sub>.workers.dev" (no trailing slash)
   * @param code    6-digit pairing code, digits only
   * @param role    "host" | "controller"
   */
  constructor(
    private readonly baseUrl: string,
    private readonly code: string,
    private readonly role: Role,
    private readonly handlers: SignalingHandlers = {},
  ) {}

  connect(): void {
    const url = `${this.baseUrl}/ws?code=${encodeURIComponent(this.code)}&role=${this.role}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.handlers.onOpen?.();
    ws.onclose = (ev) => this.handlers.onClose?.(ev);
    ws.onerror = (ev) => this.handlers.onError?.(ev);
    ws.onmessage = (ev) => {
      let msg: SignalMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      this.handlers.onMessage?.(msg);
    };
  }

  send(msg: SignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.ws?.close();
  }
}
