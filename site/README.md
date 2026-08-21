# 4AllPass public front (`site/`)

GitHub Pages fallback for the product. Suite home is **https://netzwerkpunkt.de** (in progress).

| URL | Role |
|---|---|
| `index.html` / `de.html` | 4AllPass product front (try + honest limits + family cards) |
| `produkte/` | Card list only — cheap to link or copy onto the hub |
| `produkte.json` | Source of truth for cards |

## Add a card

1. Append one object to `produkte.json`.
2. Status must match evidence: `hub-in-arbeit` (indexed on the hub), `quelle` (GitHub only), `notiz` (docs/experiment).
3. Do not invent a shop, stars, or a license.

## Owner leftovers

- `gh repo edit landjunge/4AllPass --homepage "https://netzwerkpunkt.de"`
- Put a 4AllPass section on the hub **before** launch posts use that URL as the click target.
- Enable Pages (GitHub Actions) if this folder should go live at `landjunge.github.io/4AllPass/`.
- Custom-domain leftovers (CNAME, TLS) belong on **netzwerkpunkt.de**, not on this fallback.
