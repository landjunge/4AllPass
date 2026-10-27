# `@4allpass/webauthn`

Geräteentsperrung für den Browser nach `docs/webauthn-prf.md`: WebAuthn ist ein
plattformgeschützter Auslöser für einen **Device Wrapping Key**, niemals ein
Verschlüsselungsorakel für den Vault Key.

```
src/
  types.ts               WebAuthnClient boundary, DeviceUnlockRecord, ranks
  errors.ts              WebAuthnUnavailable / PrfUnavailable / UserVerification / DeviceUnlockUnavailable
  browser-client.ts      the only file that touches navigator.credentials
  authenticator-data.ts  rpIdHash + UP/UV flag checks
  challenge.ts           server-issued 32-byte ceremony challenge (or test fallback)
  prf.ts                 assertion → prf.results.first (32 bytes, else abort)
  large-blob.ts          rank 2 storage in the authenticator
  store.ts               local record store (memory + IndexedDB)
  enable.ts              provisioning, highest rank first
  unlock.ts              PRF / largeBlob / UV-gated local → Vault Key
```

## Ablauf

```
enableDeviceUnlock()   master password already unlocked the vault
  create credential (userVerification: "required", prf, largeBlob)
  rank 1 prf             assertion → PRF → HKDF → DWK → wrap random DK
  rank 2 large_blob      random BWK (local) wraps DK, envelope → authenticator
  rank 3 uv_gated_local  random LSK (local) wraps DK, envelope → local store
  → Device Envelope (VK under DK) is uploaded to the server

unlockWithDevice()     locked vault, no master password typed
  assertion (UV required, rpIdHash + UV flag verified)
  → DWK or stored wrapping key → DK → VK
```

Nur der Vault Key bleibt nach einem Aufruf erhalten. PRF-Ausgabe, DWK, DK und
gespeicherte Einhüllschlüssel werden durch die Gerätehilfen von
`@4allpass/crypto` genullt.

## Rang 2 und Rang 3

`webauthn-prf.md` §5 ordnet largeBlob über dem lokalen Speicher ein, weil der
Authentifikator das Material hält. Das Paket trennt entsprechend:

| Rang | Device-Key-Envelope | Einhüllschlüssel |
| --- | --- | --- |
| 2 `large_blob` | largeBlob des Authentifikators | lokaler Speicher |
| 3 `uv_gated_local` | lokaler Speicher | lokaler Speicher |

Rang 2 benötigt beide Hälften; allein der gestohlene lokale Speicher reicht
nicht. Rang 3 ist lediglich eine Regelvorgabe, wie in der Spezifikation dokumentiert.

## Verbindliche Regeln

- `userVerification` ist immer `"required"`, beim Erstellen und jeder Assertion.
- Einer Assertion wird erst vertraut, nachdem `assertUserVerified` rpIdHash sowie UP- und UV-Markierung geprüft hat.
- `prf.results.first` mit weniger als 32 Bytes wird verweigert, niemals gestreckt.
- Der lokale Datensatz enthält niemals Vault Key, Master Key oder Device Key.
- Nur die PRF-Device-Key-Envelope darf zum Server gespiegelt werden; ihr Öffnen benötigt eine aktuelle Assertion dieses Authentifikators. Rang 2/3 werden unter einem lokal gehaltenen Schlüssel eingehüllt und bleiben lokal.
- Fehler enden immer in `DeviceUnlockUnavailableError`, damit die UI das Masterpasswort anbieten kann. Masterpasswortentsperrung wird niemals entfernt oder blockiert.

## Tests

```sh
npm test -w @4allpass/webauthn
```

`test/fake-authenticator.ts` implementiert die Grenze `WebAuthnClient` mit einer
schlüsselbasierten HMAC-PRF, largeBlob-Speicher und steuerbarer UV-Markierung.
Damit werden Rangfolge, Rückfallwege und UV-Schranke ohne Browser geprüft.
