import { contextBridge, ipcRenderer } from "electron";

// Only the app's own top bar gets this.
contextBridge.exposeInMainWorld("bar", {
  openMenu: (index: number, x: number, y: number) => ipcRenderer.send("bar:menu", index, x, y),
  onColors: (listener: (colors: { background: string; ink: string }) => void) => {
    ipcRenderer.on("bar:colors", (_event, colors) => listener(colors));
  },
});
