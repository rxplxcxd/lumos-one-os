# Changelog

## 1.1.0

### Neu
- **Akku-Warnungen** (20 / 10 / 2 %, iOS-artige Banner mit Aktionen) und **Energiesparmodus**: 60 Hz, FPS ≤ 60, TDP ≤ 8 W, leiser Lüfter, Helligkeit ≤ 55 %, weniger Glas-Unschärfe, keine Wellen/Shimmer, Hintergrund ≤ 30 fps; automatisch ab 10 %, aus beim Laden ab 80 %; sicheres Herunterfahren bei 2 % (60-s-Countdown). `src/components/shell/PowerWatcher.jsx`
- **Controller-Cursor** (linker Stick, Licht-Donut mit Hover, A klickt) und analoges Scrollen (rechter Stick). `src/lib/cursor.js`, `VirtualCursor.jsx`
- **Terminal** mit echter PTY (lumosd `terminal.*`), ANSI-Renderer, Themes, Direktmodus, System-Logs; **Task-Manager** (Strg+Alt+Entf / Strg+Umschalt+Esc / Select+Start). `daemon/lumosd/terminal.py`, `apps.py`, `src/lib/ansi.js`
- **App-Berechtigungen** (Sensoren, Controller/Haptik, Speicher/Cloud, Netzwerk, Mitteilungen → Flatpak-Overrides) und **Spielprofile** (FPS/TDP/Hz). `AppsSection.jsx`
- **Cloud**: Freundescodes, Freundschaften, Chat mit Clip-/Screenshot-Anhängen, Medien-Upload, Spielstand-Manifeste; **Auto-Cloud-Save** beim Spielende; **Konflikt-Manager** mit Seiten- und Dateivergleich. REST-Server + Supabase (`schema_v1_1.sql`).
- **Avatar-Studio**: externe glTF-Figuren (Expressive Robot – CC0, Fuchs – CC0/CC BY 4.0) mit Cache, eigener .glb-Import (IndexedDB), Einfärben, Emotes, Accessoires am Kopf-Knochen; neue Outfits, Accessoires und 9 Kostüme.
- **Aufnahmen**: 30-s-Replay-Puffer, Screenshots, Galerie + Editor (Trimmen, Zuschneiden, Filter, Neu-Encodieren), Teilen im Chat.
- **Spotlight-Suche**, **Leistungs-HUD**, erweitertes **Entwickler-Panel** (FPS/Frametime-Graph, Heap, CPU/GPU/RAM/Netz, Daemon-Logs).
- **Bild-in-Bild** für Web-Videos (auch als Overlay-Fenster über Spielen), **Passwort-Sichern & Autofill-Leiste**, Face ID als **Dynamic-Island-Pille**.
- **Equalizer** (PipeWire filter-chain, 5 Bänder, 7 Profile, Frequenzgang per Web Audio), **Mehrbenutzer & Kindersicherung** (PBKDF2-PIN, Altersfreigaben über OARS, Tageslimit, Freigabelisten).
- **Nachtmodus** (immer / Sonnenuntergang–Sonnenaufgang nach Standort / Zeitplan), adaptive Helligkeit (IIO-Lichtsensor), Pixel-Shift, Dimmen statischer Elemente. `src/lib/sun.js`
- **Saisonale Themen** (Halloween, Weihnachten, Silvester, Ostern per Computus, Valentinstag): prozedurale Partikel, Lichterkette, Kerzenflackern, Feuerwerk, festliches Dock, Jingles, versteckte Sammelobjekte. `src/lib/seasons.js`, `SeasonalLayer.jsx`
- Eingebautes Spiel **Lumos Orbit**; erscheint auch auf echter Hardware in der Bibliothek.
- Schnellzugriff: Energiesparen, HUD, Nachtmodus, EQ-Profil, Clip, Screenshot, Suche, Task-Manager, Terminal, Profil wechseln. Dock: Freunde, Aufnahmen, Terminal.

- **Universal Social Hub**: einheitliche Freundesliste und Posteingang für LumosOS, Steam, Xbox, PSN und Nintendo; Smart Friend Finder über alle verknüpften Netzwerke; Rich Presence (Status, Spiel + Cover, Session, Party); Profilkarten; Chat mit Emoji, Clips, Party-Einladungen, Tippt-Anzeige und Gelesen-Status; Supabase-Realtime-Push; Homescreen-Widget „Freunde“; Einstellungen → Konten & Verknüpfungen (Steam-API-Schlüssel, Xbox-Gerätecode, PSN-NPSSO, Nintendo über nxapi). Backend: `daemon/lumosd/social.py` mit AES-256-GCM-Token-Tresor; REST/Supabase um Präsenz, Tippen und Nutzernamen-Suche erweitert (`schema_v1_1_social.sql`).

### Behoben
- Bildschirmtastatur, Autofill- und Toast-Overlays konnten nach rechts verrutschen → per Portal im `<body>` und Flex-Zentrierung.
- Browser-Vorschau: ein abgebrochener Verbindungsversuch zu lumosd meldete nachträglich „getrennt“ und überschrieb den Simulator-Status (keine Systemwerte, Polling aus).
- Content-Security-Policy erlaubte keine `blob:`-Verbindungen (3D-Modelle) und keine iframes (Web/PiP in der Browser-Vorschau).
- Web Audio startet erst nach der ersten Interaktion (keine Autoplay-Warnungen).
- Tastatureingaben im Terminal lösen keine Controller-Tastenbelegungen mehr aus.
- lumosd prüft den `Origin` jetzt immer (Codespaces-Weiterleitungen nur mit `--dev`); PTY-Kindprozess kann nie in die Event-Schleife zurückfallen.

### Hinweise
- Die UI ist weiterhin modulares **JavaScript (JSX)** mit JSDoc – keine TypeScript-Migration in dieser Version, um das System stabil zu halten.
- 3D-Figuren werden zur Laufzeit von jsDelivr bzw. raw.githubusercontent.com geladen und danach offline genutzt; saisonale Grafiken und Klänge sind vollständig prozedural (keine Fremd-Assets).
- Social Hub: Steam, Xbox, PSN und Nintendo wurden nur gegen gemockte HTTP-Antworten getestet (Tests mit den dokumentierten Antwortformaten) – die echten Dienste waren im Entwicklungs-Container nicht erreichbar. PSN/Nintendo nutzen inoffizielle Schnittstellen. Plattformgrenzen (z. B. kein Steam-/PSN-Chat per API) stehen im README.
- Nicht im Entwicklungs-Container verifizierbar: echte Hardware (ESP32-Build, Sensoren, gpu-screen-recorder, MangoHud, PipeWire-EQ), Flathub-Netzzugriff und ein Live-Supabase-Projekt. Alles andere ist durch Tests (Vitest, node:test, pytest, native Firmware-Tests) und Browser-Durchläufe abgedeckt.
