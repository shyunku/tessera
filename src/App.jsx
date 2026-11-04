import { useEffect, useState } from "react";

// Placeholder screen until the confirmed design is implemented (#7).
export default function App() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    window.tessera.app.info().then(setInfo);
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>Tessera</h1>
      <p style={{ color: "#5d5f60" }}>{info ? `v${info.version} · Electron ${info.electron}` : "…"}</p>
      <p data-testid="node-check">{typeof window.require === "undefined" ? "renderer isolated" : "renderer has node"}</p>
    </main>
  );
}
