import { useEffect, useState, type ReactNode } from "react";
import { isTauriShell } from "../lib/webauthnCapabilities.ts";
import { launchAtLoginEnabled, setLaunchAtLogin } from "../lib/desktop.ts";
import {
  LAUNCH_AT_LOGIN_BROWSER,
  LAUNCH_AT_LOGIN_HINT,
  LAUNCH_AT_LOGIN_LABEL,
  SLEEP_LOCK_HINT,
} from "../lib/desktop-settings.ts";

export function SettingsPanel(): ReactNode {
  const desktop = isTauriShell();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    void launchAtLoginEnabled().then((value) => {
      if (typeof value === "boolean") setEnabled(value);
    });
  }, [desktop]);

  async function toggle(): Promise<void> {
    if (!desktop || busy) return;
    setBusy(true);
    const next = !enabled;
    const ok = await setLaunchAtLogin(next);
    if (ok) setEnabled(next);
    setBusy(false);
  }

  return (
    <section className="card" data-testid="settings-desktop">
      <h3>Einstellungen / Settings</h3>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!desktop || busy}
          data-testid="launch-at-login"
          onChange={() => void toggle()}
        />
        {LAUNCH_AT_LOGIN_LABEL}
      </label>
      <p className="hint" data-testid="launch-at-login-hint">
        {desktop ? LAUNCH_AT_LOGIN_HINT : LAUNCH_AT_LOGIN_BROWSER}
      </p>
      <p className="hint" data-testid="sleep-lock-hint">
        {SLEEP_LOCK_HINT}
      </p>
    </section>
  );
}
