import { contextBridge, ipcRenderer } from "electron";
import type { InputEvent } from "../../shared/types";

// Minimal, explicit surface exposed to the renderer. No Node access leaks through.
contextBridge.exposeInMainWorld("agent", {
  getConfig: (): Promise<{ signalingUrl: string; code: string; configured: boolean }> =>
    ipcRenderer.invoke("get-config"),
  setSignalingUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke("set-signaling-url", url),
  isTrusted: (deviceId: string): Promise<boolean> =>
    ipcRenderer.invoke("is-trusted", deviceId),
  trustDevice: (deviceId: string, name: string): Promise<boolean> =>
    ipcRenderer.invoke("trust-device", deviceId, name),
  forgetDevices: (): Promise<boolean> => ipcRenderer.invoke("forget-devices"),
  setArmed: (value: boolean): void => ipcRenderer.send("set-armed", value),
  sendInput: (ev: InputEvent): void => ipcRenderer.send("input", ev),
});
