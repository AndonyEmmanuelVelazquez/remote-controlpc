// Headless end-to-end test of the full WebRTC path through the local signaling Worker:
//   pairing -> SDP offer/answer relay -> ICE -> DTLS -> data channel input message.
// Proves the controller->host input pipe works over a real peer connection.
//
// Prereq: `wrangler dev` running in ../signaling on 127.0.0.1:8787.
import { RTCPeerConnection } from "werift";

const SIG = "ws://127.0.0.1:8787/ws?code=778899";
const STUN = [{ urls: "stun:stun.l.google.com:19302" }];
const PAYLOAD = JSON.stringify({ t: "type", text: "hello from controller" });

const fail = (m) => { console.log("FAIL ", m); process.exit(1); };
const timer = setTimeout(() => fail("timed out before data channel message arrived"), 25000);

function ws(role) {
  const sock = new WebSocket(`${SIG}&role=${role}`);
  return sock;
}
const sendSig = (sock, obj) => sock.send(JSON.stringify(obj));

// Normalize werift's emitted ICE candidate to a JSON-safe init object.
function iceInit(c) {
  const cand = c?.candidate?.candidate !== undefined ? c.candidate : c;
  if (!cand || cand.candidate == null) return null;
  return { candidate: cand.candidate, sdpMid: cand.sdpMid, sdpMLineIndex: cand.sdpMLineIndex };
}

// ---- HOST (shares screen, reads input) ----
const hostPc = new RTCPeerConnection({ iceServers: STUN });
const hostWs = ws("host");
const hostChan = hostPc.createDataChannel("input");
let got = false;

hostChan.onMessage.subscribe((data) => {
  const text = typeof data === "string" ? data : Buffer.from(data).toString();
  if (text === PAYLOAD) {
    got = true;
    clearTimeout(timer);
    console.log("PASS  pairing + offer/answer relay");
    console.log("PASS  ICE + DTLS established (connectionState=" + hostPc.connectionState + ")");
    console.log("PASS  data channel open host<->controller");
    console.log("PASS  controller input message received intact: " + text);
    cleanup(0);
  } else {
    fail("input payload mismatch: " + text);
  }
});

hostPc.onIceCandidate.subscribe((c) => {
  const init = iceInit(c);
  if (init) sendSig(hostWs, { type: "ice", candidate: init });
});

hostWs.onmessage = async (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "peer-joined" && msg.role === "controller") {
    const offer = await hostPc.createOffer();
    await hostPc.setLocalDescription(offer);
    sendSig(hostWs, { type: "offer", sdp: hostPc.localDescription.sdp });
  } else if (msg.type === "answer") {
    await hostPc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
  } else if (msg.type === "ice") {
    await hostPc.addIceCandidate(msg.candidate).catch(() => {});
  }
};

// ---- CONTROLLER (sends input) ----
const ctrlPc = new RTCPeerConnection({ iceServers: STUN });
const ctrlWs = ws("controller");

ctrlPc.onDataChannel.subscribe((ch) => {
  ch.stateChanged.subscribe((s) => {
    if (s === "open") ch.send(PAYLOAD);
  });
});

ctrlPc.onIceCandidate.subscribe((c) => {
  const init = iceInit(c);
  if (init) sendSig(ctrlWs, { type: "ice", candidate: init });
});

ctrlWs.onmessage = async (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === "offer") {
    await ctrlPc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
    const answer = await ctrlPc.createAnswer();
    await ctrlPc.setLocalDescription(answer);
    sendSig(ctrlWs, { type: "answer", sdp: ctrlPc.localDescription.sdp });
  } else if (msg.type === "ice") {
    await ctrlPc.addIceCandidate(msg.candidate).catch(() => {});
  }
};

function cleanup(code) {
  try { hostPc.close(); ctrlPc.close(); hostWs.close(); ctrlWs.close(); } catch {}
  setTimeout(() => process.exit(code), 150);
}
