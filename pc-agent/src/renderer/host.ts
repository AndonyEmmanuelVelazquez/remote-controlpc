import { SignalingClient } from "../../../shared/signaling";
import { buildIceServers } from "../../../shared/types";
import type { InputEvent, SignalMessage, TurnConfig } from "../../../shared/types";

// preload-exposed bridge
declare global {
  interface Window {
    agent: {
      getConfig(): Promise<{
        signalingUrl: string;
        code: string;
        configured: boolean;
        turn: TurnConfig;
      }>;
      setSignalingUrl(url: string): Promise<boolean>;
      setTurn(turn: TurnConfig): Promise<boolean>;
      isTrusted(deviceId: string): Promise<boolean>;
      trustDevice(deviceId: string, name: string): Promise<boolean>;
      forgetDevices(): Promise<boolean>;
      setArmed(value: boolean): void;
      sendInput(ev: InputEvent): void;
    };
  }
}

const $ = (id: string) => document.getElementById(id)!;
const codeEl = $("code");
const codeHintEl = $("code-hint");
const statusEl = $("status");
const dotEl = $("dot");
const promptEl = $("prompt");
const peerNameEl = $("peer-name");
const previewEl = $("preview") as HTMLVideoElement;
const setupEl = $("setup");
const sigInputEl = $("sig-input") as HTMLInputElement;
const turnUrlEl = $("turn-url") as HTMLInputElement;
const turnUserEl = $("turn-user") as HTMLInputElement;
const turnCredEl = $("turn-cred") as HTMLInputElement;

function setStatus(text: string, state: "" | "wait" | "live" = "") {
  statusEl.textContent = text;
  dotEl.className = "dot" + (state ? " " + state : "");
}

let code = "";
let pc: RTCPeerConnection | null = null;
let signaling: SignalingClient;
let pendingDevice: { id: string; name: string } | null = null;
let helloTimer: number | undefined;
let iceRestartInFlight = false; // guards against double-sending a restart offer
let restartedSinceConnected = false; // a 2nd "failed" after a restart ends the session

let currentUrl = "";
let turnCfg: TurnConfig = {};

async function main() {
  const cfg = await window.agent.getConfig();
  code = cfg.code;
  currentUrl = cfg.signalingUrl;
  turnCfg = cfg.turn ?? {};
  codeEl.textContent = `${code.slice(0, 3)}-${code.slice(3)}`;

  if (cfg.configured) startSignaling(currentUrl);
  else showSetup(currentUrl);
}

function startSignaling(url: string) {
  hideSetup();
  currentUrl = url;
  signaling = new SignalingClient(
    url,
    code,
    "host",
    {
      onOpen: () => setStatus(pc ? "Reconnecting controller…" : "Waiting for controller…", "wait"),
      onReconnecting: () => setStatus("Signaling lost — reconnecting…", "wait"),
      onError: () => setStatus("Signaling error — check your server URL", ""),
      onMessage: handleSignal,
    },
    { autoReconnect: true },
  );
  signaling.connect();
}

function showSetup(prefill: string) {
  setupEl.classList.add("show");
  codeEl.style.display = "none";
  codeHintEl.style.display = "none";
  sigInputEl.value = prefill && prefill !== "ws://127.0.0.1:8787" ? prefill : "";
  turnUrlEl.value = turnCfg.url ?? "";
  turnUserEl.value = turnCfg.username ?? "";
  turnCredEl.value = turnCfg.credential ?? "";
  setStatus("Configure your signaling server to begin", "");
  sigInputEl.focus();
}
function hideSetup() {
  setupEl.classList.remove("show");
  codeEl.style.display = "";
  codeHintEl.style.display = "";
}

$("sig-save").addEventListener("click", async () => {
  const raw = sigInputEl.value.trim();
  if (!raw) return setStatus("Enter your signaling server URL", "");
  const url = raw.replace(/\/+$/, "").replace(/^http/, "ws"); // accept http(s)/ws(s)
  await window.agent.setSignalingUrl(url);
  await window.agent.setTurn({
    url: turnUrlEl.value.trim(),
    username: turnUserEl.value.trim(),
    credential: turnCredEl.value.trim(),
  });
  location.reload(); // re-init cleanly with the saved config
});

$("settings-btn").addEventListener("click", () => {
  if (pc) return; // don't change servers mid-session
  signaling?.close();
  showSetup(currentUrl);
});

function handleSignal(msg: SignalMessage) {
  switch (msg.type) {
    case "peer-joined":
      if (msg.role === "controller") {
        // Controller's signaling came back mid-session (it dropped and the room
        // re-paired us): renegotiate the existing link instead of re-prompting.
        if (pc) {
          setStatus("Reconnecting controller…", "wait");
          void sendRestartOffer();
          break;
        }
        setStatus("Controller connecting…", "wait");
        // Wait briefly for the device's hello; if none, fall back to a manual prompt.
        clearTimeout(helloTimer);
        helloTimer = window.setTimeout(() => {
          if (!pc) promptFor(null, "Unknown device");
        }, 2000);
      }
      break;
    case "hello":
      clearTimeout(helloTimer);
      void onHello(msg.deviceId, msg.name || "Phone");
      break;
    case "answer":
      pc?.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      break;
    case "ice":
      pc?.addIceCandidate(msg.candidate).catch(() => {});
      break;
    case "peer-left":
      teardown("Controller disconnected");
      break;
    case "error":
      setStatus("Error: " + msg.message, "");
      break;
  }
}

async function onHello(deviceId: string, name: string) {
  if (pc) return; // session already active; a re-hello on reconnect needs no prompt
  pendingDevice = { id: deviceId, name };
  if (await window.agent.isTrusted(deviceId)) {
    setStatus(`Trusted device (${name}) — connecting…`, "wait");
    await startSession();
  } else {
    promptFor(deviceId, name);
  }
}

function promptFor(deviceId: string | null, name: string) {
  if (pc) return; // session already active
  if (deviceId) pendingDevice = { id: deviceId, name };
  peerNameEl.textContent = name;
  promptEl.classList.add("show");
  setStatus("Controller connecting — awaiting your approval", "wait");
}

$("deny").addEventListener("click", () => {
  promptEl.classList.remove("show");
  pendingDevice = null;
  setStatus("Denied. Waiting for controller…", "wait");
});

$("allow").addEventListener("click", async () => {
  promptEl.classList.remove("show");
  await startSession();
});

$("always").addEventListener("click", async () => {
  promptEl.classList.remove("show");
  if (pendingDevice) await window.agent.trustDevice(pendingDevice.id, pendingDevice.name);
  await startSession();
});

async function startSession() {
  clearTimeout(helloTimer);
  if (pc) return; // guard against double-start
  setStatus("Capturing screen…", "wait");
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 } as MediaTrackConstraints,
    audio: false,
  });
  previewEl.srcObject = stream;

  pc = new RTCPeerConnection({ iceServers: buildIceServers(turnCfg) });
  for (const track of stream.getTracks()) pc.addTrack(track, stream);

  // Host creates the input channel; controller writes to it, host reads.
  const channel = pc.createDataChannel("input", { ordered: true });
  channel.onopen = () => {
    window.agent.setArmed(true);
    setStatus("Connected — remote control active", "live");
  };
  channel.onclose = () => {
    window.agent.setArmed(false);
  };
  channel.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data) as InputEvent;
      window.agent.sendInput(ev);
    } catch {
      /* ignore malformed input */
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) signaling.send({ type: "ice", candidate: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    const st = pc?.connectionState;
    if (st === "connected") {
      restartedSinceConnected = false;
      window.agent.setArmed(true);
      setStatus("Connected — remote control active", "live");
    } else if (st === "disconnected") {
      // Often self-heals; give ICE a moment before forcing a restart.
      setStatus("Connection unstable — recovering…", "wait");
    } else if (st === "failed") {
      if (restartedSinceConnected) teardown("Connection failed"); // already retried, still down
      else void sendRestartOffer();
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signaling.send({ type: "offer", sdp: offer.sdp! });
  setStatus("Negotiating connection…", "wait");
}

// Re-negotiate ICE on the existing connection (offerer side). Used when the path
// breaks or the controller's signaling reconnects mid-session. The data channel
// and media tracks survive the restart, so an approved session stays approved.
async function sendRestartOffer() {
  if (!pc || iceRestartInFlight) return;
  iceRestartInFlight = true;
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    signaling.send({ type: "offer", sdp: offer.sdp! });
    restartedSinceConnected = true;
    setStatus("Recovering connection…", "wait");
  } catch {
    teardown("Connection failed");
  } finally {
    iceRestartInFlight = false;
  }
}

function teardown(reason: string) {
  window.agent.setArmed(false);
  pc?.close();
  pc = null;
  pendingDevice = null;
  iceRestartInFlight = false;
  restartedSinceConnected = false;
  const s = previewEl.srcObject as MediaStream | null;
  s?.getTracks().forEach((t) => t.stop());
  previewEl.srcObject = null;
  setStatus(reason + " — waiting for controller…", "wait");
}

main();
