// Runs the unit tests inside Electron's own Node runtime (BoringSSL, Electron's
// node:sqlite), which differs from system Node in crypto limits and behaviour.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
const child = spawn(require("electron"), ["--test", "--test-reporter=spec", "test/**/*.test.js"], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 1));
