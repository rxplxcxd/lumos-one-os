// Host tests for the portable firmware parts.  pio test -e native   (Unity)
// or without PlatformIO:  g++ -std=c++17 -DLUMOS_NO_UNITY -Iinclude test/test_native/test_main.cpp && ./a.out
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "haptic_player.h"
#include "lumos_protocol.h"
#include "madgwick.h"

#ifdef LUMOS_NO_UNITY
static int failures = 0;
#define TEST_ASSERT_TRUE(c) do { if (!(c)) { printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #c); failures++; } } while (0)
#define TEST_ASSERT_EQUAL(a, b) TEST_ASSERT_TRUE((a) == (b))
#define TEST_ASSERT_FLOAT_WITHIN(d, e, a) TEST_ASSERT_TRUE(fabs((double)(a) - (double)(e)) <= (d))
#define RUN_TEST(f) do { f(); printf("ok   %s\n", #f); } while (0)
#define UNITY_BEGIN() ((void)0)
#define UNITY_END() (failures ? (printf("%d failure(s)\n", failures), 1) : (printf("all native tests passed\n"), 0))
#else
#include <unity.h>
void setUp() {}
void tearDown() {}
#endif

using namespace lumos;

static void test_crc_vector() {
  const uint8_t s[] = "123456789";
  TEST_ASSERT_EQUAL(crc16(s, 9), 0x29B1);
}

static void test_cobs_roundtrip() {
  uint8_t in[600], enc[700], dec[700];
  uint32_t x = 12345;
  for (int len = 0; len < 600; len += 7) {
    for (int i = 0; i < len; i++) {
      x = x * 1103515245u + 12345u;
      in[i] = (x >> 16) % 5 == 0 ? 0 : (uint8_t)(x >> 8);
    }
    size_t e = cobsEncode(in, len, enc);
    for (size_t i = 0; i < e; i++) TEST_ASSERT_TRUE(enc[i] != 0);
    size_t d = cobsDecode(enc, e, dec, sizeof(dec));
    TEST_ASSERT_EQUAL(d, (size_t)len);
    TEST_ASSERT_TRUE(memcmp(in, dec, len) == 0);
  }
}

static void test_frame_decoder() {
  Writer w;
  bodyBattery(w, 3800, 55, true, false);
  uint8_t f[MAX_FRAME + 1];
  size_t n = buildFrame(PKT_BATTERY, 9, w.buf, w.n, f);
  FrameDecoder d;
  bool got = false;
  for (size_t i = 0; i < n; i++) got = d.push(f[i]) || got;
  TEST_ASSERT_TRUE(got);
  TEST_ASSERT_EQUAL(d.type(), PKT_BATTERY);
  TEST_ASSERT_EQUAL(d.seq(), 9);
  TEST_ASSERT_EQUAL(d.bodyLen(), (size_t)4);
  f[2] ^= 0x40;  // corrupt → rejected
  got = false;
  for (size_t i = 0; i < n; i++) got = d.push(f[i]) || got;
  TEST_ASSERT_TRUE(!got);
  TEST_ASSERT_EQUAL(d.errors, 1u);
}

static void test_madgwick_converges_to_tilt() {
  Madgwick m;
  m.beta = 0.5f;
  // device rolled by +30° about X: gravity appears in y/z
  float ay = sinf(30 * 0.0174533f), az = cosf(30 * 0.0174533f);
  for (int i = 0; i < 4000; i++) m.updateIMU(0, 0, 0, 0, ay, az, 0.001f);
  TEST_ASSERT_FLOAT_WITHIN(1.0f, 30.0f, m.roll());
  TEST_ASSERT_FLOAT_WITHIN(1.0f, 0.0f, m.pitch());
}

struct FakeDrv {
  int effects = 0, rtps = 0, offs = 0, lastEffect = -1, lastAmp = 0;
  bool busy = false;
  float k = 1;
  void playEffect(uint8_t id) { effects++; lastEffect = id; busy = true; }
  bool effectBusy() { return busy; }
  void rtp(int8_t a) { rtps++; lastAmp = a; }
  void rtpOff() { offs++; }
  void setIntensity(float v) { k = v; }
};

static void test_haptic_sequencer() {
  FakeDrv drv;
  HapticPlayer<FakeDrv> p(drv);
  uint8_t body[] = {128, 3, HAPTIC_EFFECT, 7, 0, 0, HAPTIC_WAIT, 0, 50, 0, HAPTIC_RTP, 100, 20, 0};
  HapticProgram prog;
  TEST_ASSERT_TRUE(parseHaptic(body, sizeof(body), prog));
  p.play(prog);
  TEST_ASSERT_FLOAT_WITHIN(0.01f, 128 / 255.f, drv.k);
  p.update(0);
  TEST_ASSERT_EQUAL(drv.lastEffect, 7);
  p.update(10);  // still busy
  TEST_ASSERT_TRUE(p.active());
  drv.busy = false;
  p.update(20);  // effect done → wait starts at 20
  p.update(60);
  TEST_ASSERT_EQUAL(drv.rtps, 0);
  p.update(71);  // wait done → rtp starts
  TEST_ASSERT_EQUAL(drv.rtps, 1);
  TEST_ASSERT_EQUAL(drv.lastAmp, 50);  // 100 * 128/255 ≈ 50
  p.update(95);
  TEST_ASSERT_TRUE(!p.active());
  TEST_ASSERT_EQUAL(drv.offs, 1);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_crc_vector);
  RUN_TEST(test_cobs_roundtrip);
  RUN_TEST(test_frame_decoder);
  RUN_TEST(test_madgwick_converges_to_tilt);
  RUN_TEST(test_haptic_sequencer);
  return UNITY_END();
}
