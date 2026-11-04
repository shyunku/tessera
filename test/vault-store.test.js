import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Vault, VaultError } from "../electron/store/vault.js";
import { WrongPasswordError } from "../electron/crypto/vault-crypto.js";

const FAST = { name: "scrypt", N: 2 ** 10, r: 8, p: 1 };

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-test-"));
  return path.join(dir, "tessera.db");
}

async function fresh() {
  const file = tmpFile();
  const v = new Vault(file, { kdf: FAST });
  await v.create("master-pw");
  return { v, file };
}

const names = (snap) => snap.folders.map((f) => f.name);
const tree = (v, parentId = null) =>
  v.snapshot().folders.filter((f) => f.parentId === parentId).sort((a, b) => a.position - b.position).map((f) => f.name);

test("create, lock, unlock with the right password only", async () => {
  const { v, file } = await fresh();
  assert.equal(v.state, "unlocked");
  v.lock();
  assert.equal(v.state, "locked");
  assert.throws(() => v.snapshot(), (e) => e.code === "locked");
  await assert.rejects(v.unlock("nope"), WrongPasswordError);
  await v.unlock("master-pw");
  assert.equal(v.state, "unlocked");
  v.close();
  assert.equal(Vault.exists(file), true);
  assert.equal(Vault.exists(tmpFile()), false);
});

test("creating twice is refused", async () => {
  const { v } = await fresh();
  await assert.rejects(v.create("x"), (e) => e.code === "exists");
});

test("nothing secret is stored in plain text", async () => {
  const { v, file } = await fresh();
  const f = v.createFolder(null, "업무폴더-SECRET");
  v.createItem(f, "GitHub-SECRET", [{ name: "password-label-SECRET", value: "hunter2-SECRET" }]);
  v.close();
  const raw = fs.readFileSync(file);
  for (const s of ["업무폴더-SECRET", "GitHub-SECRET", "password-label-SECRET", "hunter2-SECRET"]) {
    assert.equal(raw.includes(Buffer.from(s, "utf8")), false, s);
  }
  const db = new DatabaseSync(file);
  const row = db.prepare("SELECT name FROM items").get();
  assert.ok(row.name instanceof Uint8Array);
  db.close();
});

test("items, fields, reveal, edit and duplicate", async () => {
  const { v } = await fresh();
  const work = v.createFolder(null, "업무");
  const id = v.createItem(work, "GitHub", [
    { name: "아이디", value: "sample" },
    { name: "비밀번호", value: "gh!9vQ2#lO0x7K" },
  ]);
  const item = v.openItem(id);
  assert.equal(item.name, "GitHub");
  assert.deepEqual(item.fields.map((f) => f.name), ["아이디", "비밀번호"]);
  assert.equal("value" in item.fields[0], false, "values are not sent with the item");
  assert.equal(v.revealField(item.fields[1].id), "gh!9vQ2#lO0x7K");
  assert.equal(v.getItem(id).viewCount, 1);

  v.updateItem(id, { name: "GitHub 계정", fields: [{ name: "토큰", value: "ghp_x" }] });
  const edited = v.itemForEdit(id);
  assert.equal(edited.name, "GitHub 계정");
  assert.deepEqual(edited.fields.map((f) => [f.name, f.value]), [["토큰", "ghp_x"]]);

  const copy = v.duplicateItem(id);
  assert.equal(v.getItem(copy).name, "GitHub 계정 사본");
  assert.equal(v.revealField(v.getItem(copy).fields[0].id), "ghp_x");

  const snap = v.snapshot();
  assert.equal(snap.items.length, 2);
  assert.deepEqual(snap.items.find((i) => i.id === id).fieldNames, ["토큰"]);

  v.deleteItem(id);
  assert.throws(() => v.getItem(id), (e) => e.code === "not-found");
  assert.equal(v.db.prepare("SELECT count(*) c FROM fields WHERE item_id = ?").get(id).c, 0, "fields deleted with the item");
});

test("input is validated", async () => {
  const { v } = await fresh();
  assert.throws(() => v.createFolder(null, "   "), VaultError);
  assert.throws(() => v.createFolder("missing-id", "x"), (e) => e.code === "not-found");
  assert.throws(() => v.createItem(null, "x".repeat(201)), VaultError);
  assert.throws(() => v.createItem(null, "ok", [{ name: "", value: "v" }]), VaultError);
  assert.throws(() => v.createItem(null, "ok", [{ name: "k", value: 5 }]), VaultError);
  assert.throws(() => v.createItem(null, "ok", [{ name: "k", value: "x".repeat(70000) }]), VaultError);
  assert.equal(v.snapshot().items.length, 0, "failed creates leave nothing behind");
});

test("folder move: into, reorder, and no cycles", async () => {
  const { v } = await fresh();
  const a = v.createFolder(null, "A");
  const b = v.createFolder(null, "B");
  const c = v.createFolder(null, "C");
  const a1 = v.createFolder(a, "A1");
  v.moveFolder(c, null, 0);
  assert.deepEqual(tree(v), ["C", "A", "B"]);
  v.moveFolder(b, a, 0);
  assert.deepEqual(tree(v), ["C", "A"]);
  assert.deepEqual(tree(v, a), ["B", "A1"]);
  assert.throws(() => v.moveFolder(a, a1, 0), /하위 폴더/);
  assert.throws(() => v.moveFolder(a, a, 0), /하위 폴더/);
  v.moveFolder(a1, null, 99);
  assert.deepEqual(tree(v), ["C", "A", "A1"]);
  assert.deepEqual(tree(v, a), ["B"]);
});

test("delete folder: keep contents moves them to the parent in place", async () => {
  const { v } = await fresh();
  const x = v.createFolder(null, "X");
  const y = v.createFolder(null, "Y");
  const z = v.createFolder(null, "Z");
  const y1 = v.createFolder(y, "Y1");
  const item = v.createItem(y, "item");
  v.deleteFolder(y, "keep");
  assert.deepEqual(tree(v), ["X", "Y1", "Z"]);
  assert.equal(v.getItem(item).folderId, null);
  assert.ok(x && z && y1);
});

test("delete folder: all removes the whole subtree and its fields", async () => {
  const { v } = await fresh();
  const y = v.createFolder(null, "Y");
  const y1 = v.createFolder(y, "Y1");
  const y2 = v.createFolder(y1, "Y2");
  v.createItem(y2, "deep", [{ name: "k", value: "v" }]);
  const keep = v.createItem(null, "root item", [{ name: "k", value: "v" }]);
  v.deleteFolder(y, "all");
  const s = v.snapshot();
  assert.equal(s.folders.length, 0);
  assert.deepEqual(s.items.map((i) => i.id), [keep]);
  assert.equal(v.db.prepare("SELECT count(*) c FROM fields").get().c, 1);
});

test("undo/redo covers moves and stops at any other change", async () => {
  const { v } = await fresh();
  const a = v.createFolder(null, "A");
  const b = v.createFolder(null, "B");
  const item = v.createItem(a, "item");
  assert.deepEqual(v.undo(), { ok: false, reason: "blocked", label: "항목 만들기" });

  v.moveItem(item, b);
  v.moveFolder(b, a, 0);
  assert.equal(v.historyState().canUndo, true);
  assert.equal(v.undo().ok, true); // folder move undone
  assert.deepEqual(tree(v), ["A", "B"]);
  assert.equal(v.undo().ok, true); // item move undone
  assert.equal(v.getItem(item).folderId, a);
  assert.equal(v.undo().reason, "blocked");
  assert.equal(v.redo().ok, true);
  assert.equal(v.getItem(item).folderId, b);
  assert.equal(v.redo().ok, true);
  assert.deepEqual(tree(v, a), ["B"]);
  assert.equal(v.redo().reason, "empty");

  v.undo();
  v.setFavorite(item, true); // a non-move change clears redo and blocks undo
  assert.equal(v.historyState().canRedo, false);
  assert.deepEqual(v.undo(), { ok: false, reason: "blocked", label: "즐겨찾기 추가" });
});

test("password change keeps data and drops the old password", async () => {
  const { v, file } = await fresh();
  const id = v.createItem(null, "item", [{ name: "k", value: "secret" }]);
  await assert.rejects(v.changePassword("wrong", "new-pw"), WrongPasswordError);
  await v.changePassword("master-pw", "new-pw");
  v.close();
  const w = new Vault(file, { kdf: FAST });
  await assert.rejects(w.unlock("master-pw"), WrongPasswordError);
  await w.unlock("new-pw");
  assert.equal(w.revealField(w.getItem(id).fields[0].id), "secret");
});

test("swapping ciphertexts between rows is detected", async () => {
  const { v } = await fresh();
  const a = v.createItem(null, "A", [{ name: "k", value: "value-a" }]);
  const b = v.createItem(null, "B", [{ name: "k", value: "value-b" }]);
  const fa = v.getItem(a).fields[0].id;
  const fb = v.getItem(b).fields[0].id;
  const blobB = v.db.prepare("SELECT value FROM fields WHERE id = ?").get(fb).value;
  v.db.prepare("UPDATE fields SET value = ? WHERE id = ?").run(blobB, fa);
  assert.throws(() => v.revealField(fa), (e) => e.code === "corrupt");

  // moving a field row to another item is detected too (fields are bound to their item)
  v.db.prepare("UPDATE fields SET item_id = ? WHERE id = ?").run(b, fa);
  assert.throws(() => v.getItem(b), (e) => e.code === "corrupt");
});

test("settings are readable while locked", async () => {
  const { v } = await fresh();
  v.setSetting("theme", "dark");
  v.lock();
  assert.deepEqual(v.getSettings(), { theme: "dark" });
});

test("password change rotates the key: an old copy plus the old password cannot read newer data", async () => {
  const { v, file } = await fresh();
  const id = v.createItem(null, "item", [{ name: "k", value: "before" }]);
  const oldCopy = file + ".old";
  fs.copyFileSync(file, oldCopy);
  await v.changePassword("master-pw", "new-pw");
  assert.equal(v.revealField(v.getItem(id).fields[0].id), "before", "data still readable after rotation");
  v.updateItem(id, { name: "item", fields: [{ name: "k", value: "after" }] });
  const newBlob = v.db.prepare("SELECT value FROM fields WHERE item_id = ?").get(id).value;
  const fieldId = v.db.prepare("SELECT id FROM fields WHERE item_id = ?").get(id).id;
  v.close();

  // attacker: old file + old password unwraps the OLD key, which must not open the new value
  const old = new Vault(oldCopy, { kdf: FAST });
  await old.unlock("master-pw");
  const { openString, fieldAad } = await import("../electron/crypto/vault-crypto.js");
  assert.throws(() => openString(old.dek, newBlob, fieldAad("fields", "value", `${id}/${fieldId}`)));
  old.close();

  const w = new Vault(file, { kdf: FAST });
  await w.unlock("new-pw");
  assert.equal(w.revealField(w.getItem(id).fields[0].id), "after");
});

test("favorites and recent views come from the snapshot", async () => {
  const { v } = await fresh();
  const a = v.createItem(null, "A");
  const b = v.createItem(null, "B");
  v.setFavorite(b, true);
  let s = v.snapshot();
  assert.deepEqual(s.items.filter((i) => i.favorite).map((i) => i.name), ["B"]);
  assert.equal(s.items.find((i) => i.id === a).lastViewedAt, null);
  v.openItem(a);
  await new Promise((r) => setTimeout(r, 5));
  v.openItem(b);
  v.getItem(a); // auto-selection does not count as a view
  s = v.snapshot();
  const recent = s.items.filter((i) => i.lastViewedAt).sort((x, y) => y.lastViewedAt - x.lastViewedAt).map((i) => i.name);
  assert.deepEqual(recent, ["B", "A"]);
  assert.equal(s.items.find((i) => i.id === a).viewCount, 1);
  v.setFavorite(b, false);
  assert.equal(v.snapshot().items.some((i) => i.favorite), false);
});
