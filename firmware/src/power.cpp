#include "power.h"

static constexpr uint8_t MAX17048 = 0x36, VCELL = 0x02, SOC = 0x04, VERSION = 0x08;

uint8_t lipoPercent(uint16_t mv) {
  static const uint16_t v[] = {3300, 3500, 3600, 3680, 3740, 3780, 3820, 3870, 3930, 4000, 4080, 4200};
  static const uint8_t p[] = {0, 3, 8, 15, 25, 35, 45, 55, 65, 77, 90, 100};
  if (mv <= v[0]) return 0;
  for (int i = 1; i < 12; i++)
    if (mv <= v[i]) return p[i - 1] + (uint8_t)((uint32_t)(mv - v[i - 1]) * (p[i] - p[i - 1]) / (v[i] - v[i - 1]));
  return 100;
}

uint16_t Battery::readReg(uint8_t reg) {
  w_->beginTransmission(MAX17048);
  w_->write(reg);
  if (w_->endTransmission(false) != 0) return 0xFFFF;
  if (w_->requestFrom((int)MAX17048, 2) != 2) return 0xFFFF;
  uint16_t hi = w_->read();
  return (hi << 8) | w_->read();
}

void Battery::begin(TwoWire& w, int adcPin, int statPin) {
  w_ = &w;
  adc_ = adcPin;
  stat_ = statPin;
  pinMode(stat_, INPUT_PULLUP);
  analogSetPinAttenuation(adc_, ADC_11db);
  uint16_t ver = readReg(VERSION);
  gauge = ver != 0xFFFF && (ver & 0xFFF0) == 0x0010;
  update();
}

void Battery::update() {
  charging = digitalRead(stat_) == LOW;
  if (gauge) {
    uint16_t vc = readReg(VCELL), soc = readReg(SOC);
    if (vc != 0xFFFF && soc != 0xFFFF) {
      mv = (uint16_t)((uint32_t)vc * 78125 / 1000000);  // 78.125 µV / LSB
      percent = (uint8_t)min<uint16_t>(100, soc >> 8);
      return;
    }
  }
  float raw = analogReadMilliVolts(adc_) * 2.0f;  // 1:2 divider
  filtered_ = filtered_ < 0 ? raw : filtered_ * 0.9f + raw * 0.1f;
  mv = (uint16_t)filtered_;
  percent = lipoPercent(mv);
}
