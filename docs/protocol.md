# Lumos Joy Protokoll (Firmware ⇄ lumosd)

Gleiches Binärprotokoll über **Pogo-Pins** (ESP32-S3 USB-CDC oder UART, 1 Mbit/s) und **Bluetooth LE** (GATT-Service).
Referenz-Implementierungen: `firmware/include/lumos_protocol.h` (C++) und `daemon/lumosd/protocol.py` (Python).
Die Kompatibilität wird automatisch geprüft (`scripts/check-all.sh`: C++ erzeugt Frames → Python dekodiert).

## Framing

```
COBS( type:u8 | seq:u8 | body… | crc16:u16le ) 0x00
```

* COBS-Kodierung → im Frame kommt nie `0x00` vor, `0x00` trennt Frames (selbstsynchronisierend).
* CRC-16/CCITT-FALSE (Poly `0x1021`, Init `0xFFFF`) über `type|seq|body`. Prüfwert für `"123456789"`: `0x29B1`.
* Alle Integer Little-Endian. Max. Body 256 Byte.

## Pakete Gerät → Host

| Typ | Name | Body |
|---|---|---|
| `0x01` | HELLO | `side u8` (0 L, 1 R, 2 Chassis) · `fw major/minor/patch u8×3` · `serial char[12]` · `caps u16` (1 IMU, 2 Mag, 4 Haptik, 8 Touch, 16 Hall) |
| `0x02` | INPUT | `t_ms u32` · `buttons u32` · `stick_x i16` · `stick_y i16` (±32767) · `trigger u8` · `touch u8` |
| `0x03` | IMU | `t_us u32` · `accel i16×3` (mg) · `gyro i16×3` (1/16 °/s) · `mag i16×3` (0,1 µT) · `quat i16×4` (Q14, Madgwick on-device) |
| `0x04` | BATTERY | `mv u16` · `percent u8` · `flags u8` (1 lädt, 2 Pogo, 4 niedrig) |
| `0x05` | EVENT | `code u8` (1 Pogo an, 2 Pogo ab, 3 Hall-Sensor, 4 Akku niedrig) · `value u8` |
| `0x06` | ACK | `acked_type u8` · `status u8` |
| `0x07` | LOG | UTF-8 Text |

### Tastenbits

* **Links:** 0 ↑, 1 ↓, 2 ←, 3 →, 4 L, 5 ZL, 6 −, 7 Capture, 8 Stick-Klick, 9 SL, 10 SR
* **Rechts:** 0 A (unten), 1 B (rechts), 2 X (links), 3 Y (oben), 4 R, 5 ZR, 6 +, 7 Home, 8 Stick-Klick, 9 SL, 10 SR

## Pakete Host → Gerät

| Typ | Name | Body |
|---|---|---|
| `0x81` | HAPTIC | `intensity u8` · `n u8` · n × (`kind u8` 0 Effekt / 1 Pause / 2 RTP, `value u8`, `ms u16`) — max. 16 Schritte |
| `0x82` | CONFIG | `imu_hz u16` · `gyro_fs u8` (0–3 = 250…2000 °/s) · `accel_fs u8` (0–3 = 2…16 g) · `input_hz u16` · `flags u8` |
| `0x83` | CALIBRATE | `what u8` (Bit 0 Gyro-Bias, Bit 1 Stick-Mitte) |
| `0x84` | IDENTIFY | LED blinkt + Doppel-Buzz |
| `0x85` | PING | Gerät antwortet mit HELLO + ACK + BATTERY |
| `0x86` | BOOTLOADER | Neustart in den ROM-Download-Modus (Flashen ohne Tasten) |

## BLE

* Service `6c756d6f-7300-4a6f-7900-000000000001`
* TX (Notify, Gerät → Host) `…0002`, RX (Write/WriteNR, Host → Gerät) `…0003`
* Gleiche Frames wie seriell. Raten werden kabellos auf 125 Hz begrenzt; MTU 247; Verbindungsintervall 7,5–15 ms.
* Sobald `POGO_DETECT` (GPIO 42) auf GND gezogen wird, beendet die Firmware BLE und wechselt auf Pogo (entprellt 20 ms).

## Haptik-Muster

Alle Muster sind zentral in `shared/haptics.json` definiert (UI, Daemon und Firmware-Programme stammen daraus).
Effekt-IDs sind die ROM-Effekte der TI DRV2605L **LRA-Bibliothek 6** (z. B. 7 „Soft Bump 100 %“, 17 „Strong Click 1“,
26 „Sharp Tick 3 60 %“, 58 „Transition Click 1“, 70 „Ramp Down Long Smooth“). RTP-Schritte sind vorzeichenbehaftete
Amplituden 0–127 im Closed-Loop-Modus. Die Intensität skaliert `RATED_VOLTAGE`/`OD_CLAMP` des Treibers.
