// Prints a hex stream of frames produced by the firmware encoder; daemon/tests/test_protocol.py
// decodes them with the Python implementation (cross-language compatibility check).
#include <stdio.h>

#include "lumos_protocol.h"

using namespace lumos;

static void emit(uint8_t type, uint8_t seq, const Writer& w) {
  uint8_t f[MAX_FRAME + 1];
  size_t n = buildFrame(type, seq, w.buf, w.n, f);
  for (size_t i = 0; i < n; i++) printf("%02x", f[i]);
}

int main() {
  Writer h; bodyHello(h, SIDE_LEFT, 1, 0, 0, "LJL000000042", CAP_IMU | CAP_MAG | CAP_HAPTICS | CAP_TOUCH); emit(PKT_HELLO, 1, h);
  Writer in; bodyInput(in, 1234, 0x81, -0.5f, 0.75f, 0.2f, 1); emit(PKT_INPUT, 2, in);
  float a[3] = {0.01f, -0.02f, 0.98f}, g[3] = {120.5f, -0.0625f, 2000.f}, m[3] = {25.f, -3.2f, 40.f}, q[4] = {0.7071f, 0.7071f, 0, 0};
  Writer im; bodyImu(im, 999999, a, g, m, q); emit(PKT_IMU, 3, im);
  Writer b; bodyBattery(b, 3712, 64, false, true); emit(PKT_BATTERY, 4, b);
  Writer e; e.u8(EV_HALL); e.u8(1); emit(PKT_EVENT, 5, e);
  printf("\n");
  return 0;
}
