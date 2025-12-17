/*
 * ESP32 Nutrient Controller
 * Two-way MQTT communication with reTerminal
 * 
 * Hardware:
 *   - ESP32 DevKit
 *   - Atlas Scientific pH, EC, RTD sensors (I2C)
 *   - 4x peristaltic pumps (pH Up, pH Down, Nutrient A, Nutrient B)
 *   - 1x mixing pump
 *   - Flow sensor (pulse counter)
 * 
 * Topics:
 *   Publish:
 *     - sensors/nutrient/reading (every 5s)
 *     - sensors/nutrient/pump (on dose complete)
 *     - sensors/nutrient/flow (during dosing)
 *     - sensors/nutrient/status (every 60s)
 *   Subscribe:
 *     - sensors/nutrient/command/dose
 *     - sensors/nutrient/command/dose_ratio
 *     - sensors/nutrient/command/cal
 *     - sensors/nutrient/command/pump_cal
 *     - sensors/nutrient/command/mix
 */

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Preferences.h>

// ===== CONFIGURATION (EDIT THESE) =====
const char* WIFI_SSID = "YOUR_WIFI_SSID";              // TODO: update before deploying
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";      // TODO: update before deploying
const char* MQTT_SERVER = "192.168.2.42";              // reTerminal IP or broker host
const int MQTT_PORT = 1883;
const char* MQTT_CLIENT_ID = "esp32-nutrient-001";

// I2C Configuration
#define SDA_PIN 23  // Match ESP-IDF reference
#define SCL_PIN 22  // Match ESP-IDF reference

// Atlas Scientific I2C Addresses
#define ATLAS_PH_ADDR  0x63
#define ATLAS_EC_ADDR  0x64
#define ATLAS_RTD_ADDR 0x66

// Sensor Power Enable Pins (from ESP-IDF reference)
#define EN_RTD 15  // RTD sensor power enable
#define EN_PH  12  // pH sensor power enable
#define EN_EC  27  // EC sensor power enable

// Pump GPIO Pins (PWM capable pins)
#define PUMP_PH_UP     25
#define PUMP_PH_DOWN   26
#define PUMP_NUTRIENT_A 27
#define PUMP_NUTRIENT_B 14
#define PUMP_MIXING    12

// Flow Sensor Pin (interrupt capable)
#define FLOW_SENSOR_PIN 35

// Flow Sensor Calibration
#define PULSES_PER_ML 25.0

// Timing
#define READING_INTERVAL_MS  5000   // 5 seconds
#define STATUS_INTERVAL_MS   60000  // 60 seconds
#define SENSOR_WARMUP_MS     1000   // Wait for sensor to stabilize

// Safety Limits
#define MAX_DOSE_ML          50.0   // Maximum single dose
#define MIN_DOSE_INTERVAL_MS 30000  // 30 seconds between doses
#define MAX_PUMP_DURATION_MS 30000  // 30 second timeout

// ===== GLOBAL OBJECTS =====
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);
Preferences pumpPreferences;

// ===== GLOBAL STATE =====
unsigned long lastReadingTime = 0;
unsigned long lastStatusTime = 0;
volatile unsigned long flowPulseCount = 0;

struct PumpConfig {
  const char* name;
  int pin;
  float defaultMlPerSec;
  float mlPerSec;
  unsigned long lastDoseMillis;
};

PumpConfig pumpConfigs[] = {
  {"phUp", PUMP_PH_UP, 2.0f, 2.0f, 0},
  {"phDown", PUMP_PH_DOWN, 2.0f, 2.0f, 0},
  {"nutrientA", PUMP_NUTRIENT_A, 3.0f, 3.0f, 0},
  {"nutrientB", PUMP_NUTRIENT_B, 3.0f, 3.0f, 0}
};

const size_t PUMP_COUNT = sizeof(pumpConfigs) / sizeof(PumpConfig);

struct SensorData {
  float pH;
  float ec;
  float temperature;
  bool valid;
};

SensorData currentSensors = {0.0, 0.0, 0.0, false};

// ===== FORWARD DECLARATIONS =====
void setupWiFi();
void setupMQTT();
void reconnectMQTT();
void mqttCallback(char* topic, byte* payload, unsigned int length);
void readSensors();
float readAtlasSensor(uint8_t address, const char* cmd = "R");
void publishReading();
void publishStatus();
PumpConfig* getPumpConfig(const String& pumpName);
void loadPumpCalibrations();
void executeDoseCommand(JsonDocument& doc);
void executeDoseRatioCommand(JsonDocument& doc);
void executeCalCommand(JsonDocument& doc);
void executePumpCalCommand(JsonDocument& doc);
void executeMixCommand(JsonDocument& doc);
void executeStopCommand(JsonDocument& doc);
void executeRequestStatusCommand(JsonDocument& doc);
void runPump(PumpConfig& pump, float ml, unsigned long overrideDurationMs = 0);
void IRAM_ATTR flowSensorISR();

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n=== ESP32 Nutrient Controller ===");
  Serial.println("Version: 1.0");
  Serial.println("Starting...\n");
  
  // Initialize sensor power enable pins
  Serial.println("Enabling sensor power...");
  pinMode(EN_RTD, OUTPUT);
  pinMode(EN_PH, OUTPUT);
  pinMode(EN_EC, OUTPUT);
  
  digitalWrite(EN_RTD, HIGH);  // Power on RTD sensor
  digitalWrite(EN_PH, HIGH);   // Power on pH sensor
  digitalWrite(EN_EC, HIGH);   // Power on EC sensor
  
  delay(100);  // Allow sensor power to stabilize
  Serial.println("✓ Sensor power enabled");
  
  // Initialize I2C with explicit pins
  Serial.printf("Initializing I2C on SDA=%d, SCL=%d\n", SDA_PIN, SCL_PIN);
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);  // 400kHz to match ESP-IDF reference
  delay(100);
  Serial.println("✓ I2C initialized");
  
  // Scan I2C bus for devices
  Serial.println("\nScanning I2C bus...");
  byte deviceCount = 0;
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    byte error = Wire.endTransmission(true);  // Send stop bit
    
    if (error == 0) {
      Serial.printf("  ✓ Found device at 0x%02X", addr);
      
      // Identify known devices
      if (addr == ATLAS_PH_ADDR) {
        Serial.print(" (Atlas pH)");
      } else if (addr == ATLAS_EC_ADDR) {
        Serial.print(" (Atlas EC)");
      } else if (addr == ATLAS_RTD_ADDR) {
        Serial.print(" (Atlas RTD)");
      } else {
        Serial.print(" (Unknown)");
      }
      Serial.println();
      deviceCount++;
    } else if (error == 2) {
      // Address was NACKed - device not present (expected, don't log)
    } else {
      // Other error (timeout, bus error, etc.)
      Serial.printf("  ✗ Error %d at 0x%02X\n", error, addr);
    }
    delay(5);  // Small delay between scans
  }
  
  if (deviceCount == 0) {
    Serial.println("\n⚠ WARNING: No I2C devices found!");
    Serial.println("Expected Atlas sensors at:");
    Serial.printf("  pH:  0x%02X (99)\n", ATLAS_PH_ADDR);
    Serial.printf("  EC:  0x%02X (100)\n", ATLAS_EC_ADDR);
    Serial.printf("  RTD: 0x%02X (102)\n", ATLAS_RTD_ADDR);
    Serial.println("\nTroubleshooting:");
    Serial.println("  1. Check sensor power (LED should be on)");
    Serial.println("  2. Verify I2C wiring (SDA/SCL/GND)");
    Serial.println("  3. Check pull-up resistors (4.7kΩ recommended)");
    Serial.println("  4. Verify sensor is in I2C mode (not UART)");
  } else {
    Serial.printf("\n✓ Found %d I2C device(s)\n", deviceCount);
  }
  Serial.println();
  
  // Initialize pump pins
  pinMode(PUMP_PH_UP, OUTPUT);
  pinMode(PUMP_PH_DOWN, OUTPUT);
  pinMode(PUMP_NUTRIENT_A, OUTPUT);
  pinMode(PUMP_NUTRIENT_B, OUTPUT);
  pinMode(PUMP_MIXING, OUTPUT);
  
  digitalWrite(PUMP_PH_UP, LOW);
  digitalWrite(PUMP_PH_DOWN, LOW);
  digitalWrite(PUMP_NUTRIENT_A, LOW);
  digitalWrite(PUMP_NUTRIENT_B, LOW);
  digitalWrite(PUMP_MIXING, LOW);
  
  Serial.println("✓ Pump pins configured");

  // Load persisted pump calibration data
  if (pumpPreferences.begin("nutrient", false)) {
    loadPumpCalibrations();
  } else {
    Serial.println("✗ Failed to open pump calibration storage; using defaults");
  }
  
  // Initialize flow sensor
  pinMode(FLOW_SENSOR_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(FLOW_SENSOR_PIN), flowSensorISR, FALLING);
  Serial.println("✓ Flow sensor attached");
  
  // Connect to WiFi
  setupWiFi();
  
  // Connect to MQTT
  setupMQTT();
  
  Serial.println("\n=== System Ready ===\n");
}

// ===== MAIN LOOP =====
void loop() {
  // Maintain MQTT connection
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();
  
  unsigned long now = millis();
  
  // Periodic sensor reading and publishing
  if (now - lastReadingTime >= READING_INTERVAL_MS) {
    lastReadingTime = now;
    readSensors();
    publishReading();
  }
  
  // Periodic status publishing
  if (now - lastStatusTime >= STATUS_INTERVAL_MS) {
    lastStatusTime = now;
    publishStatus();
  }
}

// ===== WiFi SETUP =====
void setupWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ WiFi connected");
    Serial.print("  IP address: ");
    Serial.println(WiFi.localIP());
    Serial.print("  RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("\n✗ WiFi connection failed!");
    Serial.println("  Check SSID and password");
  }
}

// ===== MQTT SETUP =====
void setupMQTT() {
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setKeepAlive(60);
  mqttClient.setBufferSize(512);
  
  reconnectMQTT();
}

void reconnectMQTT() {
  while (!mqttClient.connected()) {
    Serial.print("Connecting to MQTT broker: ");
    Serial.println(MQTT_SERVER);
    
    if (mqttClient.connect(MQTT_CLIENT_ID)) {
      Serial.println("✓ MQTT connected");
      
      // Subscribe to command topics
    mqttClient.subscribe("sensors/nutrient/command/dose");
    mqttClient.subscribe("sensors/nutrient/command/dose_ratio");
    mqttClient.subscribe("sensors/nutrient/command/cal");
    mqttClient.subscribe("sensors/nutrient/command/mix");
    mqttClient.subscribe("sensors/nutrient/command/pump_cal");
    mqttClient.subscribe("sensors/nutrient/command/stop");
    mqttClient.subscribe("sensors/nutrient/command/request_status");
      
      Serial.println("✓ Subscribed to command topics");
    } else {
      Serial.print("✗ MQTT connection failed, rc=");
      Serial.println(mqttClient.state());
      Serial.println("  Retrying in 5 seconds...");
      delay(5000);
    }
  }
}

// ===== MQTT CALLBACK =====
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("← Message received: ");
  Serial.println(topic);
  
  // Parse JSON payload
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, payload, length);
  
  if (error) {
    Serial.print("✗ JSON parsing failed: ");
    Serial.println(error.c_str());
    return;
  }
  
  // Route to appropriate handler
  String topicStr = String(topic);
  
  if (topicStr.endsWith("/dose")) {
    executeDoseCommand(doc);
  } else if (topicStr.endsWith("/dose_ratio")) {
    executeDoseRatioCommand(doc);
  } else if (topicStr.endsWith("/cal")) {
    executeCalCommand(doc);
  } else if (topicStr.endsWith("/mix")) {
    executeMixCommand(doc);
  } else if (topicStr.endsWith("/pump_cal")) {
    executePumpCalCommand(doc);
  } else if (topicStr.endsWith("/stop")) {
    executeStopCommand(doc);
  } else if (topicStr.endsWith("/request_status")) {
    executeRequestStatusCommand(doc);
  } else {
    Serial.println("✗ Unknown command topic");
  }
}

// ===== SENSOR READING =====
void readSensors() {
  Serial.println("Reading sensors...");
  
  // Read RTD first for temperature compensation
  currentSensors.temperature = readAtlasSensor(ATLAS_RTD_ADDR, "R");
  delay(100);
  
  // Send temperature compensation to pH and EC sensors
  if (currentSensors.temperature > 0) {
    char tempCmd[16];
    snprintf(tempCmd, sizeof(tempCmd), "T,%.2f", currentSensors.temperature);
    
    // Send temp comp to pH
    Wire.beginTransmission(ATLAS_PH_ADDR);
    Wire.write(tempCmd);
    Wire.endTransmission();
    delay(300);
    
    // Send temp comp to EC
    Wire.beginTransmission(ATLAS_EC_ADDR);
    Wire.write(tempCmd);
    Wire.endTransmission();
    delay(300);
  }
  
  // Read pH
  currentSensors.pH = readAtlasSensor(ATLAS_PH_ADDR, "R");
  delay(100);
  
  // Read EC
  currentSensors.ec = readAtlasSensor(ATLAS_EC_ADDR, "R");
  delay(100);
  
  currentSensors.valid = (currentSensors.pH > 0 && currentSensors.ec > 0 && currentSensors.temperature > 0);
  
  Serial.print("  pH: ");
  Serial.print(currentSensors.pH, 2);
  Serial.print("  EC: ");
  Serial.print(currentSensors.ec, 0);
  Serial.print("  Temp: ");
  Serial.print(currentSensors.temperature, 1);
  Serial.println("°C");
}

float readAtlasSensor(uint8_t address, const char* cmd) {
  // Send command
  Wire.beginTransmission(address);
  Wire.write((const uint8_t*)cmd, strlen(cmd));
  byte error = Wire.endTransmission();
  
  if (error != 0) {
    Serial.printf("✗ Sensor 0x%02X: transmission error %d\n", address, error);
    return -1.0;
  }
  
  delay(SENSOR_WARMUP_MS);
  
  // Request response (max 40 bytes for Atlas sensors)
  Wire.requestFrom(address, (uint8_t)40);
  
  if (!Wire.available()) {
    Serial.printf("✗ Sensor 0x%02X: no data available\n", address);
    return -1.0;
  }
  
  // First byte is status code
  byte statusCode = Wire.read();
  
  if (statusCode != 1) {  // 1 = success, 2 = processing, 254 = no data, 255 = error
    Serial.printf("✗ Sensor 0x%02X: status code %d\n", address, statusCode);
    return -1.0;
  }
  
  // Read ASCII response
  String dataString = "";
  while (Wire.available()) {
    char c = Wire.read();
    if (c == '\0' || c == '\r' || c == '\n') break;
    dataString += c;
  }
  
  if (dataString.length() == 0) {
    Serial.printf("✗ Sensor 0x%02X: empty response\n", address);
    return -1.0;
  }
  
  float value = dataString.toFloat();
  Serial.printf("✓ Sensor 0x%02X: %.2f\n", address, value);
  return value;
}

// ===== PUBLISHING =====
void publishReading() {
  if (!currentSensors.valid) {
    Serial.println("✗ Skipping publish - invalid sensor data");
    return;
  }
  
  StaticJsonDocument<256> doc;
  doc["timestamp"] = millis();
  doc["pH"] = roundf(currentSensors.pH * 100) / 100.0;
  doc["ec"] = roundf(currentSensors.ec);
  doc["temperature"] = roundf(currentSensors.temperature * 10) / 10.0;
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  if (mqttClient.publish("sensors/nutrient/reading", buffer)) {
    Serial.println("→ Published sensor reading");
  } else {
    Serial.println("✗ Failed to publish reading");
  }
}

void publishStatus() {
  StaticJsonDocument<256> doc;
  doc["timestamp"] = millis();
  doc["uptime_s"] = millis() / 1000;
  doc["wifi_rssi"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  
  char buffer[256];
  serializeJson(doc, buffer);
  
  if (mqttClient.publish("sensors/nutrient/status", buffer)) {
    Serial.println("→ Published system status");
  } else {
    Serial.println("✗ Failed to publish status");
  }
}

void loadPumpCalibrations() {
  Serial.println("Loading pump calibration data...");
  for (size_t i = 0; i < PUMP_COUNT; ++i) {
    PumpConfig& pump = pumpConfigs[i];
    float stored = pumpPreferences.getFloat(pump.name, pump.defaultMlPerSec);
    if (stored <= 0.0f || stored > 20.0f) {
      pump.mlPerSec = pump.defaultMlPerSec;
      Serial.printf("  %s: invalid stored value %.2f, using default %.2f\n",
                    pump.name, stored, pump.defaultMlPerSec);
      continue;
    }
    pump.mlPerSec = stored;
    Serial.printf("  %s: %.2f ml/s\n", pump.name, pump.mlPerSec);
  }
  Serial.println("✓ Pump calibration ready");
}

PumpConfig* getPumpConfig(const String& pumpName) {
  for (size_t i = 0; i < PUMP_COUNT; ++i) {
    PumpConfig& pump = pumpConfigs[i];
    if (pumpName.equalsIgnoreCase(pump.name)) {
      return &pump;
    }
  }
  return nullptr;
}

// ===== COMMAND EXECUTION =====
void executeDoseCommand(JsonDocument& doc) {
  String pumpName = doc["pump"] | "";
  float ml = doc["ml"] | 0.0;
  unsigned long durationOverrideMs = doc["duration_ms"] | 0UL;

  if (durationOverrideMs == 0) {
    float durationSeconds = doc["duration_sec"] | doc["durationSec"] | doc["duration_seconds"] | doc["duration"] | doc["seconds"] | 0.0f;
    if (durationSeconds > 0.0f) {
      durationOverrideMs = static_cast<unsigned long>(durationSeconds * 1000.0f);
    }
  }
  
  Serial.print("→ Dose command: ");
  Serial.print(pumpName);
  Serial.print(" ");
  Serial.print(ml);
  Serial.print("ml");
  if (durationOverrideMs > 0) {
    Serial.print(" (override ");
    Serial.print(durationOverrideMs);
    Serial.println("ms)");
  } else {
    Serial.println("ml");
  }
  
  // Safety checks
  if ((ml <= 0.0f) && durationOverrideMs == 0) {
    Serial.println("✗ Invalid dose volume");
    return;
  }
  if (ml > MAX_DOSE_ML) {
    Serial.println("✗ Dose volume exceeds limit");
    return;
  }
  
  PumpConfig* pump = getPumpConfig(pumpName);
  if (pump == nullptr) {
    Serial.println("✗ Unknown pump");
    return;
  }

  unsigned long now = millis();
  if (now - pump->lastDoseMillis < MIN_DOSE_INTERVAL_MS) {
    Serial.println("✗ Pump recently dosed; waiting for cooldown");
    return;
  }

  if (pump->mlPerSec <= 0.0f) {
    Serial.println("✗ Pump calibration invalid; using default");
    pump->mlPerSec = pump->defaultMlPerSec;
  }
  
  runPump(*pump, ml, durationOverrideMs);
}

void executeDoseRatioCommand(JsonDocument& doc) {
  float totalMl = doc["total_ml"] | 0.0f;
  JsonObject ratios = doc["ratios"].as<JsonObject>();

  Serial.print("→ Dose ratio command: total=");
  Serial.print(totalMl);
  Serial.println("ml");

  if (totalMl <= 0.0f) {
    Serial.println("✗ Invalid total volume for ratio dosing");
    return;
  }

  if (ratios.isNull()) {
    Serial.println("✗ Missing ratios object");
    return;
  }

  PumpConfig* selectedPumps[PUMP_COUNT] = {nullptr};
  float ratioValues[PUMP_COUNT] = {0};
  size_t pumpCounter = 0;
  float ratioSum = 0.0f;

  for (JsonPair kv : ratios) {
    if (pumpCounter >= PUMP_COUNT) {
      Serial.println("⚠ Too many pumps specified; ignoring extras");
      break;
    }

    String pumpKey = kv.key().c_str();
    float value = kv.value().as<float>();

    if (value <= 0.0f) {
      Serial.printf("  ⚠ Ignoring non-positive ratio for %s\n", pumpKey.c_str());
      continue;
    }

    PumpConfig* pump = getPumpConfig(pumpKey);
    if (pump == nullptr) {
      Serial.printf("  ⚠ Unknown pump '%s' in ratio request\n", pumpKey.c_str());
      continue;
    }

    selectedPumps[pumpCounter] = pump;
    ratioValues[pumpCounter] = value;
    ratioSum += value;
    pumpCounter++;
  }

  if (pumpCounter == 0 || ratioSum <= 0.0f) {
    Serial.println("✗ No valid pump ratios supplied");
    return;
  }

  unsigned long now = millis();
  bool executedAny = false;

  for (size_t i = 0; i < pumpCounter; ++i) {
    PumpConfig* pump = selectedPumps[i];
    float shareMl = totalMl * (ratioValues[i] / ratioSum);

    if (shareMl <= 0.0f || shareMl > MAX_DOSE_ML) {
      Serial.printf("  ⚠ Skipping %s due to invalid share %.2f ml\n", pump->name, shareMl);
      continue;
    }

    if (now - pump->lastDoseMillis < MIN_DOSE_INTERVAL_MS) {
      Serial.printf("  ⚠ %s still in cooldown window\n", pump->name);
      continue;
    }

    Serial.printf("  → %s allocated %.2f ml (ratio %.2f)\n", pump->name, shareMl, ratioValues[i]);
    runPump(*pump, shareMl);
    executedAny = true;
  }

  if (!executedAny) {
    Serial.println("✗ Ratio dosing skipped for all pumps");
  }
}

void executeCalCommand(JsonDocument& doc) {
  String sensor = doc["sensor"] | "";
  String mode = doc["mode"] | "";
  JsonVariant valueVariant = doc["value"];
  float customValue = NAN;
  bool hasCustomValue = false;
  if (!valueVariant.isNull()) {
    customValue = valueVariant.as<float>();
    if (!isnan(customValue)) {
      hasCustomValue = true;
    }
  }
  
  Serial.print("→ Calibration command: ");
  Serial.print(sensor);
  Serial.print(" ");
  Serial.println(mode);
  
  // Determine sensor address and calibration command
  uint8_t address = 0;
  char calCmd[48] = {0};
  bool recognized = true;
  
  if (sensor == "ph") {
    address = ATLAS_PH_ADDR;
    if (mode == "clear") {
      strncpy(calCmd, "Cal,clear", sizeof(calCmd) - 1);
    } else if (mode == "mid") {
      float target = hasCustomValue ? customValue : 7.00f;
      snprintf(calCmd, sizeof(calCmd), "Cal,mid,%.2f", target);
    } else if (mode == "low") {
      float target = hasCustomValue ? customValue : 4.00f;
      snprintf(calCmd, sizeof(calCmd), "Cal,low,%.2f", target);
    } else if (mode == "high") {
      float target = hasCustomValue ? customValue : 10.00f;
      snprintf(calCmd, sizeof(calCmd), "Cal,high,%.2f", target);
    } else if (mode == "status") {
      strncpy(calCmd, "Cal,?", sizeof(calCmd) - 1);
    } else {
      recognized = false;
    }
  } else if (sensor == "ec") {
    address = ATLAS_EC_ADDR;
    if (mode == "clear") {
      strncpy(calCmd, "Cal,clear", sizeof(calCmd) - 1);
    } else if (mode == "dry") {
      strncpy(calCmd, "Cal,dry", sizeof(calCmd) - 1);
    } else if (mode == "low") {
      float target = hasCustomValue ? customValue : 12880.0f;
      snprintf(calCmd, sizeof(calCmd), "Cal,low,%.0f", target);
    } else if (mode == "high") {
      float target = hasCustomValue ? customValue : 80000.0f;
      snprintf(calCmd, sizeof(calCmd), "Cal,high,%.0f", target);
    } else if (mode == "one") {
      if (!hasCustomValue || customValue <= 0.0f) {
        Serial.println("✗ One-point EC calibration requires value");
        return;
      }
      snprintf(calCmd, sizeof(calCmd), "Cal,one,%.0f", customValue);
    } else if (mode == "status") {
      strncpy(calCmd, "Cal,?", sizeof(calCmd) - 1);
    } else {
      recognized = false;
    }
  } else {
    Serial.println("✗ Unknown sensor");
    return;
  }
  
  if (!recognized || calCmd[0] == '\0') {
    Serial.println("✗ Unknown calibration mode");
    return;
  }
  
  // Send calibration command to sensor
  Serial.print("  Sending: ");
  Serial.println(calCmd);
  
  Wire.beginTransmission(address);
  Wire.write((const uint8_t*)calCmd, strlen(calCmd));
  byte error = Wire.endTransmission();
  
  if (error == 0) {
    Serial.println("✓ Calibration command sent");
    
    // Wait for calibration to complete (Atlas sensors take ~900ms)
    delay(1000);
    
    // Read response
    Wire.requestFrom(address, (uint8_t)40);
    if (Wire.available()) {
      byte statusCode = Wire.read();
      if (statusCode == 1) {
        Serial.println("✓ Calibration successful");
      } else {
        Serial.printf("✗ Calibration failed with status code %d\n", statusCode);
      }
    }
  } else {
    Serial.printf("✗ I2C transmission error %d\n", error);
  }
}

void executePumpCalCommand(JsonDocument& doc) {
  String pumpName = doc["pump"] | "";
  float ml_per_sec = doc["ml_per_sec"] | 0.0;
  
  Serial.print("→ Pump calibration: ");
  Serial.print(pumpName);
  Serial.print(" = ");
  Serial.print(ml_per_sec);
  Serial.println(" ml/s");
  
  if (ml_per_sec <= 0 || ml_per_sec > 20.0) {
    Serial.println("✗ Invalid calibration value (0-20 ml/s)");
    return;
  }

  PumpConfig* pump = getPumpConfig(pumpName);
  if (pump == nullptr) {
    Serial.println("✗ Unknown pump for calibration");
    return;
  }

  pump->mlPerSec = ml_per_sec;
  pumpPreferences.putFloat(pump->name, pump->mlPerSec);
  Serial.printf("✓ %s calibration stored at %.2f ml/s\n", pump->name, pump->mlPerSec);
  
  // Publish confirmation
  StaticJsonDocument<160> response;
  response["timestamp"] = millis();
  response["pump"] = pump->name;
  response["ml_per_sec"] = pump->mlPerSec;
  response["status"] = "persisted";
  
  char buffer[160];
  serializeJson(response, buffer);
  mqttClient.publish("sensors/nutrient/pump_cal/response", buffer);
}

void executeMixCommand(JsonDocument& doc) {
  int duration_s = doc["duration_s"] | 0;
  
  Serial.print("→ Mix command: ");
  Serial.print(duration_s);
  Serial.println(" seconds");
  
  if (duration_s <= 0 || duration_s > 120) {
    Serial.println("✗ Invalid mix duration");
    return;
  }
  
  digitalWrite(PUMP_MIXING, HIGH);
  delay(duration_s * 1000);
  digitalWrite(PUMP_MIXING, LOW);
  
  Serial.println("✓ Mixing complete");
}

void executeStopCommand(JsonDocument& doc) {
  Serial.println("→ Stop command received; disabling all pumps");

  digitalWrite(PUMP_PH_UP, LOW);
  digitalWrite(PUMP_PH_DOWN, LOW);
  digitalWrite(PUMP_NUTRIENT_A, LOW);
  digitalWrite(PUMP_NUTRIENT_B, LOW);
  digitalWrite(PUMP_MIXING, LOW);

  unsigned long now = millis();
  for (size_t i = 0; i < PUMP_COUNT; ++i) {
    pumpConfigs[i].lastDoseMillis = now;
  }

  StaticJsonDocument<160> docOut;
  docOut["timestamp"] = now;
  docOut["status"] = "stopped";
  if (doc.containsKey("reason")) {
    docOut["reason"] = doc["reason"].as<const char*>();
  }

  char buffer[160];
  serializeJson(docOut, buffer);
  mqttClient.publish("sensors/nutrient/command/stop/ack", buffer);
}

void executeRequestStatusCommand(JsonDocument& doc) {
  Serial.println("→ Status request received; refreshing telemetry");

  readSensors();
  publishReading();
  publishStatus();

  StaticJsonDocument<160> docOut;
  docOut["timestamp"] = millis();
  docOut["status"] = "published";
  if (doc.containsKey("origin")) {
    docOut["origin"] = doc["origin"].as<const char*>();
  }

  char buffer[160];
  serializeJson(docOut, buffer);
  mqttClient.publish("sensors/nutrient/command/request_status/ack", buffer);
}

// ===== PUMP CONTROL =====
void runPump(PumpConfig& pump, float ml, unsigned long overrideDurationMs) {
  float mlPerSec = pump.mlPerSec > 0.0f ? pump.mlPerSec : pump.defaultMlPerSec;
  if (mlPerSec <= 0.0f) {
    Serial.printf("✗ %s calibration invalid; aborting\n", pump.name);
    return;
  }

  float requestedMl = ml;
  if (requestedMl <= 0.0f && overrideDurationMs > 0) {
    requestedMl = (overrideDurationMs / 1000.0f) * mlPerSec;
  }

  if (requestedMl <= 0.0f) {
    Serial.println("✗ Requested dose volume invalid after overrides");
    return;
  }

  if (overrideDurationMs == 0 && requestedMl > MAX_DOSE_ML) {
    Serial.println("✗ Requested dose volume exceeds safety limit");
    return;
  }

  unsigned long duration_ms = overrideDurationMs > 0
    ? overrideDurationMs
    : static_cast<unsigned long>((requestedMl / mlPerSec) * 1000.0f);

  if (duration_ms == 0) {
    duration_ms = 200;  // minimum 200ms pulse to overcome inertia
  }

  if (duration_ms > MAX_PUMP_DURATION_MS) {
    Serial.println("✗ Pump duration exceeds safety limit");
    return;
  }
  
  Serial.printf("  Running %s for %lums (%.2f ml/s, target %.2f ml)%s\n",
                pump.name,
                duration_ms,
                mlPerSec,
                requestedMl,
                overrideDurationMs > 0 ? " [override]" : "");
  
  flowPulseCount = 0;
  unsigned long startTime = millis();
  
  digitalWrite(pump.pin, HIGH);
  delay(duration_ms);
  digitalWrite(pump.pin, LOW);
  
  unsigned long finish = millis();
  unsigned long actualDuration = finish - startTime;
  float mlDispensed = flowPulseCount / PULSES_PER_ML;
  pump.lastDoseMillis = finish;
  
  Serial.print("  ✓ Dispensed: ");
  Serial.print(mlDispensed, 2);
  Serial.print("ml (");
  Serial.print(flowPulseCount);
  Serial.println(" pulses)");
  
  // Publish pump event
  StaticJsonDocument<256> doc;
  doc["timestamp"] = finish;
  doc["pump"] = pump.name;
  doc["requested_ml"] = roundf(requestedMl * 100) / 100.0;
  doc["ml_dispensed"] = roundf(mlDispensed * 100) / 100.0;
  doc["duration_ms"] = actualDuration;
  if (overrideDurationMs > 0) {
    doc["command_duration_ms"] = overrideDurationMs;
  }
  doc["calibration_ml_per_s"] = roundf(pump.mlPerSec * 100) / 100.0;
  doc["flow_pulses"] = flowPulseCount;
  doc["status"] = "complete";
  
  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish("sensors/nutrient/pump", buffer);
}

// ===== FLOW SENSOR ISR =====
void IRAM_ATTR flowSensorISR() {
  flowPulseCount++;
}
