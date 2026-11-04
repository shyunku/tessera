import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..");
export const isDev = !app.isPackaged;

// Development keeps its data inside the repository so it never touches the installed app's data.
export function configureUserData() {
  if (isDev) app.setPath("userData", path.join(repoRoot, ".devdata"));
}

export function dataDir() {
  return path.join(app.getPath("userData"), "data");
}

// Where Keyhub 0.5.x kept its data. Read only; used once for migration.
export function legacyDir() {
  if (process.env.TESSERA_LEGACY_DIR) return process.env.TESSERA_LEGACY_DIR;
  if (isDev) return path.join(repoRoot, "datafiles", "v1");
  return path.join(app.getPath("appData"), "Keyhub", "datafiles", "v1");
}

export const preloadPath = path.join(here, "preload.cjs");
export const rendererIndex = path.join(repoRoot, "build", "renderer", "index.html");
