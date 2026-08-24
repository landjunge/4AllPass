import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { loadBrowserActive, saveBrowserActive } from "../lib/browser-active.ts";
import { useCopy } from "../state/copy-mode.tsx";
import { BrowserIcon } from "./BrowserIcon.tsx";

export function BrowserCards({
  vaultId,
  onLogins,
  onEnsureDemoLogin,
}: {
  vaultId: string;
  onLogins: (rows: BrowserLoginRow[]) => void;
  onEnsureDemoLogin: () => Promise<void>;
}): ReactNode {
  const { t } = useCopy();
  const [cards, setCards] = useState<BrowserCard[] | null | "loading">("loading");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wantExt, setWantExt] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [hint, setHint] = useState<ExtensionInstall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    void listBrowserProfiles()
      .then((found) => {
      setError(null);
      setCards(found);
      if (!found) return;
      const saved = loadBrowserActive(vaultId);
      const knownExt = new Set(found.map((card) => card.id));
      const knownProfiles = new Set(
        found.flatMap((card) => card.profiles.map((profile) => profileKey(card.id, profile.id))),
      );
      if (saved) {
        setWantExt(new Set(saved.extensions.filter((id) => knownExt.has(id))));
        setSelected(new Set(saved.profiles.filter((key) => knownProfiles.has(key))));
      } else {
        setWantExt(new Set());
        setSelected(new Set());
      }
      if (found.length === 1) setOpenId(found[0]!.id);
      loadedFor.current = vaultId;
      })
      .catch((err) => {
        setCards(null);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [vaultId]);

  const selectedCount = useMemo(() => selected.size, [selected]);
  const activeCount = wantExt.size;

  useEffect(() => {
    if (!vaultId || cards === "loading" || cards === null) return;
    if (loadedFor.current !== vaultId) return;
    saveBrowserActive(vaultId, {
      extensions: [...wantExt],
      profiles: [...selected],
    });
  }, [vaultId, wantExt, selected, cards]);

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
          {error
            ? error
            : "Karten gibt es in der Desktop-App, nicht im Browser-Tab. / Cards are in the desktop app, not a browser tab."}
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
      <h3>{t({ de: "Browser auf diesem Gerät", en: "Browsers on this device" })}</h3>
      <p className="hint compact" data-testid="browser-sync-explainer">
        {t(
          {
            de: "Grün = an (gemerkt). Neue Passwörter nur im Tresor. Die Erweiterung holt sie, wenn sie offen ist. Nicht in Chrome schreiben.",
            en: "Green = on (remembered). New passwords stay in the vault. An unlocked add-on picks them up. We do not write into Chrome.",
          },
          {
            de: "Kein bidirektionales Sync. Import rein, Autofill raus. Entsperrte Extension pollt die Snapshot-Revision.",
            en: "Not two-way sync. Import in, autofill out. Unlocked extension polls snapshot revision.",
          },
        )}
      </p>
      <div className="browser-card-grid">
        {cards.map((card) => {
          const open = openId === card.id;
          const on = wantExt.has(card.id);
          return (
            <article
              key={card.id}
              className={`browser-card${open ? " open" : ""}${on ? " on" : ""}`}
              data-testid={`browser-card-${card.id}`}
              data-active={on ? "true" : "false"}
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
                    {on ? "aktiv / on" : "aus / off"} · {card.profiles.length}{" "}
                    {card.profiles.length === 1 ? "Profil / profile" : "Profile / profiles"}
                  </span>
                </span>
                {on ? <span className="browser-dot" aria-hidden /> : null}
              </button>
              {open ? (
                <div className="browser-card-body">
                  <label className="browser-ext">
                    <input
                      type="checkbox"
                      checked={wantExt.has(card.id)}
                      onChange={() => toggleExt(card.id)}
                    />
                    Extension aktiv / Extension on
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
                                data-testid={`browser-profile-${key}`}
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
        {t(
          {
            de: `${activeCount} an, ${selectedCount} Profile zum Holen.`,
            en: `${activeCount} on, ${selectedCount} profiles to fetch.`,
          },
        )}
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
