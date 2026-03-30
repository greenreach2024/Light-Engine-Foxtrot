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
 *     - sensors/nutrient/command/cal
 *     - sensors/nutrient/command/mix
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>

// ===== CONFIGURATION (EDIT THESE) =====
const char* WIFI_SSID = "Greenreach";
const char* WIFI_PASSWORD = "Farms2024";
const char* MQTT_SERVER = "192.168.2.42";         // reTerminal IP
const int MQTT_PORT = 1883;
const char* MQTT_CLIENT_ID = "esp32-nutrient-001";

// Atlas Scientific I2C Addresses
#define ATLAS_PH_ADDR  0x63
#define ATLAS_EC_ADDR  0x64
#define ATLAS_RTD_ADDR 0x66

// Pump GPIO Pins (PWM capable pins)
#define PUMP_PH_UP     25
#define PUMP_PH_DOWN   26
#define PUMP_NUTRIENT_A 27
#define PUMP_NUTRIENT_B 14
#define PUMP_MIXING    12

// Flow Sensor Pin (interrupt capable)
#define FLOW_SENSOR_PIN 35

// Pump Calibration (ml/second)
#define PUMP_PH_UP_ML_PER_SEC     2.0
#define PUMP_PH_DOWN_ML_PER_SEC   2.0
#define PUMP_NUTRIENT_A_ML_PER_SEC 3.0
#define PUMP_NUTRIENT_B_ML_PER_SEC 3.0
#define PUMP_MIXING_ML_PER_SEC    10.0

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

// ===== GLOBAL STATE =====
unsigned long lastReadingTime = 0;
unsigned long lastStatusTime = 0;
unsigned long lastDoseTime = 0;
volatile unsigned long flowPulseCount = 0;

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
float readAtlasSensor(uint8_t address);
void publishReading();
void publishStatus();
void executeDoseCommand(JsonDocument& doc);
void executeCalCommand(JsonDocument& doc);
void executeMixCommand(JsonDocument& doc);
void runPump(int pin, float ml, float mlPerSec);
void IRAM_ATTR flowSensorISR();

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n=== ESP32 Nutrient Controller ===");
  Serial.println("Version: 1.0");
  Serial.println("Starting...\n");
  
  // Initialize I2C
  Wire.begin();
  Serial.println("✓ I2C initialized");
  
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
      mqttClient.subscribe("sensors/nutrient/command/cal");
      mqttClient.subscribe("sensors/nutrient/command/mix");
      
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
  } else if (topicStr.endsWith("/cal")) {
    executeCalCommand(doc);
  } else if (topicStr.endsWith("/mix")) {
    executeMixCommand(doc);
  } else {
    Serial.println("✗ Unknown command topic");
  }
}

// ===== SENSOR READING =====
void readSensors() {
  Serial.println("Reading sensors...");
  
  currentSensors.pH = readAtlasSensor(ATLAS_PH_ADDR);
  delay(100);
  
  currentSensors.ec = readAtlasSensor(ATLAS_EC_ADDR);
  delay(100);
  
  currentSensors.temperature = readAtlasSensor(ATLAS_RTD_ADDR);
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

float readAtlasSensor(uint8_t address) {
  // Send read command
  Wire.beginTransmission(address);
  Wire.write("R");
  Wire.endTransmission();
  
  delay(SENSOR_WARMUP_MS);
  
  // Request data
  Wire.requestFrom(address, (uint8_t)20);
  
  if (Wire.available()) {
    byte responseCode = Wire.read();
    
    if (responseCode == 1) {  // Success
      String dataString = "";
      while (Wire.available()) {
        char c = Wire.read();
        if (c == '\0') break;
        dataString += c;
      }
      return dataString.toFloat();
    }
  }
  
  return -1.0;  // Error
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

// ===== COMMAND EXECUTION =====
void executeDoseCommand(JsonDocument& doc) {
  String pump = doc["pump"] | "";
  float ml = doc["ml"] | 0.0;
  
  Serial.print("→ Dose command: ");
  Serial.print(pump);
  Serial.print(" ");
  Serial.print(ml);
  Serial.println("ml");
  
  // Safety checks
  if (ml <= 0 || ml > MAX_DOSE_ML) {
    Serial.println("✗ Invalid dose volume");
    return;
  }
  
  if (millis() - lastDoseTime < MIN_DOSE_INTERVAL_MS) {
    Serial.println("✗ Too soon after last dose");
    return;
  }
  
  // Select pump and flow rate
  int pin = -1;
  float mlPerSec = 0;
  
  if (pump == "phUp") {
    pin = PUMP_PH_UP;
    mlPerSec = PUMP_PH_UP_ML_PER_SEC;
  } else if (pump == "phDown") {
    pin = PUMP_PH_DOWN;
    mlPerSec = PUMP_PH_DOWN_ML_PER_SEC;
  } else if (pump == "nutrientA") {
    pin = PUMP_NUTRIENT_A;
    mlPerSec = PUMP_NUTRIENT_A_ML_PER_SEC;
  } else if (pump == "nutrientB") {
    pin = PUMP_NUTRIENT_B;
    mlPerSec = PUMP_NUTRIENT_B_ML_PER_SEC;
  } else {
    Serial.println("✗ Unknown pump");
    return;
  }
  
  // Run pump
  runPump(pin, ml, mlPerSec);
  lastDoseTime = millis();
}

void executeCalCommand(JsonDocument& doc) {
  String sensor = doc["sensor"] | "";
  String mode = doc["mode"] | "";
  
  Serial.print("→ Calibration command: ");
  Serial.print(sensor);
  Serial.print(" ");
  Serial.println(mode);
  
  // TODO: Implement calibration commands
  // Atlas Scientific calibration: "Cal,mid,7.00" etc.
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

// ===== PUMP CONTROL =====
void runPump(int pin, float ml, float mlPerSec) {
  unsigned long duration_ms = (unsigned long)((ml / mlPerSec) * 1000);
  
  if (duration_ms > MAX_PUMP_DURATION_MS) {
    Serial.println("✗ Pump duration exceeds safety limit");
    return;
  }
  
  Serial.print("  Running pump for ");
  Serial.print(duration_ms);
  Serial.println("ms");
  
  flowPulseCount = 0;
  unsigned long startTime = millis();
  
  digitalWrite(pin, HIGH);
  delay(duration_ms);
  digitalWrite(pin, LOW);
  
  unsigned long actualDuration = millis() - startTime;
  float mlDispensed = flowPulseCount / PULSES_PER_ML;
  
  Serial.print("  ✓ Dispensed: ");
  Serial.print(mlDispensed, 2);
  Serial.print("ml (");
  Serial.print(flowPulseCount);
  Serial.println(" pulses)");
  
  // Publish pump event
  StaticJsonDocument<256> doc;
  doc["timestamp"] = millis();
  doc["ml_dispensed"] = roundf(mlDispensed * 100) / 100.0;
  doc["duration_ms"] = actualDuration;
  doc["status"] = "complete";
  
  char buffer[256];
  serializeJson(doc, buffer);
  mqttClient.publish("sensors/nutrient/pump", buffer);
}

// ===== FLOW SENSOR ISR =====
void IRAM_ATTR flowSensorISR() {
  flowPulseCount++;
}
