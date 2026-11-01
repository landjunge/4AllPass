# 4AllPass: developer reference

Build and contribution details moved from the README on 31 October 2026. These describe source development, not a newly released package. The [security boundary](security-boundary.md) and [protected access evidence](PROTECTED-ACCESS-20261018.md) define the actual scope. Return to [English](../README.md) or [Deutsch](../README.de.md).

## Für Entwickler

4AllPass ist ein local-first Passwort-Manager mit Desktop-App, Browser-Erweiterungen und optionalem verschlüsseltem Speicher.

Der Server sieht keinen Klartext, kein Tresor-Passwort und keinen Vault Key. Was die Software tatsächlich erzwingt, steht in [Security Boundary](../docs/security-boundary.md).

### Wie dieses Projekt entsteht

**System Designer & Product Architect: Daniel Filipek (landjunge)**

Produktvision, gewünschtes Verhalten, Grenzen und Prioritäten kommen von mir. KI unterstützt mich bei Implementierung, Tests und Dokumentation.

Ich bin kein klassischer Softwareentwickler und kein Security-Spezialist. Deshalb müssen Code, Spezifikationen und Tests überprüfbar bleiben.

Ich behaupte nicht, dass die Kryptografie sicher ist. Es gibt noch kein unabhängiges Drittaudit. Reviews, Tests und Versuche, das System zu brechen, sind ausdrücklich willkommen.

### Entwicklungsumgebung

Die folgenden Werkzeuge brauchst du nur für den Source-Build:

~~~sh
git clone https://github.com/landjunge/4AllPass.git
cd 4AllPass
npm install
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cd ..
npm run build:extension
npm run tauri:dev
~~~

### Prüfen

~~~sh
npm test
npm run typecheck
cd backend && pytest
cd frontend && npm run test:e2e:user-watch
~~~

`test:e2e:user-watch` is opt-in, headed or screenshot-only, dummy vault — not the real Desk vault. See [docs/UI_TEST_SUITE.md](../docs/UI_TEST_SUITE.md).

### Technische Dokumentation

- [Dokumentationsübersicht](../docs/README.md)
- [Sicherheitsgrenze](../docs/security-boundary.md)
- [Bedrohungsmodell](../docs/threat-model.md)
- [Vault-Protokoll](../docs/vault-protocol.md)
- [Recovery](../docs/recovery.md)
- [Produktreife](../docs/product-maturity.md)
- [Beitragen](../CONTRIBUTING.md)
- [Sicherheitsprobleme melden](../SECURITY.md)

Der Vault Key ist zufällig und wird niemals direkt aus dem Tresor-Passwort abgeleitet.

---

