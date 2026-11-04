# Tessera

Tessera (formerly Keyhub) is a local desktop password and key manager for Windows. Everything stays on your PC in one encrypted file; nothing is synced or sent anywhere.

Data is organised as **folders → items → keys** (for example `Work › Dev › GitHub` with keys `ID`, `Password`, `Token`).

## Features

- One master password per PC; auto-lock after idle time, on minimise, and when Windows locks or sleeps
- Values hidden until you reveal them; copying puts the value on the clipboard and clears it after 15/30/60 seconds
- Folder tree with drag and drop (move and reorder), favourites, recently viewed, search over item and key names
- Undo/redo for moves (`Ctrl+Z`, `Ctrl+Y`)
- Encrypted `.tessera` backups (add into a new folder, or replace everything)
- Light and dark themes
- One-time import of Keyhub 0.5 data

## Security model

- Master password → scrypt (N=2^17, r=8, p=1, random salt) → key that wraps a random 256-bit data key.
- Every folder name, item name, key name and value is encrypted with AES-256-GCM under the data key, bound to its row so ciphertexts cannot be swapped.
- A wrong password is detected by authenticated decryption; no password hash is stored. Damaged data is reported separately from a wrong password.
- Changing the password generates a new data key and re-encrypts everything.
- Stored in plain form: folder structure and order, favourite flags, view counts, timestamps, the number of keys per item.
- The renderer runs sandboxed with context isolation and a strict CSP; decryption happens only in the main process. Packaged builds disable `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, inspector flags and remote debugging, and check asar integrity.

## Data location

| | Path |
| --- | --- |
| Data | `%APPDATA%\Tessera\data\tessera.db` |
| Safety copies made before a "replace all" import | `%APPDATA%\Tessera\data\backups\` |
| Keyhub 0.5 data (read once, never modified) | `%APPDATA%\Keyhub\datafiles\v1` |

## Development

Requires Node.js 22+ and npm.

```bash
npm install          # also downloads the Electron binary
npm run dev          # Vite dev server + Electron (data in ./.devdata)
npm test             # unit tests (system Node)
npm run test:electron # the same tests inside Electron's runtime (BoringSSL)
npm run build        # renderer → build/renderer
npm start            # Electron with the built renderer
npm run pack:win     # Windows x64 installer → dist/Tessera-Setup-<version>.exe
```

In development, old Keyhub data is read from `./datafiles/v1` (or `TESSERA_LEGACY_DIR`).

`pack:win` builds in the system temp folder and copies the installer into `dist/`, because VS Code keeps freshly unpacked `.asar` files open inside the workspace.

## Project layout

```
electron/            main process
  crypto/            envelope encryption
  store/             SQLite store (node:sqlite)
  legacy/            Keyhub 0.5 import
  backup.js          .tessera backups
  service.js, ipc.js session, clipboard, auto-lock, IPC surface
  preload.cjs        the only API the page can call
src/                 React 19 renderer
test/                node:test suites
docs/                spec, plans, tasks, design mock
```
