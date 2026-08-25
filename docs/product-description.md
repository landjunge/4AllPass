# 4AllPass — Produktbeschreibung

**Stand:** 2026-08-25  
**Status:** Verbindliche Produktbeschreibung (DE + EN)  
**Vision:** Produktvision von Daniel Filipek (landjunge)

---

## DE

### Was ist 4AllPass heute?

4AllPass ist ein **digitaler Tresor, der wirklich dem Benutzer gehört**.

Du hast Passwörter, Passkeys, API-Keys, 2FA-Codes und andere Geheimnisse.  
Bei normalen Cloud-Passwortmanagern betreibt ein Anbieter die Infrastruktur.  
Bei 4AllPass gilt die Grundregel:

> Der Anbieter (oder der Server) soll deine Geheimnisse **gar nicht kennen können**.

Der Tresor ist verschlüsselt. Die entscheidenden Schlüssel liegen beim Benutzer.  
Das Backend kann Daten speichern und zwischen Geräten transportieren – es kann aber nicht einfach sagen:  
„Ich schaue jetzt mal nach Daniels Passwörtern.“

**Das Produkt ist die Desktop-App** (Tauri + lokales SQLite + Loopback auf `:8788`).  
Kein Cloud-Account bei uns. FastAPI mintet keine Tokens.  
Agenten bekommen Zugang nur nach explizitem Allow/Deny + TTL – und nie als ersten Bildschirm.

### Was der Benutzer wirklich will

„Ich gehe auf eine Webseite und 4AllPass erledigt den Login für mich.“

Deshalb ist die Priorität klar:

1. **Zuverlässiges Autofill** (Field Intelligence + Safe Fill)
2. Einfacher Import aus Browsern (Chrome/Firefox, Review ohne Passwort in der Liste)
3. Verständliches Recovery-Kit (ohne Kit gibt es kein Zurücksetzen)
4. Saubere Desktop-Installation und Unlock mit Tresor-Passwort
5. Kontrollierter Agent-Zugang (nur auf Wunsch)

### Was 4AllPass **nicht** ist

- Kein „besserer Bitwarden“
- Kein Enterprise-Cloud-Produkt
- Kein Marketplace für Agenten
- Kein Server, dem man die Klartext-Daten anvertrauen muss

### Haltung

Produkt zuerst.  
Sicherheit und Eigentum werden **nicht verkauft**.  
Der Kern bleibt frei und nutzbar.  
Monetarisierung (falls jemals) nur um zusätzlichen Wert herum – nie um Zero-Knowledge oder Geräte-Eigentum.

Diese Haltung und die langfristige Richtung (mehrere eigenständige Tresore, kontrollierte Connections, scoped Agent-Capabilities, später digitale Identität und Maschinen) stammen von Daniel Filipek (landjunge) und sind verbindliche Produktvision.

---

## EN

### What is 4AllPass today?

4AllPass is a **digital vault that truly belongs to the user**.

You have passwords, passkeys, API keys, 2FA codes and other secrets.  
With normal cloud password managers a provider runs the infrastructure.  
With 4AllPass the rule is:

> The provider (or the server) must **not be able to know** your secrets.

The vault is encrypted. The critical keys stay with the user.  
The backend can store data and move it between devices – it cannot simply say:  
“Let me look at Daniel’s passwords.”

**The product is the Desktop app** (Tauri + local SQLite + loopback on `:8788`).  
No cloud account with us. FastAPI never mints tokens.  
Agents get access only after explicit Allow/Deny + TTL – and never as the first screen.

### What the user actually wants

“I go to a website and 4AllPass handles the login for me.”

That is why the priority is clear:

1. **Reliable autofill** (Field Intelligence + Safe Fill)
2. Simple import from browsers (Chrome/Firefox, review without passwords in the list)
3. Understandable Recovery Kit (without the kit there is no reset)
4. Clean Desktop install and unlock with the vault password
5. Controlled agent access (only when you want it)

### What 4AllPass is **not**

- Not “a better Bitwarden”
- Not an enterprise cloud product
- Not a marketplace for agents
- Not a server you have to trust with plaintext

### Philosophy

Product first.  
Security and ownership are **not for sale**.  
The core stays free and usable.  
Monetization (if ever) only around extra value – never around zero-knowledge or device ownership.

This philosophy and the long-term direction (multiple independent vaults, controlled connections, scoped agent capabilities, later digital identity and machines) come from Daniel Filipek (landjunge) and are the binding product vision.
