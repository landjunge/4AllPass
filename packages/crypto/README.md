# `@4allpass/crypto`

Kern des Kryptografieprotokolls v1. Keine UI, Netzwerk- oder Authentifikator-Ein-/Ausgabe.

```
src/
  index.ts              public API
  test-only.ts          nonce / raw-KDF hooks (KATs only; throws in production builds)
  types.ts              KeyEnvelope, EncryptedEntry, DeviceKeyEnvelope, SnapshotManifest
  constants.ts          labels, sizes, bounds
  errors.ts             ProtocolError / IntegrityError / AuthFailureError / RollbackError
  validate.ts           untrusted-input validation and expectation checks
  encoding/
    aad.ts              length-prefixed AAD builders (envelope / entry / device / manifest)
    base64.ts           strict base64 for the JSON wire format
    framing.ts          uint32be framing for digest preimages
    digest.ts           KDF-params, entry, envelope and sealed-manifest digests
    bytes.ts
    unicode.ts          NFC → UTF-8
  kdf/
    profiles.ts         ci / mobile_safe / balanced / standard / high + range checks
    argon2id.ts         deriveMasterKey (validates params from the envelope)
  aead/
    aes-gcm.ts          encrypt (library nonce) / decrypt, owned output buffers
  envelope.ts           wrapVaultKey / unwrapVaultKey (expectations required)
  entry.ts              encryptEntry / decryptEntry (expected entryId + vaultKeyVersion)
  device.ts             PRF eval.first, HKDF DWK, Device-Key Envelope, deviceKeyVersion,
                        bindDeviceWithPrfOutput / unwrapVaultKeyWithPrfOutput
  manifest.ts           snapshot manifest: seal / open / verify (revision is authenticated)
  recovery.ts           Emergency-Kit encoding + Recovery Wrapping Key
  revision.ts           evaluateRevision / rollback, downgrade, equivocation
  snapshot.ts           verifySnapshot / unlockSnapshot (vault-revision.md §6)
  wire.ts               JSON encode/decode for server transport (strict)
  random.ts             CSPRNG helpers
  memory.ts             best-effort zeroize
```

## Verbindliche Regeln

- Der Vault Key ist immer zufällig und wird niemals vom Masterpasswort abgeleitet.
- Öffentliche `encrypt` / `wrapVaultKey` / `encryptEntry` / `sealManifest` nehmen keine Nonce entgegen.
- Versionen werden nie still vorgegeben: `vaultKeyVersion`, `deviceKeyVersion`, `schemaVersion` und `cryptoVersion` werden beim Schreiben gesetzt und aus dem Objekt zurückgelesen.
- Jedes Feld wird authentifiziert. AAD umfasst den Digest der KDF-Parameter und beide Schlüsselgenerationen. Metadaten, die nicht zum Hüllentyp gehören, werden verweigert, nicht ignoriert.
- Das Öffnen erfolgt gegen eine Erwartung. AAD aus den eigenen Objektfeldern belegt Selbstkonsistenz, keine Identität.
- Nicht vertrauenswürdige Datensätze werden genau einmal in normalisierte Kopien gelesen; diese Kopien werden gehasht. `verifySnapshotManifest` gibt sie zurück: diese anwenden, nicht die ursprünglich übergebenen Objekte.
- Kennungen müssen gültiges UTF-16 sein. Ein einzelnes Surrogat hat keine UTF-8-Kodierung und würde zwei Identitäten auf U+FFFD zusammenfallen lassen.
- `revision` wird erst nach erfolgreicher Prüfung des versiegelten Manifests vertraut; Pins entstehen mit `revisionFromManifest(verified)`.
- Rohe WebAuthn-PRF-Ausgabe wird niemals als Schlüssel verwendet; HKDF ist erforderlich, eine ausschließlich aus Nullen bestehende PRF-Ausgabe wird verweigert.
- Der gedruckte Recovery Key wird niemals direkt als AES-Schlüssel verwendet; zuerst `deriveRecoveryWrappingKey`.
- `bindDeviceWithPrfOutput` / `unwrapVaultKeyWithPrfOutput` nullen PRF-Ausgabe, DWK und Device Key vor der Rückgabe. Nur der Vault Key bleibt nach Geräteentsperrung erhalten.
- Über `wire.ts` dekodierte Hüllen werden strukturell auf Längen, Versionen und Typ-/Feldkombinationen geprüft, da sie von einem nicht vertrauenswürdigen Server stammen.
- Das Profil `ci` darf nur mit `allowTestProfile: true` verwendet werden, beim Lesen wie beim Schreiben.
- Das Masterpasswort wird NFC-normalisiert und danach UTF-8-kodiert.

## Fehlerbedeutung

| Fehler | Bedeutung |
| --- | --- |
| `ProtocolError` | Fehlerhafte lokale Eingabe, die kein entfernter Angreifer verursachen kann: falscher Typ, außerhalb des Wertebereichs oder nicht kanonisch; also ein lokaler Fehler. |
| `AuthFailureError` | GCM-Tag nicht bestätigt oder falsche Länge nicht vertrauenswürdigen AEAD-Materials; angreiferkontrolliertes Framing authentifiziert nicht. |
| `IntegrityError` | Formal gültige Eingabe widerspricht der Aufrufererwartung oder Momentaufnahme passt nicht zum Manifest; Hinweis auf Austausch. |
| `RollbackError` | Eingehende Revision ist älter als die gepinnte. |

Alle vier erweitern `CryptoError`; diese gemeinsame Klasse abfangen, wenn die
Unterscheidung nicht erforderlich ist.

## Nutzungsbeispiel

```ts
const vaultKey = generateVaultKey();

const master = wrapVaultKey({
  vaultKey, wrappingKey: masterKey, vaultId, type: "master",
  vaultKeyVersion: 1, kdf: kdfParamsFrom(ARGON2ID_PROFILES.standard, generateSalt()),
});

const entry = encryptEntry({ vaultKey, vaultId, entryId, vaultKeyVersion: 1, plaintext });

const manifest = buildManifest({ vaultId, revision: 1, vaultKeyVersion: 1,
                                 entries: [entry], envelopes: [master] });
const sealed = sealManifest({ vaultKey, manifest });

// …on the reading side, after fetching the snapshot:
const vk = unwrapVaultKey(master, {
  wrappingKey: deriveMasterKeyFromEnvelope(password, master),
  vaultId, expectType: "master", expectVaultKeyVersion: 1,
});
const verified = verifySnapshotManifest(sealed, { entries, envelopes }, {
  vaultKey: vk, vaultId, revision: 1, vaultKeyVersion: 1,
});
assertFreshSnapshot(pin, revisionFromManifest(verified));

// Decrypt the records verification returned, not the ones fetched from the server.
const record = verified.entries.find((e) => e.id === entryId)!;
const plaintext = decryptEntry(record, { vaultKey: vk, vaultId, entryId, vaultKeyVersion: 1 });
```

## Tests

```sh
npm test                 # KATs + adversarial suite + envelope property tests (fast-check)
npm run test:crypto:heavy
npm run typecheck
```

Vektoren unter `docs/test-vectors/*.json` sind maßgeblich. Sie werden durch
`scripts/generate-vectors.mjs` erzeugt, das dieses Paket nicht importiert.

`test/adversarial-*.test.ts` umfasst Nonce-Wiederverwendung, Versionsverwechslung,
AAD-Abweichungen, tresor-/geräteübergreifende Angriffe, Schlüsselaustausch,
Herabstufung, Rücksprünge, fehlerhafte und abgeschnittene Eingaben,
Credential-Austausch, PRF-/HKDF-Fehlgebrauch, Nullungslecks und unerlaubten Zugang
zu Test-APIs. Die zugrunde liegenden Befunde stehen in `docs/adversarial-review.md`.

`test/property-envelope.test.ts` ist die B3-Eigenschaftstestsuite mit zufälligen
Schlüsseln, Kennungen und Versionen für Geräte-/Wiederherstellungshüllen,
Device-Key-Envelopes und Einträge. Sie ersetzt keine bekannten Antworttests
(KATs). Masterhüllen bleiben beim Argon2id-Vektorprüfweg.
