// LiPo state: MAX17048 fuel gauge (ModelGauge) with ADC divider fallback, charger STAT pin.
#pragma once
#include <Arduino.h>
#include <Wire.h>

class Battery {
 public:
  void begin(TwoWire& w, int adcPin, int statPin);
  void update();  // call ~1 Hz
  uint16_t mv = 0;
  uint8_t percent = 0;
  bool charging = false;
  bool gauge = false;

 private:
  uint16_t readReg(uint8_t reg);
  TwoWire* w_ = nullptr;
  int adc_ = -1, stat_ = -1;
  float filtered_ = -1;
};

// Open-circuit voltage curve for a 1S LiPo at light load (mV → %)
uint8_t lipoPercent(uint16_t mv);
