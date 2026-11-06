#include "transport.h"

#include <NimBLEDevice.h>

#include "board_pins.h"

#ifdef LUMOS_POGO_UART
#define POGO_SERIAL Serial1
#else
#define POGO_SERIAL Serial  // native USB-CDC routed through the pogo pins (ARDUINO_USB_CDC_ON_BOOT=1)
#endif

static const char* SVC_UUID = "6c756d6f-7300-4a6f-7900-000000000001";
static const char* TX_UUID = "6c756d6f-7300-4a6f-7900-000000000002";  // notify  device → host
static const char* RX_UUID = "6c756d6f-7300-4a6f-7900-000000000003";  // write   host → device

static NimBLEServer* gServer = nullptr;
static NimBLECharacteristic* gTx = nullptr;
static Transport* gSelf = nullptr;
static lumos::FrameDecoder gBleRx;
static Transport::Handler gHandler = nullptr;
static volatile bool gBleConnected = false;

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    std::string v = c->getValue();
    for (char ch : v)
      if (gBleRx.push((uint8_t)ch) && gHandler) gHandler(gBleRx.type(), gBleRx.body(), gBleRx.bodyLen());
  }
};

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, ble_gap_conn_desc* desc) override {
    gBleConnected = true;
    // 7.5–15 ms connection interval for low-latency input
    s->updateConnParams(desc->conn_handle, 6, 12, 0, 200);
  }
  void onDisconnect(NimBLEServer*) override {
    gBleConnected = false;
    if (gSelf && !gSelf->pogo()) NimBLEDevice::startAdvertising();
  }
};

void Transport::begin(const char* bleName, Handler h) {
  name_ = bleName;
  handler_ = h;
  gHandler = h;
  gSelf = this;
  pinMode(pins::POGO_DETECT, INPUT_PULLUP);
#ifdef LUMOS_POGO_UART
  Serial1.begin(1000000, SERIAL_8N1, pins::POGO_UART_RX, pins::POGO_UART_TX);
#else
  Serial.begin(1000000);  // baud is ignored by USB-CDC
#endif
  NimBLEDevice::init(name_);
  NimBLEDevice::setPower(ESP_PWR_LVL_P6);
  NimBLEDevice::setMTU(247);
  gServer = NimBLEDevice::createServer();
  gServer->setCallbacks(new ServerCallbacks());
  NimBLEService* svc = gServer->createService(SVC_UUID);
  gTx = svc->createCharacteristic(TX_UUID, NIMBLE_PROPERTY::NOTIFY | NIMBLE_PROPERTY::READ);
  NimBLECharacteristic* rx = svc->createCharacteristic(RX_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  svc->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SVC_UUID);
  adv->setScanResponse(true);
  pogo_ = digitalRead(pins::POGO_DETECT) == LOW;
  if (!pogo_) startBle();
  changed_ = true;
}

void Transport::startBle() {
  if (bleOn_) return;
  NimBLEDevice::startAdvertising();
  bleOn_ = true;
}

void Transport::stopBle() {
  if (!bleOn_) return;
  NimBLEDevice::stopAdvertising();
  if (gServer)
    for (auto h : gServer->getPeerDevices()) gServer->disconnect(h);
  bleOn_ = false;
}

bool Transport::connected() const { return pogo_ ? (bool)POGO_SERIAL : gBleConnected; }

void Transport::update() {
  // debounced pogo detection (20 ms)
  bool now = digitalRead(pins::POGO_DETECT) == LOW;
  if (now != pogo_) {
    if (!detectT_) detectT_ = millis();
    else if (millis() - detectT_ > 20) {
      pogo_ = now;
      detectT_ = 0;
      changed_ = true;
      if (pogo_) stopBle();
      else startBle();
    }
  } else detectT_ = 0;

  if (pogo_) {
    while (POGO_SERIAL.available()) {
      if (rx_.push((uint8_t)POGO_SERIAL.read()) && handler_) handler_(rx_.type(), rx_.body(), rx_.bodyLen());
    }
  }
}

bool Transport::send(uint8_t type, const uint8_t* body, size_t len) {
  uint8_t frame[lumos::MAX_FRAME + 1];
  size_t n = lumos::buildFrame(type, seq_++, body, len, frame);
  if (pogo_) {
    if (POGO_SERIAL.availableForWrite() < (int)n) return false;  // never block the 1 kHz loop
    POGO_SERIAL.write(frame, n);
    return true;
  }
  if (!gBleConnected || !gTx) return false;
  gTx->setValue(frame, n);
  gTx->notify();
  return true;
}
