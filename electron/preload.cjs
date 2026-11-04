// Runs in a sandboxed preload: only the APIs below reach the page.
const { contextBridge, ipcRenderer } = require("electron");

async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (res && res.ok) return res.data;
  // Error objects lose extra properties when they cross contextBridge, so reject with a plain object.
  throw {
    code: (res && res.error && res.error.code) || "internal",
    message: (res && res.error && res.error.message) || "Unknown error",
  };
}

const EVENTS = ["vault:locked", "clipboard:cleared", "settings:changed", "legacy:progress"];

contextBridge.exposeInMainWorld("tessera", {
  app: {
    info: () => ipcRenderer.invoke("app:info"),
    status: () => call("app:status"),
    setTitleBar: (opts) => call("app:titleBar", opts),
    activity: () => call("app:activity"),
  },
  vault: {
    create: (password) => call("vault:create", { password }),
    unlock: (password) => call("vault:unlock", { password }),
    lock: () => call("vault:lock"),
    reset: (password, confirm) => call("vault:reset", { password, confirm }),
    snapshot: () => call("data:snapshot"),
  },
  legacy: {
    migrate: (password) => call("legacy:migrate", { password }),
  },
  items: {
    open: (id) => call("item:open", { id }),
    get: (id) => call("item:get", { id }),
    forEdit: (id) => call("item:forEdit", { id }),
    create: (folderId, name, fields) => call("item:create", { folderId, name, fields }),
    update: (id, name, fields) => call("item:update", { id, name, fields }),
    remove: (id) => call("item:delete", { id }),
    duplicate: (id) => call("item:duplicate", { id }),
    favorite: (id, favorite) => call("item:favorite", { id, favorite }),
    move: (id, folderId) => call("item:move", { id, folderId }),
  },
  fields: {
    reveal: (id) => call("field:reveal", { id }),
    copy: (id) => call("field:copy", { id }),
    clearClipboard: () => call("clipboard:clear"),
  },
  folders: {
    create: (parentId, name) => call("folder:create", { parentId, name }),
    rename: (id, name) => call("folder:rename", { id, name }),
    remove: (id, mode) => call("folder:delete", { id, mode }),
    move: (id, parentId, index) => call("folder:move", { id, parentId, index }),
  },
  history: {
    undo: () => call("history:undo"),
    redo: () => call("history:redo"),
  },
  settings: {
    set: (key, value) => call("settings:set", { key, value }),
  },
  password: {
    change: (current, next) => call("password:change", { current, next }),
    verify: (password) => call("password:verify", { password }),
  },
  backup: {
    exportTo: (password) => call("backup:export", { password }),
    pick: () => call("backup:pick"),
    importFrom: (token, password, mode) => call("backup:import", { token, password, mode }),
  },
  on(event, cb) {
    if (!EVENTS.includes(event)) throw new Error(`Unknown event ${event}`);
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
