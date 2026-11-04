// Session controller: owns the Vault, unlock throttling, clipboard and lock events.
// Every method here is reachable from the renderer through ipc.js.
import fs from "node:fs";
import path from "node:path";
import { Vault, VaultError } from "./store/vault.js";
import { detectLegacy } from "./legacy/v1.js";
import { migrateLegacy } from "./legacy/migrate.js";
import crypto from "node:crypto";
import { encryptBackup, decryptBackup, readBackupHeader, MAX_BACKUP_BYTES } from "./backup.js";

const ymdOf = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
import { WrongPasswordError, CorruptDataError } from "./crypto/vault-crypto.js";

// A damaged file must never look like a wrong password: the user might then reset and lose data.
function corrupt(e) {
  if (e instanceof CorruptDataError) return new VaultError("corrupt", "데이터 파일이 손상되었거나 알 수 없는 형식입니다. 초기화하지 말고 백업을 확인하세요.");
  return e;
}

export const SETTINGS_DEFAULTS = Object.freeze({
  theme: "system", // system | light | dark
  autoLockMinutes: 5, // 0 = never
  clipboardSeconds: 30,
  maskValues: true,
  lockOnMinimize: true,
});

const SETTING_RULES = {
  theme: (v) => ["system", "light", "dark"].includes(v),
  autoLockMinutes: (v) => [0, 1, 5, 15, 30].includes(v),
  clipboardSeconds: (v) => [15, 30, 60].includes(v),
  maskValues: (v) => typeof v === "boolean",
  lockOnMinimize: (v) => typeof v === "boolean",
};

const MIN_PASSWORD = 8;
const MAX_FAILS = 5;
const LOCKOUT_MS = 30_000;

function checkNewPassword(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) {
    throw new VaultError("weak-password", `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`);
  }
}

export class Service {
  // deps: { dataDir, clipboard, emit(event, payload), legacy? }
  constructor({ dataDir, clipboard, emit, kdf, legacyDir, dialogs, appVersion }) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dataDir = dataDir;
    this.dialogs = dialogs; // { save(defaultName) -> path|null, open() -> path|null }
    this.appVersion = appVersion || "";
    this.pendingBackups = new Map();
    this.kdf = kdf;
    this.legacyDir = legacyDir;
    this.vault = new Vault(path.join(dataDir, "tessera.db"), kdf ? { kdf } : undefined);
    // Written once data exists (imported or new). After a reset the old data is not offered again.
    this.legacyDoneFile = path.join(dataDir, "legacy-handled");
    this.clipboard = clipboard;
    this.emit = emit || (() => {});
    this.fails = 0;
    this.lockedUntil = 0;
    this.clip = null; // { text, timer, until }
    this.lastActivity = Date.now();
    this.idleTimer = null;
  }

  // ---------- auto lock ----------

  // The page reports keyboard/mouse activity; the main process enforces the timeout.
  noteActivity() {
    this.lastActivity = Date.now();
  }

  checkIdle(now = Date.now()) {
    if (this.vault.state !== "unlocked") return false;
    const minutes = this.settings().autoLockMinutes;
    if (!minutes) return false;
    if (now - this.lastActivity < minutes * 60_000) return false;
    this.lock(`idle:${minutes}`);
    return true;
  }

  startIdleWatch(intervalMs = 5_000) {
    clearInterval(this.idleTimer);
    this.idleTimer = setInterval(() => this.checkIdle(), intervalMs);
    this.idleTimer.unref?.();
  }

  onMinimize() {
    if (this.settings().lockOnMinimize) this.lock("minimize");
  }

  // Old Keyhub data is offered only while there is no Tessera data yet.
  legacyInfo() {
    if (this.vault.state !== "empty" || fs.existsSync(this.legacyDoneFile)) return null;
    const l = detectLegacy(this.legacyDir);
    return l ? { account: l.account } : null;
  }

  async migrateLegacy(password) {
    if (this.vault.state !== "empty") throw new VaultError("exists", "이미 데이터가 있습니다.");
    const file = this.vault.file;
    this.vault.close();
    const report = await migrateLegacy({
      legacyDir: this.legacyDir,
      dataFile: file,
      password,
      kdf: this.kdf,
      onProgress: (p) => this.emit("legacy:progress", p),
    });
    await this.vault.unlock(password);
    this._markLegacyHandled();
    return { report, status: this.status() };
  }

  _markLegacyHandled() {
    try {
      fs.writeFileSync(this.legacyDoneFile, new Date().toISOString());
    } catch {
      // not fatal: the import offer may reappear after a reset
    }
  }

  // ---------- session ----------

  settings() {
    return { ...SETTINGS_DEFAULTS, ...this.vault.getSettings() };
  }

  status() {
    return {
      state: this.vault.state,
      settings: this.settings(),
      lockedUntil: this.lockedUntil > Date.now() ? this.lockedUntil : 0,
      createdAt: this.vault.state === "empty" ? null : Number(this.vault.meta("created_at")) || null,
      lastBackupAt: this.vault.state === "empty" ? null : Number(this.vault.meta("last_backup_at")) || null,
      legacy: this.legacyInfo(),
    };
  }

  async create(password) {
    checkNewPassword(password);
    await this.vault.create(password);
    this._markLegacyHandled();
    return this.status();
  }

  async unlock(password) {
    if (this.lockedUntil > Date.now()) {
      throw new VaultError("throttled", "잠시 후 다시 시도하세요.");
    }
    try {
      await this.vault.unlock(password);
    } catch (e) {
      if (!(e instanceof WrongPasswordError)) throw corrupt(e);
      this.fails += 1;
      const left = MAX_FAILS - this.fails;
      if (left <= 0) {
        this.fails = 0;
        this.lockedUntil = Date.now() + LOCKOUT_MS;
        throw new VaultError("throttled", "비밀번호를 5번 틀려서 30초 동안 입력할 수 없습니다.");
      }
      throw new VaultError("wrong-password", `비밀번호가 맞지 않습니다. (${left}번 남음)`);
    }
    this.fails = 0;
    this.lastActivity = Date.now();
    return this.status();
  }

  lock(reason = "manual") {
    if (this.vault.state !== "unlocked") return;
    this.clearClipboard(false); // a copied secret should not outlive the session
    this.vault.lock();
    this.emit("vault:locked", { reason });
  }

  // ---------- clipboard ----------

  copyField(fieldId) {
    const text = this.vault.revealField(fieldId);
    const label = this.vault.fieldName(fieldId);
    const seconds = this.settings().clipboardSeconds;
    this.clearClipboard(false);
    this.clipboard.writeText(text);
    const until = Date.now() + seconds * 1000;
    this.clip = { text, until, timer: setTimeout(() => this.clearClipboard(true), seconds * 1000) };
    return { label, seconds, until };
  }

  // Clears only if the clipboard still holds what we put there.
  clearClipboard(notify = true) {
    if (!this.clip) return false;
    clearTimeout(this.clip.timer);
    const ours = this.clipboard.readText() === this.clip.text;
    if (ours) this.clipboard.clear();
    this.clip = null;
    if (notify) this.emit("clipboard:cleared", { cleared: ours });
    return ours;
  }

  // ---------- settings ----------

  setSetting(key, value) {
    const rule = Object.hasOwn(SETTING_RULES, key) ? SETTING_RULES[key] : null;
    if (!rule || !rule(value)) throw new VaultError("invalid", "설정 값이 올바르지 않습니다.");
    this.vault.setSetting(key, value);
    this.emit("settings:changed", this.settings());
    return this.settings();
  }

  // ---------- account ----------

  async changePassword(current, next) {
    checkNewPassword(next);
    try {
      await this.vault.changePassword(current, next);
    } catch (e) {
      if (e instanceof WrongPasswordError) throw new VaultError("wrong-password", "현재 비밀번호가 맞지 않습니다.");
      throw corrupt(e);
    }
  }

  async verifyPassword(password) {
    try {
      await this.vault.verify(password);
    } catch (e) {
      if (e instanceof WrongPasswordError) throw new VaultError("wrong-password", "비밀번호가 맞지 않습니다.");
      throw corrupt(e);
    }
  }

  async reset(password, confirmText) {
    if (confirmText !== "초기화") throw new VaultError("invalid", "‘초기화’를 정확히 입력하세요.");
    await this.verifyPassword(password);
    this.clearClipboard(false);
    const file = this.vault.file;
    this.vault.close();
    for (const f of [file, `${file}-journal`, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    this.emit("vault:locked", { reason: "reset" });
    return this.status();
  }

  // ---------- backups ----------

  async exportBackup(password) {
    this.vault._need();
    await this.verifyPassword(password);
    const text = await encryptBackup(this.vault.exportData(), password, { appVersion: this.appVersion, kdf: this.kdf });
    const file = await this.dialogs.save(`tessera-${ymdOf(Date.now())}.tessera`);
    if (!file) return { saved: false };
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, file);
    this.vault.setMeta("last_backup_at", Date.now());
    return { saved: true, fileName: path.basename(file) };
  }

  async pickBackup() {
    this.vault._need();
    const file = await this.dialogs.open();
    if (!file) return null;
    if (fs.statSync(file).size > MAX_BACKUP_BYTES) throw new VaultError("invalid", "백업 파일이 너무 큽니다.");
    const text = fs.readFileSync(file, "utf8");
    let header;
    try {
      header = readBackupHeader(text);
    } catch (e) {
      throw new VaultError(e.code || "invalid", e.message);
    }
    const token = crypto.randomUUID();
    this.pendingBackups.clear();
    this.pendingBackups.set(token, { text, fileName: path.basename(file) });
    return { token, fileName: path.basename(file), createdAt: header.createdAt };
  }

  async importBackup(token, password, mode) {
    this.vault._need();
    if (mode !== "add" && mode !== "replace") throw new VaultError("invalid", "가져오기 방식을 고르세요.");
    const pending = this.pendingBackups.get(token);
    if (!pending) throw new VaultError("invalid", "백업 파일을 다시 고르세요.");
    let tree;
    try {
      ({ tree } = await decryptBackup(pending.text, password));
    } catch (e) {
      if (e.name === "BackupError") throw new VaultError(e.code, e.message);
      throw e;
    }
    this.pendingBackups.delete(token);
    if (mode === "add") {
      const base = `가져옴 ${ymdOf(Date.now())}`;
      const taken = new Set(this.vault.snapshot().folders.filter((f) => f.parentId == null).map((f) => f.name));
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
      const folderId = this.vault.createFolder(null, name);
      const r = this.vault.importData(tree, { parentId: folderId });
      return { mode, folderName: name, items: r.items, folders: r.folders };
    }
    // Keep the current data file (still encrypted with the current password) before replacing.
    const dir = path.join(this.dataDir, "backups");
    fs.mkdirSync(dir, { recursive: true });
    const safety = path.join(dir, `tessera-before-replace-${Date.now()}.db`);
    fs.copyFileSync(this.vault.file, safety);
    const r = this.vault.replaceData(tree);
    return { mode, items: r.items, folders: r.folders, safetyCopy: path.basename(safety) };
  }

  dispose() {
    clearInterval(this.idleTimer);
    this.clearClipboard(false);
    this.vault.close();
  }
}
