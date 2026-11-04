import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { legacyPassphrase, decryptCryptoJs, encryptCryptoJs, detectLegacy } from "../electron/legacy/v1.js";
import { migrateLegacy } from "../electron/legacy/migrate.js";
import { Vault } from "../electron/store/vault.js";

const FAST = { name: "scrypt", N: 2 ** 10, r: 8, p: 1 };
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, "fixtures", "v1");

// Produced by sha256@0.2.0 (browser build, as bundled in Keyhub 0.5.7) and crypto-js@4.0.0.
const REAL = {
  password: "테스트 비번!9",
  firstHash: "e82b3010d1db92f57972975f0e24f42823a66b4556735ce5f872ea2f04adffdf",
  storedHash: "1338c651543061887a9134ed8ef726d955f21460d9eaead8df4fdfda1cccac2e",
  values: {
    "gh!9vQ2#lO0x7K": "U2FsdGVkX1+ncJyfai+FaFekYlwktPa4HsPRYqrbQ5A=",
    "한글 값 🔑": "U2FsdGVkX1+8/gFY9oGkkmkGb9sset8cNsIhk28Ezd0=",
    a: "U2FsdGVkX1+rgODHia9UhN7Lv0f1XLT94dmj53pSSys=",
    ["x".repeat(40)]: "U2FsdGVkX196SVAZ6/7tZYnue9mEy/9h0RgVjjQylD0jf4mvRBLu4QFE2V/hH1GA1G2XJqBWGxCdrQ3WOrsU0A==",
  },
};

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const fileHash = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function makeLegacy({ password = REAL.password, extra } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-legacy-test-"));
  const dir = path.join(root, "v1");
  fs.mkdirSync(path.join(dir, "core"), { recursive: true });
  fs.mkdirSync(path.join(dir, "databases"), { recursive: true });
  const core = path.join(dir, "core", "core.sqlite3");
  fs.copyFileSync(path.join(FIXTURES, "core-template.sqlite3"), core);
  const cdb = new DatabaseSync(core);
  cdb.prepare("INSERT INTO user_master(name, encrypted_pw) VALUES (?, ?)").run("shyunku", sha(sha(password)));
  cdb.prepare("INSERT INTO user_master(name, encrypted_pw) VALUES (?, ?)").run("nanoRIPE", sha(sha("other")));
  cdb.close();

  const userDb = path.join(dir, "databases", "shyunku.sqlite3");
  fs.copyFileSync(path.join(FIXTURES, "user-template.sqlite3"), userDb);
  fs.copyFileSync(path.join(FIXTURES, "user-template.sqlite3"), path.join(dir, "databases", "nanoRIPE.sqlite3"));
  const pass = sha(password);
  const db = new DatabaseSync(userDb, { enableForeignKeyConstraints: false });
  // template already has folder (1, NULL, '일반')
  db.exec(`INSERT INTO folder_master(fid, parent_fid, name) VALUES (2, NULL, '업무'), (3, 2, '개발'), (4, 3, '클라우드'), (5, 99, '고아 폴더');`);
  const item = db.prepare(
    "INSERT INTO item_master(iid, fid, name, view_cnt, last_viewed_timestamp, favorite_flag, created_timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  item.run(1, 3, "GitHub", 57, 1730000000000, 1, 1622505600000);
  item.run(2, 1, "Google", 3, 0, 0, 1621468800000);
  item.run(3, null, "최상위 항목", 0, 0, 0, 1621555200000);
  item.run(4, 77, "고아 항목", 0, 0, 0, 1621555200000);
  item.run(5, 4, "빈 항목", 0, 0, 0, 1621555200000);
  const kp = db.prepare("INSERT INTO keypair_master(kpid, iid, key, encrypted_value) VALUES (?, ?, ?, ?)");
  if (password === REAL.password) {
    let k = 1;
    for (const [v, ct] of Object.entries(REAL.values)) kp.run(k++, 1, `real-${v.length}`, ct);
  }
  kp.run(10, 2, "이메일", encryptCryptoJs("keyhub.sample@gmail.com", pass));
  kp.run(11, 2, "비밀번호", encryptCryptoJs("Rk8#mq2!vT9pL", pass));
  kp.run(12, 3, "메모", encryptCryptoJs("최상위 값", pass));
  kp.run(13, 4, "pw", encryptCryptoJs("orphan item value", pass));
  kp.run(14, 999, "삭제된 항목의 키", encryptCryptoJs("left behind", pass));
  if (extra) extra(db, pass);
  db.close();
  return { dir, root, userDb, core, dataFile: path.join(root, "data", "tessera.db") };
}

test("v1 password check matches the real library output (Korean password)", () => {
  assert.equal(legacyPassphrase(REAL.password, REAL.storedHash), REAL.firstHash);
  assert.equal(legacyPassphrase(REAL.password + " ", REAL.storedHash), null);
  assert.equal(legacyPassphrase("", REAL.storedHash), null);
});

test("latin1-hashed passwords (Node build of sha256@0.2.0) are also accepted", () => {
  const pw = "비번";
  const first = sha(Buffer.from(pw, "latin1"));
  assert.equal(legacyPassphrase(pw, sha(Buffer.from(first, "latin1"))), first);
});

test("CryptoJS values from the real library decrypt", () => {
  for (const [v, ct] of Object.entries(REAL.values)) assert.equal(decryptCryptoJs(ct, REAL.firstHash), v);
  assert.throws(() => decryptCryptoJs(REAL.values.a, sha("wrong")));
  assert.throws(() => decryptCryptoJs("not base64 cryptojs", REAL.firstHash));
});

test("detect finds only the shyunku account", () => {
  const l = makeLegacy();
  assert.equal(detectLegacy(l.dir).account, "shyunku");
  assert.equal(detectLegacy(path.join(l.root, "nope")), null);
  fs.rmSync(l.userDb);
  assert.equal(detectLegacy(l.dir), null, "no shyunku database → nothing to migrate");
});

test("full migration: structure, values, metadata; v1 files untouched", async () => {
  const l = makeLegacy();
  fs.mkdirSync(path.dirname(l.dataFile), { recursive: true });
  const before = [fileHash(l.core), fileHash(l.userDb)];
  const steps = [];
  const report = await migrateLegacy({ legacyDir: l.dir, dataFile: l.dataFile, password: REAL.password, kdf: FAST, onProgress: (p) => steps.push(p.step) });

  assert.deepEqual([fileHash(l.core), fileHash(l.userDb)], before, "v1 files are byte-identical");
  assert.equal(fs.existsSync(`${l.dataFile}.migrating`), false);
  assert.deepEqual(report, { folders: 5, items: 5, fields: 8, skippedOrphanKeys: 1 });
  assert.ok(["verify", "read", "write", "check", "done"].every((s) => steps.includes(s)));

  const v = new Vault(l.dataFile, { kdf: FAST });
  await v.unlock(REAL.password);
  const s = v.snapshot();
  const byName = (n) => s.folders.find((f) => f.name === n);
  assert.equal(byName("개발").parentId, byName("업무").id);
  assert.equal(byName("클라우드").parentId, byName("개발").id);
  assert.equal(byName("고아 폴더").parentId, null, "folder with missing parent goes to the top");
  const item = (n) => s.items.find((i) => i.name === n);
  assert.equal(item("GitHub").folderId, byName("개발").id);
  assert.equal(item("GitHub").favorite, true);
  assert.equal(item("GitHub").viewCount, 57);
  assert.equal(item("GitHub").createdAt, 1622505600000);
  assert.equal(item("최상위 항목").folderId, null);
  assert.equal(item("고아 항목").folderId, null, "item with missing folder goes to the top");
  assert.equal(item("빈 항목").fieldNames.length, 0);

  const gh = v.getItem(item("GitHub").id);
  assert.deepEqual(gh.fields.map((f) => v.revealField(f.id)), Object.keys(REAL.values));
  const google = v.getItem(item("Google").id);
  assert.deepEqual(google.fields.map((f) => [f.name, v.revealField(f.id)]), [["이메일", "keyhub.sample@gmail.com"], ["비밀번호", "Rk8#mq2!vT9pL"]]);
  assert.equal(v.meta("migrated_from"), "keyhub-v1:shyunku");
  v.close();

  await assert.rejects(migrateLegacy({ legacyDir: l.dir, dataFile: l.dataFile, password: REAL.password, kdf: FAST }), (e) => e.code === "exists");
});

test("wrong password: nothing is written", async () => {
  const l = makeLegacy();
  fs.mkdirSync(path.dirname(l.dataFile), { recursive: true });
  await assert.rejects(migrateLegacy({ legacyDir: l.dir, dataFile: l.dataFile, password: "nope", kdf: FAST }), (e) => e.code === "wrong-password");
  assert.equal(fs.existsSync(l.dataFile), false);
});

test("an undecryptable value stops the migration and leaves nothing behind", async () => {
  const l = makeLegacy({ extra: (db) => db.prepare("INSERT INTO keypair_master(kpid, iid, key, encrypted_value) VALUES (20, 2, 'broken', ?)").run(encryptCryptoJs("x", sha("other key"))) });
  fs.mkdirSync(path.dirname(l.dataFile), { recursive: true });
  await assert.rejects(migrateLegacy({ legacyDir: l.dir, dataFile: l.dataFile, password: REAL.password, kdf: FAST }), (e) => e.code === "legacy-decrypt");
  assert.equal(fs.existsSync(l.dataFile), false);
  assert.equal(fs.existsSync(`${l.dataFile}.migrating`), false);
});

test("service: legacy is offered while empty, migration unlocks, then it is gone", async () => {
  const { Service } = await import("../electron/service.js");
  const l = makeLegacy();
  const s = new Service({ dataDir: path.dirname(l.dataFile), legacyDir: l.dir, kdf: FAST, clipboard: { writeText() {}, readText() { return ""; }, clear() {} } });
  assert.deepEqual(s.status().legacy, { account: "shyunku" });
  const { report, status } = await s.migrateLegacy(REAL.password);
  assert.equal(report.items, 5);
  assert.equal(status.state, "unlocked");
  assert.equal(status.legacy, null);
  assert.equal(status.createdAt, 1621468800000, "created date comes from the oldest v1 item");
  await s.reset(REAL.password, "초기화");
  assert.equal(s.status().state, "empty");
  assert.equal(s.status().legacy, null, "after a reset the old data is not offered again");
  s.dispose();
});
