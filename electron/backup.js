// .tessera backup files: the whole tree (names and values), sealed with a key
// derived from the master password at export time (its own random salt).
//
// file = JSON { format, version, createdAt, app, kdf, salt, data }
// data = AES-256-GCM(scrypt(password, salt), JSON(tree)), AAD binds format/version/createdAt
import crypto from "node:crypto";
import { DEFAULT_KDF, deriveKek, seal, open, wipe, IntegrityError, CorruptDataError } from "./crypto/vault-crypto.js";

export const BACKUP_FORMAT = "tessera-backup";
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 200_000;

export class BackupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

const aadFor = (h) => `tessera:backup:${h.version}:${h.createdAt}`;

export async function encryptBackup(tree, password, { appVersion = "", kdf = DEFAULT_KDF, now = Date.now() } = {}) {
  const salt = crypto.randomBytes(16);
  const header = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now, app: appVersion, kdf: { ...kdf } };
  const key = await deriveKek(password, salt, kdf);
  const plain = Buffer.from(JSON.stringify({ folders: tree.folders, items: tree.items }), "utf8");
  try {
    const data = seal(key, plain, aadFor(header));
    return JSON.stringify({ ...header, salt: salt.toString("base64"), data: data.toString("base64") });
  } finally {
    plain.fill(0);
    wipe(key);
  }
}

// Reads only the header (no password needed).
export function readBackupHeader(text) {
  let h;
  try {
    h = JSON.parse(text);
  } catch {
    throw new BackupError("not-backup", "Tessera 백업 파일이 아닙니다.");
  }
  if (!h || h.format !== BACKUP_FORMAT) throw new BackupError("not-backup", "Tessera 백업 파일이 아닙니다.");
  if (h.version !== BACKUP_VERSION) throw new BackupError("unsupported", "이 버전에서 열 수 없는 백업 파일입니다.");
  if (!Number.isSafeInteger(h.createdAt) || typeof h.salt !== "string" || typeof h.data !== "string") {
    throw new BackupError("corrupt", "백업 파일이 손상되었습니다.");
  }
  return h;
}

function checkTree(t) {
  const bad = () => new BackupError("corrupt", "백업 파일 내용이 올바르지 않습니다.");
  if (!t || !Array.isArray(t.folders) || !Array.isArray(t.items)) throw bad();
  if (t.folders.length > MAX_ROWS || t.items.length > MAX_ROWS) throw bad();
  for (const f of t.folders) if (!f || typeof f.key !== "string" || typeof f.name !== "string") throw bad();
  for (const i of t.items) {
    if (!i || typeof i.key !== "string" || typeof i.name !== "string" || !Array.isArray(i.fields)) throw bad();
    for (const f of i.fields) if (!f || typeof f.name !== "string" || typeof f.value !== "string") throw bad();
  }
  return t;
}

export async function decryptBackup(text, password) {
  const h = readBackupHeader(text);
  const salt = Buffer.from(h.salt, "base64");
  let key;
  try {
    key = await deriveKek(password, salt, h.kdf);
  } catch (e) {
    if (e instanceof CorruptDataError) throw new BackupError("corrupt", "백업 파일이 손상되었습니다.");
    throw e;
  }
  let plain;
  try {
    plain = open(key, Buffer.from(h.data, "base64"), aadFor(h));
  } catch (e) {
    if (e instanceof IntegrityError) throw new BackupError("wrong-password", "백업 파일 비밀번호가 맞지 않습니다.");
    throw new BackupError("corrupt", "백업 파일이 손상되었습니다.");
  } finally {
    wipe(key);
  }
  try {
    return { header: h, tree: checkTree(JSON.parse(plain.toString("utf8"))) };
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("corrupt", "백업 파일 내용이 올바르지 않습니다.");
  } finally {
    plain.fill(0);
  }
}
