// IPC surface. Each channel maps to one Service/Vault call; results travel as
// { ok: true, data } or { ok: false, error: { code, message } }.
import { ipcMain } from "electron";

const str = (v) => (typeof v === "string" ? v : undefined);
const idOrNull = (v) => (v == null ? null : str(v));

export function registerIpc(service, isTrustedSender) {
  const v = () => service.vault;

  const routes = {
    "app:status": () => service.status(),
    "vault:create": (p) => service.create(str(p?.password)),
    "vault:unlock": (p) => service.unlock(str(p?.password)),
    "vault:lock": () => service.lock("manual"),
    "app:activity": () => service.noteActivity(),
    "legacy:migrate": (p) => service.migrateLegacy(str(p?.password)),

    "data:snapshot": () => v().snapshot(),
    "item:open": (p) => v().openItem(str(p?.id)),
    "item:get": (p) => v().getItem(str(p?.id)),
    "item:forEdit": (p) => v().itemForEdit(str(p?.id)),
    "item:create": (p) => v().createItem(idOrNull(p?.folderId), p?.name, p?.fields ?? []),
    "item:update": (p) => v().updateItem(str(p?.id), { name: p?.name, fields: p?.fields }),
    "item:delete": (p) => v().deleteItem(str(p?.id)),
    "item:duplicate": (p) => v().duplicateItem(str(p?.id)),
    "item:favorite": (p) => v().setFavorite(str(p?.id), !!p?.favorite),
    "item:move": (p) => v().moveItem(str(p?.id), idOrNull(p?.folderId)),

    "field:reveal": (p) => v().revealField(str(p?.id)),
    "field:copy": (p) => service.copyField(str(p?.id)),
    "clipboard:clear": () => service.clearClipboard(true),

    "folder:create": (p) => v().createFolder(idOrNull(p?.parentId), p?.name),
    "folder:rename": (p) => v().renameFolder(str(p?.id), p?.name),
    "folder:delete": (p) => v().deleteFolder(str(p?.id), p?.mode),
    "folder:move": (p) => v().moveFolder(str(p?.id), idOrNull(p?.parentId), p?.index),

    "history:undo": () => v().undo(),
    "history:redo": () => v().redo(),

    "settings:set": (p) => service.setSetting(str(p?.key), p?.value),
    "password:change": (p) => service.changePassword(str(p?.current), str(p?.next)),
    "password:verify": (p) => service.verifyPassword(str(p?.password)),
    "vault:reset": (p) => service.reset(str(p?.password), str(p?.confirm)),
    "backup:export": (p) => service.exportBackup(str(p?.password)),
    "backup:pick": () => service.pickBackup(),
    "backup:import": (p) => service.importBackup(str(p?.token), str(p?.password), p?.mode),
  };

  for (const [channel, fn] of Object.entries(routes)) {
    ipcMain.handle(channel, async (event, payload) => {
      if (!isTrustedSender(event)) return { ok: false, error: { code: "forbidden", message: "Rejected" } };
      try {
        const data = await fn(payload);
        return { ok: true, data: data === undefined ? null : data };
      } catch (e) {
        const known = e && (e.name === "VaultError" || e.code);
        if (!known) console.error(`[ipc] ${channel}`, e);
        return { ok: false, error: { code: (known && e.code) || "internal", message: known ? e.message : "처리 중 오류가 발생했습니다." } };
      }
    });
  }
  return Object.keys(routes);
}
