import { contextBridge, ipcRenderer } from "electron";

// Only the app's own start screen gets this. A window showing the user's
// server has no preload at all, so a page from there can't reach any of it.
contextBridge.exposeInMainWorld("dossier", {
  state: () => ipcRenderer.invoke("start:state"),
  connect: (address: string, confirmedUnencrypted: boolean) => ipcRenderer.invoke("start:connect", address, confirmedUnencrypted),
  retry: () => ipcRenderer.invoke("start:retry"),
  useThisComputer: () => ipcRenderer.invoke("start:local"),
  openReleases: () => ipcRenderer.invoke("start:releases"),
});
