import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Service } from "../electron/service.js";
import { Vault } from "../electron/store/vault.js";

const FAST = { name: "scrypt", N: 2 ** 10, r: 8, p: 1 };

function fakeClipboard() {
  let text = "";
  return { writeText: (t) => (text = t), readText: () => text, clear: () => (text = ""), get text() { return text; } };
}

function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-svc-"));
  const events = [];
  const clipboard = fakeClipboard();
  const s = new Service({ dataDir: dir, clipboard, emit: (e, p) => events.push([e, p]), kdf: FAST });
  return { s, clipboard, events, dir };
}

test("first run: empty → create → unlocked", async () => {
  const { s } = make();
  assert.equal(s.status().state, "empty");
  await assert.rejects(s.create("short"), (e) => e.code === "weak-password");
  const st = await s.create("long-enough-pw");
  assert.equal(st.state, "unlocked");
  assert.equal(st.settings.autoLockMinutes, 5);
  assert.equal(st.settings.clipboardSeconds, 30);
});

test("five wrong passwords lock input for 30 seconds", async () => {
  const { s } = make();
  await s.create("long-enough-pw");
  s.lock();
  for (let i = 4; i >= 1; i--) {
    await assert.rejects(s.unlock("bad"), (e) => e.code === "wrong-password" && e.message.includes(`${i}번 남음`));
  }
  await assert.rejects(s.unlock("bad"), (e) => e.code === "throttled");
  await assert.rejects(s.unlock("long-enough-pw"), (e) => e.code === "throttled");
  assert.ok(s.status().lockedUntil > Date.now());
  s.lockedUntil = 0;
  assert.equal((await s.unlock("long-enough-pw")).state, "unlocked");
});

test("lock emits an event once", async () => {
  const { s, events } = make();
  await s.create("long-enough-pw");
  s.lock("idle");
  s.lock("idle");
  assert.deepEqual(events.filter((e) => e[0] === "vault:locked"), [["vault:locked", { reason: "idle" }]]);
});

test("copy puts the value on the clipboard and clears only our value", async () => {
  const { s, clipboard, events } = make();
  await s.create("long-enough-pw");
  const id = s.vault.createItem(null, "item", [{ name: "비밀번호", value: "hunter2" }]);
  const fid = s.vault.getItem(id).fields[0].id;
  const r = s.copyField(fid);
  assert.equal(r.label, "비밀번호");
  assert.equal(r.seconds, 30);
  assert.equal(clipboard.text, "hunter2");
  assert.equal(s.clearClipboard(true), true);
  assert.equal(clipboard.text, "");
  assert.deepEqual(events.at(-1), ["clipboard:cleared", { cleared: true }]);

  s.copyField(fid);
  clipboard.writeText("something the user copied later");
  assert.equal(s.clearClipboard(true), false);
  assert.equal(clipboard.text, "something the user copied later");
});

test("clipboard is cleared automatically after the set time", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { s, clipboard } = make();
  await s.create("long-enough-pw");
  s.setSetting("clipboardSeconds", 15);
  const id = s.vault.createItem(null, "item", [{ name: "k", value: "v" }]);
  s.copyField(s.vault.getItem(id).fields[0].id);
  t.mock.timers.tick(14_000);
  assert.equal(clipboard.text, "v");
  t.mock.timers.tick(1_000);
  assert.equal(clipboard.text, "");
});

test("settings are validated", async () => {
  const { s } = make();
  await s.create("long-enough-pw");
  assert.equal(s.setSetting("theme", "dark").theme, "dark");
  assert.throws(() => s.setSetting("theme", "neon"), (e) => e.code === "invalid");
  assert.throws(() => s.setSetting("autoLockMinutes", 7), (e) => e.code === "invalid");
  assert.throws(() => s.setSetting("__proto__", 1), (e) => e.code === "invalid");
});

test("password change and reset", async () => {
  const { s, dir } = make();
  await s.create("long-enough-pw");
  await assert.rejects(s.changePassword("bad", "another-long-pw"), (e) => e.code === "wrong-password");
  await assert.rejects(s.changePassword("long-enough-pw", "short"), (e) => e.code === "weak-password");
  await s.changePassword("long-enough-pw", "another-long-pw");
  await assert.rejects(s.reset("another-long-pw", "reset"), (e) => e.code === "invalid");
  await assert.rejects(s.reset("bad", "초기화"), (e) => e.code === "wrong-password");
  const st = await s.reset("another-long-pw", "초기화");
  assert.equal(st.state, "empty");
  assert.equal(Vault.exists(path.join(dir, "tessera.db")), false, "no keyring or data left");
});
