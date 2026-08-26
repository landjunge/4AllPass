# 4AllPass — für normale Menschen

**DE / EN**  
Zusatz-README. Kein Jargon. Alltagsprache.

---

## DE — Einfach erklärt

### Heute

4AllPass ist ein digitaler Tresor, der **wirklich dir gehört**.

Bei den meisten Passwort-Apps speichert eine Firma deine Daten in der Cloud.  
Bei 4AllPass kann die Firma (oder der Server) deine Passwörter **nicht lesen**.

Alles Wichtige liegt bei dir auf dem Gerät.  
Der Server ist nur ein verschlüsselter Speicher.

**Das Produkt ist die Desktop-App.**  
Du installierst sie, legst einen Tresor an, holst deine Passwörter aus dem Browser und ab dann erledigt 4AllPass den Login für dich.

```text
Installieren → Importieren → Autofill → fertig
```

Installieren (ein Befehl, kein Node/Python/Docker):

```sh
curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
```

Seite: [4allpass.netzwerkpunkt.de](https://4allpass.netzwerkpunkt.de/)

Agenten (z. B. n8n) dürfen nur dann etwas, wenn du es explizit erlaubst – und nur für begrenzte Zeit.  
Sie bekommen **nie** den ganzen Tresor.

### Was du davon hast

- Zuverlässiges Autofill (der Login wird einfach erledigt)
- Passwörter bleiben bei dir
- Kein verpflichtender Cloud-Dienst (Local-first. Sync optional. Server deiner Wahl.)
- Notfall-Kit (ohne das geht nichts mehr – und das ist gut so)
- Später: Zugang für KI-Agenten, aber nur unter deiner Kontrolle

### Was wir bewusst **nicht** machen

Wir bauen **nicht** gerade:
- eine eigene Blockchain
- eine eigene digitale Identität
- 20 Zukunftsfeatures gleichzeitig

Zuerst muss 4AllPass im Alltag einfach und vertrauenswürdig sein.  
Dann kann daraus später mehr werden – genau so, wie es die Produktvision von Daniel Filipek (landjunge) vorsieht.

---

## EN — Simply explained

### Today

4AllPass is a digital vault that **truly belongs to you**.

With most password apps a company stores your data in the cloud.  
With 4AllPass the company (or the server) **cannot read** your passwords.

Everything important stays on your device.  
The server is only an encrypted storage.

**The product is the Desktop app.**  
You install it, create a vault, import your passwords from the browser, and from then on 4AllPass handles the login for you.

```text
Install → Import → Autofill → done
```

Install (one command, no Node/Python/Docker):

```sh
curl -fsSL https://raw.githubusercontent.com/landjunge/4AllPass/main/scripts/install.sh | sh
```

Site: [4allpass.netzwerkpunkt.de](https://4allpass.netzwerkpunkt.de/)

Agents (e.g. n8n) only get something when you explicitly allow it – and only for a limited time.  
They **never** get the whole vault.

### What you get

- Reliable autofill (login just works)
- Passwords stay with you
- No mandatory cloud service (local-first. Sync optional. Server of your choice.)
- Emergency Kit (without it there is no recovery – and that is intentional)
- Later: access for AI agents, but only under your control

### What we deliberately **do not** do

We are **not** currently building:
- our own blockchain
- our own digital identity system
- 20 future features at once

First 4AllPass must be simple and trustworthy in everyday use.  
Only then can more grow out of it – exactly as the product vision of Daniel Filipek (landjunge) intends.
