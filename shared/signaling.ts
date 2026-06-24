// Thin WebSocket transport to the Cloudflare signaling Worker.
// Runs in any DOM environment (Electron renderer + Android Chrome).

import type { Role, SignalMessage } from "./types";

export interface SignalingHandlers {
  onOpen?: () => void;
  onMessage?: (msg: SignalMessage) => void;
  onClose?: (ev: CloseEvent) => void;
  onError?: (ev: Event) => void;
  /** Fired before a scheduled reconnect attempt (1-based attempt number). */
  onReconnecting?: (attempt: number, delayMs: number) => void;
}

export interface SignalingOptions {
  /** Re-open the socket with exponential backoff on unexpected drops. */
  autoReconnect?: boolean;
}

// Close codes that mean "don't bother retrying": the room rejected us.
const NO_RETRY_CODES = new Set([4001]);
const MAX_BACKOFF_MS = 30_000;

export class SignalingClient {
  private ws?: WebSocket;
  private closed = false; // deliberate close() -> stop retrying
  private attempt = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private readonly autoReconnect: boolean;

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
    opts: SignalingOptions = {},
  ) {
    this.autoReconnect = opts.autoReconnect ?? false;
  }

  connect(): void {
    this.closed = false;
    this.open();
  }

  private open(): void {
    const url = `${this.baseUrl}/ws?code=${encodeURIComponent(this.code)}&role=${this.role}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0; // a clean open resets backoff
      this.handlers.onOpen?.();
    };
    ws.onerror = (ev) => this.handlers.onError?.(ev);
    ws.onclose = (ev) => {
      this.handlers.onClose?.(ev);
      this.scheduleReconnect(ev);
    };
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

  private scheduleReconnect(ev: CloseEvent): void {
    if (this.closed || !this.autoReconnect) return;
    if (NO_RETRY_CODES.has(ev.code)) return; // room rejected us; retrying won't help
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempt);
    this.attempt++;
    this.handlers.onReconnecting?.(this.attempt, delay);
    this.retryTimer = setTimeout(() => {
      if (!this.closed) this.open();
    }, delay);
  }

  send(msg: SignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}
