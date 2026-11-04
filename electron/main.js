import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { pathToFileURL } from "node:url";
import { configureUserData, isDev, preloadPath, rendererIndex } from "./paths.js";

configureUserData();

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const pageUrl = isDev && devServerUrl ? devServerUrl : pathToFileURL(rendererIndex).href;

let mainWindow = null;

function isAppUrl(url) {
  if (!url) return false;
  if (pageUrl.startsWith("file:")) return url.startsWith(pageUrl.split("#")[0].split("?")[0]);
  return new URL(url).origin === new URL(pageUrl).origin;
}

// Every IPC call must come from our own page in the main frame.
export function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !isAppUrl(frame.url)) {
      throw new Error("Rejected IPC from an unknown frame");
    }
    return fn(payload, event);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: "#f4f6f8",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#f4f6f8", symbolColor: "#5d5f60", height: 48 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(pageUrl);
}

function harden() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on("web-contents-created", (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAppUrl(url)) event.preventDefault();
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  handle("app:info", () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
  }));

  app.whenReady().then(() => {
    harden();
    createWindow();
  });

  app.on("window-all-closed", () => app.quit());
}
