import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, session, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { configureUserData, dataDir, isDev, legacyDir, preloadPath, rendererIndex, repoRoot } from "./paths.js";
import { Service } from "./service.js";
import { registerIpc } from "./ipc.js";

configureUserData();

// A packaged build never exposes a debugging port (it would let other local programs read the page).
if (!isDev && (app.commandLine.hasSwitch("remote-debugging-port") || app.commandLine.hasSwitch("remote-debugging-pipe"))) {
  app.exit(1);
}

const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const pageUrl = isDev && devServerUrl ? devServerUrl : pathToFileURL(rendererIndex).href;

let mainWindow = null;
let service = null;

function isAppUrl(url) {
  if (!url) return false;
  if (pageUrl.startsWith("file:")) return url.split("#")[0].split("?")[0] === pageUrl;
  try {
    return new URL(url).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

// IPC must come from our own page, in the main frame of our window.
function isTrustedSender(event) {
  const frame = event.senderFrame;
  return !!frame && !!mainWindow && event.sender === mainWindow.webContents && frame === event.sender.mainFrame && isAppUrl(frame.url);
}

function emit(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
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
    icon: isDev ? path.join(repoRoot, "resources", "icon.png") : undefined,
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
  mainWindow.on("minimize", () => service?.onMinimize());
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

function registerAppIpc() {
  const guard = (fn) => (event, payload) => {
    if (!isTrustedSender(event)) return { ok: false, error: { code: "forbidden", message: "Rejected" } };
    return fn(payload);
  };
  ipcMain.handle("app:info", guard(() => ({ name: app.getName(), version: app.getVersion(), electron: process.versions.electron })));
  // The page tells us its chrome colours and bar height so the native window buttons match.
  ipcMain.handle(
    "app:titleBar",
    guard((p) => {
      if (!mainWindow) return { ok: true, data: null };
      const hex = (c) => (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c) ? c : undefined);
      const height = [32, 48].includes(p?.height) ? p.height : 48;
      mainWindow.setTitleBarOverlay({ color: hex(p?.color), symbolColor: hex(p?.symbolColor), height });
      if (hex(p?.color)) mainWindow.setBackgroundColor(p.color);
      return { ok: true, data: null };
    })
  );
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    harden();
    const filters = [{ name: "Tessera 백업", extensions: ["tessera"] }];
    const dialogs = {
      save: async (name) => {
        const r = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(app.getPath("documents"), name), filters });
        return r.canceled ? null : r.filePath;
      },
      open: async () => {
        const r = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"], filters });
        return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
      },
    };
    // Automated UI checks in development can skip the native file dialogs.
    if (isDev && process.env.TESSERA_E2E_BACKUP_PATH) {
      dialogs.save = async () => process.env.TESSERA_E2E_BACKUP_PATH;
      dialogs.open = async () => process.env.TESSERA_E2E_BACKUP_PATH;
    }
    service = new Service({ dataDir: dataDir(), legacyDir: legacyDir(), clipboard, emit, dialogs, appVersion: app.getVersion() });
    registerIpc(service, isTrustedSender);
    registerAppIpc();
    service.startIdleWatch();
    // Lock when Windows locks the screen or the machine goes to sleep.
    powerMonitor.on("lock-screen", () => service.lock("system"));
    powerMonitor.on("suspend", () => service.lock("system"));
    createWindow();
  });

  app.on("before-quit", () => service?.dispose());
  app.on("window-all-closed", () => app.quit());
}
