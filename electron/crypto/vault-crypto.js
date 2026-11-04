// Envelope encryption for Tessera data.
//
//   password --scrypt(salt)--> KEK --AES-256-GCM--> wraps a random 32-byte DEK
//   every secret field       --AES-256-GCM with the DEK, bound to its row via AAD
//
// The DEK never leaves the main process. A wrong password is detected by the
// GCM tag failing when the DEK is unwrapped, so no password hash is stored.
// Wiping buffers is best effort: JS strings and library internals keep copies.
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export const FORMAT = 1; // first byte of every sealed blob, also bound into the AAD
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const HEADER = 1 + IV_LEN + TAG_LEN;
const DEK_AAD = "tessera:dek";

// ~0.6 s and 128 MiB under Electron/BoringSSL (measured 2026-11-04). Stored with the
// keyring so they can be raised later without breaking existing data.
export const DEFAULT_KDF = Object.freeze({ name: "scrypt", N: 2 ** 17, r: 8, p: 1 });

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
    this.name = "WrongPasswordError";
  }
}

// Authentication failed: wrong key, or the bytes were changed.
export class IntegrityError extends Error {
  constructor(message = "Encrypted data failed its integrity check") {
    super(message);
    this.name = "IntegrityError";
  }
}

// The stored bytes are not something we can even try to decrypt (missing, truncated,
// unknown format, out-of-range parameters). Never reported as a wrong password.
export class CorruptDataError extends Error {
  constructor(message = "Stored encrypted data is damaged or in an unknown format") {
    super(message);
    this.name = "CorruptDataError";
  }
}

function asBuffer(data, what) {
  if (Buffer.isBuffer(data)) return data;
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError(`${what} must be bytes`);
}

// Same password typed through different input methods can differ in Unicode form.
function passwordBytes(password) {
  if (typeof password !== "string" || password.length === 0) throw new TypeError("Password must be a non-empty string");
  if (!password.isWellFormed()) throw new TypeError("Password contains invalid characters");
  return Buffer.from(password.normalize("NFC"), "utf8");
}

function checkKey(key) {
  const k = asBuffer(key, "Key");
  if (k.length !== KEY_LEN) throw new TypeError("Key must be 32 bytes");
  return k;
}

// Parameters come from the data file, so bound them: a tampered file must not be
// able to make unlocking allocate gigabytes (that kills the Electron process).
function checkKdf(kdf) {
  if (!kdf || kdf.name !== "scrypt") throw new CorruptDataError(`Unsupported KDF: ${kdf && kdf.name}`);
  const { N, r, p } = kdf;
  const pow2 = Number.isSafeInteger(N) && N > 1 && N <= 2 ** 30 && (N & (N - 1)) === 0;
  if (!pow2 || N < 2 ** 10) throw new CorruptDataError("scrypt N out of range");
  if (!Number.isInteger(r) || r < 1 || r > 16) throw new CorruptDataError("scrypt r out of range");
  if (!Number.isInteger(p) || p < 1 || p > 4) throw new CorruptDataError("scrypt p out of range");
  if (128 * N * r > 512 * 1024 * 1024) throw new CorruptDataError("scrypt memory cost out of range");
  if (N * r * p > 2 ** 22) throw new CorruptDataError("scrypt work out of range");
}

export async function deriveKek(password, salt, kdf = DEFAULT_KDF) {
  checkKdf(kdf);
  const s = asBuffer(salt, "Salt");
  if (s.length < 16) throw new CorruptDataError("Salt is too short");
  const pw = passwordBytes(password);
  try {
    return await scrypt(pw, s, KEY_LEN, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 });
  } finally {
    pw.fill(0);
  }
}

function aadBytes(aad) {
  if (typeof aad !== "string" || !aad) throw new TypeError("AAD must be a non-empty string");
  return Buffer.concat([Buffer.from([FORMAT]), Buffer.from(aad, "utf8")]);
}

// blob = [FORMAT:1][iv:12][tag:16][ciphertext]
export function seal(key, data, aad) {
  const k = checkKey(key);
  const ad = aadBytes(aad);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(ad);
  const ct = Buffer.concat([cipher.update(asBuffer(data, "Data")), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT]), iv, cipher.getAuthTag(), ct]);
}

export function open(key, blob, aad) {
  const k = checkKey(key);
  const ad = aadBytes(aad);
  if (blob == null) throw new CorruptDataError("Encrypted value is missing");
  const b = asBuffer(blob, "Encrypted value");
  if (b.length < HEADER) throw new CorruptDataError("Encrypted value is truncated");
  if (b[0] !== FORMAT) throw new CorruptDataError("Encrypted value has an unknown format");
  const iv = b.subarray(1, 1 + IV_LEN);
  const tag = b.subarray(1 + IV_LEN, HEADER);
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(ad);
  decipher.setAuthTag(tag);
  // GCM's final() returns no bytes, so update() holds the whole plaintext: no extra copy.
  const out = decipher.update(b.subarray(HEADER));
  try {
    decipher.final();
  } catch {
    out.fill(0);
    throw new IntegrityError();
  }
  return out;
}

export function sealString(key, text, aad) {
  if (typeof text !== "string") throw new TypeError("Text must be a string");
  const buf = Buffer.from(text, "utf8");
  try {
    return seal(key, buf, aad);
  } finally {
    buf.fill(0);
  }
}

export function openString(key, blob, aad) {
  const buf = open(key, blob, aad);
  try {
    return buf.toString("utf8");
  } finally {
    buf.fill(0);
  }
}

const NAME_RE = /^[a-z_]+$/;
const ROW_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;

// Field AAD: binds a ciphertext to one column of one row. rowId is a UUID, or
// "parentUuid/uuid" when the row must also stay tied to its parent.
export function fieldAad(table, column, rowId) {
  if (!NAME_RE.test(table) || !NAME_RE.test(column)) throw new TypeError("Bad table or column name");
  if (typeof rowId !== "string" || !ROW_RE.test(rowId)) throw new TypeError("Bad row id");
  return `tessera:${table}:${column}:${rowId}`;
}

export function newKey() {
  // Buffer.alloc never comes from the shared pool, so wiping it wipes the only copy.
  const k = Buffer.alloc(KEY_LEN);
  crypto.randomFillSync(k);
  return k;
}

// Creates a new keyring for a password. Returns the stored record and the open DEK.
export async function createKeyring(password, kdf = DEFAULT_KDF) {
  const dek = newKey();
  const record = await wrapDek(dek, password, kdf);
  return { record, dek };
}

export async function wrapDek(dek, password, kdf = DEFAULT_KDF) {
  checkKey(dek);
  const salt = crypto.randomBytes(16);
  const kek = await deriveKek(password, salt, kdf);
  try {
    return {
      kdf: { name: kdf.name, N: kdf.N, r: kdf.r, p: kdf.p },
      salt,
      wrappedDek: seal(kek, dek, DEK_AAD),
    };
  } finally {
    kek.fill(0);
  }
}

// Returns the DEK, or throws WrongPasswordError (tag failure) / CorruptDataError.
export async function unwrapDek(password, record) {
  if (!record) throw new CorruptDataError("Keyring is missing");
  const kek = await deriveKek(password, record.salt, record.kdf);
  let raw;
  try {
    raw = open(kek, record.wrappedDek, DEK_AAD);
  } catch (e) {
    if (e instanceof IntegrityError) throw new WrongPasswordError();
    throw e;
  } finally {
    kek.fill(0);
  }
  try {
    if (raw.length !== KEY_LEN) throw new CorruptDataError("Unwrapped key has the wrong length");
    const dek = Buffer.alloc(KEY_LEN);
    raw.copy(dek);
    return dek;
  } finally {
    raw.fill(0);
  }
}

export function wipe(buf) {
  if (Buffer.isBuffer(buf)) buf.fill(0);
}
