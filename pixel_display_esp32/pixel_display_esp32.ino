/*
    Based on Neil Kolban example for IDF: https://github.com/nkolban/esp32-snippets/blob/master/cpp_utils/tests/BLE%20Tests/SampleWrite.cpp
    Ported to Arduino ESP32 by Evandro Copercini
*/

#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <FastLED.h>
#include <Preferences.h>
#include <nvs_flash.h>

#define LED_PIN 22
#define COLOR_ORDER GRB
#define CHIPSET WS2812B
#define WIDTH 8
#define HEIGHT 8
#define NUM_LEDS 64
#define MAX_SAVES 4

Preferences preferences;

char *command;
char *commandValue = "";
int brightness = 50;
char save_slot[8];

CRGB matrix[WIDTH * HEIGHT];

#define BLE_NAME "PixelDisplay"
#define SERVICE_UUID "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID_WRITE "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CHARACTERISTIC_UUID_NOTIFY "e50fc8b7-42d6-4047-bc03-b2a92905d480"

BLEServer *pServer = NULL;
BLECharacteristic *pCharacteristicWrite = NULL;
BLECharacteristic *pCharacteristicNotify = NULL;
bool deviceConnected = false;
bool oldDeviceConnected = false;

CRGB hexStringToColor(const char *hexString) {
  uint32_t hexValue = strtol(hexString, nullptr, 16);
  return CRGB((hexValue >> 16) & 0xFF, (hexValue >> 8) & 0xFF, hexValue & 0xFF);
}

class MyServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) {
    deviceConnected = true;
    BLEDevice::startAdvertising();
    Serial.println("Connected to device");
  };

  void onDisconnect(BLEServer *pServer) {
    deviceConnected = false;
    Serial.println("Disconnected from device.");
  }
};

class MyCharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) {
    String value = pCharacteristic->getValue();
    if (value.length() > 0) {
      const char *v = value.c_str();
      command = strtok_r(const_cast<char *>(v), ",", &commandValue);
      if (isdigit(*command)) {
        CRGB c = hexStringToColor(commandValue);
        uint16_t i = atoi(command);
        matrix[i] = c;
      } else if (strcmp(command, "c") == 0) {
        clear_memory(commandValue);
      } else if (strcmp(command, "w") == 0) {
        write_to_mem(commandValue);
      } else if (strcmp(command, "s") == 0) {
        change_save_slot(commandValue);
      } else if (strcmp(command, "l") == 0) {
        send_stored_data(commandValue);
      } else if (strcmp(command, "b") == 0) {
        adjust_brightness(commandValue);
      } else if (strcmp(command, "d") == 0) {
        nvs_flash_erase(); // erase the NVS partition and...
        nvs_flash_init(); // initialize the NVS partition.
      }
    }
  }
};

void setup() {
  Serial.begin(115200);
  while (!Serial);

  FastLED.addLeds<CHIPSET, LED_PIN, COLOR_ORDER>(matrix, 64);
  FastLED.clear();
  FastLED.setBrightness(brightness);


  // Setup the saved settings.
  preferences.begin("settings", false);
  preferences.getInt("brightness", 50);
  preferences.getBytes("save_slot", save_slot, sizeof(save_slot));

  if (!preferences.isKey(save_slot)) {
    strcpy(save_slot, "0");
    preferences.putBytes("save_slot", save_slot, sizeof(save_slot));
    Serial.print("Updated save slot ");
    Serial.println(save_slot);
  }
  preferences.end();


  preferences.begin("data", false);  // Start preferences with a name
  if (preferences.getBytes(save_slot, &matrix, sizeof(matrix))) {
    Serial.println("Loaded successfully");
  } else {
    Serial.println("Error loading data!");
  }
  preferences.end();

  // Start BLE setup
  BLEDevice::init(BLE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristicWrite = pService->createCharacteristic(
    CHARACTERISTIC_UUID_WRITE,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_NOTIFY);

  pCharacteristicWrite->setCallbacks(new MyCharCallbacks());
  BLEDescriptor *pWriteDescriptor = new BLEDescriptor(CHARACTERISTIC_UUID_WRITE);
  pWriteDescriptor->setValue("Write Characteristic Description");
  pCharacteristicWrite->addDescriptor(pWriteDescriptor);

  pCharacteristicNotify = pService->createCharacteristic(
                    CHARACTERISTIC_UUID_NOTIFY,
                    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_INDICATE
                  );
  pCharacteristicNotify->addDescriptor(new BLE2902());

  pService->start();

  BLEAdvertising *pAdvertising = pServer->getAdvertising();
  pAdvertising->setScanResponse(false);
  pAdvertising->setMinPreferred(0x0);  // set value to 0x00 to not advertise this parameter
  BLEDevice::startAdvertising();
  Serial.println("Waiting a client connection to notify...");
}

uint16_t pos(uint16_t col, uint16_t row) {
  uint16_t x = (uint16_t)col;
  uint16_t y = (uint16_t)row;
  uint16_t i = 0;

  if (y & 0x01) {
    // Odd rows run backwards
    uint8_t reverseX = (WIDTH - 1) - x;
    i = (y * WIDTH) + reverseX;
  } else {
    // Even rows run forwards
    i = (y * WIDTH) + x;
  }
  return i;
}

void loop() {
  if (!deviceConnected && oldDeviceConnected) {
    delay(500);                   // give the bluetooth stack the chance to get things ready
    pServer->startAdvertising();  // restart advertising
    Serial.println("start advertising");
    oldDeviceConnected = deviceConnected;
  }
  // connecting
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = deviceConnected;
  }

  FastLED.show();
  FastLED.delay(1000);
}

void clear_memory(char *key) {
  for (int i = 0; i < NUM_LEDS; i++) {
    matrix[i] = CRGB::Black;
  }
  FastLED.clear();
  clear_key_data(key);
}

void write_to_mem(char *key) {
  preferences.begin("data", false);
  if (preferences.putBytes(key, &matrix, sizeof(matrix))) {
    Serial.print("Saved data to key ");
    Serial.println(key);
  } else {
    Serial.println("Error saving data!");
  }
  preferences.end();
}

void clear_key_data(char *key) {
  CRGB temp[WIDTH * HEIGHT];
  for (int i = 0; i < NUM_LEDS; i++) {
    temp[i] = CRGB::Black;
  }
  preferences.begin("data", false);  
  preferences.putBytes(key, &temp, sizeof(temp));
  preferences.end();
  Serial.print("Cleared data for key: ");
  Serial.println(key);
}

void load_stored_data(char *key) {
    preferences.begin("data", false);
    if (preferences.isKey(key)) {
      Serial.print("Loading data from ");
      Serial.println(key);
      preferences.getBytes(key, &matrix, sizeof(matrix));  
    } else {
      for (int i = 0; i < NUM_LEDS; i++) {
        matrix[i] = CRGB::Black;
      }
    }
    preferences.end();
}

void send_stored_data(char *key) {
    Serial.print("Stored data sent for key: ");
    Serial.println(key);
    CRGB temp[WIDTH * HEIGHT];
    preferences.begin("data", false);
    preferences.getBytes(key, &temp, sizeof(temp));  
    preferences.end();

    uint8_t byteArray[NUM_LEDS * 3];
    for (int i = 0; i < NUM_LEDS; i++) {
        byteArray[i * 3] = temp[i].r;
        byteArray[i * 3 + 1] = temp[i].g;
        byteArray[i * 3 + 2] = temp[i].b;
    }

    pCharacteristicNotify->setValue(byteArray, sizeof(byteArray));
    pCharacteristicNotify->notify();
    
}

void adjust_brightness(char *b) {
  int brightness = atoi(b);
  if (brightness > 255 || brightness < 0) {
    Serial.println("ERROR: Invalid brightness");
  } else {
    FastLED.setBrightness(brightness);
    preferences.begin("settings", false);
    preferences.putInt("brightness", brightness);  
    preferences.end();
  }
}

void change_save_slot(char *s) {
  int save_int = atoi(s);
  if (save_int > MAX_SAVES || save_int < 0) {
    Serial.println("ERROR: Invalid save slot");
  } else {
    preferences.begin("settings", false);
    preferences.putBytes("save_slot", s, sizeof(save_slot));  
    preferences.end();
    load_stored_data(s);
  }
}

void check_initialized() {
  preferences.begin("settings", false);

  for (int i; i < MAX_SAVES; i++) {

  }
}


