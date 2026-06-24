import { SignalingClient } from "../../shared/signaling";
import { buildIceServers, normalizeCode } from "../../shared/types";
import type { InputEvent, KeyMods, MouseButton, SignalMessage, TurnConfig } from "../../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const connectEl = $("connect");
const sessionEl = $("session");
const codeInput = $<HTMLInputElement>("code-input");
const sigInput = $<HTMLInputElement>("sig-url");
const turnUrl = $<HTMLInputElement>("turn-url");
const turnUser = $<HTMLInputElement>("turn-user");
const turnCred = $<HTMLInputElement>("turn-cred");
const connectBtn = $<HTMLButtonElement>("connect-btn");
const msgEl = $("msg");
const video = $<HTMLVideoElement>("screen");
const kbd = $<HTMLInputElement>("kbd");

const DEFAULT_SIG =
  (import.meta as { env?: Record<string, string> }).env?.VITE_SIGNALING_URL ?? "";
sigInput.value = localStorage.getItem("sigUrl") ?? DEFAULT_SIG;
codeInput.value = localStorage.getItem("code") ?? "";
turnUrl.value = localStorage.getItem("turnUrl") ?? "";
turnUser.value = localStorage.getItem("turnUser") ?? "";
turnCred.value = localStorage.getItem("turnCred") ?? "";

function loadTurn(): TurnConfig {
  return {
    url: localStorage.getItem("turnUrl") ?? "",
    username: localStorage.getItem("turnUser") ?? "",
    credential: localStorage.getItem("turnCred") ?? "",
  };
}

// Stable identity so a remembered PC can auto-approve this phone ("don't ask again").
function getDeviceId(): string {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = (crypto.randomUUID?.() ?? String(Math.random()).slice(2)) as string;
    localStorage.setItem("deviceId", id);
  }
  return id;
}
function getDeviceName(): string {
  let name = localStorage.getItem("deviceName");
  if (!name) {
    const ua = navigator.userAgent;
    name = /Android/i.test(ua) ? "Android phone" : /iPhone|iPad/i.test(ua) ? "iOS device" : "Phone";
    localStorage.setItem("deviceName", name);
  }
  return name;
}
const DEVICE_ID = getDeviceId();
const DEVICE_NAME = getDeviceName();

let signaling: SignalingClient | null = null;
let pc: RTCPeerConnection | null = null;
let channel: RTCDataChannel | null = null;
let recoverTimer: number | undefined; // grace window for the host to re-establish ICE

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
  localStorage.setItem("code", code);
  localStorage.setItem("turnUrl", turnUrl.value.trim());
  localStorage.setItem("turnUser", turnUser.value.trim());
  localStorage.setItem("turnCred", turnCred.value.trim());

  connectBtn.disabled = true;
  setMsg("Connecting to signaling…");

  pc = new RTCPeerConnection({ iceServers: buildIceServers(loadTurn()) });
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
    const st = pc?.connectionState;
    if (st === "connected") {
      clearTimeout(recoverTimer);
      setMsg("");
    } else if (st === "disconnected" || st === "failed") {
      // The host (offerer) drives ICE restart; keep the session up and wait for
      // its fresh offer. Drop only if recovery doesn't land within the window.
      setMsg("Connection lost — recovering…");
      clearTimeout(recoverTimer);
      recoverTimer = window.setTimeout(() => {
        if (pc?.connectionState !== "connected") disconnect("Disconnected");
      }, 12_000);
    }
  };

  signaling = new SignalingClient(
    sig,
    code,
    "controller",
    {
      onOpen: () => {
        // Identify this device so a remembered PC can auto-approve. Re-sent on
        // every (re)connect so the host knows the controller's signaling is back.
        signaling?.send({ type: "hello", deviceId: DEVICE_ID, name: DEVICE_NAME });
        setMsg(pc?.connectionState === "connected" ? "" : "Waiting for PC to accept…");
      },
      onReconnecting: () => {
        if (pc?.connectionState !== "connected") setMsg("Signaling lost — reconnecting…");
      },
      onClose: () => {
        if (!pc || pc.connectionState !== "connected") setMsg("Signaling closed");
      },
      onError: () => setMsg("Signaling error — check the server URL"),
      onMessage: handleSignal,
    },
    { autoReconnect: true },
  );
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
  resetView();
  setMode("direct");
}

function disconnect(reason: string) {
  clearTimeout(recoverTimer);
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

/** Inverse of toNormalized: frame coords -> screen px (places the trackpad cursor dot). */
function frameToScreen(nx: number, ny: number): { x: number; y: number } {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const rect = video.getBoundingClientRect();
  const fit = Math.min(rect.width / vw, rect.height / vh);
  const dispW = vw * fit;
  const dispH = vh * fit;
  const offX = rect.left + (rect.width - dispW) / 2;
  const offY = rect.top + (rect.height - dispH) / 2;
  return { x: offX + nx * dispW, y: offY + ny * dispH };
}

// ---- local view transform (zoom + pan), applied as CSS so tap-mapping via
//      getBoundingClientRect stays correct without touching the host. ----
const MAX_SCALE = 4;
let viewScale = 1;
let tx = 0;
let ty = 0;

function applyView() {
  video.style.transform = `translate(${tx}px, ${ty}px) scale(${viewScale})`;
  $("btn-zoom").textContent = "Zoom: " + Math.round(viewScale * 100) + "%";
  $("btn-reset").style.display = viewScale > 1.01 ? "" : "none";
  if (mode === "trackpad") positionCursor();
}
function clampPan() {
  const minTx = window.innerWidth * (1 - viewScale);
  const minTy = window.innerHeight * (1 - viewScale);
  tx = Math.min(0, Math.max(minTx, tx));
  ty = Math.min(0, Math.max(minTy, ty));
}
function zoomAbout(fx: number, fy: number, next: number) {
  const s2 = Math.min(MAX_SCALE, Math.max(1, next));
  // keep the focal screen point fixed (transform-origin 0 0)
  tx = fx - (fx - tx) * (s2 / viewScale);
  ty = fy - (fy - ty) * (s2 / viewScale);
  viewScale = s2;
  clampPan();
  applyView();
}
function resetView() {
  viewScale = 1;
  tx = 0;
  ty = 0;
  applyView();
}

// ---- virtual cursor (trackpad mode) ----
const cursorEl = $("cursor");
let mode: "direct" | "trackpad" = "direct";
const cursor = { x: 0.5, y: 0.5 };
const TRACKPAD_SENS = 1.1;

function positionCursor() {
  const p = frameToScreen(cursor.x, cursor.y);
  cursorEl.style.left = p.x + "px";
  cursorEl.style.top = p.y + "px";
}
function setMode(m: "direct" | "trackpad") {
  mode = m;
  $("btn-mode").textContent = "Mode: " + (m === "trackpad" ? "Trackpad" : "Direct");
  cursorEl.style.display = m === "trackpad" ? "block" : "none";
  if (m === "trackpad") positionCursor();
}

// ---- throttled mouse move ----
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

// ---- pointer / gesture engine ----
interface Pt { x: number; y: number; sx: number; sy: number; }
const pts = new Map<number, Pt>();
const TAP_MS = 250;
const TAP_SLOP = 10; // px

// single-finger state
let oneStartT = 0;
let oneMoved = false;
let oneDown = false; // left button currently held (direct drag or trackpad drag-lock)
let lastTapEnd = 0; // for trackpad double-tap-drag

// two-finger state
let twoActive = false;
let twoMoved = false;
let twoStartT = 0;
let startDist = 0;
let startScale = 1;
let lastCentroid = { x: 0, y: 0 };
let suppressLeftover = false; // ignore the finger left after a 2-finger gesture

const hyp = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
function twoPts(): [Pt, Pt] {
  const v = [...pts.values()];
  return [v[0], v[1]];
}

video.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  video.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });

  if (pts.size === 1) {
    oneStartT = performance.now();
    oneMoved = false;
    oneDown = false;
    if (mode === "trackpad" && performance.now() - lastTapEnd < 300) {
      // double-tap then hold = drag-lock: press left at the cursor
      oneDown = true;
      send({ t: "md", b: "left", x: cursor.x, y: cursor.y });
    }
  } else if (pts.size === 2) {
    // a second finger arrived: cancel any in-progress single press, start gesture
    if (oneDown) {
      const n = mode === "trackpad" ? cursor : toNormalized(e.clientX, e.clientY);
      if (n) send({ t: "mu", b: "left", x: n.x, y: n.y });
      oneDown = false;
    }
    const [a, b] = twoPts();
    twoActive = true;
    twoMoved = false;
    twoStartT = performance.now();
    startDist = hyp(a.x, a.y, b.x, b.y);
    startScale = viewScale;
    lastCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
});

video.addEventListener("pointermove", (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX;
  p.y = e.clientY;

  // two-finger: pinch-zoom + pan (zoomed) or scroll (at 1x)
  if (pts.size >= 2 && twoActive) {
    const [a, b] = twoPts();
    const d = hyp(a.x, a.y, b.x, b.y);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const dcx = cx - lastCentroid.x;
    const dcy = cy - lastCentroid.y;
    if (Math.abs(d - startDist) > TAP_SLOP || Math.abs(dcx) + Math.abs(dcy) > 1) twoMoved = true;

    if (startDist > 0 && Math.abs(d - startDist) > 2) {
      zoomAbout(cx, cy, startScale * (d / startDist));
    }
    if (viewScale > 1.01) {
      tx += dcx;
      ty += dcy;
      clampPan();
      applyView();
    } else if (Math.abs(dcx) + Math.abs(dcy) > 1) {
      send({ t: "scroll", dx: -Math.round(dcx / 2), dy: -Math.round(dcy / 2) });
    }
    lastCentroid = { x: cx, y: cy };
    return;
  }

  if (pts.size !== 1) return;
  if (hyp(e.clientX, e.clientY, p.sx, p.sy) > TAP_SLOP) oneMoved = true;

  if (mode === "direct") {
    if (!oneMoved) return;
    if (!oneDown) {
      // first movement promotes the tap into a press-drag at the start point
      const start = toNormalized(p.sx, p.sy);
      if (start) {
        oneDown = true;
        send({ t: "md", b: "left", x: start.x, y: start.y });
      }
    }
    const n = toNormalized(e.clientX, e.clientY);
    if (n) queueMove(n.x, n.y);
  } else {
    // trackpad: relative cursor motion (incremental delta each move)
    const rect = video.getBoundingClientRect();
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const fit = Math.min(rect.width / vw, rect.height / vh);
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    p.sx = e.clientX;
    p.sy = e.clientY;
    cursor.x = Math.min(1, Math.max(0, cursor.x + (dx * TRACKPAD_SENS) / (vw * fit)));
    cursor.y = Math.min(1, Math.max(0, cursor.y + (dy * TRACKPAD_SENS) / (vh * fit)));
    positionCursor();
    queueMove(cursor.x, cursor.y);
  }
});

function endPointer(e: PointerEvent) {
  const p = pts.get(e.pointerId);
  const now = performance.now();
  pts.delete(e.pointerId);

  if (twoActive) {
    if (pts.size < 2) {
      twoActive = false;
      if (now - twoStartT < TAP_MS && !twoMoved) {
        // two-finger tap = right click
        const n = mode === "trackpad" ? cursor : p && toNormalized(p.x, p.y);
        if (n) send({ t: "click", b: "right", x: n.x, y: n.y });
      }
      if (pts.size === 1) suppressLeftover = true; // avoid jump from the remaining finger
    }
    return;
  }

  if (pts.size === 0 && suppressLeftover) {
    suppressLeftover = false;
    return;
  }

  const wasTap = now - oneStartT < TAP_MS && !oneMoved;
  if (mode === "direct") {
    if (oneDown) {
      const n = p ? toNormalized(p.x, p.y) : null;
      if (n) send({ t: "mu", b: "left", x: n.x, y: n.y });
      oneDown = false;
    } else if (wasTap) {
      const n = p ? toNormalized(p.x, p.y) : null;
      if (n) send({ t: "click", b: "left", x: n.x, y: n.y });
    }
  } else {
    if (oneDown) {
      send({ t: "mu", b: "left", x: cursor.x, y: cursor.y });
      oneDown = false;
    } else if (wasTap) {
      send({ t: "click", b: "left", x: cursor.x, y: cursor.y });
      lastTapEnd = now;
    }
  }
}
video.addEventListener("pointerup", endPointer);
video.addEventListener("pointercancel", endPointer);

// Desktop wheel (handy when testing in a browser).
video.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    send({ t: "scroll", dx: Math.round(e.deltaX / 40), dy: Math.round(e.deltaY / 40) });
  },
  { passive: false },
);

// ------------------------------------------------------------- toolbar ------

$("btn-mode").addEventListener("click", () => setMode(mode === "direct" ? "trackpad" : "direct"));
$("btn-reset").addEventListener("click", resetView);
$("btn-disconnect").addEventListener("click", () => disconnect("Disconnected"));
$("btn-kbd").addEventListener("click", () => {
  kbd.value = "";
  kbd.focus();
});
$("btn-zoom").addEventListener("click", () => {
  // cycle 100% -> 200% -> 300% -> 100% about the screen center
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  zoomAbout(cx, cy, viewScale >= 3 ? 1 : viewScale + 1);
});

setMode("direct");

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

// ------------------------------------------------------------- install ------

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let deferredInstall: BeforeInstallPromptEvent | null = null;
const installBtn = $<HTMLButtonElement>("btn-install");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // keep the event so we can trigger it from our button
  deferredInstall = e as BeforeInstallPromptEvent;
  if (!matchMedia("(display-mode: standalone)").matches) installBtn.style.display = "";
});
installBtn.addEventListener("click", async () => {
  if (!deferredInstall) return;
  await deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  installBtn.style.display = "none";
});
window.addEventListener("appinstalled", () => {
  installBtn.style.display = "none";
});

// Register PWA service worker (best-effort).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
