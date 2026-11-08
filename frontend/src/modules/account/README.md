# Kontomodul

Verwaltet die angemeldete E-Mail-Adresse, die kurzlebige Kontopasswortreferenz
und Befehle für Registrierung, Anmeldung, lokale Anmeldung und Abmeldung.

- Das Kontopasswort bleibt ausschließlich im Arbeitsspeicher, um vor seiner
  Wiederverwendung als Tresorpasswort zu warnen. Bei wiederhergestellten/lokalen
  Sitzungen und vor der Abmeldung wird es gelöscht.
- Tresor laden, sperren und bereinigen erfolgt ausschließlich über Rückruffunktionen.
- Das Modul erhält keinen Tresorklartext, Vault Key, Schlüsselhüllen,
  Momentaufnahmen, Revisionen oder Wiederherstellungsmaterial.
- API-Tokens werden weiterhin in `lib/api.ts` gespeichert.

Andere Module importieren ausschließlich aus `modules/account/index.ts`.
