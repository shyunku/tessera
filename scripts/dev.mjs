// Starts the Vite dev server, then Electron pointed at it.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const electronPath = require("electron");

const server = await createServer({ configFile: "vite.config.js" });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] renderer at ${url}`);

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE; // some shells set this, which makes Electron run as plain Node

const child = spawn(electronPath, ["."], { stdio: "inherit", env });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
