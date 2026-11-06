// TI DRV2605L haptic driver in closed-loop LRA mode with auto-calibration (results cached in NVS).
#pragma once
#include <Arduino.h>
#include <Wire.h>

class DRV2605 {
 public:
  struct Calib {
    uint8_t comp, bemf, gain;
    bool valid;
  };
  // ratedV/odClampV: LRA rated RMS voltage and overdrive clamp (datasheet of the actuator)
  bool begin(TwoWire& w, int enPin, float lraHz = 170.f, float ratedV = 2.0f, float odClampV = 2.9f);
  bool autoCalibrate(Calib& out);
  void applyCalibration(const Calib& c);

  // HapticPlayer driver interface
  void playEffect(uint8_t id);
  bool effectBusy();
  void rtp(int8_t amp);
  void rtpOff();
  void setIntensity(float k);

 private:
  void write(uint8_t reg, uint8_t v);
  uint8_t read(uint8_t reg);
  TwoWire* w_ = nullptr;
  uint8_t ratedReg_ = 0x53, clampReg_ = 0x89;
  float intensity_ = 1.f;
};
