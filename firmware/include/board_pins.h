// Pin map for the Lumos Joy boards (ESP32-S3-MINI-1-N8). Left and right halves share one PCB;
// the side is selected at build time (-DLUMOS_SIDE_LEFT / -DLUMOS_SIDE_RIGHT) or by the SIDE strap.
#pragma once
#include <stdint.h>

namespace pins {
// I²C bus: ICM-20948 (0x68/0x69), DRV2605L (0x5A), MAX17048 (0x36)
constexpr int I2C_SDA = 15;
constexpr int I2C_SCL = 16;
constexpr uint32_t I2C_HZ = 400000;

// Hall-effect stick + trigger (ADC1 — usable while Wi-Fi/BLE radio is on)
constexpr int STICK_X = 4;
constexpr int STICK_Y = 5;
constexpr int TRIGGER = 6;
constexpr int VBAT_ADC = 7;  // 1:2 divider fallback when no MAX17048 is fitted
constexpr int STICK_TOUCH = 3;  // capacitive pad in the stick cap (touch channel 3)

// 11 buttons (active low, internal pull-ups); order == protocol bit order for this side
constexpr int BUTTONS[11] = {10, 11, 12, 13, 14, 17, 18, 21, 47, 48, 39};

constexpr int HAPTIC_EN = 2;      // DRV2605L EN
constexpr int CHARGE_STAT = 40;   // charger STAT (low = charging)
constexpr int POGO_DETECT = 42;   // pulled to GND by the handheld rail when attached
constexpr int STATUS_LED = 38;    // WS2812-2020 status LED
constexpr int SIDE_STRAP = 1;     // high = right half (if no build flag)
constexpr int POGO_UART_TX = 43;  // optional raw UART over pogo (-DLUMOS_POGO_UART)
constexpr int POGO_UART_RX = 44;
constexpr int HALL_DOCK = 9;      // chassis board only: dock magnet hall switch
}  // namespace pins
