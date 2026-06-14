import { SignalingClient } from "../../shared/signaling";
import { ICE_SERVERS, normalizeCode } from "../../shared/types";
import type { InputEvent, KeyMods, MouseButton, SignalMessage } from "../../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const connectEl = $("connect");
const sessionEl = $("session");
const codeInput = $<HTMLInputElement>("code-input");
const sigInput = $<HTMLInputElement>("sig-url");
const connectBtn = $<HTMLButtonElement>("connect-btn");
const msgEl = $("msg");
const video = $<HTMLVideoElement>("screen");
const kbd = $<HTMLInputElement>("kbd");

const DEFAULT_SIG =
  (import.meta as { env?: Record<string, string> }).env?.VITE_SIGNALING_URL ?? "";
sigInput.value = localStorage.getItem("sigUrl") ?? DEFAULT_SIG;

let signaling: SignalingClient | null = null;
let pc: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;

function setMsg(t: string) {
  msgEl.textContent = t;
}

// ---------------------------------------------------------------- connect ----

connectBtn.addEventListener("click", () => {
  const code = normalizeCode(codeInput.value);
  if (code.length !== 6) return setMsg("Enter the 6-digit code");
  let sig = sigInput.value.trim();
  if (!sig) return setMsg("Set the signaling server URL");
  sig = sig.replace(/\/+$/, "").replace(/^http/, "ws"); // accept http(s)/ws(s)
  localStorage.setItem("sigUrl", sigInput.value.trim());

  connectBtn.disabled = true;
  setMsg("Connecting to signaling…");

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.ontrack = (e) => {
    video.srcObject = e.streams[0];
    showSession();
  };
  pc.ondatachannel = (e) => {
    channel = e.channel;
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) signaling?.send({ type: "ice", candidate: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === "failed") disconnect("Connection failed");
    if (pc?.connectionState === "disconnected") disconnect("Disconnected");
  };

  signaling = new SignalingClient(sig, code, "controller", {
    onOpen: () => setMsg("Waiting for PC to accept…"),
    onClose: () => {
      if (!pc || pc.connectionState !== "connected") setMsg("Signaling closed");
    },
    onError: () => setMsg("Signaling error — check the server URL"),
    onMessage: handleSignal,
  });
  signaling.connect();
});

async function handleSignal(msg: SignalMessage) {
  switch (msg.type) {
    case "peer-joined":
      if (msg.role === "host") setMsg("PC found — waiting for approval…");
      break;
    case "offer":
      if (!pc) return;
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signaling?.send({ type: "answer", sdp: answer.sdp! });
      setMsg("Establishing direct connection…");
      break;
    case "ice":
      pc?.addIceCandidate(msg.candidate).catch(() => {});
      break;
    case "peer-left":
      disconnect("PC disconnected");
      break;
    case "full":
      setMsg("A controller is already connected to this code.");
      connectBtn.disabled = false;
      break;
    case "error":
      setMsg("Error: " + msg.message);
      break;
  }
}

function showSession() {
  connectEl.style.display = "none";
  sessionEl.classList.add("show");
  setMsg("");
}

function disconnect(reason: string) {
  channel = null;
  pc?.close();
  pc = null;
  signaling?.close();
  signaling = null;
  (video.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  sessionEl.classList.remove("show");
  connectEl.style.display = "";
  connectBtn.disabled = false;
  setMsg(reason);
}

function send(ev: InputEvent) {
  if (channel?.readyState === "open") channel.send(JSON.stringify(ev));
}

// ------------------------------------------------------------- input map ----

/** Map a client point over the <video> (object-fit:contain) to normalized frame coords. */
function toNormalized(clientX: number, clientY: number): { x: number; y: number } | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const rect = video.getBoundingClientRect();
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const offX = rect.left + (rect.width - dispW) / 2;
  const offY = rect.top + (rect.height - dispH) / 2;
  const x = (clientX - offX) / dispW;
  const y = (clientY - offY) / dispH;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

let rightArmed = false;
let scrollMode = false;
let dragging = false;
let lastScroll: { x: number; y: number } | null = null;
let pendingMove: { x: number; y: number } | null = null;
let rafQueued = false;

function flushMove() {
  rafQueued = false;
  if (pendingMove) {
    send({ t: "mm", x: pendingMove.x, y: pendingMove.y });
    pendingMove = null;
  }
}
function queueMove(x: number, y: number) {
  pendingMove = { x, y };
  if (!rafQueued) {
    rafQueued = true;
    requestAnimationFrame(flushMove);
  }
}

video.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  video.setPointerCapture(e.pointerId);
  if (scrollMode) {
    lastScroll = { x: e.clientX, y: e.clientY };
    return;
  }
  const p = toNormalized(e.clientX, e.clientY);
  if (!p) return;
  if (rightArmed) {
    send({ t: "click", b: "right", x: p.x, y: p.y });
    setRightArmed(false);
    return;
  }
  dragging = true;
  send({ t: "md", b: "left", x: p.x, y: p.y });
});

video.addEventListener("pointermove", (e) => {
  if (scrollMode && lastScroll) {
    const dx = e.clientX - lastScroll.x;
    const dy = e.clientY - lastScroll.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) {
      send({ t: "scroll", dx: -Math.round(dx / 2), dy: -Math.round(dy / 2) });
      lastScroll = { x: e.clientX, y: e.clientY };
    }
    return;
  }
  if (!dragging) return;
  const p = toNormalized(e.clientX, e.clientY);
  if (p) queueMove(p.x, p.y);
});

function endPointer(e: PointerEvent) {
  if (scrollMode) {
    lastScroll = null;
    return;
  }
  if (!dragging) return;
  dragging = false;
  const p = toNormalized(e.clientX, e.clientY);
  if (p) send({ t: "mu", b: "left", x: p.x, y: p.y });
}
video.addEventListener("pointerup", endPointer);
video.addEventListener("pointercancel", endPointer);

// Desktop wheel (useful when testing in a browser).
video.addEventListener("wheel", (e) => {
  e.preventDefault();
  send({ t: "scroll", dx: Math.round(e.deltaX / 40), dy: Math.round(e.deltaY / 40) });
}, { passive: false });

// ------------------------------------------------------------- toolbar ------

function setRightArmed(v: boolean) {
  rightArmed = v;
  const b = $("btn-right");
  b.textContent = "Right-click: " + (v ? "ON" : "off");
  b.classList.toggle("active", v);
}
function setScrollMode(v: boolean) {
  scrollMode = v;
  const b = $("btn-scroll");
  b.textContent = "Scroll: " + (v ? "ON" : "off");
  b.classList.toggle("active", v);
}

$("btn-right").addEventListener("click", () => setRightArmed(!rightArmed));
$("btn-scroll").addEventListener("click", () => setScrollMode(!scrollMode));
$("btn-disconnect").addEventListener("click", () => disconnect("Disconnected"));
$("btn-kbd").addEventListener("click", () => {
  kbd.value = "";
  kbd.focus();
});

// ------------------------------------------------------------- keyboard -----

const mods = (e: KeyboardEvent): KeyMods => ({
  ctrl: e.ctrlKey,
  alt: e.altKey,
  shift: e.shiftKey,
  meta: e.metaKey,
});

// Special keys / shortcuts: send discrete down+up so nothing sticks.
kbd.addEventListener("keydown", (e) => {
  const special = e.key.length > 1 || e.ctrlKey || e.altKey || e.metaKey;
  if (!special) return; // printable handled by 'input' below
  e.preventDefault();
  send({ t: "kd", key: e.key, mods: mods(e) });
  send({ t: "ku", key: e.key, mods: mods(e) });
});

// Printable text (covers Android soft keyboards that don't emit real keydowns).
kbd.addEventListener("input", (e) => {
  const data = (e as unknown as { data?: string | null }).data;
  if (data) send({ t: "type", text: data });
  kbd.value = "";
});

// Hardware keyboard fallback at the document level when not focused on #kbd.
document.addEventListener("keydown", (e) => {
  if (!sessionEl.classList.contains("show")) return;
  if (document.activeElement === kbd) return;
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    send({ t: "type", text: e.key });
  } else {
    send({ t: "kd", key: e.key, mods: mods(e) });
    send({ t: "ku", key: e.key, mods: mods(e) });
  }
});

// Register PWA service worker (best-effort).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
