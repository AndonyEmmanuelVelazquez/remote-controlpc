import { contextBridge, ipcRenderer } from "electron";
import type { InputEvent } from "../../shared/types";

// Minimal, explicit surface exposed to the renderer. No Node access leaks through.
contextBridge.exposeInMainWorld("agent", {
  getConfig: (): Promise<{ signalingUrl: string }> => ipcRenderer.invoke("get-config"),
  setArmed: (value: boolean): void => ipcRenderer.send("set-armed", value),
  sendInput: (ev: InputEvent): void => ipcRenderer.send("input", ev),
});
