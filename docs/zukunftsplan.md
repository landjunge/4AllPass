# 4AllPass — Zukunftsplan

**Stand:** 2026-08-25  
**Produktvision:** Daniel Filipek (landjunge)  
**Leitlinie:** Fundament zuerst. Die Zukunft wächst hinein – sie wird nicht jetzt gebaut.

## Das Haus-Modell

```text
Fundament (jetzt)
Sehr guter Passwortmanager
Security · Crypto · Autofill · Desktop · Recovery · UX

1. Etage — Multi-Device
Desktop · Mobile · Browser · Device Identity · Sync

2. Etage — Verbundene Tresore
Mehrere eigenständige Vaults · Connections · Trust · Capabilities · Revocation

3. Etage — Agenten & Identität
Human · Device · Agent · Credential · Proof

4. Etage — Digitale Identität & Dokumente
Verifiable Credentials · Documents · Signatures · Proofs

5. Etage — Maschinen & autonome Systeme
Agents · Robots · Machines · Delegation · Attestation

Über allem
Austauschbare Kryptographie (heute bewährt → hybrid → Post-Quantum)
```

## Aktuelle Prioritäten (verbindlich aus product-maturity v3)

| Priorität | Inhalt                              | Status                  |
|-----------|-------------------------------------|-------------------------|
| **P0**    | Install + Import + Provider         | Weitgehend da, Fremden-Test offen |
| **P1**    | Zuverlässiges Autofill als Produkt  | Nächster Fokus          |
| **P1b**   | Diagnostics / Assisted Fill         | Teilweise da            |
| **P2**    | Agent Access UX                     | Code da, nicht First Screen |
| **P3**    | Passkeys / TOTP                     | TOTP da, Passkey später |

**Regel:** Keine 20 neuen Features, solange Install, Import, Provider, Autofill und Vault nicht zuverlässig sind.

## Was wir bewusst nicht jetzt machen

- Core-Rewrite, zweites Tauri
- iOS/Android-App (0 % in dieser Reihenfolge)
- Eigenen Identity-Standard erfinden
- Blockchain / eigene Kryptowährung
- 500 Provider, Browser-Zurückschreiben, Launch-Posts vor P0+P1

Der heutige 4AllPass muss nicht wie die Zukunft aussehen.  
Er muss nur so gebaut sein, dass die Zukunft hineinwachsen kann.
