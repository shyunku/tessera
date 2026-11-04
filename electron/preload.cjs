// Runs in a sandboxed preload: only the APIs below reach the page.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("tessera", {
  app: {
    info: () => invoke("app:info"),
  },
});
