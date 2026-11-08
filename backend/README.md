# 4AllPass-Backend

FastAPI-, PostgreSQL- und Redis-Backend für 4AllPass. Dieser Dienst arbeitet nach
dem Zero-Knowledge-Prinzip: Er sieht weder unverschlüsselte Tresoreinträge noch
Masterpasswort, Vault Key, Device Key, Device Wrapping Key oder WebAuthn-PRF-Ausgabe.
Die maßgeblichen Spezifikationen stehen im Hauptverzeichnis:

- [`../docs/architecture.md`](../docs/architecture.md)
- [`../docs/crypto-protocol.md`](../docs/crypto-protocol.md)
- [`../docs/webauthn-prf.md`](../docs/webauthn-prf.md)
- [`../docs/vault-revision.md`](../docs/vault-revision.md)
- [`../docs/threat-model.md`](../docs/threat-model.md)

## Inhalt der Version v1

- SQLAlchemy-2.0-Modelle und Alembic-Migrationen für das serverseitig speicherbare
  Schema: Nutzer, Tresore, unveränderliche Tresormomentaufnahmen, Schlüsselhüllen,
  verschlüsselte Einträge, Geräte, WebAuthn-Zugangsdaten und Device-Key-Envelope-Spiegel.
- Kontoauthentifizierung für Registrierung, An-/Abmeldung und Kontoinformationen
  mit Argon2id-Kontopasswörtern und widerrufbaren Redis- oder In-Memory-Bearer-
  Sitzungen. Das Kontopasswort ist nicht das Masterpasswort und entschlüsselt
  keinen Tresor.
- Eigentumsprüfung: Jede Tresor-/Geräte-/Momentaufnahmeroute benötigt
  `Authorization: Bearer`; fremde Tresore ergeben 404.
- Momentaufnahme per GET/POST mit Compare-and-Swap auf `expectedRevision`
  (`docs/vault-revision.md` §4). Der Server speichert nur undurchsichtigen Geheimtext.
- Geräteregistrierung, -auflistung und -widerruf, Zugangsdatenmetadaten und
  Device-Key-Envelope-Spiegel. `DELETE` ändert nur Metadaten
  (`revocation: "metadata_only"`). Kryptografischer Widerruf erfolgt durch die
  nächste Momentaufnahme ohne die Gerätehülle. WebAuthn-Zeilen bleiben
  `client_asserted`, bis der Client eine vom Server COSE-geprüfte Attestation
  oder Assertion sendet (`cose_verified`). Das belegt Zeremonieintegrität,
  keine PRF-Prüfung. Siehe [`../docs/security-boundary.md`](../docs/security-boundary.md).
- Optionales undurchsichtiges `sealedManifest` bei GET/POST. Der Server speichert
  es unverändert; der Client prüft es unter dem Vault Key.
- Schreibende Momentaufnahmezugriffe sperren die Tresorzeile. Bei gleichzeitigen
  `N → N+1`-Commits erhält einer 200, der andere 409. `vaultKeyVersion` darf nicht sinken.

## Lokal einrichten

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env   # adjust if your Postgres/Redis differ

createuser fourallpass --pwprompt   # if not already present
createdb fourallpass -O fourallpass
createdb fourallpass_test -O fourallpass   # used by the pytest suite

alembic upgrade head
uvicorn app.main:app --reload
```

## Tests

```sh
pip install -r requirements-dev.txt
createdb fourallpass_test -O fourallpass
createdb fourallpass_migrations_test -O fourallpass   # used by tests/test_migrations.py
pytest
```

`tests/test_migrations.py` führt `alembic upgrade head` → `downgrade base` →
`upgrade head` → `alembic check` gegen eine Testdatenbank aus und erkennt damit
Abweichungen zwischen Migrationen und Modellen. Mit
`FOURALLPASS_SKIP_MIGRATION_TESTS=1` lässt sich dies in Umgebungen ohne freie
Testdatenbank überspringen.

## Datenbankschema der Gerätehüllen

Nach `docs/webauthn-prf.md` existieren zwei getrennte Hüllenkonzepte; beide sind modelliert:

| Tabelle | Eingehüllter Schlüssel | Verwendeter Schlüssel | Dokumentation |
| --- | --- | --- | --- |
| `key_envelopes` (`type = "device"`) | Vault Key (VK) | Device Key (DK) | crypto-protocol.md §3 |
| `device_key_envelopes` | Device Key (DK) | Device Wrapping Key (DWK) | webauthn-prf.md §4 |

Der Server entschlüsselt keine davon: Er besitzt weder DK noch DWK.
`device_key_envelopes` ist ein optionaler Spiegel des clientseitigen Zustands
(webauthn-prf.md §2.1, Schritt 7). Damit kann eine zweite Browsersitzung auf einem
bereits vertrauten Gerät denselben Komfortentsperrungsblob wiederherstellen.

Ergänzende Tabellen: `devices` mit stabiler `device_id`, die in die AAD beider
Hüllen eingeht, sowie `webauthn_credentials` mit Credential-ID, RP-ID,
öffentlichem COSE-Schlüssel und PRF-/largeBlob-Fähigkeitsmarkierungen;
Schlüsselmaterial wird dort nicht gespeichert.

## Migrationen

```sh
alembic revision --autogenerate -m "message"
alembic upgrade head
```

Automatisch erzeugte Migrationen manuell prüfen: Alembic ordnet zyklische
Fremdschlüssel (`vaults.active_snapshot_id` ↔ `vault_snapshots.vault_id`) oder
Postgres-Enum-Löschungen nicht immer korrekt. Siehe die Kommentare in
`alembic/versions/*_initial_schema.py`.
