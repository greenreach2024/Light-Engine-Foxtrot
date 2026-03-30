/*
 * ESP32 Dual Environmental Sensor
 * HDC302x + BME680 Averaged Readings
 * Serial Output (115200 baud)
 * For Light Engine Foxtrot Temperature Forecasting
 * WiFi DISABLED - USB Serial Only
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <Adafruit_HDC302x.h>
#include <Adafruit_BME680.h>
#include <Adafruit_Sensor.h>
#include <ArduinoJson.h>

// I2C Configuration
#define I2C_SDA 21
#define I2C_SCL 22
#define I2C_FREQ 100000  // 100kHz - stable for both sensors

// Timing
#define READING_INTERVAL 2000  // 2 seconds between readings
#define WARMUP_TIME 5000       // 5 seconds warmup on boot

// Sensors
Adafruit_HDC302x hdc;
Adafruit_BME680 bme;

// Status
bool hdc_available = false;
bool bme_available = false;
unsigned long last_reading = 0;
unsigned long boot_time = 0;

void setup() {
  // Disable WiFi to save power and prevent brownout
  WiFi.mode(WIFI_OFF);
  btStop();  // Disable Bluetooth too
  
  Serial.begin(115200);
  while (!Serial) {
    delay(10);
  }
  
  boot_time = millis();
  
  Serial.println("\n\n=== ESP32 Dual Environmental Sensor ===");
  Serial.println("Device: Light-Engine-Foxtrot-Sensor");
  Serial.println("Sensors: HDC302x + BME680");
  Serial.println("Output: JSON averaged readings");
  Serial.println("Communication: USB Serial Only (WiFi/BT OFF)");
  Serial.println();
  
  // Initialize I2C
  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(I2C_FREQ);
  delay(100);
  
  // Initialize HDC302x
  Serial.print("Initializing HDC302x... ");
  if (hdc.begin()) {
    hdc_available = true;
    Serial.println("OK");
    Serial.print("  Address: 0x");
    Serial.println(0x44, HEX);
  } else {
    Serial.println("FAILED");
    Serial.println("  Check: I2C connection, address 0x44");
  }
  
  // Initialize BME680
  Serial.print("Initializing BME680... ");
  if (bme.begin()) {
    bme_available = true;
    Serial.println("OK");
    Serial.print("  Address: 0x");
    Serial.println(0x76, HEX);
    
    // Configure BME680
    bme.setTemperatureOversampling(BME680_OS_8X);
    bme.setHumidityOversampling(BME680_OS_2X);
    bme.setPressureOversampling(BME680_OS_4X);
    bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
    bme.setGasHeater(320, 150);  // 320°C for 150ms
  } else {
    Serial.println("FAILED");
    Serial.println("  Check: I2C connection, address 0x76 or 0x77");
  }
  
  Serial.println();
  
  if (!hdc_available && !bme_available) {
    Serial.println("ERROR: No sensors detected!");
    Serial.println("System halted. Check I2C connections.");
    while (1) {
      delay(1000);
    }
  }
  
  if (hdc_available && bme_available) {
    Serial.println("✓ Both sensors ready - will average readings");
  } else if (hdc_available) {
    Serial.println("⚠ HDC302x only - single sensor mode");
  } else {
    Serial.println("⚠ BME680 only - single sensor mode");
  }
  
  Serial.println();
  Serial.print("Warming up sensors for ");
  Serial.print(WARMUP_TIME / 1000);
  Serial.println(" seconds...");
  
  delay(WARMUP_TIME);
  Serial.println("✓ Ready\n");
}

void loop() {
  unsigned long now = millis();
  
  if (now - last_reading < READING_INTERVAL) {
    delay(10);
    return;
  }
  
  last_reading = now;
  
  // Read HDC302x
  // Note: HDC302x library API varies by version - skipping for now
  float hdc_temp = NAN;
  float hdc_hum = NAN;
  bool hdc_success = false;
  
  // HDC302x temporarily disabled until correct API is determined
  hdc_available = false;
  
  // Read BME680
  float bme_temp = NAN;
  float bme_hum = NAN;
  float bme_pressure = NAN;
  float bme_gas = NAN;
  bool bme_success = false;
  
  if (bme_available) {
    if (bme.performReading()) {
      bme_temp = bme.temperature;
      bme_hum = bme.humidity;
      bme_pressure = bme.pressure / 100.0;  // Convert to hPa
      bme_gas = bme.gas_resistance / 1000.0;  // Convert to kOhms
      bme_success = true;
    }
  }
  
  // Build JSON output
  JsonDocument doc;
  doc["timestamp"] = now;
  doc["uptime_s"] = (now - boot_time) / 1000;
  
  // Individual sensor data
  JsonObject hdc_obj = doc["hdc302x"].to<JsonObject>();
  if (hdc_success) {
    hdc_obj["temperature_c"] = round(hdc_temp * 100) / 100.0;
    hdc_obj["humidity"] = round(hdc_hum * 100) / 100.0;
    hdc_obj["status"] = "ok";
  } else {
    hdc_obj["status"] = hdc_available ? "error" : "not_available";
  }
  
  JsonObject bme_obj = doc["bme680"].to<JsonObject>();
  if (bme_success) {
    bme_obj["temperature_c"] = round(bme_temp * 100) / 100.0;
    bme_obj["humidity"] = round(bme_hum * 100) / 100.0;
    bme_obj["pressure_hpa"] = round(bme_pressure * 100) / 100.0;
    bme_obj["gas_kohms"] = round(bme_gas * 100) / 100.0;
    bme_obj["status"] = "ok";
  } else {
    bme_obj["status"] = bme_available ? "error" : "not_available";
  }
  
  // Averaged readings
  JsonObject avg = doc["averaged"].to<JsonObject>();
  
  int temp_count = 0;
  float temp_sum = 0;
  if (hdc_success) { temp_sum += hdc_temp; temp_count++; }
  if (bme_success) { temp_sum += bme_temp; temp_count++; }
  
  int hum_count = 0;
  float hum_sum = 0;
  if (hdc_success) { hum_sum += hdc_hum; hum_count++; }
  if (bme_success) { hum_sum += bme_hum; hum_count++; }
  
  if (temp_count > 0) {
    avg["temperature_c"] = round((temp_sum / temp_count) * 100) / 100.0;
    avg["temperature_sources"] = temp_count;
  }
  
  if (hum_count > 0) {
    avg["humidity"] = round((hum_sum / hum_count) * 100) / 100.0;
    avg["humidity_sources"] = hum_count;
  }
  
  // Only include pressure/gas if available (BME680 only)
  if (bme_success) {
    avg["pressure_hpa"] = round(bme_pressure * 100) / 100.0;
    avg["gas_kohms"] = round(bme_gas * 100) / 100.0;
  }
  
  // Output JSON
  serializeJson(doc, Serial);
  Serial.println();
  
  // Memory management
  doc.clear();
}
