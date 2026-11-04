// Reader for Keyhub 0.5.x ("v1") data. Read only: the original files are copied
// to a temp folder first and never opened for writing.
//
// v1 format (verified against the shipped 0.5.7 bundle, sha256@0.2.0 and crypto-js@4.0.0):
//   core.sqlite3  user_master(user_id, name, encrypted_pw)
//                 encrypted_pw = hex(sha256(hex(sha256(utf8(password)))))
//   <name>.sqlite3 folder_master(fid, parent_fid, name)          names in plain text
//                  item_master(iid, fid, name, view_cnt, last_viewed_timestamp, favorite_flag, created_timestamp)
//                  keypair_master(kpid, iid, key, encrypted_value)
//                  encrypted_value = CryptoJS.AES.encrypt(value, hex(sha256(utf8(password))))
//                  i.e. OpenSSL "Salted__" format, EVP_BytesToKey(MD5, 1 round), AES-256-CBC
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// The only v1 account carried over (user decision 2026-11-04).
export const LEGACY_ACCOUNT = "shyunku";

const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

export function legacyPaths(dir) {
  return {
    core: path.join(dir, "core", "core.sqlite3"),
    db: path.join(dir, "databases", `${LEGACY_ACCOUNT}.sqlite3`),
  };
}

function snapshotCopy(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-legacy-"));
  const copy = path.join(dir, path.basename(file));
  fs.copyFileSync(file, copy);
  return { copy, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function withCopy(file, fn) {
  const { copy, cleanup } = snapshotCopy(file);
  let db;
  try {
    db = new DatabaseSync(copy, { readOnly: true });
    return fn(db);
  } finally {
    db?.close();
    cleanup();
  }
}

export function detectLegacy(dir) {
  if (!dir) return null;
  const p = legacyPaths(dir);
  if (!fs.existsSync(p.core) || !fs.existsSync(p.db)) return null;
  try {
    const user = withCopy(p.core, (db) => db.prepare("SELECT user_id, name, encrypted_pw FROM user_master WHERE name = ?").get(LEGACY_ACCOUNT));
    if (!user) return null;
    return { account: LEGACY_ACCOUNT, storedHash: String(user.encrypted_pw), ...p };
  } catch {
    return null;
  }
}

// Returns the passphrase the old app used for AES (the first sha256 hex), or null.
// UTF-8 is what the shipped renderer used; latin1 is tried too in case a value
// was ever hashed by the Node build of the library.
export function legacyPassphrase(password, storedHash) {
  if (typeof password !== "string" || !password) return null;
  for (const enc of ["utf8", "latin1"]) {
    const first = sha256hex(Buffer.from(password, enc));
    const second = sha256hex(Buffer.from(first, "latin1"));
    const a = Buffer.from(second);
    const b = Buffer.from(String(storedHash).toLowerCase());
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return first;
  }
  return null;
}

function evpBytesToKey(pass, salt) {
  const out = [];
  let prev = Buffer.alloc(0);
  let len = 0;
  while (len < 48) {
    prev = crypto.createHash("md5").update(Buffer.concat([prev, pass, salt])).digest();
    out.push(prev);
    len += prev.length;
  }
  const all = Buffer.concat(out);
  return { key: all.subarray(0, 32), iv: all.subarray(32, 48) };
}

export function decryptCryptoJs(b64, passphrase) {
  const raw = Buffer.from(String(b64), "base64");
  if (raw.length < 32 || raw.subarray(0, 8).toString("latin1") !== "Salted__") throw new Error("Not a CryptoJS value");
  const { key, iv } = evpBytesToKey(Buffer.from(passphrase, "utf8"), raw.subarray(8, 16));
  const d = crypto.createDecipheriv("aes-256-cbc", key, iv);
  const plain = Buffer.concat([d.update(raw.subarray(16)), d.final()]);
  // A wrong key can still pass the padding check; real values are valid UTF-8.
  const text = new TextDecoder("utf-8", { fatal: true }).decode(plain);
  plain.fill(0);
  return text;
}

// For tests: produces the same format as CryptoJS.AES.encrypt(value, passphrase).
export function encryptCryptoJs(value, passphrase) {
  const salt = crypto.randomBytes(8);
  const { key, iv } = evpBytesToKey(Buffer.from(passphrase, "utf8"), salt);
  const c = crypto.createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([Buffer.from("Salted__", "latin1"), salt, c.update(value, "utf8"), c.final()]).toString("base64");
}

export function readLegacyRows(dbFile) {
  return withCopy(dbFile, (db) => ({
    folders: db.prepare("SELECT fid, parent_fid, name FROM folder_master ORDER BY fid").all(),
    items: db
      .prepare("SELECT iid, fid, name, view_cnt, last_viewed_timestamp, favorite_flag, created_timestamp FROM item_master ORDER BY iid")
      .all(),
    keypairs: db.prepare("SELECT kpid, iid, key, encrypted_value FROM keypair_master ORDER BY kpid").all(),
  }));
}

const ms = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
const text = (v, fallback) => {
  const s = v == null ? "" : String(v).trim();
  return s || fallback;
};

// Turns v1 rows into the plain tree that Vault.importData() takes, decrypting every value.
// Throws if any value cannot be decrypted (nothing is written in that case).
export function buildImport(rows, passphrase) {
  const folderIds = new Set(rows.folders.map((f) => f.fid));
  const parentOf = new Map(rows.folders.map((f) => [f.fid, folderIds.has(f.parent_fid) ? f.parent_fid : null]));
  // Break any parent cycle by attaching the looping folder to the top level.
  for (const f of rows.folders) {
    const seen = new Set([f.fid]);
    let p = parentOf.get(f.fid);
    while (p != null) {
      if (seen.has(p)) {
        parentOf.set(f.fid, null);
        break;
      }
      seen.add(p);
      p = parentOf.get(p);
    }
  }
  const folders = rows.folders.map((f) => ({
    key: `f${f.fid}`,
    parentKey: parentOf.get(f.fid) == null ? null : `f${parentOf.get(f.fid)}`,
    name: text(f.name, "이름 없는 폴더").slice(0, 200),
  }));

  const itemIds = new Set(rows.items.map((i) => i.iid));
  const fieldsByItem = new Map();
  const report = { folders: folders.length, items: rows.items.length, fields: 0, skippedOrphanKeys: 0, failed: [] };
  for (const kp of rows.keypairs) {
    if (!itemIds.has(kp.iid)) {
      report.skippedOrphanKeys += 1; // left behind by deleted items in v1
      continue;
    }
    let value;
    try {
      value = decryptCryptoJs(kp.encrypted_value, passphrase);
    } catch {
      report.failed.push(kp.kpid);
      continue;
    }
    const list = fieldsByItem.get(kp.iid) || [];
    list.push({ name: text(kp.key, "키").slice(0, 200), value });
    fieldsByItem.set(kp.iid, list);
    report.fields += 1;
  }

  const items = rows.items.map((i) => ({
    key: `i${i.iid}`,
    folderKey: folderIds.has(i.fid) ? `f${i.fid}` : null,
    name: text(i.name, "이름 없는 항목").slice(0, 200),
    favorite: Number(i.favorite_flag) === 1,
    viewCount: Math.max(0, Math.round(Number(i.view_cnt) || 0)),
    lastViewedAt: ms(i.last_viewed_timestamp),
    createdAt: ms(i.created_timestamp),
    fields: fieldsByItem.get(i.iid) || [],
  }));
  return { folders, items, report };
}
