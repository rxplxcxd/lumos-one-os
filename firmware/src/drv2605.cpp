#include "drv2605.h"

static constexpr uint8_t ADDR = 0x5A;
static constexpr uint8_t STATUS = 0x00, MODE = 0x01, RTP_INPUT = 0x02, LIBRARY_SEL = 0x03, WAVESEQ1 = 0x04, WAVESEQ2 = 0x05, GO = 0x0C,
                         OVERDRIVE = 0x0D, SUSTAIN_POS = 0x0E, SUSTAIN_NEG = 0x0F, BRAKE = 0x10, RATED_VOLTAGE = 0x16, OD_CLAMP = 0x17,
                         A_CAL_COMP = 0x18, A_CAL_BEMF = 0x19, FEEDBACK = 0x1A, CONTROL1 = 0x1B, CONTROL2 = 0x1C, CONTROL3 = 0x1D, CONTROL4 = 0x1E;
static constexpr uint8_t MODE_INTERNAL = 0x00, MODE_RTP = 0x05, MODE_AUTOCAL = 0x07, MODE_STANDBY = 0x40;

void DRV2605::write(uint8_t reg, uint8_t v) {
  w_->beginTransmission(ADDR);
  w_->write(reg);
  w_->write(v);
  w_->endTransmission();
}

uint8_t DRV2605::read(uint8_t reg) {
  w_->beginTransmission(ADDR);
  w_->write(reg);
  w_->endTransmission(false);
  w_->requestFrom((int)ADDR, 1);
  return w_->available() ? w_->read() : 0;
}

bool DRV2605::begin(TwoWire& w, int enPin, float lraHz, float ratedV, float odClampV) {
  w_ = &w;
  pinMode(enPin, OUTPUT);
  digitalWrite(enPin, HIGH);
  delay(2);
  uint8_t id = read(STATUS) >> 5;  // DEVICE_ID: 7 = DRV2605L, 3 = DRV2605
  if (id != 7 && id != 3) return false;
  write(MODE, MODE_INTERNAL);  // leave standby
  // Datasheet (SLOS854) eq. 5/6 for LRA closed loop, sample time 300 µs:
  //   RATED_VOLTAGE = Vrms * sqrt(1 - (4*300µs + 300µs) * f) / 20.71 mV
  //   OD_CLAMP      = Vpeak / 21.22 mV
  float sampleTerm = 1.f - (4.f * 300e-6f + 300e-6f) * lraHz;
  if (sampleTerm < 0.05f) sampleTerm = 0.05f;
  ratedReg_ = (uint8_t)constrain(ratedV * sqrtf(sampleTerm) / 0.02071f, 0.f, 255.f);
  clampReg_ = (uint8_t)constrain(odClampV / 0.02122f, 0.f, 255.f);
  write(RATED_VOLTAGE, ratedReg_);
  write(OD_CLAMP, clampReg_);
  write(FEEDBACK, 0x80 | (3 << 4) | (1 << 2) | 2);  // LRA, brake factor 4x, loop gain medium, BEMF gain 2
  // DRIVE_TIME = (0.5 * period_ms - 0.5) / 0.1 ; startup boost on
  uint8_t driveTime = (uint8_t)constrain((0.5f * 1000.f / lraHz - 0.5f) / 0.1f, 0.f, 31.f);
  write(CONTROL1, 0x80 | driveTime);
  write(CONTROL2, 0xF5);  // bidirectional input, brake stabiliser, 300 µs sample, blanking/idiss defaults
  write(CONTROL3, 0xA0);  // closed-loop LRA, signed RTP data
  write(LIBRARY_SEL, 6);  // LRA effect library
  write(OVERDRIVE, 0);
  write(SUSTAIN_POS, 0);
  write(SUSTAIN_NEG, 0);
  write(BRAKE, 0);
  return true;
}

bool DRV2605::autoCalibrate(Calib& out) {
  write(MODE, MODE_AUTOCAL);
  write(CONTROL4, 0x20);  // AUTO_CAL_TIME = 500–700 ms
  write(GO, 1);
  uint32_t t0 = millis();
  while ((read(GO) & 1) && millis() - t0 < 2000) delay(5);
  bool ok = !(read(STATUS) & 0x08);  // DIAG_RESULT
  out = {read(A_CAL_COMP), read(A_CAL_BEMF), (uint8_t)(read(FEEDBACK) & 0x03), ok};
  write(MODE, MODE_INTERNAL);
  return ok;
}

void DRV2605::applyCalibration(const Calib& c) {
  if (!c.valid) return;
  write(A_CAL_COMP, c.comp);
  write(A_CAL_BEMF, c.bemf);
  write(FEEDBACK, (read(FEEDBACK) & 0xFC) | (c.gain & 0x03));
}

void DRV2605::setIntensity(float k) {
  k = constrain(k, 0.15f, 1.f);
  if (fabsf(k - intensity_) < 0.01f) return;
  intensity_ = k;
  // closed loop: scaling the rated voltage scales every ROM effect proportionally
  write(RATED_VOLTAGE, (uint8_t)(ratedReg_ * k));
  write(OD_CLAMP, (uint8_t)max<float>(clampReg_ * k, ratedReg_ * k));
}

void DRV2605::playEffect(uint8_t id) {
  write(MODE, MODE_INTERNAL);
  write(WAVESEQ1, id);
  write(WAVESEQ2, 0);
  write(GO, 1);
}

bool DRV2605::effectBusy() { return read(GO) & 1; }

void DRV2605::rtp(int8_t amp) {
  write(MODE, MODE_RTP);
  write(RTP_INPUT, (uint8_t)amp);
}

void DRV2605::rtpOff() {
  write(RTP_INPUT, 0);
  write(MODE, MODE_INTERNAL);
}
