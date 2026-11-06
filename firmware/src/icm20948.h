// Minimal register-level ICM-20948 driver (I²C): accel + gyro + AK09916 magnetometer via bypass.
#pragma once
#include <Arduino.h>
#include <Wire.h>

class ICM20948 {
 public:
  enum GyroFs : uint8_t { DPS250 = 0, DPS500 = 1, DPS1000 = 2, DPS2000 = 3 };
  enum AccelFs : uint8_t { G2 = 0, G4 = 1, G8 = 2, G16 = 3 };

  bool begin(TwoWire& w, uint8_t addr = 0x68);
  void configure(GyroFs gfs, AccelFs afs, uint16_t rateHz);
  bool read(float accelG[3], float gyroDps[3]);  // returns false on bus error
  bool readMag(float uT[3]);                     // returns true when a fresh sample was read
  float tempC();
  bool hasMag() const { return mag_; }

  float gyroBias[3] = {0, 0, 0};

 private:
  void bank(uint8_t b);
  void write(uint8_t reg, uint8_t v);
  uint8_t read8(uint8_t reg);
  bool readN(uint8_t reg, uint8_t* buf, size_t n);
  void magWrite(uint8_t reg, uint8_t v);
  bool magReadN(uint8_t reg, uint8_t* buf, size_t n);

  TwoWire* w_ = nullptr;
  uint8_t addr_ = 0x68, bank_ = 0xFF;
  float gScale_ = 1.f / 16.4f, aScale_ = 1.f / 4096.f;
  bool mag_ = false;
};
