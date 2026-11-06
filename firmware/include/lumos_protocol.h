// Lumos Joy wire protocol — header-only, portable C++ (ESP32-S3 firmware + native tests).
// Must stay byte-compatible with daemon/lumosd/protocol.py.
//
// Frame:  COBS( type:u8 | seq:u8 | body… | crc16:u16le ) 0x00
// CRC:    CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over type|seq|body
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace lumos {

enum PacketType : uint8_t {
  PKT_HELLO = 0x01, PKT_INPUT = 0x02, PKT_IMU = 0x03, PKT_BATTERY = 0x04, PKT_EVENT = 0x05, PKT_ACK = 0x06, PKT_LOG = 0x07,
  PKT_HAPTIC = 0x81, PKT_CONFIG = 0x82, PKT_CALIBRATE = 0x83, PKT_IDENTIFY = 0x84, PKT_PING = 0x85, PKT_BOOTLOADER = 0x86,
};
enum Side : uint8_t { SIDE_LEFT = 0, SIDE_RIGHT = 1, SIDE_CHASSIS = 2 };
enum Caps : uint16_t { CAP_IMU = 1, CAP_MAG = 2, CAP_HAPTICS = 4, CAP_TOUCH = 8, CAP_HALL = 16 };
enum EventCode : uint8_t { EV_POGO_ATTACH = 1, EV_POGO_DETACH = 2, EV_HALL = 3, EV_LOW_BATTERY = 4 };
enum HapticKind : uint8_t { HAPTIC_EFFECT = 0, HAPTIC_WAIT = 1, HAPTIC_RTP = 2 };

static constexpr size_t MAX_PAYLOAD = 256;
static constexpr size_t MAX_FRAME = MAX_PAYLOAD + MAX_PAYLOAD / 254 + 3;

// Units (see protocol.py): gyro 1/16 °/s, accel mg, mag 0.1 µT, quaternion Q14
static constexpr float GYRO_LSB_PER_DPS = 16.0f;
static constexpr float ACCEL_LSB_PER_G = 1000.0f;
static constexpr float MAG_LSB_PER_UT = 10.0f;
static constexpr float QUAT_SCALE = 16384.0f;

inline uint16_t crc16(const uint8_t* d, size_t n, uint16_t crc = 0xFFFF) {
  for (size_t i = 0; i < n; i++) {
    crc ^= (uint16_t)d[i] << 8;
    for (int b = 0; b < 8; b++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
  }
  return crc;
}

// Returns encoded length (without the trailing 0x00 delimiter).
inline size_t cobsEncode(const uint8_t* in, size_t n, uint8_t* out) {
  size_t codeIdx = 0, o = 1;
  uint8_t code = 1;
  for (size_t i = 0; i < n; i++) {
    if (in[i] == 0) {
      out[codeIdx] = code;
      codeIdx = o++;
      code = 1;
    } else {
      out[o++] = in[i];
      if (++code == 0xFF) {
        out[codeIdx] = code;
        codeIdx = o++;
        code = 1;
      }
    }
  }
  out[codeIdx] = code;
  return o;
}

// Returns decoded length or 0 on error.
inline size_t cobsDecode(const uint8_t* in, size_t n, uint8_t* out, size_t outCap) {
  size_t i = 0, o = 0;
  while (i < n) {
    uint8_t code = in[i++];
    if (code == 0) return 0;
    for (uint8_t k = 1; k < code; k++) {
      if (i >= n || o >= outCap) return 0;
      out[o++] = in[i++];
    }
    if (code < 0xFF && i < n) {
      if (o >= outCap) return 0;
      out[o++] = 0;
    }
  }
  return o;
}

// Little-endian body writer.
struct Writer {
  uint8_t buf[MAX_PAYLOAD];
  size_t n = 0;
  void u8(uint8_t v) { if (n < MAX_PAYLOAD) buf[n++] = v; }
  void u16(uint16_t v) { u8(v & 0xFF); u8(v >> 8); }
  void i16(int16_t v) { u16((uint16_t)v); }
  void u32(uint32_t v) { u16(v & 0xFFFF); u16(v >> 16); }
  void bytes(const void* p, size_t len) { for (size_t i = 0; i < len; i++) u8(((const uint8_t*)p)[i]); }
};

struct Reader {
  const uint8_t* p;
  size_t n, i = 0;
  bool ok = true;
  Reader(const uint8_t* d, size_t len) : p(d), n(len) {}
  uint8_t u8() { if (i >= n) { ok = false; return 0; } return p[i++]; }
  uint16_t u16() { uint16_t a = u8(); return a | (uint16_t)u8() << 8; }
  int16_t i16() { return (int16_t)u16(); }
  uint32_t u32() { uint32_t a = u16(); return a | (uint32_t)u16() << 16; }
};

inline int16_t sat16(float v) { return v > 32767.f ? 32767 : v < -32768.f ? -32768 : (int16_t)v; }

// Builds a complete wire frame (COBS + delimiter) into `out`; returns its length.
inline size_t buildFrame(uint8_t type, uint8_t seq, const uint8_t* body, size_t len, uint8_t* out) {
  uint8_t raw[MAX_PAYLOAD + 4];
  if (len > MAX_PAYLOAD) len = MAX_PAYLOAD;
  raw[0] = type;
  raw[1] = seq;
  memcpy(raw + 2, body, len);
  uint16_t c = crc16(raw, len + 2);
  raw[len + 2] = c & 0xFF;
  raw[len + 3] = c >> 8;
  size_t e = cobsEncode(raw, len + 4, out);
  out[e] = 0x00;
  return e + 1;
}

inline void bodyHello(Writer& w, Side side, uint8_t ma, uint8_t mi, uint8_t pa, const char* serial, uint16_t caps) {
  w.u8(side); w.u8(ma); w.u8(mi); w.u8(pa);
  char s[12] = {0};
  strncpy(s, serial, sizeof(s));
  w.bytes(s, 12);
  w.u16(caps);
}

inline void bodyInput(Writer& w, uint32_t tMs, uint32_t buttons, float sx, float sy, float trig, uint8_t touch) {
  w.u32(tMs); w.u32(buttons); w.i16(sat16(sx * 32767.f)); w.i16(sat16(sy * 32767.f));
  w.u8((uint8_t)(trig < 0 ? 0 : trig > 1 ? 255 : trig * 255.f)); w.u8(touch);
}

inline void bodyImu(Writer& w, uint32_t tUs, const float a[3], const float g[3], const float m[3], const float q[4]) {
  w.u32(tUs);
  for (int i = 0; i < 3; i++) w.i16(sat16(a[i] * ACCEL_LSB_PER_G));
  for (int i = 0; i < 3; i++) w.i16(sat16(g[i] * GYRO_LSB_PER_DPS));
  for (int i = 0; i < 3; i++) w.i16(sat16(m[i] * MAG_LSB_PER_UT));
  for (int i = 0; i < 4; i++) w.i16(sat16(q[i] * QUAT_SCALE));
}

inline void bodyBattery(Writer& w, uint16_t mv, uint8_t pct, bool charging, bool pogo) {
  w.u16(mv); w.u8(pct); w.u8((charging ? 1 : 0) | (pogo ? 2 : 0) | (pct <= 10 ? 4 : 0));
}

struct HapticStep {
  uint8_t kind, value;
  uint16_t ms;
};
struct HapticProgram {
  uint8_t intensity = 255;
  uint8_t count = 0;
  HapticStep steps[16];
};

inline bool parseHaptic(const uint8_t* b, size_t n, HapticProgram& out) {
  Reader r(b, n);
  out.intensity = r.u8();
  uint8_t c = r.u8();
  if (c > 16) c = 16;
  out.count = 0;
  for (uint8_t i = 0; i < c && r.ok; i++) {
    HapticStep s;
    s.kind = r.u8(); s.value = r.u8(); s.ms = r.u16();
    if (r.ok) out.steps[out.count++] = s;
  }
  return r.ok;
}

// Incremental frame decoder for the receive path.
class FrameDecoder {
 public:
  // Feeds one byte; returns true when a valid packet is available via type()/seq()/body().
  bool push(uint8_t b) {
    if (b != 0) {
      if (len_ < sizeof(enc_)) enc_[len_++] = b;
      else { len_ = 0; errors++; }
      return false;
    }
    if (len_ == 0) return false;
    size_t d = cobsDecode(enc_, len_, dec_, sizeof(dec_));
    len_ = 0;
    if (d < 4) { errors++; return false; }
    uint16_t c = (uint16_t)dec_[d - 2] | (uint16_t)dec_[d - 1] << 8;
    if (crc16(dec_, d - 2) != c) { errors++; return false; }
    bodyLen_ = d - 4;
    return true;
  }
  uint8_t type() const { return dec_[0]; }
  uint8_t seq() const { return dec_[1]; }
  const uint8_t* body() const { return dec_ + 2; }
  size_t bodyLen() const { return bodyLen_; }
  uint32_t errors = 0;

 private:
  uint8_t enc_[MAX_FRAME];
  uint8_t dec_[MAX_FRAME];
  size_t len_ = 0, bodyLen_ = 0;
};

}  // namespace lumos
