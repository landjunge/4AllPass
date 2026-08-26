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

function isImportable(key: string): boolean {
  return !key.startsWith("safari:");
}

function cardStatus(
  t: (plain: { de: string; en: string }) => string,
  on: boolean,
  picked: number,
): string {
  if (on && picked > 0) {
    return t({
      de: `Autofill an · ${picked} Profil${picked === 1 ? "" : "e"}`,
      en: `Autofill on · ${picked} profile${picked === 1 ? "" : "s"}`,
    });
  }
  if (on) return t({ de: "Autofill an", en: "Autofill on" });
  if (picked > 0) {
    return t({
      de: `${picked} Profil${picked === 1 ? "" : "e"}`,
      en: `${picked} profile${picked === 1 ? "" : "s"}`,
    });
  }
  return t({ de: "Tippen zum Verbinden", en: "Tap to connect" });
}

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
        setSelected(
          new Set(
            saved.profiles.filter((key) => knownProfiles.has(key) && isImportable(key)),
          ),
        );
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

  const importableCount = useMemo(
    () => [...selected].filter(isImportable).length,
    [selected],
  );
  const activeCount = wantExt.size;
  const openCard = cards !== "loading" && cards !== null ? cards.find((card) => card.id === openId) : undefined;

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
        <p className="muted">
          {t({ de: "Browser werden gesucht…", en: "Looking for browsers…" })}
        </p>
      </section>
    );
  }

  if (cards === null) {
    return (
      <section className="card browser-cards" data-testid="browser-cards">
        <h3>{t({ de: "Welche Browser sollen mit 4AllPass arbeiten?", en: "Which browsers should work with 4AllPass?" })}</h3>
        <p className="muted">
          {error
            ? error
            : t({
                de: "Browser verbinden geht in der Desktop-App auf diesem Mac, nicht in einem normalen Tab.",
                en: "Connecting browsers works in the desktop app on this Mac, not in a regular tab.",
              })}
        </p>
      </section>
    );
  }

  if (cards.length === 0) {
    return (
      <section className="card browser-cards" data-testid="browser-cards">
        <h3>{t({ de: "Welche Browser sollen mit 4AllPass arbeiten?", en: "Which browsers should work with 4AllPass?" })}</h3>
        <p className="muted">{t({ de: "Kein Browser gefunden.", en: "No browsers found." })}</p>
      </section>
    );
  }

  function toggleProfile(key: string): void {
    if (!isImportable(key)) return;
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
        if (!isImportable(key)) continue;
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
      <h3>
        {t({
          de: "Welche Browser sollen mit 4AllPass arbeiten?",
          en: "Which browsers should work with 4AllPass?",
        })}
      </h3>
      <p className="hint compact" data-testid="browser-sync-explainer">
        {t(
          {
            de: "Chrome, Firefox, Safari. Autofill einschalten, Profile anhaken, Passwörter in den Tresor übernehmen. 4AllPass schreibt nicht zurück in den Browser.",
            en: "Chrome, Firefox, Safari. Turn on autofill, tick profiles, bring passwords into the vault. 4AllPass does not write back into the browser.",
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
          const picked = card.profiles.filter((profile) =>
            selected.has(profileKey(card.id, profile.id)),
          ).length;
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
                  <span className="muted browser-card-status">{cardStatus(t, on, picked)}</span>
                </span>
                {on ? <span className="browser-dot" aria-hidden /> : null}
              </button>
            </article>
          );
        })}
      </div>
      {openCard ? (
        <div className="browser-card-panel" data-testid="browser-card-panel">
          <div className="browser-card-panel-head">
            <strong>{openCard.name}</strong>
            <label className="browser-ext">
              <input
                type="checkbox"
                checked={wantExt.has(openCard.id)}
                onChange={() => toggleExt(openCard.id)}
              />
              {t({
                de: `Autofill in ${openCard.name}`,
                en: `Autofill in ${openCard.name}`,
              })}
            </label>
            {wantExt.has(openCard.id) ? (
              <button type="button" onClick={() => void installExt(openCard.id)}>
                {t({ de: "Erweiterung installieren", en: "Install add-on" })}
              </button>
            ) : null}
            <button
              type="button"
              data-testid={`open-autofill-demo-${openCard.id}`}
              onClick={() => void openDemo(openCard.id)}
            >
              {t({ de: "Ausfüllen testen", en: "Test fill" })}
            </button>
          </div>
          {openCard.id === "safari" ? (
            <p className="hint compact">
              {t({
                de: "Safari-Passwörter importieren kommt später. Autofill kannst du schon einschalten.",
                en: "Safari password import comes later. You can already turn on autofill.",
              })}
            </p>
          ) : (
            <p className="hint compact">
              {t({
                de: "Passwörter aus diesen Profilen übernehmen",
                en: "Bring in passwords from these profiles",
              })}
            </p>
          )}
          <ul className="browser-profiles">
            {openCard.profiles.length === 0 ? (
              <li className="muted">
                {t({ de: "Kein Profil gefunden.", en: "No profile found." })}
              </li>
            ) : (
              openCard.profiles.map((profile) => {
                const key = profileKey(openCard.id, profile.id);
                const importable = isImportable(key);
                return (
                  <li key={key}>
                    <label>
                      <input
                        type="checkbox"
                        data-testid={`browser-profile-${key}`}
                        checked={selected.has(key)}
                        disabled={!importable}
                        onChange={() => toggleProfile(key)}
                      />
                      {profile.name}
                    </label>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : (
        <p className="muted compact-hint">
          {t({
            de: "Browser antippen, Autofill einschalten, Profile anhaken.",
            en: "Tap a browser, turn on autofill, tick profiles.",
          })}
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || importableCount === 0}
          data-testid="fetch-browser-passwords"
          onClick={() => void fetchPasswords()}
        >
          {busy
            ? t({
                de: "macOS fragt nach dem Anmeldepasswort…",
                en: "macOS may ask for the login password…",
              })
            : t({
                de: `Passwörter importieren (${importableCount})`,
                en: `Import passwords (${importableCount})`,
              })}
        </button>
      </div>
      <p className="muted">
        {t(
          {
            de:
              importableCount > 0
                ? `${importableCount} Profil${importableCount === 1 ? "" : "e"} ausgewählt. Import legt sie in den Tresor.`
                : activeCount > 0
                  ? `${activeCount} Browser mit Autofill. Profile anhaken, dann importieren.`
                  : "Noch kein Browser ausgewählt.",
            en:
              importableCount > 0
                ? `${importableCount} profile${importableCount === 1 ? "" : "s"} selected. Import puts them in the vault.`
                : activeCount > 0
                  ? `${activeCount} browser${activeCount === 1 ? "" : "s"} with autofill. Tick profiles, then import.`
                  : "No browser chosen yet.",
          },
        )}
      </p>
      {error ? <p className="error">{error}</p> : null}
      {hint ? (
        <div className="browser-install-hint" data-testid="extension-install-hint">
          <p>
            <strong>{hint.appName}</strong>
            {" — "}
            {t({
              de: "einmal in diesem Browser erlauben.",
              en: "allow it once in this browser.",
            })}
          </p>
          {hint.flavor === "firefox" ? (
            <p>
              {t({
                de: "about:debugging → Temporäres Add-on laden → diese Datei:",
                en: "about:debugging → Load Temporary Add-on → this file:",
              })}
              <code>{hint.bundlePath}/manifest.json</code>
            </p>
          ) : hint.flavor === "safari" ? (
            <p>
              {t({
                de: "Xcode-Projekt öffnen, Run, dann Safari → Einstellungen → Erweiterungen.",
                en: "Open the Xcode project, Run, then Safari → Settings → Extensions.",
              })}
              <code>{hint.bundlePath}</code>
            </p>
          ) : (
            <p>
              {t({
                de: "Entwicklermodus → Entpackte Erweiterung laden → diesen Ordner:",
                en: "Developer mode → Load unpacked → this folder:",
              })}
              <code>{hint.bundlePath}</code>
            </p>
          )}
          <p>
            {t(
              {
                de: "Die Erweiterung spricht nur mit 4AllPass auf diesem Mac.",
                en: "The add-on talks only to 4AllPass on this Mac.",
              },
              {
                de: "Popup: nur Tresor-Passwort, API http://127.0.0.1:8788.",
                en: "Popup: vault password only, API http://127.0.0.1:8788.",
              },
            )}
          </p>
          <button type="button" data-testid="open-autofill-demo" onClick={() => void openDemo(hint.browserId)}>
            {t({ de: "Testseite öffnen", en: "Open test page" })}
          </button>
        </div>
      ) : null}
    </section>
  );
}
