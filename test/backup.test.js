import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encryptBackup, decryptBackup, readBackupHeader } from "../electron/backup.js";
import { Service } from "../electron/service.js";

const FAST = { name: "scrypt", N: 2 ** 10, r: 8, p: 1 };
const TREE = {
  folders: [{ key: "a", parentKey: null, name: "업무" }, { key: "b", parentKey: "a", name: "개발" }],
  items: [{ key: "i1", folderKey: "b", name: "GitHub", favorite: true, viewCount: 3, fields: [{ name: "비밀번호", value: "gh!9" }] }],
};

test("backup round trip; wrong password and tampering are told apart", async () => {
  const text = await encryptBackup(TREE, "pw-12345678", { kdf: FAST, now: 1700000000000 });
  assert.equal(text.includes("GitHub"), false);
  assert.equal(text.includes("gh!9"), false);
  assert.equal(readBackupHeader(text).createdAt, 1700000000000);
  const { tree } = await decryptBackup(text, "pw-12345678");
  assert.deepEqual(tree, TREE);
  await assert.rejects(decryptBackup(text, "nope"), (e) => e.code === "wrong-password");
  const h = JSON.parse(text);
  await assert.rejects(decryptBackup(JSON.stringify({ ...h, createdAt: h.createdAt + 1 }), "pw-12345678"), (e) => e.code === "wrong-password", "header is authenticated");
  await assert.rejects(decryptBackup(JSON.stringify({ ...h, kdf: { name: "scrypt", N: 2 ** 24, r: 8, p: 1 } }), "pw-12345678"), (e) => e.code === "corrupt");
  await assert.rejects(decryptBackup("{}", "x"), (e) => e.code === "not-backup");
  await assert.rejects(decryptBackup("not json", "x"), (e) => e.code === "not-backup");
  await assert.rejects(decryptBackup(JSON.stringify({ ...h, version: 9 }), "x"), (e) => e.code === "unsupported");
});

function svc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-bak-"));
  const files = { save: path.join(dir, "out.tessera"), open: path.join(dir, "out.tessera") };
  const dialogs = { save: async () => files.save, open: async () => files.open };
  const s = new Service({ dataDir: path.join(dir, "data"), kdf: FAST, dialogs, clipboard: { writeText() {}, readText() { return ""; }, clear() {} } });
  return { s, dir, files };
}

test("export then import into a new folder and as a full replace", async () => {
  const { s, dir, files } = svc();
  await s.create("master-pass-1");
  const work = s.vault.createFolder(null, "업무");
  s.vault.createItem(work, "GitHub", [{ name: "비밀번호", value: "gh!9" }]);
  s.vault.createItem(null, "Root item", []);
  await assert.rejects(s.exportBackup("wrong-pass"), (e) => e.code === "wrong-password");
  const r = await s.exportBackup("master-pass-1");
  assert.deepEqual(r, { saved: true, fileName: "out.tessera" });
  assert.ok(s.status().lastBackupAt > 0);

  const picked = await s.pickBackup();
  assert.equal(picked.fileName, "out.tessera");
  await assert.rejects(s.importBackup(picked.token, "nope", "add"), (e) => e.code === "wrong-password");
  const added = await s.importBackup(picked.token, "master-pass-1", "add");
  assert.match(added.folderName, /^가져옴 \d{4}-\d{2}-\d{2}$/);
  assert.equal(added.items, 2);
  let snap = s.vault.snapshot();
  assert.equal(snap.items.length, 4);
  const imported = snap.folders.find((f) => f.name === added.folderName);
  const importedWork = snap.folders.find((f) => f.name === "업무" && f.parentId === imported.id);
  assert.ok(importedWork, "folder tree kept under the import folder");
  const gh = snap.items.find((i) => i.name === "GitHub" && i.folderId === importedWork.id);
  assert.equal(s.vault.revealField(s.vault.getItem(gh.id).fields[0].id), "gh!9");

  const again = await s.pickBackup();
  const second = await s.importBackup(again.token, "master-pass-1", "add");
  assert.equal(second.folderName, `${added.folderName} (2)`);
  await assert.rejects(s.importBackup(again.token, "master-pass-1", "add"), (e) => e.code === "invalid", "token is single use");

  const third = await s.pickBackup();
  const replaced = await s.importBackup(third.token, "master-pass-1", "replace");
  snap = s.vault.snapshot();
  assert.equal(snap.items.length, 2);
  assert.deepEqual(snap.folders.map((f) => f.name), ["업무"]);
  assert.ok(fs.existsSync(path.join(dir, "data", "backups", replaced.safetyCopy)), "safety copy kept");
  s.dispose();
});

test("a non-backup file is refused when picked", async () => {
  const { s, files } = svc();
  await s.create("master-pass-1");
  fs.writeFileSync(files.open, "hello");
  await assert.rejects(s.pickBackup(), (e) => e.code === "not-backup");
  s.dispose();
});
