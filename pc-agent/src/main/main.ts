import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
} from "electron";
import { join } from "node:path";
import { dispatch, invalidateScreenSize } from "./input";
import type { InputEvent } from "../../../shared/types";

// Signaling endpoint. Override for production with SIGNALING_URL env var, e.g.
//   set SIGNALING_URL=wss://remote-control-signaling.<sub>.workers.dev
const SIGNALING_URL = process.env.SIGNALING_URL ?? "ws://127.0.0.1:8787";

// Input is only actuated while a controller is authorized (renderer arms it after
// the user clicks "Allow"). Defense in depth against stray IPC.
let armed = false;

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

ipcMain.handle("get-config", () => ({ signalingUrl: SIGNALING_URL }));

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

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
