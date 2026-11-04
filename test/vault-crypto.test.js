import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  DEFAULT_KDF,
  createKeyring,
  unwrapDek,
  wrapDek,
  seal,
  open,
  sealString,
  openString,
  fieldAad,
  deriveKek,
  newKey,
  WrongPasswordError,
  IntegrityError,
  CorruptDataError,
} from "../electron/crypto/vault-crypto.js";

// Fast parameters for tests; the format is the same.
const FAST = { name: "scrypt", N: 2 ** 10, r: 8, p: 1 };
const U = () => crypto.randomUUID();

test("default KDF is scrypt with at least 128 MiB of work", () => {
  assert.equal(DEFAULT_KDF.name, "scrypt");
  assert.ok(128 * DEFAULT_KDF.N * DEFAULT_KDF.r >= 128 * 1024 * 1024);
});

test("keyring round trip with the right password", async () => {
  const { record, dek } = await createKeyring("correct horse 배터리", FAST);
  const again = await unwrapDek("correct horse 배터리", record);
  assert.ok(dek.equals(again));
  assert.equal(record.salt.length, 16);
  assert.deepEqual(record.kdf, FAST);
});

test("unwrapped DEK is its own allocation, not a slice of the shared pool", async () => {
  const { record } = await createKeyring("pw", FAST);
  const dek = await unwrapDek("pw", record);
  assert.equal(dek.byteOffset, 0);
  assert.equal(dek.buffer.byteLength, 32);
  assert.equal(newKey().buffer.byteLength, 32);
});

test("wrong password is rejected", async () => {
  const { record } = await createKeyring("secret-1", FAST);
  await assert.rejects(unwrapDek("secret-2", record), WrongPasswordError);
  await assert.rejects(unwrapDek("Secret-1", record), WrongPasswordError);
});

test("password is NFC-normalized (composed and decomposed Hangul match)", async () => {
  const composed = "비밀번호";
  const decomposed = composed.normalize("NFD");
  assert.notEqual(composed, decomposed);
  const { record, dek } = await createKeyring(composed, FAST);
  assert.ok((await unwrapDek(decomposed, record)).equals(dek));
});

test("empty, non-string or malformed passwords are refused", async () => {
  await assert.rejects(createKeyring("", FAST), TypeError);
  await assert.rejects(createKeyring(undefined, FAST), TypeError);
  await assert.rejects(createKeyring("ab\uD800", FAST), TypeError);
});

test("a changed wrapped key or salt reads as a wrong password", async () => {
  const { record } = await createKeyring("pw", FAST);
  const flipped = Buffer.from(record.wrappedDek);
  flipped[flipped.length - 1] ^= 1;
  await assert.rejects(unwrapDek("pw", { ...record, wrappedDek: flipped }), WrongPasswordError);
  const salt = Buffer.from(record.salt);
  salt[0] ^= 1;
  await assert.rejects(unwrapDek("pw", { ...record, salt }), WrongPasswordError);
});

test("damaged or unknown keyring data is NOT reported as a wrong password", async () => {
  const { record } = await createKeyring("pw", FAST);
  const cases = {
    missing: { ...record, wrappedDek: undefined },
    truncated: { ...record, wrappedDek: record.wrappedDek.subarray(0, 10) },
    futureFormat: { ...record, wrappedDek: Buffer.concat([Buffer.from([2]), record.wrappedDek.subarray(1)]) },
    shortSalt: { ...record, salt: record.salt.subarray(0, 8) },
    badKdf: { ...record, kdf: { name: "argon2id" } },
    noRecord: null,
  };
  for (const [name, rec] of Object.entries(cases)) {
    await assert.rejects(unwrapDek("pw", rec), CorruptDataError, name);
  }
});

test("Uint8Array inputs (as node:sqlite returns them) work everywhere", async () => {
  const { record, dek } = await createKeyring("pw", FAST);
  const asU8 = (b) => new Uint8Array(b);
  const back = await unwrapDek("pw", { kdf: record.kdf, salt: asU8(record.salt), wrappedDek: asU8(record.wrappedDek) });
  assert.ok(back.equals(dek));
  const aad = fieldAad("items", "name", U());
  assert.equal(openString(asU8(dek), asU8(sealString(dek, "x", aad)), aad), "x");
});

test("a new wrap of the same DEK opens with the new password only", async () => {
  const { record, dek } = await createKeyring("old", FAST);
  const next = await wrapDek(dek, "new", FAST);
  assert.ok(!next.salt.equals(record.salt));
  assert.ok((await unwrapDek("new", next)).equals(dek));
  await assert.rejects(unwrapDek("old", next), WrongPasswordError);
});

test("seal/open round trip and fresh IV every time", async () => {
  const { dek } = await createKeyring("pw", FAST);
  const aad = fieldAad("items", "name", U());
  const a = sealString(dek, "GitHub 🔑", aad);
  const b = sealString(dek, "GitHub 🔑", aad);
  assert.notDeepEqual(a.subarray(1, 13), b.subarray(1, 13), "IVs differ");
  assert.equal(openString(dek, a, aad), "GitHub 🔑");
  assert.equal(openString(dek, sealString(dek, "", aad), aad), "");
});

test("ciphertext is bound to its row, its column and its parent", async () => {
  const { dek } = await createKeyring("pw", FAST);
  const item = U();
  const row = U();
  const blob = sealString(dek, "hunter2", fieldAad("fields", "value", `${item}/${row}`));
  assert.throws(() => openString(dek, blob, fieldAad("fields", "value", `${U()}/${row}`)), IntegrityError);
  assert.throws(() => openString(dek, blob, fieldAad("fields", "name", `${item}/${row}`)), IntegrityError);
  assert.throws(() => openString(dek, blob, fieldAad("fields", "value", row)), IntegrityError);
});

test("AAD inputs are validated so they cannot collide", () => {
  assert.throws(() => fieldAad("a:b", "c", U()), TypeError);
  assert.throws(() => fieldAad("items", "name", undefined), TypeError);
  assert.throws(() => fieldAad("items", "name", "null"), TypeError);
  assert.throws(() => fieldAad("items", "name", `${U()}:x`), TypeError);
});

test("any flipped byte is detected", async () => {
  const { dek } = await createKeyring("pw", FAST);
  const aad = fieldAad("items", "name", U());
  const blob = seal(dek, Buffer.from("payload"), aad);
  for (let i = 1; i < blob.length; i++) {
    const x = Buffer.from(blob);
    x[i] ^= 0x80;
    assert.throws(() => open(dek, x, aad), IntegrityError, `byte ${i}`);
  }
  const wrongFormat = Buffer.from(blob);
  wrongFormat[0] = 9;
  assert.throws(() => open(dek, wrongFormat, aad), CorruptDataError);
  assert.throws(() => open(dek, blob.subarray(0, 20), aad), CorruptDataError);
  assert.throws(() => open(dek, null, aad), CorruptDataError);
});

test("wrong key is detected", async () => {
  const a = await createKeyring("pw", FAST);
  const b = await createKeyring("pw", FAST);
  const aad = fieldAad("items", "name", U());
  assert.throws(() => openString(b.dek, sealString(a.dek, "x", aad), aad), IntegrityError);
});

test("bad inputs are refused", () => {
  const aad = fieldAad("items", "name", U());
  assert.throws(() => seal(Buffer.alloc(16), "x", aad), TypeError);
  assert.throws(() => seal(Buffer.alloc(32), Buffer.from("x"), ""), TypeError);
  assert.throws(() => seal(Buffer.alloc(32), 42, aad), TypeError);
  for (const v of [undefined, null, 42, { a: 1 }]) assert.throws(() => sealString(Buffer.alloc(32), v, aad), TypeError);
});

test("KDF parameters from a tampered file are bounded, including their product", async () => {
  const salt = Buffer.alloc(16);
  const bad = [
    { name: "md5" },
    { name: "scrypt", N: 2 ** 24, r: 8, p: 1 },
    { name: "scrypt", N: 3000, r: 8, p: 1 },
    { name: "scrypt", N: 2 ** 4, r: 8, p: 1 },
    { name: "scrypt", N: 2 ** 14, r: 64, p: 1 },
    { name: "scrypt", N: 2 ** 14, r: 8, p: 99 },
    { name: "scrypt", N: 2 ** 20, r: 16, p: 4 }, // 2 GiB, crashes Electron
    { name: "scrypt", N: 2 ** 20, r: 8, p: 1 }, // 1 GiB
    { name: "scrypt", N: 2 ** 32 + 2 ** 20, r: 8, p: 1 },
  ];
  for (const kdf of bad) await assert.rejects(deriveKek("pw", salt, kdf), CorruptDataError, JSON.stringify(kdf));
  await assert.rejects(deriveKek("pw", Buffer.alloc(4), FAST), CorruptDataError);
});

test("default parameters work end to end", async () => {
  const t = Date.now();
  const { record, dek } = await createKeyring("real-params");
  assert.ok((await unwrapDek("real-params", record)).equals(dek));
  console.log(`  scrypt default x2: ${Date.now() - t} ms`);
});
