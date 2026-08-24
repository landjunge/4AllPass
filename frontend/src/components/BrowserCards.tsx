import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  extensionInstall,
  importBrowserLogins,
  listBrowserProfiles,
  openAutofillDemo,
  openBrowserForExtension,
  profileKey,
  type BrowserCard,
  type BrowserLoginRow,
  type ExtensionInstall,
} from "../lib/browsers.ts";
import { BrowserIcon } from "./BrowserIcon.tsx";

export function BrowserCards({
  onLogins,
  onEnsureDemoLogin,
}: {
  onLogins: (rows: BrowserLoginRow[]) => void;
  onEnsureDemoLogin: () => Promise<void>;
}): ReactNode {
  const [cards, setCards] = useState<BrowserCard[] | null | "loading">("loading");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wantExt, setWantExt] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [hint, setHint] = useState<ExtensionInstall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listBrowserProfiles().then((found) => {
      setCards(found);
      if (!found) return;
      const profiles = new Set<string>();
      const ext = new Set<string>();
      for (const card of found) {
        ext.add(card.id);
        for (const profile of card.profiles) {
          profiles.add(profileKey(card.id, profile.id));
        }
      }
      setSelected(profiles);
      setWantExt(ext);
      if (found.length === 1) setOpenId(found[0]!.id);
    });
  }, []);

  const selectedCount = useMemo(() => selected.size, [selected]);

  if (cards === "loading") {
    return (
      <section className="card browser-cards" data-testid="browser-cards">
        <p className="muted">Browser werden gesucht… / Looking for browsers…</p>
      </section>
    );
  }

  if (cards === null) {
    return (
      <section className="card browser-cards" data-testid="browser-cards">
        <h3>Browser auf diesem Gerät</h3>
        <p className="muted">
          Karten gibt es in der Desktop-App, nicht im Browser-Tab. / Cards are in the desktop app,
          not a browser tab.
        </p>
      </section>
    );
  }

  if (cards.length === 0) {
    return (
      <section className="card browser-cards" data-testid="browser-cards">
        <h3>Browser auf diesem Gerät</h3>
        <p className="muted">Keine Browser gefunden. / No browsers found.</p>
      </section>
    );
  }

  function toggleProfile(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleExt(id: string): void {
    setWantExt((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function fetchPasswords(): Promise<void> {
    setError(null);
    setBusy(true);
    const rows: BrowserLoginRow[] = [];
    try {
      for (const key of selected) {
        const split = key.indexOf(":");
        if (split < 0) continue;
        const browserId = key.slice(0, split);
        const profileId = key.slice(split + 1);
        if (browserId === "safari") {
          continue;
        }
        const part = await importBrowserLogins(browserId, profileId);
        rows.push(...part);
      }
      onLogins(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function installExt(browserId: string): Promise<void> {
    setError(null);
    try {
      const info = await extensionInstall(browserId);
      setHint(info);
      await openBrowserForExtension(browserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openDemo(browserId: string): Promise<void> {
    setError(null);
    try {
      await onEnsureDemoLogin();
      await openAutofillDemo(browserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="card browser-cards" data-testid="browser-cards">
      <h3>Browser auf diesem Gerät / Browsers on this device</h3>
      <p className="hint">
        Pro Browser: Extension und Passwörter sind getrennte Haken. Extension lädt der Browser
        selbst — kein Mac-Passwort. / Extension vs passwords are separate. The browser installs the
        add-on; no Mac login password for that.
      </p>
      <div className="browser-card-grid">
        {cards.map((card) => {
          const open = openId === card.id;
          return (
            <article
              key={card.id}
              className={open ? "browser-card open" : "browser-card"}
              data-testid={`browser-card-${card.id}`}
            >
              <button
                type="button"
                className="browser-card-hit"
                onClick={() => setOpenId(open ? null : card.id)}
              >
                <BrowserIcon id={card.id} name={card.name} />
                <span className="browser-card-label">
                  <strong>{card.name}</strong>
                  <span className="muted">
                    {card.profiles.length}{" "}
                    {card.profiles.length === 1 ? "Profil / profile" : "Profile / profiles"}
                  </span>
                </span>
              </button>
              {open ? (
                <div className="browser-card-body">
                  <label className="browser-ext">
                    <input
                      type="checkbox"
                      checked={wantExt.has(card.id)}
                      onChange={() => toggleExt(card.id)}
                    />
                    Extension
                  </label>
                  {wantExt.has(card.id) ? (
                    <button type="button" onClick={() => void installExt(card.id)}>
                      Extension laden / Load add-on
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`open-autofill-demo-${card.id}`}
                    onClick={() => void openDemo(card.id)}
                  >
                    Demo-Login öffnen / Open demo login
                  </button>
                  <ul className="browser-profiles">
                    {card.profiles.length === 0 ? (
                      <li className="muted">Kein Profil gefunden. / No profile found.</li>
                    ) : (
                      card.profiles.map((profile) => {
                        const key = profileKey(card.id, profile.id);
                        return (
                          <li key={key}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selected.has(key)}
                                onChange={() => toggleProfile(key)}
                              />
                              {profile.name} — Passwörter holen später / fetch later
                            </label>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || selectedCount === 0}
          data-testid="fetch-browser-passwords"
          onClick={() => void fetchPasswords()}
        >
          {busy
            ? "Keychain / lese Profile…"
            : `Passwörter holen (${selectedCount}) / Fetch passwords`}
        </button>
      </div>
      <p className="muted">
        {selectedCount} Profile gewählt / selected · {wantExt.size} Extensions. macOS kann nach dem
        Anmeldepasswort fragen.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {hint ? (
        <div className="browser-install-hint" data-testid="extension-install-hint">
          <p>
            <strong>{hint.appName}</strong> — {hint.page}
          </p>
          {hint.flavor === "firefox" ? (
            <p>
              about:debugging → Load Temporary Add-on → diese Datei / this file:
              <code>{hint.bundlePath}/manifest.json</code>
            </p>
          ) : hint.flavor === "safari" ? (
            <p>
              Xcode-Projekt öffnen, Run, dann Safari → Einstellungen → Erweiterungen. /
              Open the Xcode project, Run, then Safari → Settings → Extensions.
              <code>{hint.bundlePath}</code>
            </p>
          ) : (
            <p>
              Developer mode → Load unpacked → diesen Ordner / this folder:
              <code>{hint.bundlePath}</code>
            </p>
          )}
          <p>
            Popup: nur Tresor-Passwort, API <code>http://127.0.0.1:8788</code>. / Popup: vault
            password only.
          </p>
          <button type="button" data-testid="open-autofill-demo" onClick={() => void openDemo(hint.browserId)}>
            Demo-Login öffnen / Open demo login
          </button>
        </div>
      ) : null}
    </section>
  );
}
