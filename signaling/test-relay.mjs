// Quick relay smoke test against `wrangler dev` on 127.0.0.1:8787.
// Verifies: role pairing notices + verbatim offer/answer/ice relay + reject 3rd peer.
const BASE = "ws://127.0.0.1:8787/ws?code=483921";
const log = [];
const rec = (who, m) => { log.push(`${who} <= ${m}`); };

function open(role) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}&role=${role}`);
    ws.onmessage = (e) => rec(role, e.data);
    ws.onopen = () => resolve(ws);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const host = await open("host");
await wait(200);
const ctrl = await open("controller");
await wait(300); // let peer-joined notices flow

host.send(JSON.stringify({ type: "offer", sdp: "FAKE_SDP_OFFER" }));
await wait(200);
ctrl.send(JSON.stringify({ type: "answer", sdp: "FAKE_SDP_ANSWER" }));
ctrl.send(JSON.stringify({ type: "ice", candidate: { candidate: "c1" } }));
await wait(300);

// third peer in host slot must be rejected with {type:"full"}
const dupe = await open("host");
await wait(300);

const assert = (cond, name) => console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
const has = (who, sub) => log.some((l) => l.startsWith(who) && l.includes(sub));

assert(has("controller", '"peer-joined"'), "controller notified peer-joined");
assert(has("host", '"peer-joined"'), "host notified peer-joined");
assert(has("controller", "FAKE_SDP_OFFER"), "offer relayed host->controller");
assert(has("host", "FAKE_SDP_ANSWER"), "answer relayed controller->host");
assert(has("host", '"ice"'), "ice relayed controller->host");
assert(has("host", '"full"'), "3rd host rejected with full");

console.log("\n--- transcript ---");
for (const l of log) console.log(l);
host.close(); ctrl.close(); dupe.close();
await wait(100);
process.exit(0);
