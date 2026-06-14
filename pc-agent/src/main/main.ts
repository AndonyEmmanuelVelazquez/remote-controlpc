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
import type { InputEvent } from "../../../shared/types";

// Signaling endpoint. Baked at build time from SIGNALING_URL (see build.mjs); a runtime
// SIGNALING_URL env var still overrides it. Lets a packaged app ship a working default.
declare const __SIGNALING_DEFAULT__: string;
const SIGNALING_URL = process.env.SIGNALING_URL ?? __SIGNALING_DEFAULT__;

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
  signalingUrl: SIGNALING_URL,
  code: getOrCreateCode(),
}));

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
