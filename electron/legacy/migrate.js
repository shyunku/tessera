// One-time move of the Keyhub 0.5.x "shyunku" account into a new Tessera data file.
//
// 1. check the password against the v1 hash   2. read and decrypt every v1 value (from a temp copy)
// 3. write a new data file under a temp name  4. reopen it and compare every value with the source
// 5. rename it into place.  The v1 files are never written; on any failure nothing is left behind.
import fs from "node:fs";
import { Vault, VaultError } from "../store/vault.js";
import { detectLegacy, legacyPassphrase, readLegacyRows, buildImport, LEGACY_ACCOUNT } from "./v1.js";

const sameText = (a, b) => a === b;

export async function migrateLegacy({ legacyDir, dataFile, password, kdf, onProgress = () => {} }) {
  const legacy = detectLegacy(legacyDir);
  if (!legacy) throw new VaultError("no-legacy", "이전 버전 데이터를 찾을 수 없습니다.");
  if (fs.existsSync(dataFile) && Vault.exists(dataFile)) throw new VaultError("exists", "이미 데이터가 있습니다.");

  onProgress({ step: "verify" });
  const passphrase = legacyPassphrase(password, legacy.storedHash);
  if (!passphrase) throw new VaultError("wrong-password", "비밀번호가 맞지 않습니다.");

  onProgress({ step: "read" });
  const rows = readLegacyRows(legacy.db);
  const data = buildImport(rows, passphrase);
  if (data.report.failed.length) {
    throw new VaultError("legacy-decrypt", `이전 데이터의 값 ${data.report.failed.length}개를 풀지 못해서 가져오기를 멈췄습니다. 원본은 그대로 있습니다.`);
  }
  const total = data.report.fields;
  onProgress({ step: "read", done: total, total });

  const tmp = `${dataFile}.migrating`;
  for (const f of [tmp, `${tmp}-journal`]) fs.rmSync(f, { force: true });
  let vault = new Vault(tmp, kdf ? { kdf } : undefined);
  try {
    onProgress({ step: "write", done: 0, total });
    await vault.create(password);
    const { ids } = vault.importData(data);
    vault.setMeta("migrated_from", `keyhub-v1:${LEGACY_ACCOUNT}`);
    vault.setMeta("migrated_at", Date.now());
    if (rows.items.length) {
      const first = Math.min(...data.items.map((i) => i.createdAt ?? Infinity));
      if (Number.isFinite(first)) vault.setMeta("created_at", first);
    }
    onProgress({ step: "write", done: total, total });
    vault.close();

    // Verify by reading back from disk with the password.
    onProgress({ step: "check", done: 0, total });
    vault = new Vault(tmp, kdf ? { kdf } : undefined);
    await vault.unlock(password);
    const snap = vault.snapshot();
    if (snap.folders.length !== data.folders.length || snap.items.length !== data.items.length) {
      throw new VaultError("legacy-verify", "가져온 결과가 원본과 다릅니다.");
    }
    const folderName = new Map(snap.folders.map((f) => [f.id, f]));
    for (const f of data.folders) {
      const got = folderName.get(ids.get(f.key));
      const parent = f.parentKey == null ? null : ids.get(f.parentKey);
      if (!got || !sameText(got.name, f.name) || got.parentId !== parent) throw new VaultError("legacy-verify", "폴더가 원본과 다릅니다.");
    }
    let done = 0;
    for (const it of data.items) {
      const got = vault.getItem(ids.get(it.key));
      const folder = it.folderKey == null ? null : ids.get(it.folderKey);
      if (!sameText(got.name, it.name) || got.folderId !== folder || got.fields.length !== it.fields.length) {
        throw new VaultError("legacy-verify", "항목이 원본과 다릅니다.");
      }
      got.fields.forEach((f, i) => {
        if (!sameText(f.name, it.fields[i].name) || !sameText(vault.revealField(f.id), it.fields[i].value)) {
          throw new VaultError("legacy-verify", "값이 원본과 다릅니다.");
        }
      });
      done += it.fields.length;
      onProgress({ step: "check", done, total });
    }
    vault.close();

    fs.renameSync(tmp, dataFile);
    onProgress({ step: "done", done: total, total });
    return { folders: data.folders.length, items: data.items.length, fields: total, skippedOrphanKeys: data.report.skippedOrphanKeys };
  } catch (e) {
    vault.close();
    for (const f of [tmp, `${tmp}-journal`]) fs.rmSync(f, { force: true });
    throw e;
  }
}
