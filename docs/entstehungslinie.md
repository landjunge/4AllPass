# 4AllPass — Entstehungslinie

**Stand:** 2026-08-25  
**Produktvision und langfristige Richtung:** Daniel Filipek (landjunge)

## Phase 0 — Idee & Crypto-Fundament (17.–18. August 2026)

- Crypto Protocol v1 (zufälliger Vault Key)
- Envelope-Modell, Vault-Revision + CAS
- Threat Model, Adversarial Review, Testvektoren
- Entscheidung: Server ist nur Blob-Store

## Phase 1 — Erster Client (PWA + Backend)

- FastAPI + Snapshots
- Master-Passwort-Unlock, Recovery-Kit
- Hard-Revoke = Vault-Key-Rotation

## Phase 2 — Pivot: Desktop wird das Produkt (~20.–22. August)

- Tauri + lokales SQLite + Loopback `:8788` wird Primärprodukt
- Unlock = Tresor-Passwort
- Agent-Zugang über denselben Loopback-Broker (Allow/Deny + TTL)

## Phase 3 — Alltagstauglichkeit (aktuell)

- Fokus auf zuverlässiges Autofill und Browser-Import
- Ehrliche Docs und product-maturity v3
- Hardening von CAS und Concurrent-Updates

## Leitentscheidungen

| Entscheidung                        | Warum                                      |
|-------------------------------------|--------------------------------------------|
| Vault Key immer pure random         | Zero-Knowledge bleibt echt                 |
| Desktop = Primärprodukt             | Alltagsnutzen ohne Server-Ops              |
| Agent = Allow/Deny + TTL            | Maschinen bekommen nie den ganzen Tresor   |
| Recovery-Kit erzwungen              | Kein Server-Reset möglich                  |
| Produkt zuerst, Sicherheit nicht verkaufen | Langfristiges Vertrauen               |
| Fundament vor Features              | Zukunft kann hineinwachsen                 |
