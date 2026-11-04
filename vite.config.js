import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The production page is loaded from file://, so it gets a strict CSP through a meta tag.
// The dev server needs inline scripts for React Fast Refresh, so the tag is only added on build.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

function cspOnBuild() {
  return {
    name: "tessera-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  root: "src",
  base: "./",
  plugins: [react(), cspOnBuild()],
  build: {
    outDir: "../build/renderer",
    emptyOutDir: true,
    target: "chrome140",
  },
  server: {
    port: 4125,
    strictPort: true,
  },
});
