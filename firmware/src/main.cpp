// Lumos Joy firmware (ESP32-S3) — left/right controller halves and the chassis board.
//  • ICM-20948 6/9-axis IMU @ up to 1 kHz, Madgwick fusion on-device (quaternion to host)
//  • Hall-effect stick/trigger, capacitive stick touch, 11 debounced buttons
//  • DRV2605L LRA haptics (closed loop, auto-calibrated) driven by host step programs
//  • MAX17048 fuel gauge / ADC fallback, charger status
//  • Pogo-pin USB-CDC/UART while attached, Bluetooth LE when detached (automatic hand-over)
#include <Arduino.h>
#include <Preferences.h>
#include <Wire.h>
#include <esp_mac.h>
#include <soc/rtc_cntl_reg.h>

#include "board_pins.h"
#include "drv2605.h"
#include "haptic_player.h"
#include "icm20948.h"
#include "inputs.h"
#include "lumos_protocol.h"
#include "madgwick.h"
#include "power.h"
#include "transport.h"

using namespace lumos;

#ifndef LUMOS_FW_MAJOR
#define LUMOS_FW_MAJOR 1
#define LUMOS_FW_MINOR 0
#define LUMOS_FW_PATCH 0
#endif

static Side gSide = SIDE_LEFT;
static char gSerial[13];
static uint16_t gCaps = 0;

static Preferences prefs;
static Transport transport;
static ICM20948 imu;
static DRV2605 drv;
static HapticPlayer<DRV2605> player(drv);
static Inputs inputs;
static Battery battery;
static Madgwick ahrs;

static bool imuOk = false, hapticsOk = false;
static uint32_t imuPeriodUs = 1000, inputPeriodUs = 1000;
static uint32_t tImu = 0, tInput = 0, tInputSent = 0, tBattery = 0, tLed = 0, identifyUntil = 0;
static float lastMag[3] = {0, 0, 0};
static bool hallState = false;

static void sendHello() {
  Writer w;
  bodyHello(w, gSide, LUMOS_FW_MAJOR, LUMOS_FW_MINOR, LUMOS_FW_PATCH, gSerial, gCaps);
  transport.send(PKT_HELLO, w);
}

static void sendBattery() {
  Writer w;
  bodyBattery(w, battery.mv, battery.percent, battery.charging, transport.pogo());
  transport.send(PKT_BATTERY, w);
}

static void sendEvent(uint8_t code, uint8_t value) {
  Writer w;
  w.u8(code);
  w.u8(value);
  transport.send(PKT_EVENT, w);
}

static void ack(uint8_t type, uint8_t status) {
  Writer w;
  w.u8(type);
  w.u8(status);
  transport.send(PKT_ACK, w);
}

static void calibrateGyro() {
  if (!imuOk) return;
  float sum[3] = {0, 0, 0}, a[3], g[3];
  for (int i = 0; i < 3; i++) imu.gyroBias[i] = 0;
  int n = 0;
  for (int i = 0; i < 600; i++) {
    if (imu.read(a, g)) {
      for (int k = 0; k < 3; k++) sum[k] += g[k];
      n++;
    }
    delayMicroseconds(900);
  }
  if (n) {
    for (int k = 0; k < 3; k++) imu.gyroBias[k] = sum[k] / n;
    prefs.putBytes("gbias", imu.gyroBias, sizeof(imu.gyroBias));
  }
  ahrs.reset();
}

static void onCommand(uint8_t type, const uint8_t* b, size_t n) {
  switch (type) {
    case PKT_PING:
      sendHello();
      ack(type, 0);
      sendBattery();
      break;
    case PKT_HAPTIC: {
      HapticProgram p;
      if (hapticsOk && parseHaptic(b, n, p)) player.play(p);
      break;
    }
    case PKT_CONFIG: {
      Reader r(b, n);
      uint16_t imuHz = r.u16();
      uint8_t gfs = r.u8(), afs = r.u8();
      uint16_t inHz = r.u16();
      if (!r.ok) return ack(type, 1);
      // BLE cannot carry 1 kHz: cap the rates while wireless
      uint16_t cap = transport.pogo() ? 1000 : 125;
      imuHz = constrain(imuHz, 50, cap);
      inHz = constrain(inHz, 60, cap);
      imuPeriodUs = 1000000UL / imuHz;
      inputPeriodUs = 1000000UL / inHz;
      if (imuOk) imu.configure((ICM20948::GyroFs)(gfs & 3), (ICM20948::AccelFs)(afs & 3), imuHz);
      ack(type, 0);
      break;
    }
    case PKT_CALIBRATE: {
      uint8_t what = n ? b[0] : 3;
      if (what & 1) calibrateGyro();
      if (what & 2) {
        inputs.calibrateCenter();
        inputs.saveCalibration();
      }
      ack(type, 0);
      break;
    }
    case PKT_IDENTIFY: {
      identifyUntil = millis() + 1500;
      HapticProgram p;
      p.intensity = 255;
      p.count = 3;
      p.steps[0] = {HAPTIC_EFFECT, 14, 0};  // strong buzz
      p.steps[1] = {HAPTIC_WAIT, 0, 120};
      p.steps[2] = {HAPTIC_EFFECT, 14, 0};
      if (hapticsOk) player.play(p);
      ack(type, 0);
      break;
    }
    case PKT_BOOTLOADER:
      ack(type, 0);
      delay(50);
      REG_WRITE(RTC_CNTL_OPTION1_REG, RTC_CNTL_FORCE_DOWNLOAD_BOOT);
      esp_restart();
      break;
    default:
      break;
  }
}

static void led(uint8_t r, uint8_t g, uint8_t b) { neopixelWrite(pins::STATUS_LED, r, g, b); }

void setup() {
#if defined(LUMOS_CHASSIS)
  gSide = SIDE_CHASSIS;
#elif defined(LUMOS_SIDE_RIGHT)
  gSide = SIDE_RIGHT;
#elif defined(LUMOS_SIDE_LEFT)
  gSide = SIDE_LEFT;
#else
  pinMode(pins::SIDE_STRAP, INPUT_PULLDOWN);
  gSide = digitalRead(pins::SIDE_STRAP) ? SIDE_RIGHT : SIDE_LEFT;
#endif
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  snprintf(gSerial, sizeof(gSerial), "LJ%c%02X%02X%02X%02X%01X", gSide == SIDE_LEFT ? 'L' : gSide == SIDE_RIGHT ? 'R' : 'C', mac[2], mac[3], mac[4], mac[5], mac[1] & 0xF);

  prefs.begin("lumos", false);
  Wire.begin(pins::I2C_SDA, pins::I2C_SCL, pins::I2C_HZ);

  hapticsOk = drv.begin(Wire, pins::HAPTIC_EN, 170.f, 2.0f, 2.9f);
  if (hapticsOk) {
    DRV2605::Calib c{};
    if (prefs.getBytes("lra", &c, sizeof(c)) == sizeof(c) && c.valid) drv.applyCalibration(c);
    else if (drv.autoCalibrate(c)) prefs.putBytes("lra", &c, sizeof(c));
    gCaps |= CAP_HAPTICS;
  }
  battery.begin(Wire, pins::VBAT_ADC, pins::CHARGE_STAT);

#if defined(LUMOS_CHASSIS)
  pinMode(pins::HALL_DOCK, INPUT_PULLUP);
  hallState = digitalRead(pins::HALL_DOCK) == LOW;
  gCaps |= CAP_HALL;
#else
  imuOk = imu.begin(Wire);
  if (imuOk) {
    gCaps |= CAP_IMU | (imu.hasMag() ? CAP_MAG : 0);
    if (prefs.getBytes("gbias", imu.gyroBias, sizeof(imu.gyroBias)) != sizeof(imu.gyroBias)) calibrateGyro();
  }
  inputs.begin(prefs);
  gCaps |= CAP_TOUCH;
#endif

  const char* name = gSide == SIDE_LEFT ? "Lumos Joy L" : gSide == SIDE_RIGHT ? "Lumos Joy R" : "Lumos Chassis";
  transport.begin(name, onCommand);
  led(0, 0, 8);
}

void loop() {
  uint32_t nowUs = micros();
  uint32_t nowMs = millis();
  transport.update();

  if (transport.justChanged()) {
    sendEvent(transport.pogo() ? EV_POGO_ATTACH : EV_POGO_DETACH, 1);
    sendHello();
    sendBattery();
    // wireless → lower rates; attached → host re-sends CONFIG after HELLO
    if (!transport.pogo()) {
      imuPeriodUs = max<uint32_t>(imuPeriodUs, 8000);
      inputPeriodUs = max<uint32_t>(inputPeriodUs, 8000);
    }
    if (hapticsOk) {
      HapticProgram p;
      p.intensity = 200;
      p.count = 1;
      p.steps[0] = {HAPTIC_EFFECT, (uint8_t)(transport.pogo() ? 58 : 70), 0};  // transition click / ramp down
      player.play(p);
    }
  }

#if defined(LUMOS_CHASSIS)
  (void)nowUs;
  bool hall = digitalRead(pins::HALL_DOCK) == LOW;
  if (hall != hallState) {
    hallState = hall;
    sendEvent(EV_HALL, hall ? 1 : 0);
  }
#else
  if (nowUs - tInput >= 1000) {  // sample inputs at 1 kHz regardless of report rate
    tInput = nowUs;
    inputs.update();
  }
  {
    // report on change (rate-limited to the configured report rate) plus a keep-alive
    bool due = nowUs - tInputSent >= inputPeriodUs;
    bool keepalive = nowUs - tInputSent >= (transport.pogo() ? 8000u : 16000u);
    if ((inputs.changed && due) || keepalive) {
      tInputSent = nowUs;
      Writer w;
      bodyInput(w, nowMs, inputs.buttons, inputs.stickX, inputs.stickY, inputs.trigger, inputs.touch);
      transport.send(PKT_INPUT, w);
      inputs.changed = false;
    }
  }
  if (imuOk && nowUs - tImu >= imuPeriodUs) {
    float dt = (nowUs - tImu) * 1e-6f;
    tImu = nowUs;
    float a[3], g[3];
    if (imu.read(a, g)) {
      imu.readMag(lastMag);
      constexpr float D2R = 0.01745329f;
      if (dt > 0.05f) dt = 0.05f;
      ahrs.update(g[0] * D2R, g[1] * D2R, g[2] * D2R, a[0], a[1], a[2], lastMag[0], lastMag[1], lastMag[2], dt);
      float q[4] = {ahrs.q0, ahrs.q1, ahrs.q2, ahrs.q3};
      Writer w;
      bodyImu(w, nowUs, a, g, lastMag, q);
      transport.send(PKT_IMU, w);
    }
  }
#endif

  if (nowMs - tBattery >= 1000) {
    tBattery = nowMs;
    uint8_t before = battery.percent;
    battery.update();
    sendBattery();
    if (before > 10 && battery.percent <= 10) sendEvent(EV_LOW_BATTERY, battery.percent);
  }

  player.update(nowMs);

  if (nowMs - tLed >= 50) {
    tLed = nowMs;
    if (nowMs < identifyUntil) led((nowMs / 150) % 2 ? 40 : 0, (nowMs / 150) % 2 ? 40 : 0, (nowMs / 150) % 2 ? 40 : 0);
    else if (battery.percent <= 10 && !battery.charging) led((nowMs / 500) % 2 ? 24 : 0, 0, 0);
    else if (transport.pogo()) led(0, battery.charging ? 10 : 0, battery.charging ? 0 : 6);
    else led(0, 0, transport.connected() ? 6 : ((nowMs / 600) % 2 ? 6 : 0));
  }
}
