import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  listBrowserProfiles,
  profileKey,
  type BrowserCard,
} from "../lib/browsers.ts";

export function BrowserCards(): ReactNode {
  const [cards, setCards] = useState<BrowserCard[] | null | "loading">("loading");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void listBrowserProfiles().then((found) => {
      setCards(found);
      if (!found) return;
      const next = new Set<string>();
      for (const card of found) {
        for (const profile of card.profiles) {
          next.add(profileKey(card.id, profile.id));
        }
      }
      setSelected(next);
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

  function toggle(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="card browser-cards" data-testid="browser-cards">
      <h3>Browser auf diesem Gerät / Browsers on this device</h3>
      <p className="hint">
        Karte aufklappen, Profile anhaken. Passwörter holen kommt als Nächstes. / Open a card, tick
        profiles. Fetching passwords is next.
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
                <strong>{card.name}</strong>
                <span className="muted">
                  {card.profiles.length}{" "}
                  {card.profiles.length === 1 ? "Profil / profile" : "Profile / profiles"}
                </span>
              </button>
              {open ? (
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
                              onChange={() => toggle(key)}
                            />
                            {profile.name}
                          </label>
                        </li>
                      );
                    })
                  )}
                </ul>
              ) : null}
            </article>
          );
        })}
      </div>
      <p className="muted">
        {selectedCount} gewählt / selected — Übernehmen liest noch keine Passwörter.
      </p>
    </section>
  );
}
