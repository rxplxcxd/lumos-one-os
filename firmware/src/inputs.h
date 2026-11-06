// Buttons (debounced), hall-effect stick + trigger (calibrated, radial deadzone) and capacitive stick touch.
#pragma once
#include <Arduino.h>
#include <Preferences.h>

class Inputs {
 public:
  void begin(Preferences& prefs);
  void update();  // call at ≥1 kHz
  void calibrateCenter();
  void saveCalibration();

  uint32_t buttons = 0;
  float stickX = 0, stickY = 0, trigger = 0;
  uint8_t touch = 0;  // bit0: stick touched
  bool changed = false;

 private:
  struct Axis {
    uint16_t min = 400, center = 2048, max = 3700;
    float map(uint16_t raw) const;
  } ax_, ay_, at_;
  uint8_t integ_[11] = {0};
  uint32_t touchBase_ = 0;
  uint32_t lastTouch_ = 0;
  Preferences* prefs_ = nullptr;
  float lastX_ = 0, lastY_ = 0, lastT_ = 0;
};
