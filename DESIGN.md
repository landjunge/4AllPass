# 4AllPass – Design Foundation

**Status:** Living document – basis that must not be lost  
**Date:** 2026-08-20  
**Owner:** landjunge (Daniel)  
**Repo:** https://github.com/landjunge/4AllPass  
**Portfolio Domain:** https://netzwerkpunkt.de

## Core Requirements (from owner)

1. This information is the **basis** and must not get lost.
2. 4AllPass needs a beautiful logo: the name "4AllPass" + a magpie (Elster) sitting on the lettering in front view, holding a golden key in its beak.
3. Current app colors/design are not satisfying yet.
4. All projects, apps, websites and portfolio items live under netzwerkpunkt.de.

## Current Colors (frontend/src/styles.css)

```css
:root {
  --bg: #080c18;
  --panel: #101733;
  --panel-2: #16204a;
  --line: #24306b;
  --text: #eaf0ff;
  --muted: #93a2d0;
  --accent: #7aa2ff;
  --ok: #4fd1a5;
  --danger: #ff7a90;
}
```

Icon: Shield + Lock with purple→blue gradient.

## Recommended Palette – "Golden Magpie"

Inspired by the Elster + golden key:

- **BG:** `#0A0E1A`
- **Panel:** `#12182B`
- **Accent / Gold:** `#C9A227` or `#D4AF37`
- **Text:** `#F8F4EC` (warm off-white)
- **Muted:** `#A89F8C`
- **OK / Secure:** `#3DDC97`
- **Danger:** keep or soften `#ff7a90`

This gives a premium, trustworthy, slightly warmer feel that matches the logo symbolism and differentiates from generic cool-tech blue.

## Logo Brief

- Wordmark: "4AllPass" (bold, modern, slightly technical sans-serif)
- Element: European magpie (Elster) – black & white with iridescent sheen
- Pose: front view, sitting on the lettering
- Attribute: holds a golden key in its beak
- Style: elegant, clean, memorable, suitable for app icon + website header
- Symbolism: intelligence, curiosity, collector of shiny things → keys/passwords; guardian of access

Canva candidates have been generated and some saved as editable designs.

## Next Steps

- [ ] Finalize logo (export SVG/PNG)
- [ ] Replace `frontend/public/icon.svg`
- [ ] Update `styles.css` with chosen palette
- [ ] Add 4AllPass to netzwerkpunkt.de portfolio
- [ ] Optional light mode

This file is the permanent design foundation for the project.
