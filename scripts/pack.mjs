// Builds the Windows installer outside the project folder, then copies it to dist/.
// Building inside the workspace fails when an editor built on Electron (VS Code)
// holds the freshly unpacked default_app.asar open.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const out = path.join(os.tmpdir(), "tessera-release");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
fs.rmSync(out, { recursive: true, force: true });

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("npx", ["vite", "build"]);
run("npx", ["electron-builder", "--win", "--x64", `-c.directories.output=${out}`]);

const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const name = `Tessera-Setup-${pkg.version}.exe`;
for (const f of [name, `${name}.blockmap`]) fs.copyFileSync(path.join(out, f), path.join(dist, f));
console.log(`\n[pack] ${path.join(dist, name)}`);
