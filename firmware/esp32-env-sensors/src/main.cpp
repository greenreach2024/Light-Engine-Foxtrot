#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME680.h>
#include <Adafruit_HDC302x.h>

// WiFi credentials
const char* WIFI_SSID = "Greenreach";
const char* WIFI_PASSWORD = "Farms2024";

// MQTT broker configuration
const char* MQTT_SERVER = "192.168.2.42";
const int MQTT_PORT = 1883;
const char* MQTT_TOPIC = "sensors/farm/environment";
const char* DEVICE_NAME = "ESP32-BoardA";

// I²C configuration - Board A
// Pigtail: Green=GND, Yellow=3V3, Red=SDA, Black=SCL
#define I2C_SDA 21
#define I2C_SCL 22
#define I2C_FREQ 100000  // 100 kHz

// Sensor I²C addresses
#define HDC302x_ADDR 0x44  // Default address (can be 0x44 or 0x45)
#define BME680_ADDR 0x77   // Default address (can be 0x77 or 0x76)

// Sampling configuration
const int SAMPLE_COUNT = 10;           // Number of readings to average
const unsigned long SAMPLE_INTERVAL = 5000;   // 5 seconds between samples
const unsigned long PUBLISH_INTERVAL = 60000; // Publish averaged data every 60 seconds

// Sea level pressure for altitude calculation (hPa)
#define SEALEVELPRESSURE_HPA (1013.25)

// Initialize objects
Adafruit_BME680 bme680;
Adafruit_HDC302x hdc;
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// Sensor availability flags
bool hdc_available = false;
bool bme_available = false;

// Averaging accumulators
float tempSum_hdc = 0.0;
float humiditySum_hdc = 0.0;
int validSampleCount_hdc = 0;

float tempSum_bme = 0.0;
float humiditySum_bme = 0.0;
float pressureSum_bme = 0.0;
float gasSum_bme = 0.0;
int validSampleCount_bme = 0;

unsigned long lastSampleTime = 0;
unsigned long lastPublishTime = 0;

// Function prototypes
void setupI2C();
void setupSensors();
void setupWiFi();
void reconnectMQTT();
void publishSensorData();
void takeSample();

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n=== ESP32 Environmental Sensor - Board A ===");
  Serial.printf("Device: %s\n", DEVICE_NAME);
  Serial.println("Sensors: HDC302x + BME680 (I²C shared bus)");
  Serial.printf("I²C: SDA=GPIO%d, SCL=GPIO%d @ %d kHz\n", I2C_SDA, I2C_SCL, I2C_FREQ / 1000);
  Serial.println("Pigtail: Green=GND, Yellow=3V3, Red=SDA, Black=SCL");
  
  // Initialize I²C bus
  setupI2C();
  
  // Initialize sensors
  setupSensors();
  
  // Connect to WiFi
  setupWiFi();
  
  // Configure MQTT
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  Serial.printf("MQTT broker configured: %s:%d\n", MQTT_SERVER, MQTT_PORT);
  
  Serial.println("Setup complete!\n");
}

void loop() {
  // Check WiFi connection and reconnect if needed
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastWiFiAttempt = 0;
    if (millis() - lastWiFiAttempt > 30000) { // Try every 30 seconds
      Serial.println("WiFi disconnected. Reconnecting...");
      setupWiFi();
      lastWiFiAttempt = millis();
    }
  }
  
  // Only attempt MQTT if WiFi is connected
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      reconnectMQTT();
    }
    mqttClient.loop();
  }
  
  unsigned long currentTime = millis();
  
  // Take sensor sample at defined interval
  if (currentTime - lastSampleTime >= SAMPLE_INTERVAL) {
    takeSample();
    lastSampleTime = currentTime;
    
    // Publish averaged data when enough samples collected from at least one sensor
    if (validSampleCount_hdc >= SAMPLE_COUNT || validSampleCount_bme >= SAMPLE_COUNT) {
      publishSensorData();
      
      // Reset accumulators
      tempSum_hdc = 0.0;
      humiditySum_hdc = 0.0;
      validSampleCount_hdc = 0;
      
      tempSum_bme = 0.0;
      humiditySum_bme = 0.0;
      pressureSum_bme = 0.0;
      gasSum_bme = 0.0;
      validSampleCount_bme = 0;
      
      lastPublishTime = currentTime;
    }
  }
}

void setupI2C() {
  Serial.println("\n--- I²C Bus Initialization ---");
  
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(I2C_FREQ);
  
  Serial.println("✓ I²C bus initialized");
  
  // Scan I²C bus for devices
  Serial.println("Scanning I²C bus...");
  byte count = 0;
  
  for (byte addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    byte error = Wire.endTransmission();
    
    if (error == 0) {
      Serial.printf("  Found device at 0x%02X", addr);
      
      // Identify known devices
      if (addr == HDC302x_ADDR || addr == 0x45) {
        Serial.print(" (HDC302x)");
      } else if (addr == BME680_ADDR || addr == 0x76) {
        Serial.print(" (BME680)");
      }
      Serial.println();
      count++;
    }
  }
  
  Serial.printf("Found %d I²C device(s)\n\n", count);
}

void setupSensors() {
  Serial.println("--- Sensor Initialization ---");
  
  // Initialize HDC302x
  Serial.print("HDC302x (0x");
  Serial.print(HDC302x_ADDR, HEX);
  Serial.print("): ");
  
  if (hdc.begin(HDC302x_ADDR, &Wire)) {
    hdc_available = true;
    Serial.println("✓ Ready");
  } else {
    Serial.println("✗ Not found");
  }
  
  // Initialize BME680
  Serial.print("BME680 (0x");
  Serial.print(BME680_ADDR, HEX);
  Serial.print("): ");
  
  if (bme680.begin(BME680_ADDR)) {
    bme_available = true;
    Serial.println("✓ Ready");
    
    // Configure BME680 oversampling and filter
    bme680.setTemperatureOversampling(BME680_OS_8X);
    bme680.setHumidityOversampling(BME680_OS_2X);
    bme680.setPressureOversampling(BME680_OS_4X);
    bme680.setIIRFilterSize(BME680_FILTER_SIZE_3);
    bme680.setGasHeater(320, 150); // 320°C for 150 ms
  } else {
    Serial.println("✗ Not found");
  }
  
  if (!hdc_available && !bme_available) {
    Serial.println("\n⚠ WARNING: No sensors detected!");
    Serial.println("Check wiring:");
    Serial.printf("  SDA (Red) → GPIO%d\n", I2C_SDA);
    Serial.printf("  SCL (Black) → GPIO%d\n", I2C_SCL);
    Serial.println("  3V3 (Yellow) → 3.3V");
    Serial.println("  GND (Green) → GND");
  }
  
  Serial.println();
}

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
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n✗ WiFi connection failed!");
    Serial.println("Will retry in loop...");
    // Don't restart - just continue and retry later
  }
}

void reconnectMQTT() {
  static unsigned long lastAttempt = 0;
  unsigned long now = millis();
  
  // Try reconnecting every 5 seconds
  if (now - lastAttempt < 5000) {
    return;
  }
  lastAttempt = now;
  
  Serial.print("Connecting to MQTT broker... ");
  
  if (mqttClient.connect(DEVICE_NAME)) {
    Serial.println("✓ Connected");
  } else {
    Serial.print("✗ Failed, rc=");
    Serial.println(mqttClient.state());
  }
}

void takeSample() {
  bool hasValidSample = false;
  
  // Read HDC302x (temperature and humidity)
  if (hdc_available) {
    double temp, humidity;
    if (hdc.readTemperatureHumidityOnDemand(temp, humidity, TRIGGERMODE_LP0)) {
      // Validate readings
      if (!isnan(temp) && !isnan(humidity)) {
        if (temp > -40 && temp < 80 && humidity >= 0 && humidity <= 100) {
          tempSum_hdc += temp;
          humiditySum_hdc += humidity;
          validSampleCount_hdc++;
          hasValidSample = true;
          
          Serial.printf("[HDC Sample %d/%d] T: %.1f°C, H: %.1f%%\n", 
                        validSampleCount_hdc, SAMPLE_COUNT, temp, humidity);
        } else {
          Serial.printf("⚠ HDC302x: Implausible reading - T=%.1f°C, H=%.1f%%\n", temp, humidity);
        }
      } else {
        Serial.println("⚠ HDC302x: NaN reading");
      }
    } else {
      Serial.println("⚠ HDC302x: Read failed");
    }
  }
  
  // Read BME680 (temperature, humidity, pressure, gas)
  if (bme_available) {
    if (bme680.performReading()) {
      float temp = bme680.temperature;
      float humidity = bme680.humidity;
      float pressure = bme680.pressure / 100.0; // Convert Pa to hPa
      float gas = bme680.gas_resistance / 1000.0; // Convert to kOhms
      
      // Validate readings
      if (!isnan(temp) && !isnan(humidity) && !isnan(pressure) && !isnan(gas)) {
        if (temp > -40 && temp < 80 && humidity >= 0 && humidity <= 100 && pressure > 300 && pressure < 1100) {
          tempSum_bme += temp;
          humiditySum_bme += humidity;
          pressureSum_bme += pressure;
          gasSum_bme += gas;
          validSampleCount_bme++;
          hasValidSample = true;
          
          Serial.printf("[BME Sample %d/%d] T: %.1f°C, H: %.1f%%, P: %.1f hPa, G: %.1f kΩ\n", 
                        validSampleCount_bme, SAMPLE_COUNT, temp, humidity, pressure, gas);
        } else {
          Serial.printf("⚠ BME680: Implausible reading - T=%.1f°C, H=%.1f%%, P=%.1f hPa\n", 
                       temp, humidity, pressure);
        }
      } else {
        Serial.println("⚠ BME680: NaN reading");
      }
    } else {
      Serial.println("⚠ BME680: Read failed");
    }
  }
  
  if (!hasValidSample) {
    Serial.println("⚠ No valid samples from any sensor this cycle");
  }
}

void publishSensorData() {
  // Create JSON payload
  StaticJsonDocument<512> doc;
  doc["device"] = DEVICE_NAME;
  doc["scope"] = "Farm";
  doc["ts"] = millis() / 1000;  // Timestamp in seconds since boot
  
  JsonObject sensors = doc.createNestedObject("sensors");
  
  // Average temperature and humidity from both sensors if available
  float avgTemp = 0.0;
  float avgHumidity = 0.0;
  int tempSourceCount = 0;
  int humiditySourceCount = 0;
  
  if (validSampleCount_hdc > 0) {
    avgTemp += tempSum_hdc / validSampleCount_hdc;
    avgHumidity += humiditySum_hdc / validSampleCount_hdc;
    tempSourceCount++;
    humiditySourceCount++;
  }
  
  if (validSampleCount_bme > 0) {
    avgTemp += tempSum_bme / validSampleCount_bme;
    avgHumidity += humiditySum_bme / validSampleCount_bme;
    tempSourceCount++;
    humiditySourceCount++;
  }
  
  // Calculate final averages
  if (tempSourceCount > 0) {
    avgTemp /= tempSourceCount;
    JsonObject tempObj = sensors.createNestedObject("temperature");
    tempObj["value"] = round(avgTemp * 10) / 10.0;
    tempObj["unit"] = "C";
    tempObj["sources"] = tempSourceCount;
  }
  
  if (humiditySourceCount > 0) {
    avgHumidity /= humiditySourceCount;
    JsonObject humidityObj = sensors.createNestedObject("humidity");
    humidityObj["value"] = round(avgHumidity * 10) / 10.0;
    humidityObj["unit"] = "%";
    humidityObj["sources"] = humiditySourceCount;
  }
  
  // Add BME680-specific measurements
  if (validSampleCount_bme > 0) {
    float avgPressure = pressureSum_bme / validSampleCount_bme;
    float avgGas = gasSum_bme / validSampleCount_bme;
    
    JsonObject pressureObj = sensors.createNestedObject("pressure");
    pressureObj["value"] = round(avgPressure * 10) / 10.0;
    pressureObj["unit"] = "hPa";
    
    JsonObject gasObj = sensors.createNestedObject("gas");
    gasObj["value"] = round(avgGas * 10) / 10.0;
    gasObj["unit"] = "kOhm";
    
    // Calculate approximate altitude
    float altitude = 44330 * (1.0 - pow(avgPressure / SEALEVELPRESSURE_HPA, 0.1903));
    JsonObject altObj = sensors.createNestedObject("altitude");
    altObj["value"] = round(altitude * 10) / 10.0;
    altObj["unit"] = "m";
  }
  
  // Add metadata
  JsonObject meta = doc.createNestedObject("metadata");
  meta["hdc_samples"] = validSampleCount_hdc;
  meta["bme_samples"] = validSampleCount_bme;
  meta["rssi"] = WiFi.RSSI();
  
  // Serialize JSON
  char payload[512];
  serializeJson(doc, payload);
  
  // Publish to MQTT
  if (mqttClient.publish(MQTT_TOPIC, payload)) {
    Serial.println("\n✓ Published averaged data:");
    if (tempSourceCount > 0) {
      Serial.printf("  Temperature: %.1f°C (from %d sensor%s)\n", 
                    avgTemp, tempSourceCount, tempSourceCount > 1 ? "s" : "");
    }
    if (humiditySourceCount > 0) {
      Serial.printf("  Humidity: %.1f%% (from %d sensor%s)\n", 
                    avgHumidity, humiditySourceCount, humiditySourceCount > 1 ? "s" : "");
    }
    if (validSampleCount_bme > 0) {
      Serial.printf("  Pressure: %.1f hPa\n", pressureSum_bme / validSampleCount_bme);
      Serial.printf("  Gas: %.1f kΩ\n", gasSum_bme / validSampleCount_bme);
    }
    Serial.printf("  Topic: %s\n", MQTT_TOPIC);
    Serial.printf("  Payload: %s\n\n", payload);
  } else {
    Serial.println("✗ MQTT publish failed!");
  }
}
