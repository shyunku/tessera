import { useCallback, useEffect, useState } from "react";
import { api } from "./util.js";
import { ImportScreen, CreateScreen, UnlockScreen } from "./screens/Start.jsx";
import Vault from "./screens/Vault.jsx";

const CHROME = {
  light: { color: "#f4f6f8", symbolColor: "#5d5f60" },
  dark: { color: "#0c0d0e", symbolColor: "#b4b6b8" },
};

function useSystemDark() {
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = (e) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [lockReason, setLockReason] = useState("startup");
  const [startOver, setStartOver] = useState(false);
  const systemDark = useSystemDark();

  const refresh = useCallback(() => api.app.status().then(setStatus), []);

  useEffect(() => {
    refresh();
    const offLock = api.on("vault:locked", (p) => {
      setLockReason(p?.reason || "manual");
      refresh();
    });
    const offSettings = api.on("settings:changed", (settings) => setStatus((s) => (s ? { ...s, settings } : s)));
    return () => {
      offLock();
      offSettings();
    };
  }, [refresh]);

  const pref = status?.settings?.theme || "system";
  const theme = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  const screen = !status
    ? "loading"
    : status.state === "unlocked"
      ? "vault"
      : status.state === "locked"
        ? "unlock"
        : status.legacy && !startOver
          ? "import"
          : "create";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    api.app.setTitleBar({ ...CHROME[theme], height: screen === "vault" ? 48 : 32 }).catch(() => {});
  }, [theme, screen]);

  if (screen === "loading") return null;
  if (screen === "import") return <ImportScreen onDone={setStatus} onSkip={() => setStartOver(true)} />;
  if (screen === "create") return <CreateScreen onDone={setStatus} />;
  if (screen === "unlock") return <UnlockScreen reason={lockReason} lockedUntil={status.lockedUntil} onDone={setStatus} />;
  return <Vault status={status} setStatus={setStatus} />;
}
