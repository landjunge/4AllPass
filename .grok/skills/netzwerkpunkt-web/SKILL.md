---
name: netzwerkpunkt-web
description: >
  Build and restyle Netzwerkpunkt / 4AllPass public websites in this worktree:
  landing pages, hub HTML, PWA chrome. Distinctive design, DE+EN, product
  isolation. Use when the user asks for a website, landing, Hub, HTML/CSS,
  “gut aussehen”, Magpie landing, or restyle of site/. Trigger also for
  /netzwerkpunkt-web.
---

# Netzwerkpunkt web

Use **after** `frontend-design` and `web-design-guidelines`. This skill is the
product constraint, not a second aesthetic.

## When

Public HTML/CSS (landing, hub, docs pages), or PWA chrome that people land on.

## Do

- One job per page. Hero is a thesis, not a gradient template.
- DE + EN on every user-facing string in the same change.
- SEO when the page is public: title, description, canonical, OG.
- 4AllPass landing: Golden Magpie tokens (`docs/DESIGN.md` / `frontend/src/tokens.css`). Logo is Elster + goldener Schlüssel + Wortmarke.
- Hub / other products: do not paint them Magpie. Gnom-Hub-V1 greys stay Gnom-Hub.
- Landing origin has **no** `/api`. Vault is a separate origin (`deploy/LAYOUT.md`).
- Verify in browser when tools exist: desktop + mobile viewport, empty/error if you added those states.

## Do not

- Mix vault blobs or FastAPI into `4allpass.netzwerkpunkt.de`.
- Mix Tollgate or Gnom-Hub into the 4AllPass landing tree.
- Invent a Cloud Edition or put the vault on the marketing site.
- Add new npm/Cargo dependencies for a static landing.
