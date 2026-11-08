# Rückmeldungsmodul

Verwaltet das globale Fehler- und Hinweismodell für das Anwendungsbanner.

- Nutzertexte werden aus einem festen zweisprachigen Katalog gewählt.
- Die technische Klassifizierung enthält nur einen ausdrücklich zugelassenen
  Fehlernamen und optionalen HTTP-Status.
- Rohe Nachrichten, Antwortinhalte, Aufrufstapel, Kennungen und übermittelte Werte
  werden niemals in den Rückmeldungszustand kopiert.
- Das Modul protokolliert keine Fehler und verwaltet weder Konto-, Tresor- noch
  Kryptografieverhalten.

Andere Module importieren ausschließlich aus `modules/feedback/index.ts`.
