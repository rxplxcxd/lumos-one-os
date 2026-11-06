// Dual transport: pogo-pin USB-CDC (or raw UART with -DLUMOS_POGO_UART) when attached to the
// handheld, Bluetooth LE GATT (NimBLE) when detached. Same framed protocol on both.
#pragma once
#include <Arduino.h>
#include "lumos_protocol.h"

class Transport {
 public:
  using Handler = void (*)(uint8_t type, const uint8_t* body, size_t len);
  void begin(const char* bleName, Handler h);
  void update();  // polls pogo detect + serial RX
  bool send(uint8_t type, const uint8_t* body, size_t len);
  bool send(uint8_t type, const lumos::Writer& w) { return send(type, w.buf, w.n); }
  bool pogo() const { return pogo_; }
  bool connected() const;
  bool justChanged() { bool c = changed_; changed_ = false; return c; }

 private:
  void startBle();
  void stopBle();
  Handler handler_ = nullptr;
  lumos::FrameDecoder rx_;
  uint8_t seq_ = 0;
  bool pogo_ = false, changed_ = false, bleOn_ = false;
  uint32_t detectT_ = 0;
  const char* name_ = "Lumos Joy";
};
