// Madgwick AHRS (S. Madgwick, 2010) — 6-axis IMU and 9-axis MARG update, portable C++.
// Gyro in rad/s, accel/mag in any consistent unit (normalised internally).
#pragma once
#include <math.h>

namespace lumos {

class Madgwick {
 public:
  float beta = 0.08f;
  float q0 = 1, q1 = 0, q2 = 0, q3 = 0;

  void reset() { q0 = 1; q1 = q2 = q3 = 0; }

  void updateIMU(float gx, float gy, float gz, float ax, float ay, float az, float dt) {
    float qDot1 = 0.5f * (-q1 * gx - q2 * gy - q3 * gz);
    float qDot2 = 0.5f * (q0 * gx + q2 * gz - q3 * gy);
    float qDot3 = 0.5f * (q0 * gy - q1 * gz + q3 * gx);
    float qDot4 = 0.5f * (q0 * gz + q1 * gy - q2 * gx);
    if (!(ax == 0.f && ay == 0.f && az == 0.f)) {
      float r = invSqrt(ax * ax + ay * ay + az * az);
      ax *= r; ay *= r; az *= r;
      float _2q0 = 2 * q0, _2q1 = 2 * q1, _2q2 = 2 * q2, _2q3 = 2 * q3;
      float _4q0 = 4 * q0, _4q1 = 4 * q1, _4q2 = 4 * q2, _8q1 = 8 * q1, _8q2 = 8 * q2;
      float q0q0 = q0 * q0, q1q1 = q1 * q1, q2q2 = q2 * q2, q3q3 = q3 * q3;
      float s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
      float s1 = _4q1 * q3q3 - _2q3 * ax + 4 * q0q0 * q1 - _2q0 * ay - _4q1 + _8q1 * q1q1 + _8q1 * q2q2 + _4q1 * az;
      float s2 = 4 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay - _4q2 + _8q2 * q1q1 + _8q2 * q2q2 + _4q2 * az;
      float s3 = 4 * q1q1 * q3 - _2q1 * ax + 4 * q2q2 * q3 - _2q2 * ay;
      float n = s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3;
      if (n > 0) {
        r = invSqrt(n);
        qDot1 -= beta * s0 * r; qDot2 -= beta * s1 * r; qDot3 -= beta * s2 * r; qDot4 -= beta * s3 * r;
      }
    }
    integrate(qDot1, qDot2, qDot3, qDot4, dt);
  }

  void update(float gx, float gy, float gz, float ax, float ay, float az, float mx, float my, float mz, float dt) {
    if (mx == 0.f && my == 0.f && mz == 0.f) return updateIMU(gx, gy, gz, ax, ay, az, dt);
    float qDot1 = 0.5f * (-q1 * gx - q2 * gy - q3 * gz);
    float qDot2 = 0.5f * (q0 * gx + q2 * gz - q3 * gy);
    float qDot3 = 0.5f * (q0 * gy - q1 * gz + q3 * gx);
    float qDot4 = 0.5f * (q0 * gz + q1 * gy - q2 * gx);
    if (!(ax == 0.f && ay == 0.f && az == 0.f)) {
      float r = invSqrt(ax * ax + ay * ay + az * az);
      ax *= r; ay *= r; az *= r;
      r = invSqrt(mx * mx + my * my + mz * mz);
      mx *= r; my *= r; mz *= r;
      float _2q0mx = 2 * q0 * mx, _2q0my = 2 * q0 * my, _2q0mz = 2 * q0 * mz, _2q1mx = 2 * q1 * mx;
      float _2q0 = 2 * q0, _2q1 = 2 * q1, _2q2 = 2 * q2, _2q3 = 2 * q3, _2q0q2 = 2 * q0 * q2, _2q2q3 = 2 * q2 * q3;
      float q0q0 = q0 * q0, q0q1 = q0 * q1, q0q2 = q0 * q2, q0q3 = q0 * q3, q1q1 = q1 * q1, q1q2 = q1 * q2, q1q3 = q1 * q3, q2q2 = q2 * q2, q2q3 = q2 * q3, q3q3 = q3 * q3;
      float hx = mx * q0q0 - _2q0my * q3 + _2q0mz * q2 + mx * q1q1 + _2q1 * my * q2 + _2q1 * mz * q3 - mx * q2q2 - mx * q3q3;
      float hy = _2q0mx * q3 + my * q0q0 - _2q0mz * q1 + _2q1mx * q2 - my * q1q1 + my * q2q2 + _2q2 * mz * q3 - my * q3q3;
      float _2bx = sqrtf(hx * hx + hy * hy);
      float _2bz = -_2q0mx * q2 + _2q0my * q1 + mz * q0q0 + _2q1mx * q3 - mz * q1q1 + _2q2 * my * q3 - mz * q2q2 + mz * q3q3;
      float _4bx = 2 * _2bx, _4bz = 2 * _2bz;
      float s0 = -_2q2 * (2 * q1q3 - _2q0q2 - ax) + _2q1 * (2 * q0q1 + _2q2q3 - ay) - _2bz * q2 * (_2bx * (0.5f - q2q2 - q3q3) + _2bz * (q1q3 - q0q2) - mx) + (-_2bx * q3 + _2bz * q1) * (_2bx * (q1q2 - q0q3) + _2bz * (q0q1 + q2q3) - my) + _2bx * q2 * (_2bx * (q0q2 + q1q3) + _2bz * (0.5f - q1q1 - q2q2) - mz);
      float s1 = _2q3 * (2 * q1q3 - _2q0q2 - ax) + _2q0 * (2 * q0q1 + _2q2q3 - ay) - 4 * q1 * (1 - 2 * q1q1 - 2 * q2q2 - az) + _2bz * q3 * (_2bx * (0.5f - q2q2 - q3q3) + _2bz * (q1q3 - q0q2) - mx) + (_2bx * q2 + _2bz * q0) * (_2bx * (q1q2 - q0q3) + _2bz * (q0q1 + q2q3) - my) + (_2bx * q3 - _4bz * q1) * (_2bx * (q0q2 + q1q3) + _2bz * (0.5f - q1q1 - q2q2) - mz);
      float s2 = -_2q0 * (2 * q1q3 - _2q0q2 - ax) + _2q3 * (2 * q0q1 + _2q2q3 - ay) - 4 * q2 * (1 - 2 * q1q1 - 2 * q2q2 - az) + (-_4bx * q2 - _2bz * q0) * (_2bx * (0.5f - q2q2 - q3q3) + _2bz * (q1q3 - q0q2) - mx) + (_2bx * q1 + _2bz * q3) * (_2bx * (q1q2 - q0q3) + _2bz * (q0q1 + q2q3) - my) + (_2bx * q0 - _4bz * q2) * (_2bx * (q0q2 + q1q3) + _2bz * (0.5f - q1q1 - q2q2) - mz);
      float s3 = _2q1 * (2 * q1q3 - _2q0q2 - ax) + _2q2 * (2 * q0q1 + _2q2q3 - ay) + (-_4bx * q3 + _2bz * q1) * (_2bx * (0.5f - q2q2 - q3q3) + _2bz * (q1q3 - q0q2) - mx) + (-_2bx * q0 + _2bz * q2) * (_2bx * (q1q2 - q0q3) + _2bz * (q0q1 + q2q3) - my) + _2bx * q1 * (_2bx * (q0q2 + q1q3) + _2bz * (0.5f - q1q1 - q2q2) - mz);
      float n = s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3;
      if (n > 0) {
        r = invSqrt(n);
        qDot1 -= beta * s0 * r; qDot2 -= beta * s1 * r; qDot3 -= beta * s2 * r; qDot4 -= beta * s3 * r;
      }
    }
    integrate(qDot1, qDot2, qDot3, qDot4, dt);
  }

  // Euler angles in degrees (same convention as lumosd.controllers.quat_to_euler)
  float pitch() const { float v = 2 * (q0 * q2 - q3 * q1); v = v > 1 ? 1 : v < -1 ? -1 : v; return asinf(v) * 57.29578f; }
  float roll() const { return atan2f(2 * (q0 * q1 + q2 * q3), 1 - 2 * (q1 * q1 + q2 * q2)) * 57.29578f; }

 private:
  void integrate(float d1, float d2, float d3, float d4, float dt) {
    q0 += d1 * dt; q1 += d2 * dt; q2 += d3 * dt; q3 += d4 * dt;
    float r = invSqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
    q0 *= r; q1 *= r; q2 *= r; q3 *= r;
  }
  static float invSqrt(float x) { return 1.0f / sqrtf(x); }
};

}  // namespace lumos
