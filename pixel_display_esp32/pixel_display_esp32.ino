/*
    Based on Neil Kolban example for IDF: https://github.com/nkolban/esp32-snippets/blob/master/cpp_utils/tests/BLE%20Tests/SampleWrite.cpp
    Ported to Arduino ESP32 by Evandro Copercini
*/

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <FastLED.h>
#include <EEPROM.h>

#define LED_PIN 22
#define COLOR_ORDER GRB
#define CHIPSET WS2812B
#define BRIGHTNESS 64
#define WIDTH 8
#define HEIGHT 8
#define NUM_LEDS 64
#define FPS 60
#define EEPROM_SIZE NUM_LEDS * 3 + 1 // 3 bytes for each RGB color

char *led_id;
char *color = "";

CRGB matrix[WIDTH * HEIGHT];

#define BLE_NAME "PixelDisplay"
#define SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLEServer *pServer = NULL;
BLECharacteristic *pCharacteristic = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

CRGB hexStringToColor(const char *hexString)
{
  uint32_t hexValue = strtol(hexString, nullptr, 16);
  return CRGB((hexValue >> 16) & 0xFF, (hexValue >> 8) & 0xFF, hexValue & 0xFF);
}

class MyServerCallbacks : public BLEServerCallbacks
{
  void onConnect(BLEServer *pServer)
  {
    deviceConnected = true;
    BLEDevice::startAdvertising();
    Serial.println("Connected to device");
  };

  void onDisconnect(BLEServer *pServer)
  {
    deviceConnected = false;
    Serial.println("Disconnected from device.");
  }
};

class MyCharCallbacks : public BLECharacteristicCallbacks
{
  void onWrite(BLECharacteristic *pCharacteristic)
  {
    std::string value = pCharacteristic->getValue();

    if (value.length() > 0)
    {
      const char *v = value.c_str();
      led_id = strtok_r(const_cast<char *>(v), ",", &color);
      if (atoi(led_id) == -1)
      {
        FastLED.clear();
        FastLED.show();
        return;
      }
      CRGB c = hexStringToColor(color);
      uint16_t i = atoi(led_id);
      matrix[i] = c;
      EEPROM.write(i * 3, c.red);
      EEPROM.write(i * 3 + 1, c.green);
      EEPROM.write(i * 3 + 2, c.blue);
      EEPROM.write(EEPROM_SIZE, 0x11);
      EEPROM.commit();
    }
  }
};

void setup()
{
  Serial.begin(115200);
  delay(10);
  if (!EEPROM.begin(EEPROM_SIZE))
  {
    Serial.println("failed to initialise EEPROM");
    delay(1000);
  }
  FastLED.addLeds<CHIPSET, LED_PIN, COLOR_ORDER>(matrix, 64);
  FastLED.setBrightness(BRIGHTNESS);
  FastLED.clear();

  for (int i = 0; i < NUM_LEDS; i++)
  {
    matrix[i] = CRGB(EEPROM.read(i * 3), EEPROM.read(i * 3 + 1), EEPROM.read(i * 3 + 2));
  }

  FastLED.show();

  BLEDevice::init(BLE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ |
          BLECharacteristic::PROPERTY_WRITE |
          BLECharacteristic::PROPERTY_NOTIFY |
          BLECharacteristic::PROPERTY_INDICATE);

  pCharacteristic->setCallbacks(new MyCharCallbacks());

  pCharacteristic->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising *pAdvertising = pServer->getAdvertising();
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x0); // set value to 0x00 to not advertise this parameter
  BLEDevice::startAdvertising();
  Serial.println("Waiting a client connection to notify...");
}

uint16_t pos(uint16_t col, uint16_t row)
{
  uint16_t x = (uint16_t)col;
  uint16_t y = (uint16_t)row;
  uint16_t i = 0;

  if (y & 0x01)
  {
    // Odd rows run backwards
    uint8_t reverseX = (WIDTH - 1) - x;
    i = (y * WIDTH) + reverseX;
  }
  else
  {
    // Even rows run forwards
    i = (y * WIDTH) + x;
  }
  return i;
}

void loop()
{
  if (!deviceConnected && oldDeviceConnected)
  {
    delay(500);                  // give the bluetooth stack the chance to get things ready
    pServer->startAdvertising(); // restart advertising
    Serial.println("start advertising");
    oldDeviceConnected = deviceConnected;
  }
  // connecting
  if (deviceConnected && !oldDeviceConnected)
  {
    // do stuff here on connecting
    oldDeviceConnected = deviceConnected;
  }
  FastLED.show();
  FastLED.delay(1000 / FPS);
}