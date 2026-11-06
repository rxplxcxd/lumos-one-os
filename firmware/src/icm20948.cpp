#include "icm20948.h"

// Bank 0
static constexpr uint8_t WHO_AM_I = 0x00, USER_CTRL = 0x03, PWR_MGMT_1 = 0x06, PWR_MGMT_2 = 0x07, INT_PIN_CFG = 0x0F, ACCEL_XOUT_H = 0x2D, TEMP_OUT_H = 0x39, REG_BANK_SEL = 0x7F;
// Bank 2
static constexpr uint8_t GYRO_SMPLRT_DIV = 0x00, GYRO_CONFIG_1 = 0x01, ACCEL_SMPLRT_DIV_1 = 0x10, ACCEL_SMPLRT_DIV_2 = 0x11, ACCEL_CONFIG = 0x14;
// AK09916
static constexpr uint8_t AK_ADDR = 0x0C, AK_WIA2 = 0x01, AK_ST1 = 0x10, AK_HXL = 0x11, AK_CNTL2 = 0x31, AK_CNTL3 = 0x32;

void ICM20948::bank(uint8_t b) {
  if (b == bank_) return;
  w_->beginTransmission(addr_);
  w_->write(REG_BANK_SEL);
  w_->write(b << 4);
  w_->endTransmission();
  bank_ = b;
}

void ICM20948::write(uint8_t reg, uint8_t v) {
  w_->beginTransmission(addr_);
  w_->write(reg);
  w_->write(v);
  w_->endTransmission();
}

uint8_t ICM20948::read8(uint8_t reg) {
  uint8_t v = 0;
  readN(reg, &v, 1);
  return v;
}

bool ICM20948::readN(uint8_t reg, uint8_t* buf, size_t n) {
  w_->beginTransmission(addr_);
  w_->write(reg);
  if (w_->endTransmission(false) != 0) return false;
  if (w_->requestFrom((int)addr_, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = w_->read();
  return true;
}

void ICM20948::magWrite(uint8_t reg, uint8_t v) {
  w_->beginTransmission(AK_ADDR);
  w_->write(reg);
  w_->write(v);
  w_->endTransmission();
}

bool ICM20948::magReadN(uint8_t reg, uint8_t* buf, size_t n) {
  w_->beginTransmission(AK_ADDR);
  w_->write(reg);
  if (w_->endTransmission(false) != 0) return false;
  if (w_->requestFrom((int)AK_ADDR, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) buf[i] = w_->read();
  return true;
}

bool ICM20948::begin(TwoWire& w, uint8_t addr) {
  w_ = &w;
  addr_ = addr;
  bank_ = 0xFF;
  bank(0);
  if (read8(WHO_AM_I) != 0xEA) {
    addr_ = addr == 0x68 ? 0x69 : 0x68;  // AD0 strap may differ between board revisions
    bank_ = 0xFF;
    bank(0);
    if (read8(WHO_AM_I) != 0xEA) return false;
  }
  write(PWR_MGMT_1, 0x80);  // device reset
  delay(100);
  bank_ = 0xFF;
  bank(0);
  write(PWR_MGMT_1, 0x01);  // auto-select best clock, wake
  delay(20);
  write(PWR_MGMT_2, 0x00);  // accel + gyro on
  // magnetometer through I²C bypass (I2C_MST_EN = 0, BYPASS_EN = 1)
  write(USER_CTRL, 0x00);
  write(INT_PIN_CFG, 0x02);
  delay(5);
  uint8_t wia = 0;
  if (magReadN(AK_WIA2, &wia, 1) && wia == 0x09) {
    magWrite(AK_CNTL3, 0x01);  // soft reset
    delay(10);
    magWrite(AK_CNTL2, 0x08);  // continuous mode 4: 100 Hz
    mag_ = true;
  }
  configure(DPS2000, G8, 1000);
  return true;
}

void ICM20948::configure(GyroFs gfs, AccelFs afs, uint16_t rateHz) {
  static const float gLsb[] = {131.f, 65.5f, 32.8f, 16.4f};
  static const float aLsb[] = {16384.f, 8192.f, 4096.f, 2048.f};
  gScale_ = 1.f / gLsb[gfs & 3];
  aScale_ = 1.f / aLsb[afs & 3];
  if (rateHz < 10) rateHz = 10;
  if (rateHz > 1125) rateHz = 1125;
  uint16_t div = (uint16_t)(1125 / rateHz) - 1;
  bank(2);
  write(GYRO_SMPLRT_DIV, (uint8_t)div);
  write(GYRO_CONFIG_1, (uint8_t)((1 << 3) | ((gfs & 3) << 1) | 0x01));  // DLPFCFG=1 (~152 Hz), FCHOICE=1
  write(ACCEL_SMPLRT_DIV_1, (uint8_t)(div >> 8));
  write(ACCEL_SMPLRT_DIV_2, (uint8_t)(div & 0xFF));
  write(ACCEL_CONFIG, (uint8_t)((1 << 3) | ((afs & 3) << 1) | 0x01));
  bank(0);
}

bool ICM20948::read(float a[3], float g[3]) {
  uint8_t b[12];
  bank(0);
  if (!readN(ACCEL_XOUT_H, b, 12)) return false;
  for (int i = 0; i < 3; i++) {
    a[i] = (int16_t)((b[i * 2] << 8) | b[i * 2 + 1]) * aScale_;
    g[i] = (int16_t)((b[6 + i * 2] << 8) | b[6 + i * 2 + 1]) * gScale_ - gyroBias[i];
  }
  return true;
}

bool ICM20948::readMag(float uT[3]) {
  if (!mag_) return false;
  uint8_t st1 = 0;
  if (!magReadN(AK_ST1, &st1, 1) || !(st1 & 0x01)) return false;
  uint8_t b[8];  // HXL..HZH, TMPS, ST2 (reading ST2 releases the data lock)
  if (!magReadN(AK_HXL, b, 8)) return false;
  if (b[7] & 0x08) return false;  // magnetic overflow
  for (int i = 0; i < 3; i++) uT[i] = (int16_t)(b[i * 2] | (b[i * 2 + 1] << 8)) * 0.15f;
  // align magnetometer axes with accel/gyro frame (AK09916: X=X, Y=-Y, Z=-Z)
  uT[1] = -uT[1];
  uT[2] = -uT[2];
  return true;
}

float ICM20948::tempC() {
  uint8_t b[2];
  bank(0);
  if (!readN(TEMP_OUT_H, b, 2)) return NAN;
  return (int16_t)((b[0] << 8) | b[1]) / 333.87f + 21.f;
}
