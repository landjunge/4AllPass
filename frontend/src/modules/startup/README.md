# Startmodul

Verwaltet die anfängliche Zustands-/Laufzeitprüfung und den angezeigten Startstatus.

- Erkennt das lokale Profil und liest Metadaten des lokalen Speichers.
- Stellt eine vorhandene Kontositzung wieder her und fordert die Tresorschicht
  anschließend auf, verschlüsselte Tresorübersichten zu laden.
- Trennt die stille lokale Browsersitzung von der gebündelten Desktop-Anwendung.
- Markiert den Start sowohl bei Erfolg als auch nach behandelten Fehlern als bereit.
- Erhält weder Tresorklartext, Vault Key, Wiederherstellungsmaterial noch Kryptografieoperationen.

Andere Module importieren ausschließlich aus `modules/startup/index.ts`.
