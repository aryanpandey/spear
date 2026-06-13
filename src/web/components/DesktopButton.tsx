import { useEffect, useRef, useState } from "react";
import {
  fetchDesktopManifest,
  detectPlatform,
  type DesktopManifest,
  type DesktopArtifact,
  type DesktopPlatform,
} from "../api";

const LABEL: Record<DesktopPlatform, string> = { mac: "macOS", win: "Windows" };

function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function Row({ platform, artifact, detected }: { platform: DesktopPlatform; artifact: DesktopArtifact | null; detected: boolean }) {
  return (
    <div className={`dl-row ${detected ? "detected" : ""}`}>
      <span className="dl-os">
        {LABEL[platform]}
        {detected && <span className="dl-you"> · your system</span>}
      </span>
      {artifact ? (
        <a className="dl-get" href={artifact.url} download>
          download{artifact.bytes ? ` (${fmtSize(artifact.bytes)})` : ""}
        </a>
      ) : (
        <span className="dl-missing" title={`build it with: npm run dist:${platform}`}>
          not built
        </span>
      )}
    </div>
  );
}

export function DesktopButton() {
  const [open, setOpen] = useState(false);
  const [manifest, setManifest] = useState<DesktopManifest | null>(null);
  const [err, setErr] = useState(false);
  const detected = detectPlatform();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || manifest || err) return;
    fetchDesktopManifest().then(setManifest, () => setErr(true));
  }, [open, manifest, err]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // If we know the platform and its build exists, the primary click downloads directly.
  function onPrimary() {
    if (manifest && detected && manifest[detected]) {
      window.location.href = manifest[detected]!.url;
      return;
    }
    setOpen((o) => !o);
  }

  return (
    <div className="desktop-dl" ref={ref}>
      <button className="tab desktop-btn" onClick={onPrimary} title="Install spear as a desktop app">
        ⤓ Desktop app
      </button>
      {open && (
        <div className="dl-panel">
          <div className="dl-head">Install the desktop app</div>
          {err ? (
            <div className="dl-err">couldn't load downloads</div>
          ) : !manifest ? (
            <div className="muted">loading…</div>
          ) : (
            <>
              <Row platform="mac" artifact={manifest.mac} detected={detected === "mac"} />
              <Row platform="win" artifact={manifest.win} detected={detected === "win"} />
              <div className="dl-foot">
                v{manifest.version} · launches as a native Electron window
                {!manifest.mac && !manifest.win && (
                  <div className="muted" style={{ marginTop: 4 }}>
                    no builds yet — run <code>npm run dist:mac</code> / <code>dist:win</code>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
