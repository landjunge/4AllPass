# 4AllPass — freigegebene AP4-Marke / approved AP4 identity

Nutzerentscheidung vom 18.10.2026: Die gemeinsam entworfenen türkisfarbenen
AP-/Kontur-4-Rastermotive ersetzen die Elster in aktuellen Angeboten.
Quelle: vom Nutzer aus der ChatGPT-Bibliothek auf diesen Mac übertragene PNGs.
Keine neue Gestaltung, Freistellung, Verzerrung oder vereinfachte Kleinvariante.

`ap4/4allpass-dark.png` und `ap4/4allpass-light.png` sind unveränderte Originale
(1254 × 1254). `ap4/dark/` und `ap4/light/` enthalten alle 13 bereitgestellten
Größen 16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512, 1024.
Original-/Größen-Hashes: [ap4/SHA256SUMS](ap4/SHA256SUMS).

- Dark-Original: `e34a5925bee7a35434145646c8fca497edc26eef015b3e88a40411e006bbb094`
- Light-Original: `d253dfba15a8eea31c958debf5b3b1fdb068c96dd8e7a77192681e3e655866b4`

App und Erweiterungs-Popup haben eine feste dunkle Oberfläche und verwenden
Dark. Native Tauri-/Installer-Icons und Browser-Toolbar verwenden ebenfalls
Dark als feste, plattformübergreifende Identität. Die vorhandene Plattform-
konfiguration hat keinen automatischen nativen Hell-/Dunkelwechsel; ein solcher
wird nicht behauptet. README, Produktseite und Browser-Favicon wählen mit
`prefers-color-scheme` Hell/Dunkel; PWA-/Touch-Icons bleiben fest Dark.

`python scripts/sync-approved-icons.py` kopiert passende bereitgestellte PNGs
bytegleich für Web/Erweiterungen. Tauri benötigt native RGBA-PNGs: `ap4/native/`
enthält mit dem vorhandenen Tauri-Iconwerkzeug aus den jeweiligen bereitgestellten
Größen erzeugte Ableitungen. Eine unabhängige PNG-Dekodierung vergleicht alle
Bildpunkte einschließlich Alpha (RGB wird ausschließlich um deckendes Alpha255
ergänzt); keine Farb-/Größenänderung. ICO enthält diese RGBA-Frames,
ICNS entsteht mit Apples `iconutil`
(macOS erforderlich nur für die Erzeugung). `--check` prüft die Quellen, Größen,
Hashes und aktuellen Zielkopien ohne Änderungen auf allen CI-Plattformen.
Safari-Assetkataloge verwenden dieselben bereitgestellten Größen. Der Safari-
Wrapper wird dadurch nicht als neu signiert oder im Store verfügbar behauptet.

Die früheren SVGs `mark.svg` und `wordmark.svg` bleiben historische Quellen;
aktuelle produktive Verweise verwenden sie nicht mehr. Alte Releases und ihre
Abbildungen werden nicht umgeschrieben. Die bestehende UI-Palette bleibt erhalten.

## English

Approved by the user on 18 October 2026; transferred originals from the ChatGPT
Library. Both originals and all 13 supplied sizes are preserved with hashes.
Native RGBA derivatives add opaque alpha only; decoded pixels are checked
against each supplied size before building. No redesign, distortion or
simplified small-size substitute. Current app,
installer and extension assets replace the former magpie with AP4. Fixed dark
native/app/extension icons; adaptive light/dark README, product page and favicons.
No automatic native theme switching is claimed. Existing UI colours, vaults,
cryptography and historical releases are unchanged. Run the synchronization script
on macOS to regenerate containers; `--check` verifies existing assets on CI.
