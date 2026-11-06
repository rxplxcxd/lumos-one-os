# lumosd WebSocket-API

`ws://127.0.0.1:7420` · JSON. Electron (Main-Prozess) verbindet sich und reicht alles per IPC an die UI weiter.

* **Request** `{"id": 1, "method": "flatpak.install", "params": {…}}`
* **Antwort** `{"id": 1, "result": …}` oder `{"id": 1, "error": {"code": "EINVAL", "message": "…"}}`
* **Event** `{"event": "flatpak.progress", "data": {…}}`

Die erste Nachricht muss `auth.hello {token}` sein. Der Token wird bei jedem Start neu erzeugt und nach
`$XDG_RUNTIME_DIR/lumos/daemon.token` (0640) und `~/.cache/lumos/daemon.token` (0600) geschrieben.
`lumosd --dev` deaktiviert die Prüfung (nur für Browser-Entwicklung). `daemon.methods` listet alle Methoden.

## Methoden

| Bereich | Methoden |
|---|---|
| System | `system.info` · `system.stats` · `system.power {action: suspend\|reboot\|shutdown}` |
| Energie | `power.get` · `power.set {profile, tdp_w, fan_mode, fan_pct, charge_limit}` · `power.battery` |
| Display | `display.get` · `display.set {brightness, fps_limit, fsr, fsr_sharpness, refresh, hdr, tv_resolution, tv_upscaler}` |
| Audio | `audio.get` · `audio.set {volume, muted, output}` |
| Netzwerk | `network.status` · `network.wifi_scan` · `network.wifi_connect {ssid, password}` · `network.wifi_disconnect` · `network.set_wifi {enabled}` |
| Bluetooth | `bluetooth.status` · `bluetooth.scan {seconds}` · `bluetooth.pair {address}` · `bluetooth.remove {address}` · `bluetooth.set {enabled}` |
| Flatpak | `flatpak.list` · `flatpak.install {id, remote, name, icon}` → `{job}` · `flatpak.uninstall {id}` · `flatpak.update {id?}` · `flatpak.cancel {job}` · `flatpak.jobs` |
| Bibliothek | `library.list` · `library.launch {id}` · `library.running` · `steam.bigpicture` |
| Sideload / Dateien | `sideload.inspect {path}` · `sideload.add {path, name}` · `sideload.remove {id}` · `fs.roots` · `fs.list {path}` |
| Face ID | `faceid.status` · `faceid.verify {reason, timeout}` → `{ok, reason}` · `faceid.enroll {label}` · `faceid.remove {id}` · `faceid.clear` · `faceid.preview {on}` · `faceid.set {enabled}` · `faceid.test` |
| Haptik | `haptics.play {pattern, target: all\|left\|right\|body, intensity}` · `haptics.set {enabled, intensity}` · `haptics.patterns` |
| Controller | `controllers.list` · `controllers.configure {gyro_enabled, gyro_sensitivity, gyro_as_mouse, stick_deadzone, swap_ab}` · `controllers.identify {id}` · `controllers.calibrate {id}` · `controllers.rumble {id, steps?}` · `controllers.assign {id, slot}` |
| Tastatur-Bridge | `input.keyboard_pad {mode: off\|games\|always, bindings}` (KeyboardEvent.code je Aktion) · `input.shell_visible {visible}` |
| Dock | `dock.status` |
| Spielstände | `saves.list` · `saves.pack {id}` → `{archive, sha256}` · `saves.restore {id, archive}` |
| Updates | `update.status` · `update.check {channel}` · `update.download` · `update.apply {archive?}` · `update.rollback` · `update.cleanup` · `update.usb_scan` · `update.pair_start` |
| Medien | `media.status` · `media.control {action: toggle\|play\|pause\|next\|previous}` |
| Simulator | `sim.state` · `sim.faceid {outcome: success\|fail\|none}` · `sim.battery {percent, charging}` · `sim.controller {side, attached, battery}` · `sim.controller_power {side, connected}` · `sim.dock {docked}` · `sim.button {button, pressed}` · `sim.gyro {pitch, roll \| reset}` · `sim.usb_controller {model: xbox\|dualsense\|pro\|8bitdo\|generic, connected}` |

`sim.*` (außer `sim.button`/`sim.gyro`) funktioniert nur mit `lumosd --simulate`.

## Events

`battery` · `system.stats` · `gyro` (≈60 Hz, `{pitch, roll, yaw}` in Grad relativ zur Ruhelage) · `controllers.changed` ·
`controller.attached` · `controller.detached` · `controller.low_battery` · `dock.changed` · `input.home` · `input.qam` ·
`input.button` · `flatpak.progress {job, id, op, percent, stage, speed}` · `flatpak.done` · `flatpak.error` ·
`faceid.state {state: searching\|detected\|matched\|failed\|enrolling\|enrolled, progress, angle}` · `faceid.frame {jpeg, face}` ·
`library.launched` · `library.exited` · `library.changed` · `media.state` · `update.progress {stage, percent}` · `update.paired` · `update.uploaded`

## PC-Sync-Endpunkt (`:7421`)

Wird erst nach `update.pair_start` (6-stelliger Code, 3 Min. gültig, einmalig) oder bei vorhandenen Kopplungen geöffnet.
`sync.pair {code, name}` → `{token}` · `sync.hello {token}` · `sync.upload_begin {name, size, sha256}` · Binärframes ·
`sync.upload_finish` · `sync.status`. Nur `lumos-update-*.zip`; die Installation erfolgt erst nach Bestätigung am Gerät
und nur mit gültiger Ed25519-Signatur.
