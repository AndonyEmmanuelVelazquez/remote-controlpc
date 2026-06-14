import { SignalingClient } from "../../../shared/signaling";
import { ICE_SERVERS, generatePairingCode, normalizeCode } from "../../../shared/types";
import type { InputEvent, SignalMessage } from "../../../shared/types";

// preload-exposed bridge
declare global {
  interface Window {
    agent: {
      getConfig(): Promise<{ signalingUrl: string }>;
      setArmed(value: boolean): void;
      sendInput(ev: InputEvent): void;
    };
  }
}

const $ = (id: string) => document.getElementById(id)!;
const codeEl = $("code");
const statusEl = $("status");
const dotEl = $("dot");
const promptEl = $("prompt");
const previewEl = $("preview") as HTMLVideoElement;

function setStatus(text: string, state: "" | "wait" | "live" = "") {
  statusEl.textContent = text;
  dotEl.className = "dot" + (state ? " " + state : "");
}

const codeDisplay = generatePairingCode(); // "NNN-NNN"
const code = normalizeCode(codeDisplay); // "NNNNNN"
codeEl.textContent = codeDisplay;

let pc: RTCPeerConnection | null = null;
let signaling: SignalingClient;

async function main() {
  const { signalingUrl } = await window.agent.getConfig();

  signaling = new SignalingClient(signalingUrl, code, "host", {
    onOpen: () => setStatus("Waiting for controller…", "wait"),
    onClose: () => setStatus("Signaling disconnected", ""),
    onError: () => setStatus("Signaling error — check SIGNALING_URL", ""),
    onMessage: handleSignal,
  });
  signaling.connect();
}

function handleSignal(msg: SignalMessage) {
  switch (msg.type) {
    case "peer-joined":
      if (msg.role === "controller") {
        setStatus("Controller connecting — awaiting your approval", "wait");
        promptEl.classList.add("show");
      }
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

$("deny").addEventListener("click", () => {
  promptEl.classList.remove("show");
  setStatus("Denied. Waiting for controller…", "wait");
});

$("allow").addEventListener("click", async () => {
  promptEl.classList.remove("show");
  await startSession();
});

async function startSession() {
  setStatus("Capturing screen…", "wait");
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 30 } as MediaTrackConstraints,
    audio: false,
  });
  previewEl.srcObject = stream;

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
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
    if (pc?.connectionState === "failed") teardown("Connection failed");
    if (pc?.connectionState === "disconnected") teardown("Controller disconnected");
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signaling.send({ type: "offer", sdp: offer.sdp! });
  setStatus("Negotiating connection…", "wait");
}

function teardown(reason: string) {
  window.agent.setArmed(false);
  pc?.close();
  pc = null;
  const s = previewEl.srcObject as MediaStream | null;
  s?.getTracks().forEach((t) => t.stop());
  previewEl.srcObject = null;
  setStatus(reason + " — waiting for controller…", "wait");
}

main();
