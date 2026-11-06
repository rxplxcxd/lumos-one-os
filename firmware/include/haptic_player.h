// Non-blocking haptic step sequencer (portable; driven by loop() with millis()).
// Driver interface:
//   void playEffect(uint8_t id); bool effectBusy(); void rtp(int8_t amp); void rtpOff(); void setIntensity(float);
#pragma once
#include "lumos_protocol.h"

namespace lumos {

template <typename Driver>
class HapticPlayer {
 public:
  explicit HapticPlayer(Driver& d) : drv_(d) {}

  void play(const HapticProgram& p) {
    if (active_ && inRtp_) drv_.rtpOff();
    prog_ = p;
    idx_ = 0;
    active_ = prog_.count > 0;
    started_ = false;
    inRtp_ = false;
    drv_.setIntensity(prog_.intensity / 255.0f);
  }

  bool active() const { return active_; }

  void update(uint32_t nowMs) {
    if (!active_) return;
    while (idx_ < prog_.count) {
      const HapticStep& s = prog_.steps[idx_];
      if (!started_) {
        started_ = true;
        t0_ = nowMs;
        if (s.kind == HAPTIC_EFFECT) {
          if (inRtp_) { drv_.rtpOff(); inRtp_ = false; }
          drv_.playEffect(s.value);
        } else if (s.kind == HAPTIC_RTP) {
          int amp = (int)(s.value * (prog_.intensity / 255.0f) + 0.5f);
          drv_.rtp((int8_t)(amp > 127 ? 127 : amp));
          inRtp_ = true;
        } else if (inRtp_) {
          drv_.rtpOff();
          inRtp_ = false;
        }
      }
      bool done;
      if (s.kind == HAPTIC_EFFECT) done = !drv_.effectBusy() || nowMs - t0_ > 600;  // ROM effects are < 600 ms
      else done = nowMs - t0_ >= s.ms;
      if (!done) return;
      idx_++;
      started_ = false;
    }
    if (inRtp_) { drv_.rtpOff(); inRtp_ = false; }
    active_ = false;
  }

 private:
  Driver& drv_;
  HapticProgram prog_;
  uint8_t idx_ = 0;
  bool active_ = false, started_ = false, inRtp_ = false;
  uint32_t t0_ = 0;
};

}  // namespace lumos
