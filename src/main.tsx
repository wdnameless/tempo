import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MiniOverlay, useOverlayDismiss } from "./components/MiniOverlay";
import { dbReady } from "./services/db";
import { isTauri } from "./services/platform";
import "./index.css";

/** Routes the webview to the right root: main app or the mini overlay window. */
function Root() {
  const isOverlay = window.location.search.includes('window=mini-overlay');
  return isOverlay ? <MiniOverlayWindow /> : <App />;
}

function MiniOverlayWindow() {
  useOverlayDismiss();
  return <MiniOverlay />;
}

function Main() {
  // Outside Tauri there is no IPC, so there is no database to wait for: the
  // browser is a UI preview, and blocking on a command that cannot answer would
  // leave a blank window forever.
  const [ready, setReady] = useState(() => !isTauri());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    dbReady()
      .then(() => setReady(true))
      .catch((err) => {
        console.error("Failed to initialize database:", err);
        setFailed(true);
      });
  }, []);

  if (failed) {
    // A blank themed surface rather than a half-initialised app: without the
    // database every screen would render empty lists that look like real data.
    return <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]" />;
  }

  if (!ready) {
    return <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]" />;
  }

  return <Root />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Main />
  </React.StrictMode>,
);
