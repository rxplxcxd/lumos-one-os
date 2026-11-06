#include "inputs.h"
#include "board_pins.h"

static constexpr uint8_t DEBOUNCE = 4;  // samples at 1 kHz → 4 ms integrator

float Inputs::Axis::map(uint16_t raw) const {
  if (raw >= center) return max > center ? constrain((float)(raw - center) / (max - center), 0.f, 1.f) : 0.f;
  return center > min ? -constrain((float)(center - raw) / (center - min), 0.f, 1.f) : 0.f;
}

void Inputs::begin(Preferences& prefs) {
  prefs_ = &prefs;
  for (int p : pins::BUTTONS) pinMode(p, INPUT_PULLUP);
  analogReadResolution(12);
  for (int p : {pins::STICK_X, pins::STICK_Y, pins::TRIGGER}) analogSetPinAttenuation(p, ADC_11db);
  if (prefs.isKey("ax")) {
    prefs.getBytes("ax", &ax_, sizeof(ax_));
    prefs.getBytes("ay", &ay_, sizeof(ay_));
    prefs.getBytes("at", &at_, sizeof(at_));
  } else {
    calibrateCenter();
    at_.min = at_.center = analogRead(pins::TRIGGER);
    at_.max = 3600;
  }
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) sum += touchRead(pins::STICK_TOUCH);
  touchBase_ = sum / 16;
}

void Inputs::calibrateCenter() {
  uint32_t sx = 0, sy = 0;
  for (int i = 0; i < 64; i++) {
    sx += analogRead(pins::STICK_X);
    sy += analogRead(pins::STICK_Y);
    delayMicroseconds(500);
  }
  ax_.center = sx / 64;
  ay_.center = sy / 64;
}

void Inputs::saveCalibration() {
  prefs_->putBytes("ax", &ax_, sizeof(ax_));
  prefs_->putBytes("ay", &ay_, sizeof(ay_));
  prefs_->putBytes("at", &at_, sizeof(at_));
}

void Inputs::update() {
  changed = false;
  uint32_t b = buttons;
  for (int i = 0; i < 11; i++) {
    bool down = digitalRead(pins::BUTTONS[i]) == LOW;
    if (down && integ_[i] < DEBOUNCE) integ_[i]++;
    else if (!down && integ_[i] > 0) integ_[i]--;
    if (integ_[i] == DEBOUNCE) b |= (1u << i);
    else if (integ_[i] == 0) b &= ~(1u << i);
  }
  if (b != buttons) {
    buttons = b;
    changed = true;
  }

  uint16_t rx = analogRead(pins::STICK_X), ry = analogRead(pins::STICK_Y), rt = analogRead(pins::TRIGGER);
  // track the physical travel so the full range is always reachable
  ax_.min = min(ax_.min, rx); ax_.max = max(ax_.max, rx);
  ay_.min = min(ay_.min, ry); ay_.max = max(ay_.max, ry);
  at_.max = max(at_.max, rt);
  float x = ax_.map(rx), y = ay_.map(ry);
  // small radial hardware deadzone (the daemon applies the user deadzone on top)
  float mag = sqrtf(x * x + y * y);
  if (mag < 0.03f) x = y = 0;
  else if (mag > 1.f) { x /= mag; y /= mag; }
  float t = at_.max > at_.center ? constrain((float)(rt - at_.center) / (at_.max - at_.center), 0.f, 1.f) : 0.f;
  if (fabsf(x - lastX_) > 0.004f || fabsf(y - lastY_) > 0.004f || fabsf(t - lastT_) > 0.01f) {
    lastX_ = stickX = x;
    lastY_ = stickY = y;
    lastT_ = trigger = t;
    changed = true;
  }

  // ESP32-S3 touch: reading rises when touched
  uint32_t now = millis();
  if (now - lastTouch_ >= 10) {
    lastTouch_ = now;
    uint32_t v = touchRead(pins::STICK_TOUCH);
    uint8_t tch = v > touchBase_ * 13 / 10 ? 1 : 0;
    if (!tch) touchBase_ = (touchBase_ * 63 + v) / 64;  // slow drift compensation
    if (tch != touch) {
      touch = tch;
      changed = true;
    }
  }
}
