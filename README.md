# Lumos One OS

Kiosk-Betriebssystem-Oberfläche, Hardware-Daemon, Controller-Firmware, Cloud-Dienst und Update-System für das
**Lumos One** – ein offenes 8″-OLED-Handheld (165 Hz, 1920 × 1200) auf Basis eines **Framework-13-Mainboards** mit
**Arch Linux + Gamescope** und abnehmbaren **ESP32-S3-Controllern** über Pogo-Pins.

```
┌──────────────────────────── Gamescope (DRM, 165 Hz, FSR/NIS) ─────────────────────────────┐
│  Lumos Shell  (Electron · React · Framer Motion · Tailwind · Three.js/R3F · WebGL2)        │
│   Boot-Animation · Homescreen + Widgets · Game Hub · Store (Flathub) · Face ID · Passwörter │
│   Avatar-Studio · Notizen · Rechner · Einstellungen · Cloud · Sync & Update · Dev-Panel     │
│        │ IPC (preload, contextIsolation)                                                    │
│  Electron Main ── Schlüsselbund (AES-256-GCM, safeStorage) · Flathub-Proxy+Cache · Webviews │
└────────┼──────────────────────────────────────────────────────────────────────────────────┘
         │ WebSocket ws://127.0.0.1:7420 (Token-Auth, JSON-RPC + Events)
┌────────┴─────────── lumosd (Python, asyncio) ────────────────────────────────────────────┐
│ Flatpak-Jobs (PTY-Progress) · Bibliothek (Steam/Flatpak/AppImage) · Face ID (Howdy + V4L2) │
│ Controller (Pogo-USB-CDC/UART + BLE, uinput-Gamepad, Gyro) · Haptik · Akku/TDP/Lüfter      │
│ Dock (Hall-Sensor + DRM-Hotplug) · Audio (PipeWire) · WLAN/BT · Spielstände · Updates      │
└────────┬───────────────────────────────┬──────────────────────────────────────────────────┘
         │ COBS+CRC16 Frames             │ sudo → lumos-priv (whitelist)
   ESP32-S3 Joy L/R + Chassis-MCU     ryzenadj · framework_tool · howdy · sysfs
   ICM-20948 · DRV2605L-LRA · MAX17048
```

## Inhalt

| Ordner | Inhalt |
|---|---|
| `electron/` | Main-Prozess: Kiosk-Fenster, Daemon-Bridge, Schlüsselbund, Flathub-Proxy, `lumosfile://`-Protokoll, Webview-Autofill |
| `src/components/` | Alle UI-Screens & Komponenten (Boot, Home, Widgets, Store, Bibliothek, Face ID, Einstellungen, Apps, Dev-Panel …) |
| `src/services/` | Bridge (IPC/WebSocket/Simulator), Flathub-Client, Haptik, Cloud (REST + Supabase, Offline-Queue), Wetter, Schlüsselbund |
| `src/store/` | Zustand-Stores (Einstellungen mit Cloud-Sync, System, Downloads, Bibliothek, Profile, Widgets, Notizen) |
| `src/styles/` | Tailwind + Glas-/Fokus-Stile, 80 × 50-rem-Layoutraster (pixelgleich auf 8″-Panel und 4K-TV) |
| `shared/haptics.json` | Zentrale Haptik-Muster (DRV2605L-Effekte, RTP-Hüllkurven, Rumble-Fallback) |
| `daemon/` | `lumosd` Hardware-Daemon + `lumos_priv.py` (privilegierter Helfer) + Tests |
| `firmware/` | PlatformIO-Projekt ESP32-S3 (Joy L/R, Chassis), portable Protokoll-/Fusion-/Haptik-Header + native Tests |
| `cloud-server/` | Selbst hostbarer Lumos-Cloud-REST-Server (Node, keine Abhängigkeiten) + Supabase-Schema |
| `updater/` | `lumos_update` (signierte Pakete, atomare Installation, Rollback, Cleanup, OTA) + PC-App `pc_client/lumos_sync.py` |
| `system/` | Gamescope-Session, systemd-Units, udev-Regeln, sudoers, greetd-Autologin, USB4-Netzwerk |
| `scripts/` | `install-arch.sh`, `dev.sh`, `check-all.sh`, `make-release.sh`, `build-zip.sh` |
| `docs/` | [Daemon-API](docs/daemon-api.md), [Controller-Protokoll](docs/protocol.md) |

## Funktionen

* **Boot-Animation** – Lichtpunkt → Lichtstrahl → „Lumos One“ kondensiert aus dem Licht → Bloom öffnet die Oberfläche; dazu ansteigender Haptik-Puls (`boot.rise`).
* **17 lebendige Hintergründe** (WebGL2, dynamische Auflösung für 165 Hz): *Gezeiten*, *Drift*, *Aurora*, *Seide*, *Glut*, *Nebel* (Sternennebel), *Tiefsee* (Lichtkaustik), *Verlauf* (Mesh-Gradient), *Regen* (Tropfen auf Glas), *Dünen*, *Schnee*, *Glühwürmchen*, *Horizont* (Raster), *Tinte*, *Prisma*, *OLED* (akkuschonend) und *Eigenes* (Bild **oder Video** mit Ken-Burns-Loop); Tempo und Partikeldichte einstellbar, die Akzentfarbe des Farbschemas fließt in die Shader ein. Alle reagieren auf **Gyro-Neigung** (kritisch gedämpfte Feder), **Wischgesten** (Strömung) und **jeden Tastendruck** (Welle vom fokussierten Element). Blue-Noise-Dithering verhindert Banding auf OLED.
* **9 Farbschemata** (Lumen, Graphit, Polar, Rosé, Salbei, Bernstein, Lavendel, Koralle, OLED-Schwarz) plus Glas-Deckkraft/-Unschärfe, „Transparenz reduzieren“, „Kontrast erhöhen“, fetter Text.
* **Animationssystem** – gleitender **Fokus-Halo** (Feder folgt dem Fokus inkl. Eckradius), **Lichtwellen** bei jedem Tastendruck, 6 Bildschirmübergänge (Federn, Zoom, Schieben, Aufsteigen, Drehen, Überblenden) mit Richtung für Vor/Zurück, globales Animationstempo, 3D-Neigung der Spielkacheln per Gyro/Zeiger, gestaffelte Einblendungen, rollende Zahlen, Lade-Animation beim Anschließen des Netzteils, OLED-schonender Bildschirmschoner (Uhr/Ambient/Hintergrund), Nachtmodus, synthetische Systemklänge (3 Klangstile).
* **Komplett per Tastatur steuerbar** – jede Controller-Taste (Steuerkreuz, A/B/X/Y, L/R/ZL/ZR, +/−, Home, Capture, beide Sticks inkl. Klick) hat bis zu zwei Tastaturtasten, frei umbelegbar unter **Einstellungen → Tastatur & Steuerung** (Taste drücken, Konflikte werden automatisch aufgelöst, 3 Vorlagen). Tastenhinweise zeigen automatisch die passende Taste bzw. das Controller-Symbol (Xbox/PlayStation/Nintendo). Optional steuert die Tastatur in Spielen das virtuelle Gamepad (lumosd-Bridge).
* **USB-/Bluetooth-Controller von Drittanbietern** – Xbox (360/One/Series/Elite), DualShock 4/DualSense (Edge), Switch Pro/Joy-Con, 8BitDo, HORI, PowerA, PDP, Logitech, Razer, GameSir, Steam Controller und generische HID-Gamepads; Erkennung von Hersteller/Modell/Layout, Akkustand, Rumble (auch für alle Haptik-Muster), Spielerzuweisung P1–P4, Controller-Tester mit Live-Anzeige und **Zuordnungs-Assistent** für nicht standardisierte Pads, udev-Regeln (`system/udev/70-lumos-controllers.rules`).
* **Haptik-Engine** – 21 Muster (Navigation, Rand, Auswahl, Schalter, Regler-Raster, Face ID Erfolg/Ablehnung, Controller an/ab …) auf LRA-Aktuatoren via DRV2605L im Closed-Loop mit Auto-Kalibrierung; Rumble-Fallback für externe Pads.
* **Face ID** – Apple-artige Glyphe (Suchen → Erkannt → Häkchen / Kopfschütteln), Sperrbildschirm mit Code-Fallback, iOS-artige Einstellungen (Gesichter hinzufügen, neu scannen, löschen, zurücksetzen, Aufmerksamkeit, Verwendungszwecke). Backend: **Howdy** + IR-Kamera (V4L2/OpenCV-Vorschau und Gesichts-Vorerkennung, IR-Emitter).
* **Passwörter** – AES-256-GCM-Tresor im Electron-Main-Prozess; Schlüssel im Systemschlüsselbund (libsecret/kwallet via `safeStorage`) oder gerätegebunden (scrypt); Freigabe nur nach Face-ID-Prüfung **im Main-Prozess**; Generator, TOTP (RFC 6238), Autofill in Web-Apps (`<webview>`-Preload erkennt Login-Formulare).
* **Store** – native UI über die **Flathub-REST-API v2** (Kategorien Spiele/Emulatoren/Medien/Werkzeuge/Browser, Suche, Handheld-Empfehlungen, Details mit Screenshots, Größen, Lizenz, Versionshinweisen), Disk-Cache & Offline-Fallback. **Silent Install**: UI → WebSocket → `flatpak install -y` in einer PTY → Live-Fortschritt (%) global in Statusleiste, Homescreen, Bibliothek und Store; Abbrechen möglich.
* **Sideloading** – AppImages, `.flatpak`-Bundles, `.flatpakref` und Binaries aus dem Dateimanager (USB-Sticks, SD, Home).
* **Homescreen** – zentriertes „Zuletzt gespielt“-Karussell (Steam-Artwork, Fokus-Federn, Shimmer, Hero-Hintergrund), App-Dock, Widgets in **2×2 / 4×4 / 6×6** mit je eigenem Layout (Akku & System, Wetter via Open-Meteo, Musik via MPRIS, Uhr & Kalender, Controller, Cloud, Notizen, Downloads, Schnellstart); Bearbeiten mit Y, hinzufügen mit X, verschieben mit L/R.
* **Game Hub / Bibliothek** – Steam (libraryfolders.vdf, Appmanifeste, Spielzeit aus localconfig.vdf), Flatpak-Apps, Emulatoren, Sideloads; Start mit Fokus-Übergabe an Gamescope, **Steam Big Picture**-Integration.
* **Controller** – bis zu 4: Joy L + R (Pogo-Pins oder BLE, automatische Übergabe) + 1 externer Controller; virtuelles uinput-Gamepad, Bewegungssensor-Gerät (für Steam/SDL-Gyro), Gyro-Maus; **Detach-Animation** mit Kanten-Glow und Akku-Popup + Haptik-Impuls.
* **Lumos Cloud** – Profile (inkl. Avatar), Einstellungen (Last-Writer-Wins pro Schlüssel), **Cloud-Saves** (deterministische tar.gz, SHA-256, Versionen & Konflikterkennung, atomare Wiederherstellung), gekaufte Inhalte, Geräte; Offline-Warteschlange; Backend wahlweise **selbst gehostet** oder **Supabase**.
* **Avatar-Studio** – stilisierte 3D-Figur (Three.js/R3F, parametrisch: Kopf, Augen, Brauen, Nase, Mund, 7 Frisuren, Kleidung, Brille, Accessoires), folgt dem Gyro, Porträt-Export als Profilbild; alternativ eigenes Bild (Datei/USB).
* **Essentials** – Notizen (Checklisten, Anheften, Suche), Rechner (Standard & wissenschaftlich, sicherer Parser, Verlauf), Web (Webview + Autofill), Dateien.
* **Einstellungen** – System, Hintergrund & Stil, Display & TV-Docking (Bildrate, FPS-Limiter, HDR, TV-Auflösung, FSR/NIS, Schärfe), Audio, Leistung & Energie (Profile, TDP, Lüfter, Ladelimit), Netzwerk & Bluetooth, Controller & Gyro, Haptik (Mustertester), Face ID & Code, Cloud, Softwareupdate, Entwickler, Info.
* **Lumos Sync & Update** – OTA (GitHub Releases oder JSON-Feed), USB-Stick, PC-App per Kopplungscode; Ed25519-signierte Pakete, Prüfsummen je Datei, **atomarer Wechsel** (`/opt/lumos/current → releases/X`), Rollback, Cleanup (alte Releases, Caches, ungenutzte Flatpak-Runtimes, pacman-Cache).
* **Entwickler-Panel** (`Strg+Umschalt+D` / `F12`) – Face ID Pretend, virtuelle Joy-Cons (Pogo an/ab, Power, Akku), virtuelles Touch-Gamepad, Akku, Docking (4K-TV-Modus), Gyro-Override, Live-Event-Stream.
* **Bildschirmtastatur** (QWERTZ, Umlaute, Symbole) für Controller-/Touch-Eingabe.

## Neu in 1.1

Kurzüberblick (Details in [`CHANGELOG.md`](CHANGELOG.md)):

* **Akku & Energiesparen** – iOS-artige Warnbanner bei 20 / 10 / 2 %, echter Energiesparmodus (60 Hz, FPS ≤ 60, TDP ≤ 8 W, leiser Lüfter, weniger Unschärfe/Animationen, Hintergrund ≤ 30 fps), automatisch ab 10 %, sicheres Herunterfahren bei 2 % mit abbrechbarem Countdown.
* **Controller-Cursor** – linker Stick steuert einen leuchtenden Licht-Cursor (Hover + A klickt), rechter Stick scrollt analog; in Spielen automatisch aus.
* **Bildschirmtastatur** sitzt jetzt garantiert mittig (Portal direkt im `<body>`), QWERTZ-Belegung (Y/Z), Eingabe auch in WLAN- und Code-Dialogen.
* **Terminal** (echte PTY über lumosd, ANSI-Farben, 3 Retro-Themes, Direktmodus) mit **System-Logs**; **Task-Manager** (`Strg+Alt+Entf`, `Strg+Umschalt+Esc` oder Select+Start).
* **Apps & Berechtigungen** – Sensoren, Controller/Haptik, Speicher/Cloud, Netzwerk, Mitteilungen je App (Flatpak-Overrides), **Spielprofile** (FPS/TDP/Hz je Spiel).
* **Lumos Cloud sozial** – Anmeldung/Registrierung, **automatischer Cloud-Save** beim Beenden eines Spiels, **Konflikt-Manager** mit Seiten-Vergleich und Datei-Diff, **Freunde (Freundescode) & Chat** inkl. geteilter Clips/Screenshots.
* **Avatar-Studio** – neue Kategorie *Figur*: freie 3D-Charaktere (glTF, CC0/CC BY, werden beim ersten Öffnen geladen und lokal gecacht) oder **eigenes .glb-Modell**, Einfärben, Emotes aus den Modell-Animationen, Accessoires am Kopf-Knochen; neue Outfits (Anzug, Rüstung, Raumanzug) und Kostüme (Astronaut, Ritter, Hexe, Teufelchen, Weihnachtsmann, Osterhase, Engel, Agent).
* **Aufnahmen** – 30-s-Replay-Puffer (`F10`), Screenshots (`F11`), Galerie mit Editor (Zuschneiden, Trimmen, Filter, echtes Neu-Encodieren) und Teilen im Chat.
* **Spotlight-Suche** (`Strg+K` / Select) über Apps, Spiele, Einstellungen, Spielstände, Kontakte, Notizen, Flathub, Rechner und Web.
* **Leistungs-HUD** (Minimal/Voll, MangoHud in Spielen), erweitertes **Entwickler-Panel** (FPS, Frametime-Graph, JS-Heap, CPU/GPU/RAM/Netz, Daemon-Logs).
* **Web** mit **Bild-in-Bild** (YouTube/Twitch, auch als Overlay über Spielen), zuverlässige **Passwort-Sichern/Autofill-Leiste**, Face ID als **Dynamic-Island-Pille** oben.
* **Audio-Equalizer** (5 Bänder, 7 Profile, echte Frequenzkurve), **Mehrbenutzer + Kindersicherung** (Profile mit PIN/Face ID, Eltern-PIN, Altersfreigaben USK/PEGI über OARS, Tageslimit, Freigabelisten), **Nachtmodus** (immer / Sonnenuntergang–Sonnenaufgang / Zeitplan), adaptive Helligkeit, **Pixel-Shift** und Dimmen statischer Elemente.
* **Saisonale Themen** – Halloween, Weihnachten, Silvester, Ostern, Valentinstag automatisch nach Datum (oder fest gewählt): Partikel, Lichterketten, Kerzenflackern, Feuerwerk, festliches Dock, synthetische Jingles und versteckte Kürbisse/Ostereier.
* **Universal Social Hub** – *Freunde & Chat* bündelt **LumosOS, Steam, Xbox, PlayStation und Nintendo**: Smart Friend Finder (ein Nutzername durchsucht alle verknüpften Netzwerke gleichzeitig, Filter je Plattform, Badges/Avatare/IDs, „Hinzufügen/Folgen“), **einheitlicher Posteingang**, Rich Presence (Online/Abwesend/„Zuletzt online vor X Std.“, Spiel mit Cover, Session-Dauer, Party „3/4“), Profilkarten, Emoji, Clip-/Screenshot-Anhänge, Party-Einladungen, „Tippt gerade …“ und Gelesen-/Gesendet-Status, Echtzeit über **Supabase Realtime** (Websocket; beim selbst gehosteten Server Polling), Freunde-Widget für den Homescreen, zentrale Verknüpfung unter **Einstellungen → Konten & Verknüpfungen**. Welche Plattform was kann, steht in [Social Hub: Was geht wo?](#social-hub-was-geht-wo).
* **Neues Spiel** *Lumos Orbit* (eingebaut, funktioniert auch in der Browser-Vorschau).

**Supabase-Nutzer:** für die neuen Cloud-Funktionen zusätzlich `cloud-server/supabase/schema_v1_1.sql` und `schema_v1_1_social.sql` einmal im SQL-Editor ausführen (siehe [Lumos Cloud](#lumos-cloud)).

## Social Hub: Was geht wo?

Die Plattformen stellen ihre Funktionen sehr unterschiedlich bereit. Lumos nutzt offizielle Schnittstellen, wo es sie gibt – und sagt in der Oberfläche ehrlich, wo nicht.

| | Anmeldung | Suche | Freunde & Präsenz | Chat | Hinzufügen |
|---|---|---|---|---|---|
| **LumosOS** | Lumos Cloud / Supabase | Nutzername (≥ 3 Zeichen) | ✓ Echtzeit | ✓ Text, Clips, Party, Tippen, Gelesen | ✓ Anfrage / Code |
| **Steam** | Web-API-Schlüssel + Profil | Vanity-URL/SteamID, Namen deiner Freunde¹ | ✓ (Profil muss öffentlich sein) | → öffnet Steam-Client² | → Steam-Client² |
| **Xbox Live** | Microsoft-Gerätecode (eigene Azure-App-ID) | ✓ Gamertag | ✓ | ✓ Lesen & Senden | ✓ |
| **PlayStation** *(experimentell)* | NPSSO-Token | ✓ Online-ID | ✓ | – (keine API) | – (keine API) |
| **Nintendo** *(experimentell)* | lokaler nxapi-Server | – (nur Freundescode) | ✓ | – (keine API) | – |

¹ Steam hat keine öffentliche Namenssuche. ² Steam bietet keine öffentliche Chat-/Freundes-Schreib-API; Lumos öffnet `steam://friends/…` im Client.
PSN und Nintendo haben keine offiziellen öffentlichen APIs: Lumos nutzt dieselben Endpunkte wie die Open-Source-Projekte [psn-api](https://github.com/achievements-app/psn-api) und [nxapi](https://github.com/samuelthomas2774/nxapi); sie können sich jederzeit ändern oder gegen die Nutzungsbedingungen der Plattform verstoßen – Nutzung auf eigene Verantwortung. Token werden im Daemon AES-256-GCM-verschlüsselt gespeichert (Schlüsseldatei `0600` auf demselben Gerät – schützt vor versehentlichem Auslesen/Backups, nicht vor Root-Zugriff).
**Supabase:** nach `schema_v1_1.sql` zusätzlich `cloud-server/supabase/schema_v1_1_social.sql` ausführen (Präsenz, Realtime-Publikation, Nutzernamen-Suche).

## Bedienung

| Taste | Aktion |
|---|---|
| Steuerkreuz / linker Stick | Navigation (Haptik-Tick, Rand-Bump) |
| A | Auswählen / Textfeld bearbeiten |
| B | Zurück / Tastatur schließen |
| X / Y | Kontextaktion (z. B. Suche, Neu, Widgets bearbeiten) |
| L / R | Tabs bzw. Kategorien wechseln |
| + (Start) | Schnellzugriff (Helligkeit, Lautstärke, TDP, FPS, Power) |
| Home | Startbildschirm (holt die Shell auch aus einem laufenden Spiel zurück) |
| Capture | Schnellzugriff |
| Select | Spotlight-Suche · **Select + Start**: Task-Manager |
| Linker / rechter Stick | Licht-Cursor (A klickt) / Scrollen |

Tastatur (Standardvorlage, alles umbelegbar): Pfeile oder WASD, Eingabe/Leertaste (A), Esc/Rücktaste (B), X/F (X), Y/R (Y), Q/E bzw. Bild↑/↓ (L/R), 1/3 (ZL/ZR), M/Tab (+), N (−), Pos1/F1 (Home), F9 (Capture), I/J/K/L (linker Stick), Ziffernblock 8/4/2/6 (rechter Stick). Dazu: `F10` Clip (30 s), `F11` Screenshot, `Strg+K` Suche, `Strg+Alt+Entf` Task-Manager, `F12` Entwickler-Panel.

## Entwicklung am PC

Voraussetzungen: Node ≥ 20, Python ≥ 3.11.

```bash
npm ci
```

```bash
pip install -r daemon/requirements.txt
```

Komplette Shell mit simuliertem Hardware-Daemon in Electron:

```bash
scripts/dev.sh
```

Nur im Browser (http://127.0.0.1:5173, Daemon ohne Token im `--dev`-Modus):

```bash
scripts/dev.sh browser
```

Läuft weder Electron noch `lumosd`, nutzt die UI automatisch einen eingebauten Simulator (Hinweis „Simulation“ in der Statusleiste).

Alle Prüfungen (UI-Build + Unit-Tests, Cloud-Integrationstest, Daemon/Updater-pytest inkl. End-to-End-WebSocket-Test, Firmware-Native-Tests und C++→Python-Protokollvektoren):

```bash
scripts/check-all.sh
```

## Installation auf dem Handheld (Arch Linux)

1. Arch Linux minimal installieren (UEFI, `linux` oder `linux-zen`), Netzwerk einrichten, Repository klonen.
2. Installer ausführen – installiert Pakete (Gamescope, PipeWire, NetworkManager, BlueZ, Flatpak, OpenCV …), AUR-Werkzeuge (Howdy, ryzenadj, framework_tool, linux-enable-ir-emitter, bleak), baut die Shell, legt `/opt/lumos/releases/<version>` an und richtet udev, sudoers, systemd und greetd-Autologin ein:

```bash
sudo bash scripts/install-arch.sh
```

3. Neu starten → das Gerät bootet direkt in die Gamescope-Session `lumos-session` mit der Lumos-Shell.

### Systemd-Dienste

| Unit | Zweck |
|---|---|
| `lumosd.service` (User) | Hardware-Daemon; Start durch `lumos-session`, `systemctl --user status lumosd` |
| `greetd.service` | Autologin in `/usr/bin/lumos-session` (Gamescope + Shell) |
| `lumos-update-cleanup.timer` | wöchentliches Aufräumen alter Releases & Caches |
| `NetworkManager`, `bluetooth`, `power-profiles-daemon` | Netzwerk, BT, Energieprofile |

Logs:

```bash
journalctl --user -u lumosd -f
```

### Rechte

`lumosd` läuft **nicht** als root. Privilegierte Aktionen (TDP, Lüfter, Ladelimit, Plattformprofil, Howdy) laufen ausschließlich über `/usr/lib/lumos/lumos-priv` (strikt validierte Argumente, kein Shell-Aufruf), freigegeben in `/etc/sudoers.d/lumos`. uinput, Joy-Con-Seriell und Backlight werden per udev-Regel für die Gruppen `input`, `uucp`, `video` freigegeben.

## Face ID (Howdy) einrichten

1. IR-Kamera finden: `v4l2-ctl --list-devices` (die IR-Kamera liefert Graustufenbilder).
2. IR-Emitter aktivieren (falls dunkel): `sudo linux-enable-ir-emitter configure`.
3. Howdy konfigurieren: `sudo howdy config` → `device_path = /dev/v4l/by-id/…-video-index0`, `certainty = 3.5`, `dark_threshold = 60`.
4. Testen: `sudo howdy test`.
5. Gesicht in **Einstellungen → Face ID & Code → Face ID konfigurieren** anlernen (Kopf im Kreis bewegen; danach führt `howdy add` die eigentliche Aufnahme durch). Modelle bleiben lokal in Howdys Modellspeicher.
6. Optional systemweit (sudo/Login): Howdy 2.x `auth sufficient pam_python.so /lib/security/howdy/pam.py`, Howdy 3.x `auth sufficient pam_howdy.so` als erste Zeile in `/etc/pam.d/sudo` bzw. dem Login-PAM.

Rückgabecodes von Howdy werden übersetzt (10 = kein Modell, 11 = nicht erkannt, 13 = zu dunkel, 14 = Kamera fehlt). Im Simulator lässt sich das Ergebnis im Entwickler-Panel vorgeben.

## Controller-Firmware flashen (ESP32-S3)

Hardware je Hälfte: ESP32-S3-MINI-1-N8, ICM-20948 (I²C 0x68/0x69), DRV2605L (0x5A) + LRA (~170 Hz, 2 Vrms), MAX17048 (0x36, optional), Hall-Stick + Hall-Trigger, kapazitive Stick-Kappe, 11 Tasten, WS2812-Status-LED, Pogo-Pins (USB D+/D−, VBUS, GND, DETECT). Pinbelegung: `firmware/include/board_pins.h`.

```bash
pip install platformio
```

```bash
cd firmware && pio run -e joy-left -t upload
```

```bash
cd firmware && pio run -e joy-right -t upload
```

Weitere Umgebungen: `joy-left-uart` / `joy-right-uart` (rohe UART statt USB-CDC über die Pogo-Pins), `chassis` (Hall-Sensor-Dockerkennung + Gehäuse-LRA im Handheld), `native` (Host-Tests: `pio test -e native`).
Erster Flash: BOOT halten und Reset drücken; danach versetzt lumosd die Controller per `BOOTLOADER`-Paket selbst in den Download-Modus. Die LRA-Auto-Kalibrierung und der Gyro-Bias werden beim ersten Start ermittelt und im NVS gespeichert (neu: Einstellungen → Controller → Kalibrieren).

## Lumos Cloud

**Selbst gehostet** (empfohlen für volle Kontrolle):

```bash
PORT=8787 LUMOS_CLOUD_DATA=/var/lib/lumos-cloud node cloud-server/server.js
```

Passwörter mit scrypt, Access-Token (HS256, 15 min) + rotierende Refresh-Token, optimistische Nebenläufigkeit (`version`), SHA-256-geprüfte Spielstände, atomare Speicherung. Für Internetbetrieb hinter einen TLS-Reverse-Proxy (Caddy/nginx) stellen.

**Supabase**: neues Projekt anlegen → `cloud-server/supabase/schema.sql` und danach `cloud-server/supabase/schema_v1_1.sql` (Freunde, Chat, Medien, Spielstand-Manifeste; idempotent) im SQL-Editor ausführen → Projekt-URL und **anon key** in `.env` (`VITE_CLOUD_PROVIDER=supabase`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) eintragen oder direkt in **Einstellungen → Cloud-Dienste → Backend**. Der anon key ist öffentlich vorgesehen; alle Tabellen und der Storage-Bucket sind per Row-Level-Security auf den jeweiligen Nutzer beschränkt. Den **service_role key niemals** in die App eintragen.

## Updates

Signaturschlüssel erzeugen (privaten Schlüssel sicher verwahren, öffentlichen nach `/usr/share/lumos/update-signing.pub`):

```bash
PYTHONPATH=updater python3 -m lumos_update keygen lumos-signing
```

Release bauen und signieren:

```bash
scripts/make-release.sh 1.1.0 lumos-signing.key
```

Verteilen: die ZIP als Asset an ein GitHub-Release hängen (OTA), auf einen USB-Stick kopieren, oder mit der PC-App senden:

```bash
python3 updater/pc_client/lumos_sync.py
```

(GUI; CLI: `lumos_sync.py pair 123456 --host 10.55.0.1`, `lumos_sync.py send lumos-update-1.1.0.zip`, `lumos_sync.py usb lumos-update-1.1.0.zip`). Verbindung über WLAN oder ein USB4/Thunderbolt-Kabel (Thunderbolt-Netzwerk, `10.55.0.1`).

Ablauf am Gerät: Download (fortsetzbar) → Signatur- und Dateiprüfung → Entpacken nach `releases/.staging-X` → `fsync` → Umbenennen zu `releases/X` → atomarer Symlink-Wechsel `current` (vorherige Version bleibt als `previous` für Rollback) → Cleanup.

## Konfiguration

* `/etc/lumos/lumosd.toml` – Daemon (IR-Kamera, Update-Feed, Controller-Erkennung, zusätzliche Spielstandordner), Beispiel in `system/lumosd.toml`.
* `~/.config/lumos/session.env` – von lumosd geschrieben; Gamescope-Parameter für Bildrate, HDR, TV-Auflösung und Upscaler (wirken beim nächsten Session-Start; FPS-Limit, Upscaler-Filter und Schärfe werden zusätzlich live über Gamescope-X-Atome gesetzt).
* `.env` – UI-Build-Variablen (Cloud-Provider, Daemon-URL für Browser-Entwicklung), Vorlage `.env.example`.

## Projekt als ZIP

```bash
scripts/build-zip.sh
```

## Lizenz

MIT. Flathub-Inhalte und -Metadaten gehören den jeweiligen Projekten; Steam-Artwork wird zur Laufzeit von Valves CDN geladen.
