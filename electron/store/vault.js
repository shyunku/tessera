// Tessera data store: encrypted folders, items and fields in one SQLite file.
// Everything that names or holds a secret is sealed with the DEK; structure,
// favorites, view counts and timestamps are stored in plain form.
import crypto from "node:crypto";
import fs from "node:fs";
import { openDb, tx } from "./db.js";
import {
  DEFAULT_KDF,
  createKeyring,
  unwrapDek,
  wrapDek,
  newKey,
  sealString,
  openString,
  fieldAad,
  wipe,
  IntegrityError,
} from "../crypto/vault-crypto.js";

export const LIMITS = Object.freeze({ name: 200, value: 64 * 1024, fields: 100 });

export class VaultError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "VaultError";
    this.code = code;
  }
}

const now = () => Date.now();
const uuid = () => crypto.randomUUID();

function cleanName(name, what = "이름") {
  if (typeof name !== "string") throw new VaultError("invalid", `${what}이 올바르지 않습니다.`);
  const v = name.trim();
  if (!v) throw new VaultError("invalid", `${what}을 입력하세요.`);
  if (v.length > LIMITS.name) throw new VaultError("invalid", `${what}은 ${LIMITS.name}자 이하여야 합니다.`);
  return v;
}

function cleanValue(value) {
  if (typeof value !== "string") throw new VaultError("invalid", "값이 올바르지 않습니다.");
  if (Buffer.byteLength(value, "utf8") > LIMITS.value) throw new VaultError("invalid", "값이 너무 깁니다.");
  return value;
}

export class Vault {
  constructor(file, { kdf = DEFAULT_KDF } = {}) {
    this.file = file;
    this.kdf = kdf;
    this.db = null;
    this.dek = null;
    this.history = { undo: [], redo: [] };
  }

  static exists(file) {
    if (!fs.existsSync(file)) return false;
    const v = new Vault(file);
    try {
      v._open();
      return !!v.db.prepare("SELECT 1 FROM keyring WHERE id = 1").get();
    } finally {
      v.close();
    }
  }

  get state() {
    if (this.dek) return "unlocked";
    return fs.existsSync(this.file) && this._hasKeyring() ? "locked" : "empty";
  }

  _open() {
    if (!this.db) this.db = openDb(this.file);
    return this.db;
  }

  _hasKeyring() {
    return !!this._open().prepare("SELECT 1 FROM keyring WHERE id = 1").get();
  }

  _keyringRecord() {
    const r = this._open().prepare("SELECT kdf, salt, wrapped_dek FROM keyring WHERE id = 1").get();
    if (!r) throw new VaultError("empty", "저장된 데이터가 없습니다.");
    return { kdf: JSON.parse(r.kdf), salt: Buffer.from(r.salt), wrappedDek: Buffer.from(r.wrapped_dek) };
  }

  _writeKeyring(record) {
    this.db
      .prepare("INSERT OR REPLACE INTO keyring(id, kdf, salt, wrapped_dek, updated_at) VALUES (1, ?, ?, ?, ?)")
      .run(JSON.stringify(record.kdf), record.salt, record.wrappedDek, now());
  }

  _need() {
    if (!this.dek) throw new VaultError("locked", "잠겨 있습니다.");
    return this.db;
  }

  close() {
    this.lock();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ---------- keyring ----------

  async create(password) {
    if (this.state !== "empty") throw new VaultError("exists", "이미 데이터가 있습니다.");
    const { record, dek } = await createKeyring(password, this.kdf);
    const db = this._open();
    tx(db, () => {
      this._writeKeyring(record);
      db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('created_at', ?)").run(String(now()));
    });
    this.dek = dek;
  }

  async unlock(password) {
    const record = this._keyringRecord();
    const dek = await unwrapDek(password, record); // throws WrongPasswordError
    this.lock();
    this.dek = dek;
    this.history = { undo: [], redo: [] };
  }

  // Checks a password without changing the session.
  async verify(password) {
    const dek = await unwrapDek(password, this._keyringRecord());
    wipe(dek);
  }

  lock() {
    wipe(this.dek);
    this.dek = null;
    this.history = { undo: [], redo: [] };
  }

  // A new DEK is generated and every secret is re-encrypted, so an old copy of the
  // file (or an old backup) plus the old password does not open data written later.
  async changePassword(current, next) {
    const db = this._need();
    const oldDek = await unwrapDek(current, this._keyringRecord());
    const newDek = newKey();
    try {
      const record = await wrapDek(newDek, next, this.kdf);
      const re = (table, column, rowKey, blob) =>
        sealString(newDek, openString(oldDek, blob, fieldAad(table, column, rowKey)), fieldAad(table, column, rowKey));
      tx(db, () => {
        const uf = db.prepare("UPDATE folders SET name = ? WHERE id = ?");
        for (const r of db.prepare("SELECT id, name FROM folders").all()) uf.run(re("folders", "name", r.id, r.name), r.id);
        const ui = db.prepare("UPDATE items SET name = ? WHERE id = ?");
        for (const r of db.prepare("SELECT id, name FROM items").all()) ui.run(re("items", "name", r.id, r.name), r.id);
        const ff = db.prepare("UPDATE fields SET name = ?, value = ? WHERE id = ?");
        for (const r of db.prepare("SELECT id, item_id, name, value FROM fields").all()) {
          const key = `${r.item_id}/${r.id}`;
          ff.run(re("fields", "name", key, r.name), re("fields", "value", key, r.value), r.id);
        }
        this._writeKeyring(record);
      });
    } catch (e) {
      wipe(newDek);
      throw e;
    } finally {
      wipe(oldDek);
    }
    wipe(this.dek);
    this.dek = newDek;
    this._barrier("비밀번호 변경");
  }

  meta(key) {
    const r = this._open().prepare("SELECT value FROM meta WHERE key = ?").get(key);
    return r ? r.value : null;
  }

  setMeta(key, value) {
    this._open().prepare("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)").run(key, String(value));
  }

  // ---------- crypto helpers ----------

  _seal(table, column, id, text) {
    return sealString(this.dek, text, fieldAad(table, column, id));
  }

  _open1(table, column, id, blob) {
    try {
      return openString(this.dek, blob, fieldAad(table, column, id));
    } catch (e) {
      if (e instanceof IntegrityError || e.name === "CorruptDataError") {
        throw new VaultError("corrupt", "저장된 데이터가 손상되었습니다.");
      }
      throw e;
    }
  }

  // ---------- reads ----------

  // Everything the list and tree need, with names decrypted. Field values are not included.
  snapshot() {
    const db = this._need();
    const folders = db
      .prepare("SELECT id, parent_id, position, name, created_at, updated_at FROM folders ORDER BY position")
      .all()
      .map((f) => ({
        id: f.id,
        parentId: f.parent_id,
        position: f.position,
        name: this._open1("folders", "name", f.id, f.name),
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      }));
    const fieldNames = new Map();
    for (const r of db.prepare("SELECT id, item_id, name FROM fields ORDER BY position").all()) {
      const list = fieldNames.get(r.item_id) || [];
      list.push(this._open1("fields", "name", `${r.item_id}/${r.id}`, r.name));
      fieldNames.set(r.item_id, list);
    }
    const items = db
      .prepare("SELECT id, folder_id, name, favorite, view_count, last_viewed_at, created_at, updated_at FROM items")
      .all()
      .map((i) => ({
        id: i.id,
        folderId: i.folder_id,
        name: this._open1("items", "name", i.id, i.name),
        favorite: !!i.favorite,
        viewCount: i.view_count,
        lastViewedAt: i.last_viewed_at,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        fieldNames: fieldNames.get(i.id) || [],
      }));
    return { folders, items, history: this.historyState() };
  }

  _itemRow(id) {
    const r = this.db.prepare("SELECT * FROM items WHERE id = ?").get(id);
    if (!r) throw new VaultError("not-found", "항목을 찾을 수 없습니다.");
    return r;
  }

  _folderRow(id) {
    const r = this.db.prepare("SELECT * FROM folders WHERE id = ?").get(id);
    if (!r) throw new VaultError("not-found", "폴더를 찾을 수 없습니다.");
    return r;
  }

  // Opening an item counts as a view (used for "recent" and view counts).
  openItem(id) {
    const db = this._need();
    this._itemRow(id);
    db.prepare("UPDATE items SET view_count = view_count + 1, last_viewed_at = ? WHERE id = ?").run(now(), id);
    return this.getItem(id);
  }

  getItem(id) {
    const db = this._need();
    const r = this._itemRow(id);
    const fields = db
      .prepare("SELECT id, name FROM fields WHERE item_id = ? ORDER BY position")
      .all(id)
      .map((f) => ({ id: f.id, name: this._open1("fields", "name", `${id}/${f.id}`, f.name) }));
    return {
      id: r.id,
      folderId: r.folder_id,
      name: this._open1("items", "name", r.id, r.name),
      favorite: !!r.favorite,
      viewCount: r.view_count,
      lastViewedAt: r.last_viewed_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      fields,
    };
  }

  revealField(id) {
    const db = this._need();
    const r = db.prepare("SELECT id, item_id, value FROM fields WHERE id = ?").get(id);
    if (!r) throw new VaultError("not-found", "키를 찾을 수 없습니다.");
    return this._open1("fields", "value", `${r.item_id}/${r.id}`, r.value);
  }

  fieldName(id) {
    const r = this._need().prepare("SELECT id, item_id, name FROM fields WHERE id = ?").get(id);
    if (!r) throw new VaultError("not-found", "키를 찾을 수 없습니다.");
    return this._open1("fields", "name", `${r.item_id}/${r.id}`, r.name);
  }

  // Item with field values, for the edit dialog.
  itemForEdit(id) {
    const item = this.getItem(id);
    item.fields = item.fields.map((f) => ({ ...f, value: this.revealField(f.id) }));
    return item;
  }

  // ---------- folders ----------

  _children(parentId) {
    return this.db
      .prepare("SELECT id, position FROM folders WHERE parent_id IS ? ORDER BY position")
      .all(parentId ?? null);
  }

  _renumber(parentId, ids) {
    const st = this.db.prepare("UPDATE folders SET position = ? WHERE id = ?");
    ids.forEach((id, i) => st.run(i, id));
  }

  _subtree(id) {
    return this.db
      .prepare(
        "WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT f.id FROM folders f JOIN t ON f.parent_id = t.id) SELECT id FROM t"
      )
      .all(id)
      .map((r) => r.id);
  }

  _checkParent(parentId) {
    if (parentId == null) return null;
    this._folderRow(parentId);
    return parentId;
  }

  createFolder(parentId, name) {
    const db = this._need();
    const n = cleanName(name, "폴더 이름");
    const id = uuid();
    tx(db, () => {
      const p = this._checkParent(parentId);
      const pos = this._children(p).length;
      const t = now();
      db.prepare("INSERT INTO folders(id, parent_id, position, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, p, pos, this._seal("folders", "name", id, n), t, t);
    });
    this._barrier("폴더 만들기");
    return id;
  }

  renameFolder(id, name) {
    const db = this._need();
    const n = cleanName(name, "폴더 이름");
    tx(db, () => {
      this._folderRow(id);
      db.prepare("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?").run(this._seal("folders", "name", id, n), now(), id);
    });
    this._barrier("폴더 이름 바꾸기");
  }

  // mode "keep": children move up to the parent. mode "all": everything inside is deleted.
  deleteFolder(id, mode) {
    const db = this._need();
    if (mode !== "keep" && mode !== "all") throw new VaultError("invalid", "삭제 방식을 고르세요.");
    tx(db, () => {
      const f = this._folderRow(id);
      if (mode === "all") {
        const ids = this._subtree(id);
        const marks = ids.map(() => "?").join(",");
        db.prepare(`DELETE FROM items WHERE folder_id IN (${marks})`).run(...ids); // fields cascade
        // delete deepest first so parent references never dangle
        for (const fid of ids.reverse()) db.prepare("DELETE FROM folders WHERE id = ?").run(fid);
      } else {
        const parent = f.parent_id;
        const siblings = this._children(parent).map((r) => r.id).filter((x) => x !== id);
        const moved = this._children(id).map((r) => r.id);
        const at = this._children(parent).findIndex((r) => r.id === id);
        siblings.splice(at, 0, ...moved);
        db.prepare("UPDATE folders SET parent_id = ? WHERE parent_id = ?").run(parent, id);
        db.prepare("UPDATE items SET folder_id = ? WHERE folder_id = ?").run(parent, id);
        db.prepare("DELETE FROM folders WHERE id = ?").run(id);
        this._renumber(parent, siblings);
      }
    });
    this._barrier("폴더 삭제");
  }

  // Puts a folder under parentId at index (0-based among its new siblings).
  moveFolder(id, parentId, index) {
    const db = this._need();
    let label;
    return this._recordMove(() =>
      tx(db, () => {
        const f = this._folderRow(id);
        const p = this._checkParent(parentId);
        if (p != null && this._subtree(id).includes(p)) {
          throw new VaultError("invalid", "폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.");
        }
        const name = this._open1("folders", "name", id, f.name);
        const siblings = this._children(p).map((r) => r.id).filter((x) => x !== id);
        const at = Number.isInteger(index) ? Math.max(0, Math.min(index, siblings.length)) : siblings.length;
        siblings.splice(at, 0, id);
        db.prepare("UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?").run(p, now(), id);
        this._renumber(p, siblings);
        if (f.parent_id !== p) this._renumber(f.parent_id, this._children(f.parent_id).map((r) => r.id));
        label = f.parent_id === p ? `‘${name}’ 순서 변경` : `‘${name}’ 이동`;
      })
    , () => label);
  }

  // ---------- items ----------

  _writeFields(itemId, fields) {
    if (!Array.isArray(fields)) throw new VaultError("invalid", "키 목록이 올바르지 않습니다.");
    if (fields.length > LIMITS.fields) throw new VaultError("invalid", `키는 ${LIMITS.fields}개까지 넣을 수 있습니다.`);
    for (const f of fields) {
      if (!f || typeof f !== "object") throw new VaultError("invalid", "키 목록이 올바르지 않습니다.");
    }
    const t = now();
    const ins = this.db.prepare(
      "INSERT INTO fields(id, item_id, position, name, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    fields.forEach((f, i) => {
      const id = uuid();
      const key = `${itemId}/${id}`;
      ins.run(id, itemId, i, this._seal("fields", "name", key, cleanName(f.name, "키 이름")), this._seal("fields", "value", key, cleanValue(f.value)), t, t);
    });
  }

  createItem(folderId, name, fields = []) {
    const db = this._need();
    const n = cleanName(name, "항목 이름");
    const id = uuid();
    tx(db, () => {
      const f = this._checkParent(folderId);
      const t = now();
      db.prepare("INSERT INTO items(id, folder_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, f, this._seal("items", "name", id, n), t, t);
      this._writeFields(id, fields);
    });
    this._barrier("항목 만들기");
    return id;
  }

  // Replaces the item's name and its whole field list (the edit dialog sends everything).
  updateItem(id, { name, fields }) {
    const db = this._need();
    const n = cleanName(name, "항목 이름");
    tx(db, () => {
      this._itemRow(id);
      db.prepare("UPDATE items SET name = ?, updated_at = ? WHERE id = ?").run(this._seal("items", "name", id, n), now(), id);
      db.prepare("DELETE FROM fields WHERE item_id = ?").run(id);
      this._writeFields(id, fields);
    });
    this._barrier("항목 수정");
  }

  deleteItem(id) {
    const db = this._need();
    tx(db, () => {
      this._itemRow(id);
      db.prepare("DELETE FROM items WHERE id = ?").run(id);
    });
    this._barrier("항목 삭제");
  }

  duplicateItem(id) {
    const src = this.itemForEdit(id);
    return this.createItem(src.folderId, `${src.name} 사본`.slice(0, LIMITS.name), src.fields.map(({ name, value }) => ({ name, value })));
  }

  setFavorite(id, favorite) {
    const db = this._need();
    this._itemRow(id);
    db.prepare("UPDATE items SET favorite = ? WHERE id = ?").run(favorite ? 1 : 0, id);
    this._barrier(favorite ? "즐겨찾기 추가" : "즐겨찾기 해제");
  }

  moveItem(id, folderId) {
    const db = this._need();
    let label;
    return this._recordMove(() =>
      tx(db, () => {
        const r = this._itemRow(id);
        const f = this._checkParent(folderId);
        db.prepare("UPDATE items SET folder_id = ?, updated_at = ? WHERE id = ?").run(f, now(), id);
        label = `‘${this._open1("items", "name", id, r.name)}’ 이동`;
      })
    , () => label);
  }

  // ---------- bulk import / export (migration and backups) ----------

  // data: { folders: [{ key, parentKey, name }], items: [{ key, folderKey, name, favorite,
  //         viewCount, lastViewedAt, createdAt, fields: [{ name, value }] }] }
  // Everything lands under parentId (null = top level) in one transaction.
  importData(data, { parentId = null } = {}) {
    const db = this._need();
    const folders = Array.isArray(data?.folders) ? data.folders : [];
    const items = Array.isArray(data?.items) ? data.items : [];
    const keyToId = new Map();
    const count = { folders: 0, items: 0, fields: 0 };
    tx(db, () => {
      const root = this._checkParent(parentId);
      const keys = new Set(folders.map((f) => f.key));
      const insFolder = db.prepare(
        "INSERT INTO folders(id, parent_id, position, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const nextPos = new Map();
      const posFor = (parent) => {
        if (!nextPos.has(parent)) nextPos.set(parent, this._children(parent).length);
        const p = nextPos.get(parent);
        nextPos.set(parent, p + 1);
        return p;
      };
      // parents first, in the given order among siblings
      const pending = folders.slice();
      while (pending.length) {
        const before = pending.length;
        for (let i = 0; i < pending.length; ) {
          const f = pending[i];
          const pk = f.parentKey != null && keys.has(f.parentKey) ? f.parentKey : null;
          if (pk != null && !keyToId.has(pk)) {
            i++;
            continue;
          }
          const parent = pk == null ? root : keyToId.get(pk);
          const id = uuid();
          const t = now();
          insFolder.run(id, parent, posFor(parent), this._seal("folders", "name", id, cleanName(f.name, "폴더 이름")), t, t);
          keyToId.set(f.key, id);
          count.folders += 1;
          pending.splice(i, 1);
        }
        if (pending.length === before) throw new VaultError("invalid", "폴더 구조가 올바르지 않습니다.");
      }
      const insItem = db.prepare(
        "INSERT INTO items(id, folder_id, name, favorite, view_count, last_viewed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const it of items) {
        const id = uuid();
        const folder = it.folderKey != null && keyToId.has(it.folderKey) ? keyToId.get(it.folderKey) : root;
        const created = Number.isSafeInteger(it.createdAt) ? it.createdAt : now();
        insItem.run(
          id,
          folder,
          this._seal("items", "name", id, cleanName(it.name, "항목 이름")),
          it.favorite ? 1 : 0,
          Number.isSafeInteger(it.viewCount) && it.viewCount > 0 ? it.viewCount : 0,
          Number.isSafeInteger(it.lastViewedAt) ? it.lastViewedAt : null,
          created,
          Number.isSafeInteger(it.updatedAt) ? it.updatedAt : created
        );
        this._writeFields(id, Array.isArray(it.fields) ? it.fields : []);
        keyToId.set(it.key, id);
        count.items += 1;
        count.fields += Array.isArray(it.fields) ? it.fields.length : 0;
      }
    });
    this._barrier("가져오기");
    return { ...count, ids: keyToId };
  }

  // Plain tree of everything, values included (for backups). Same shape importData takes.
  exportData() {
    const db = this._need();
    const folders = db
      .prepare("SELECT id, parent_id, position, name FROM folders ORDER BY position")
      .all()
      .map((f) => ({ key: f.id, parentKey: f.parent_id, position: f.position, name: this._open1("folders", "name", f.id, f.name) }));
    // keep sibling order: parents' children sorted by position
    folders.sort((a, b) => a.position - b.position);
    const items = db
      .prepare("SELECT * FROM items")
      .all()
      .map((i) => ({
        key: i.id,
        folderKey: i.folder_id,
        name: this._open1("items", "name", i.id, i.name),
        favorite: !!i.favorite,
        viewCount: i.view_count,
        lastViewedAt: i.last_viewed_at,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
        fields: db
          .prepare("SELECT id, name, value FROM fields WHERE item_id = ? ORDER BY position")
          .all(i.id)
          .map((f) => ({
            name: this._open1("fields", "name", `${i.id}/${f.id}`, f.name),
            value: this._open1("fields", "value", `${i.id}/${f.id}`, f.value),
          })),
      }));
    return { folders: folders.map(({ position, ...f }) => f), items };
  }

  // Removes every folder and item (keyring and settings stay).
  clearData() {
    const db = this._need();
    tx(db, () => {
      db.exec("DELETE FROM fields; DELETE FROM items; UPDATE folders SET parent_id = NULL; DELETE FROM folders;");
    });
    this._barrier("데이터 교체");
  }

  // ---------- undo / redo (moves only) ----------

  _structure() {
    return {
      folders: this.db.prepare("SELECT id, parent_id, position FROM folders").all().map((r) => [r.id, r.parent_id, r.position]),
      items: this.db.prepare("SELECT id, folder_id FROM items").all().map((r) => [r.id, r.folder_id]),
    };
  }

  _applyStructure(s) {
    tx(this.db, () => {
      // detach first so no intermediate state points at a folder that is being moved
      const up = this.db.prepare("UPDATE folders SET parent_id = ?, position = ? WHERE id = ?");
      for (const [id, , pos] of s.folders) up.run(null, pos, id);
      for (const [id, parent, pos] of s.folders) up.run(parent, pos, id);
      const it = this.db.prepare("UPDATE items SET folder_id = ? WHERE id = ?");
      for (const [id, folder] of s.items) it.run(folder, id);
    });
  }

  _recordMove(run, label) {
    const before = this._structure();
    run();
    const entry = { label: label(), before, after: this._structure() };
    this.history.undo.push(entry);
    this.history.redo = [];
    return { label: entry.label };
  }

  _barrier(label) {
    this.history.undo.push({ barrier: true, label });
    this.history.redo = [];
  }

  historyState() {
    const top = this.history.undo[this.history.undo.length - 1];
    return {
      canUndo: !!top && !top.barrier,
      blockedBy: top && top.barrier ? top.label : null,
      canRedo: this.history.redo.length > 0,
    };
  }

  undo() {
    this._need();
    const top = this.history.undo[this.history.undo.length - 1];
    if (!top) return { ok: false, reason: "empty" };
    if (top.barrier) return { ok: false, reason: "blocked", label: top.label };
    this.history.undo.pop();
    this._applyStructure(top.before);
    this.history.redo.push(top);
    return { ok: true, label: top.label };
  }

  redo() {
    this._need();
    const e = this.history.redo.pop();
    if (!e) return { ok: false, reason: "empty" };
    this._applyStructure(e.after);
    this.history.undo.push(e);
    return { ok: true, label: e.label };
  }

  // ---------- settings (plain, readable while locked) ----------

  getSettings() {
    const rows = this._open().prepare("SELECT key, value FROM settings").all();
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  }

  setSetting(key, value) {
    this._open().prepare("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
  }
}
