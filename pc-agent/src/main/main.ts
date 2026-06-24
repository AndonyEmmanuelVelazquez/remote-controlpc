import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
} from "electron";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { dispatch, invalidateScreenSize } from "./input";
import type { InputEvent, TurnConfig } from "../../../shared/types";

// Signaling endpoint resolution order (first non-empty wins):
//   1. SIGNALING_URL env var (runtime override)
//   2. saved config.json (set by the user in the app's setup screen)
//   3. __SIGNALING_DEFAULT__ baked at build time (see build.mjs)
// Each user runs their OWN signaling server, so distributable builds bake no real URL and
// prompt for one on first run. The owner's build can bake a URL for a one-click experience.
declare const __SIGNALING_DEFAULT__: string;
const DEV_DEFAULT = "ws://127.0.0.1:8787";

type AppConfig = { signalingUrl?: string; turn?: TurnConfig };
function loadConfig(): AppConfig {
  return loadJson<AppConfig>("config.json", {});
}
function resolveSignalingUrl(): string {
  return process.env.SIGNALING_URL || loadConfig().signalingUrl || __SIGNALING_DEFAULT__;
}
// "Configured" = the user has a real, deliberate URL (env, saved config, or a non-dev
// baked default). If not, the renderer shows the first-run setup screen.
function isConfigured(): boolean {
  if (process.env.SIGNALING_URL) return true;
  if (loadConfig().signalingUrl) return true;
  return !!__SIGNALING_DEFAULT__ && __SIGNALING_DEFAULT__ !== DEV_DEFAULT;
}

// Input is only actuated while a controller is authorized (renderer arms it after
// the user clicks "Allow"). Defense in depth against stray IPC.
let armed = false;

// ---- persistence (userData/*.json) -----------------------------------------
// Stable pairing code so a remembered phone can reconnect without retyping, and
// a set of trusted device IDs so a remembered phone skips the Allow prompt.
type TrustStore = Record<string, { name: string; since: number }>;
let trusted: TrustStore = {};

function storeFile(name: string): string {
  return join(app.getPath("userData"), name);
}
function loadJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(storeFile(name), "utf8")) as T;
  } catch {
    return fallback;
  }
}
function saveJson(name: string, value: unknown): void {
  try {
    writeFileSync(storeFile(name), JSON.stringify(value));
  } catch (err) {
    console.error("failed to persist", name, err);
  }
}
function getOrCreateCode(): string {
  const saved = loadJson<{ code?: string }>("code.json", {});
  if (saved.code && /^\d{6}$/.test(saved.code)) return saved.code;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  saveJson("code.json", { code });
  return code;
}

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 720,
    height: 540,
    title: "Remote Control PC Agent",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Auto-grant getDisplayMedia to the primary screen (no OS picker dialog).
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ["screen"] }).then((sources) => {
        invalidateScreenSize();
        callback({ video: sources[0] });
      });
    },
    { useSystemPicker: false },
  );

  win.loadFile(join(__dirname, "renderer/host.html"));
  win.on("closed", () => (win = null));
}

// ---- IPC from renderer ----------------------------------------------------

ipcMain.handle("get-config", () => ({
  signalingUrl: resolveSignalingUrl(),
  code: getOrCreateCode(),
  configured: isConfigured(),
  turn: loadConfig().turn ?? {},
}));

ipcMain.handle("set-signaling-url", (_e, url: string) => {
  const cfg = loadConfig();
  cfg.signalingUrl = url;
  saveJson("config.json", cfg);
  return true;
});

ipcMain.handle("set-turn", (_e, turn: TurnConfig) => {
  const cfg = loadConfig();
  // Empty url => drop TURN entirely (fall back to STUN-only).
  cfg.turn = turn?.url ? turn : undefined;
  saveJson("config.json", cfg);
  return true;
});

ipcMain.handle("is-trusted", (_e, deviceId: string) => !!trusted[deviceId]);

ipcMain.handle("trust-device", (_e, deviceId: string, name: string) => {
  trusted[deviceId] = { name: name || "", since: Date.now() };
  saveJson("trusted.json", trusted);
  return true;
});

ipcMain.handle("forget-devices", () => {
  trusted = {};
  saveJson("trusted.json", trusted);
  return true;
});

ipcMain.on("set-armed", (_e, value: boolean) => {
  armed = !!value;
});

ipcMain.on("input", async (_e, ev: InputEvent) => {
  if (!armed) return;
  try {
    await dispatch(ev);
  } catch (err) {
    console.error("input dispatch failed", err);
  }
});

// ---- lifecycle ------------------------------------------------------------

app.whenReady().then(() => {
  trusted = loadJson<TrustStore>("trusted.json", {});
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
