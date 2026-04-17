#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <cstring>
#include <Preferences.h>
#include <algorithm>
#include <Wire.h>

// WiFi credentials (override before flashing; keep secrets out of git)
static const char *WIFI_SSID = "YOUR_WIFI_SSID";
static const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// MQTT broker configuration
static const char *MQTT_BROKER = "192.168.2.42"; // default; can be overridden via USB/NVS
static const int MQTT_PORT = 1883;

// Atlas Scientific EZO sensor I2C addresses
static const uint8_t ATLAS_PH_ADDR = 0x63;
static const uint8_t ATLAS_EC_ADDR = 0x64;
static const uint8_t ATLAS_RTD_ADDR = 0x66;

// Atlas sensor GPIO power enables
// NOTE: Board layout may not match original pin definitions!
// Original: EN_PH=12, EN_EC=27, EN_RTD=15
// Testing different combinations based on which chips stay powered
static const int EN_PH_GPIO = 12;   // Controls AUX position (pH sensor is here) ✅ WORKING
static const int EN_EC_GPIO = 14;   // TESTING: Trying GPIO 14 for EC chip position
static const int EN_RTD_GPIO = 15;  // Controls TEMP position ✅ WORKING

// I2C configuration (matches original working system)
static const int I2C_SDA_PIN = 23;  // Atlas EZO SDA pin (NOT default 21!)
static const int I2C_SCL_PIN = 22;  // Atlas EZO SCL pin
static const uint32_t I2C_FREQ = 400000;  // 400kHz

// MQTT topics
static const char *COMMAND_TOPIC = "commands/NutrientRoom";
static const char *ACK_TOPIC = "sensors/NutrientRoom/ack";
// Backend subscribes to sensors/#; use structured nutrient path
static const char *SENSOR_TOPIC = "sensors/nutrient/reading";

// Pump GPIO assignments
static const int PUMP_PH_DOWN_GPIO = 4;
static const int PUMP_EC_MIX_A_GPIO = 16;
static const int PUMP_EC_MIX_B_GPIO = 17;
static const int PUMP_ACTIVE_STATE = LOW;     // Active-low relay board: LOW = ON
static const int PUMP_INACTIVE_STATE = HIGH;  // HIGH = OFF

// Dosing safety guardrails (seconds)
static const float MIN_DURATION_SEC = 0.5f;
static const float MAX_DURATION_PH_SEC = 5.0f;
static const float MAX_DURATION_EC_SEC = 20.0f;
static const float MAX_PH_DAILY_RUNTIME_SEC = 60.0f;      // Limit pH pump runtime per day
static const float MAX_EC_DAILY_RUNTIME_SEC = 300.0f;     // Limit EC pump runtime per day
static const float MAX_RUNTIME_PER_WINDOW_SEC = 15.0f;    // per command window guardrail
static const unsigned long DOSE_WINDOW_COOLDOWN_MS = 60UL * 1000UL;  // 60 second cooldown between doses
static const unsigned long TELEMETRY_INTERVAL_MS = 60UL * 1000UL;    // 60 second push cadence
static const unsigned long WIFI_RECONNECT_INTERVAL_MS = 15UL * 1000UL;  // retry WiFi every 15s
static const unsigned long AUTODOSE_CHECK_INTERVAL_MS = 30UL * 1000UL;  // evaluate setpoints every 30s

static const float DEFAULT_EC_DOSE_SECONDS = 2.5f;
static const float DEFAULT_EC_MIX_B_RATIO = 2.0f;
static const float DEFAULT_PH_DOWN_DOSE_SECONDS = 1.0f;
static const float DEFAULT_SAFE_PH_TARGET = 5.80f;
static const float DEFAULT_SAFE_EC_TARGET = 1300.0f;
static const bool DEFAULT_SAFE_AUTODOSE_ENABLED = true;
static const float DEFAULT_SAFE_PH_DEADBAND = 0.15f;
static const float DEFAULT_SAFE_EC_DEADBAND = 50.0f;

static const float DEFAULT_MIN_DOSE_INTERVAL_SEC = DOSE_WINDOW_COOLDOWN_MS / 1000.0f;
static const float DEFAULT_SAFE_DOSE_PAUSE_SEC = DEFAULT_MIN_DOSE_INTERVAL_SEC;

// EC sensor configuration
static const float EC_EMPTY_THRESHOLD = 75.0f;  // uS/cm threshold for empty tank detection
static const float EC_SENSOR_MIN_VALID = 5.0f;  // reject near-zero readings as sensor fault
static const unsigned long MQTT_RECONNECT_INTERVAL_MS = 5UL * 1000UL;

// Atlas sensor reading state
static float lastTempReading = 21.0f;  // Cache temperature for compensation

WiFiClient espClient;
PubSubClient mqttClient(espClient);
Preferences preferences;
Preferences netprefs;  // separate NVS namespace for network config

// Runtime network configuration (overrides compile-time defaults when set)
static String runtimeWifiSsid;
static String runtimeWifiPwd;
static String runtimeMqttHost;
static int runtimeMqttPort = MQTT_PORT;

struct SetpointState {
  float phTarget = DEFAULT_SAFE_PH_TARGET;
  float phTolerance = DEFAULT_SAFE_PH_DEADBAND;
  float ecTarget = DEFAULT_SAFE_EC_TARGET;  // uS/cm
  float ecTolerance = DEFAULT_SAFE_EC_DEADBAND;
  float ecDoseSeconds = DEFAULT_EC_DOSE_SECONDS;
  float phDownDoseSeconds = DEFAULT_PH_DOWN_DOSE_SECONDS;
  float minDoseIntervalSec = DEFAULT_SAFE_DOSE_PAUSE_SEC;
  bool autodoseEnabled = DEFAULT_SAFE_AUTODOSE_ENABLED;
  unsigned long updatedAtMs = 0;
};

struct PumpGuardState {
  float dailyRuntimeSec = 0.0f;
  unsigned long dailyResetMs = 0;
  unsigned long lastDoseMs = 0;
};

static bool wifiConfigured = false;
static bool networkEnabled = false;
static String serialBuffer;
static unsigned long lastUsbStopPulseMs = 0;
static unsigned long lastWifiAttemptMs = 0;
static unsigned long lastMqttAttemptMs = 0;
static unsigned long lastDoseActionMs = 0;
static SetpointState setpoints;
static PumpGuardState phDownGuard;
static PumpGuardState ecMixAGuard;
static PumpGuardState ecMixBGuard;
static bool pumpsAreStopped = false;
static unsigned long lastAutodoseCheckMs = 0;

static void reconnectMQTT();
static void publishAck(const String &status, const String &action, const String &reason, float ecValue);
static void executeDosingCommand(const String &action, float durationSec);
static void stopAllPumps();
static bool atlasSendCommand(uint8_t addr, const char *cmd);
static bool atlasReadResponse(uint8_t addr, char *buffer, size_t bufLen, uint8_t *status);
static float atlasReadFloat(uint8_t addr, const char *cmd);
static bool atlasSendAndCheckOK(uint8_t addr, const char *cmd, unsigned long waitMs = 900);
static void enableAtlasSensor(int gpioPin, bool enable);
static float readECSensor();
static float readPHSensor();
static float readTemperatureSensor();
static void publishSensorData();
static void maybeAutodose();
static bool isSafeToDose(const String &action, float currentEC);
static void handleCommand(const char *payload);
static float maxDurationForAction(const String &action);
static float minDurationForAction(const String &action);
static float clampDoseDurationForAction(const String &action, float durationSec);
static void processSerialInput();
static void handleSerialCommand(const String &command);
static void loadSetpointsFromStorage();
static void persistSetpointsToStorage();
static void attachSetpoints(JsonDocument &doc);
static bool checkPumpGuardrails(const String &action, float requestedDurationSec, char *reason, size_t reasonLen);
static PumpGuardState &guardStateForAction(const String &action);
static float dailyLimitForAction(const String &action);
static void recordPumpRun(const String &action, float durationSec);
static void ensureWifiConnection();
static void loadNetworkConfig();
static void saveWifiConfig(const String &ssid, const String &pwd);
static void saveBrokerConfig(const String &host, int port);
static bool isControlLinkOnline();

static void mqttCallback(char *topic, byte *payload, unsigned int length) {
  Serial.printf("📨 Message on topic: %s\n", topic);

  char message[length + 1];
  memcpy(message, payload, length);
  message[length] = '\0';

  handleCommand(message);
}

void setup() {
  Serial.begin(115200);
  delay(100);  // Allow serial to stabilize
  Serial.println("\n\n🚀 ESP32 Nutrient Controller - Atlas EZO Sensors");

  pinMode(PUMP_PH_DOWN_GPIO, OUTPUT);
  pinMode(PUMP_EC_MIX_A_GPIO, OUTPUT);
  pinMode(PUMP_EC_MIX_B_GPIO, OUTPUT);
  digitalWrite(PUMP_PH_DOWN_GPIO, PUMP_INACTIVE_STATE);
  digitalWrite(PUMP_EC_MIX_A_GPIO, PUMP_INACTIVE_STATE);
  digitalWrite(PUMP_EC_MIX_B_GPIO, PUMP_INACTIVE_STATE);
  stopAllPumps();

  // Initialize Atlas sensor power control GPIOs
  pinMode(EN_PH_GPIO, OUTPUT);
  pinMode(EN_EC_GPIO, OUTPUT);
  pinMode(EN_RTD_GPIO, OUTPUT);
  digitalWrite(EN_PH_GPIO, HIGH);   // Enable pH sensor
  digitalWrite(EN_EC_GPIO, HIGH);   // Enable EC sensor
  digitalWrite(EN_RTD_GPIO, HIGH);  // Enable RTD sensor
  delay(100);  // Allow sensors to power up

  // Initialize I2C bus for Atlas sensors
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(I2C_FREQ);
  Serial.printf("✅ I2C initialized: SDA=%d, SCL=%d, Freq=%dkHz\n", 
                I2C_SDA_PIN, I2C_SCL_PIN, I2C_FREQ / 1000);

  preferences.begin("nutrients", false);
  netprefs.begin("netcfg", false);
  loadSetpointsFromStorage();
  loadNetworkConfig();
  wifiConfigured = runtimeWifiSsid.length() > 0 && runtimeWifiSsid != "YOUR_WIFI_SSID";

  if (wifiConfigured) {
    WiFi.mode(WIFI_STA);
  Serial.printf("Connecting to WiFi: %s\n", runtimeWifiSsid.c_str());
  WiFi.begin(runtimeWifiSsid.c_str(), runtimeWifiPwd.c_str());
    lastWifiAttemptMs = millis();
    unsigned long wifiStart = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - wifiStart) < 15000UL) {
      delay(500);
      Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\n✅ WiFi connected");
      Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
      configTime(0, 0, "pool.ntp.org");

  mqttClient.setServer(runtimeMqttHost.c_str(), runtimeMqttPort);
      mqttClient.setCallback(mqttCallback);
      mqttClient.setKeepAlive(60);
  mqttClient.setBufferSize(1024); // allow larger JSON payloads

      networkEnabled = true;
      reconnectMQTT();
    } else {
      Serial.println("\n⚠️  WiFi connect timeout. Entering USB-only safe mode.");
      WiFi.disconnect(true, true);
      networkEnabled = false;
    }
  } else {
    if (setpoints.autodoseEnabled) {
      Serial.println("🔌 USB/offline mode: using local autodose setpoints (safe fallback active).");
    } else {
      Serial.println("🔌 USB-only mode: WiFi not configured and autodose disabled; pumps held OFF.");
    }
    networkEnabled = false;
  }
}

void loop() {
  processSerialInput();
  ensureWifiConnection();
  maybeAutodose();

  if (networkEnabled) {
    if (!mqttClient.connected()) {
      reconnectMQTT();
    }
    mqttClient.loop();

    static unsigned long lastPublish = 0;
    if (millis() - lastPublish > TELEMETRY_INTERVAL_MS) {
      publishSensorData();
      lastPublish = millis();
    }
  } else {
    // If local autodose is disabled, pulse stopAllPumps() as a hard safety hold.
    if (!setpoints.autodoseEnabled && millis() - lastUsbStopPulseMs > 1000UL) {
      stopAllPumps();
      lastUsbStopPulseMs = millis();
    }
    delay(20);
  }
}

static void ensureWifiConnection() {
  if (!wifiConfigured) {
    networkEnabled = false;
    return;
  }

  wl_status_t status = WiFi.status();
  if (status == WL_CONNECTED) {
    if (!networkEnabled) {
      Serial.println("✅ WiFi connection restored");
      networkEnabled = true;
      reconnectMQTT();
    }
    return;
  }

  if (networkEnabled) {
    Serial.printf("⚠️  WiFi dropped (status %d). Entering USB-safe mode.\n", static_cast<int>(status));
    networkEnabled = false;
    stopAllPumps();
    if (mqttClient.connected()) {
      mqttClient.disconnect();
    }
  }

  const unsigned long now = millis();
  if (now - lastWifiAttemptMs < WIFI_RECONNECT_INTERVAL_MS) {
    return;
  }

  Serial.println("🔁 Attempting WiFi reconnect...");
  if (status == WL_CONNECT_FAILED || status == WL_NO_SSID_AVAIL) {
    Serial.println("   Reinitialising WiFi credentials");
    WiFi.disconnect(false, true);
    WiFi.mode(WIFI_STA);
    WiFi.begin(runtimeWifiSsid.c_str(), runtimeWifiPwd.c_str());
  } else {
    WiFi.reconnect();
  }
  lastWifiAttemptMs = now;
}

static void reconnectMQTT() {
  if (!networkEnabled || mqttClient.connected()) {
    return;
  }

  const unsigned long now = millis();
  if (now - lastMqttAttemptMs < MQTT_RECONNECT_INTERVAL_MS) {
    return;
  }
  lastMqttAttemptMs = now;

  Serial.print("Connecting to MQTT broker...");

  String clientId = "ESP32-NutrientRoom-";
  clientId += String(random(0xffff), HEX);

  if (mqttClient.connect(clientId.c_str())) {
    Serial.println(" ✅ Connected");

    if (mqttClient.subscribe(COMMAND_TOPIC)) {
      Serial.printf("📡 Subscribed to %s\n", COMMAND_TOPIC);
    } else {
      Serial.println("❌ Failed to subscribe");
    }
  } else {
    Serial.printf(" ❌ Failed, rc=%d, retrying in 5s\n", mqttClient.state());
  }
}

static bool isControlLinkOnline() {
  return networkEnabled && mqttClient.connected();
}

static bool isSafeToDose(const String &action, float currentEC) {
  if (action == "stop") {
    return true;
  }

  if (currentEC < EC_SENSOR_MIN_VALID) {
    Serial.printf("⚠️  SAFETY BLOCK: EC sensor reading %.1f looks invalid\n", currentEC);
    return false;
  }

  if (currentEC < EC_EMPTY_THRESHOLD) {
    Serial.printf("⚠️  SAFETY BLOCK: EC %.1f < threshold %.1f\n", currentEC, EC_EMPTY_THRESHOLD);
    return false;
  }

  return true;
}

static void handleCommand(const char *payload) {
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.print("❌ JSON parse error: ");
    Serial.println(error.c_str());
    publishAck("rejected", "", "Invalid JSON payload", 0.0f);
    return;
  }

  String action = doc["action"] | "";
  float durationSec = doc["durationSec"] | 0.0f;

  if (action == "setTargets") {
    JsonObject targets = doc["targets"].as<JsonObject>();
    if (!targets.isNull()) {
      if (targets.containsKey("phTarget")) {
        setpoints.phTarget = targets["phTarget"].as<float>();
      }
      if (targets.containsKey("phTolerance")) {
        setpoints.phTolerance = targets["phTolerance"].as<float>();
      }
      if (targets.containsKey("ecTarget")) {
        setpoints.ecTarget = targets["ecTarget"].as<float>();
      }
      if (targets.containsKey("ecTolerance")) {
        setpoints.ecTolerance = targets["ecTolerance"].as<float>();
      }

      if (targets.containsKey("autodoseEnabled")) {
        setpoints.autodoseEnabled = targets["autodoseEnabled"].as<bool>();
      }

      if (targets.containsKey("ecDoseSeconds")) {
        float ecDose = targets["ecDoseSeconds"].as<float>();
        ecDose = std::max(MIN_DURATION_SEC, std::min(MAX_DURATION_EC_SEC, ecDose));
        setpoints.ecDoseSeconds = ecDose;
      }

      if (targets.containsKey("phDownDoseSeconds")) {
        float phDose = targets["phDownDoseSeconds"].as<float>();
        phDose = std::max(MIN_DURATION_SEC, std::min(MAX_DURATION_PH_SEC, phDose));
        setpoints.phDownDoseSeconds = phDose;
      }

      if (targets.containsKey("minDoseIntervalSec")) {
        float interval = targets["minDoseIntervalSec"].as<float>();
        interval = std::max(30.0f, std::min(3600.0f, interval));
        setpoints.minDoseIntervalSec = interval;
      }

      JsonObject dosing = targets["dosing"].as<JsonObject>();
      if (!dosing.isNull()) {
        if (dosing.containsKey("enabled")) {
          setpoints.autodoseEnabled = dosing["enabled"].as<bool>();
        }
        if (dosing.containsKey("ecDoseSeconds")) {
          float ecDose = dosing["ecDoseSeconds"].as<float>();
          ecDose = std::max(MIN_DURATION_SEC, std::min(MAX_DURATION_EC_SEC, ecDose));
          setpoints.ecDoseSeconds = ecDose;
        }
        if (dosing.containsKey("phDownDoseSeconds")) {
          float phDose = dosing["phDownDoseSeconds"].as<float>();
          phDose = std::max(MIN_DURATION_SEC, std::min(MAX_DURATION_PH_SEC, phDose));
          setpoints.phDownDoseSeconds = phDose;
        }
        if (dosing.containsKey("minDoseIntervalSec")) {
          float interval = dosing["minDoseIntervalSec"].as<float>();
          interval = std::max(30.0f, std::min(3600.0f, interval));
          setpoints.minDoseIntervalSec = interval;
        }
      }

      setpoints.phTarget = std::max(4.0f, std::min(7.5f, setpoints.phTarget));
      setpoints.phTolerance = std::max(0.05f, std::min(1.0f, setpoints.phTolerance));
      setpoints.ecTarget = std::max(100.0f, std::min(2500.0f, setpoints.ecTarget));
      setpoints.ecTolerance = std::max(5.0f, std::min(500.0f, setpoints.ecTolerance));

      persistSetpointsToStorage();
      lastAutodoseCheckMs = 0;
    }

    publishAck("accepted", action, "Setpoints updated", readECSensor());
    publishSensorData();
    return;
  }

  if (action == "requestStatus") {
    publishSensorData();
    publishAck("status", action, "Snapshot published", readECSensor());
    return;
  }

  if (action != "phDown" && action != "ecMixA" && action != "ecMixB" && action != "stop") {
    Serial.printf("❌ Invalid action: %s\n", action.c_str());
    publishAck("rejected", action, "Invalid action", 0.0f);
    return;
  }

  if (action != "stop") {
    float minDuration = minDurationForAction(action);
    float maxDuration = maxDurationForAction(action);

    if (durationSec <= 0.0f) {
      publishAck("rejected", action, "durationSec must be positive", 0.0f);
      return;
    }

    if (durationSec < minDuration - 0.0001f) {
      char reason[96];
      snprintf(reason, sizeof(reason), "duration %.1fs below minimum %.1fs", durationSec, minDuration);
      publishAck("rejected", action, reason, 0.0f);
      return;
    }

    if (durationSec > maxDuration + 0.0001f) {
      char reason[128];
      snprintf(reason, sizeof(reason), "Safety block: duration %.1fs exceeds limit %.1fs", durationSec, maxDuration);
      publishAck("rejected", action, reason, 0.0f);
      return;
    }

    char guardReason[128];
    if (!checkPumpGuardrails(action, durationSec, guardReason, sizeof(guardReason))) {
      publishAck("rejected", action, guardReason, readECSensor());
      return;
    }
  }

  float currentEC = readECSensor();

  if (!isSafeToDose(action, currentEC)) {
  char reason[128];
  snprintf(reason, sizeof(reason), "Safety block: EC %.1f uS/cm < threshold %.1f", currentEC, EC_EMPTY_THRESHOLD);
    Serial.printf("🛑 %s\n", reason);
    publishAck("rejected", action, reason, currentEC);
    return;
  }

  Serial.printf("✅ Safety check passed (EC: %.1f)\n", currentEC);
  publishAck("accepted", action, "Command accepted", currentEC);

  executeDosingCommand(action, durationSec);

  publishAck("completed", action, "Command completed", readECSensor());
}

static void executeDosingCommand(const String &action, float durationSec) {
  int gpio = -1;

  if (action == "phDown") {
    gpio = PUMP_PH_DOWN_GPIO;
  } else if (action == "ecMixA") {
    gpio = PUMP_EC_MIX_A_GPIO;
  } else if (action == "ecMixB") {
    gpio = PUMP_EC_MIX_B_GPIO;
  } else if (action == "stop") {
    stopAllPumps();
    return;
  }

  if (gpio < 0) {
    Serial.printf("❌ Unknown action: %s\n", action.c_str());
    return;
  }

  const float safeDurationSec = clampDoseDurationForAction(action, durationSec);

  Serial.printf("🔛 Activating %s on GPIO%d for %.1fs (requested %.1fs)\n",
                action.c_str(), gpio, safeDurationSec, durationSec);
  digitalWrite(gpio, PUMP_ACTIVE_STATE);
  pumpsAreStopped = false;

  unsigned long startTime = millis();
  unsigned long duration = static_cast<unsigned long>(safeDurationSec * 1000.0f);

  while (millis() - startTime < duration) {
    mqttClient.loop();
    delay(100);
  }

  digitalWrite(gpio, PUMP_INACTIVE_STATE);
  Serial.printf("🔴 Deactivated %s\n", action.c_str());

  if (action != "stop") {
    recordPumpRun(action, safeDurationSec);
  }
}

static void stopAllPumps() {
  if (!pumpsAreStopped) {
    Serial.println("🛑 EMERGENCY STOP - All pumps off");
  }
  digitalWrite(PUMP_PH_DOWN_GPIO, PUMP_INACTIVE_STATE);
  digitalWrite(PUMP_EC_MIX_A_GPIO, PUMP_INACTIVE_STATE);
  digitalWrite(PUMP_EC_MIX_B_GPIO, PUMP_INACTIVE_STATE);
  pumpsAreStopped = true;
}

// ========== Atlas Scientific EZO I2C Protocol Functions ==========

static bool atlasSendCommand(uint8_t addr, const char *cmd) {
  Wire.beginTransmission(addr);
  Wire.write(cmd);
  uint8_t error = Wire.endTransmission();
  
  if (error != 0) {
    Serial.printf("❌ Atlas I2C TX error to 0x%02X: %d\n", addr, error);
    return false;
  }
  return true;
}

static bool atlasReadResponse(uint8_t addr, char *buffer, size_t bufLen, uint8_t *status) {
  Wire.requestFrom(addr, bufLen);
  
  if (Wire.available() == 0) {
    Serial.printf("❌ Atlas I2C RX: No data from 0x%02X\n", addr);
    return false;
  }
  
  *status = Wire.read();  // First byte is status code
  
  size_t i = 0;
  while (Wire.available() && i < bufLen - 1) {
    buffer[i++] = Wire.read();
  }
  buffer[i] = '\0';  // Null terminate
  
  return true;
}

static float atlasReadFloat(uint8_t addr, const char *cmd) {
  if (!atlasSendCommand(addr, cmd)) {
    return -1.0f;
  }
  
  delay(900);  // Atlas sensors need 900ms to process "R" command
  
  char buffer[32];
  uint8_t status;
  
  if (!atlasReadResponse(addr, buffer, sizeof(buffer), &status)) {
    return -1.0f;
  }
  
  // Status byte meanings: 0x01 = success, 0x02 = still processing, 0xFF = no data
  if (status != 0x01) {
    Serial.printf("⚠️  Atlas sensor 0x%02X status: 0x%02X\n", addr, status);
    return -1.0f;
  }
  
  return atof(buffer);
}

static bool atlasSendAndCheckOK(uint8_t addr, const char *cmd, unsigned long waitMs) {
  if (!atlasSendCommand(addr, cmd)) {
    return false;
  }
  delay(waitMs);
  char buffer[32];
  uint8_t status = 0;
  if (!atlasReadResponse(addr, buffer, sizeof(buffer), &status)) {
    return false;
  }
  if (status != 0x01) {
    Serial.printf("⚠️  Atlas cmd status 0x%02X for '%s'\n", status, cmd);
    return false;
  }
  // Many EZO modules reply with "OK" on success; accept empty too
  String resp(buffer);
  resp.trim();
  if (resp.length() == 0 || resp.equalsIgnoreCase("OK") || resp.equalsIgnoreCase("SUCCESS")) {
    return true;
  }
  // For queries like Cal,? the response is not OK; treat any non-empty as success for caller to parse
  return true;
}

static void enableAtlasSensor(int gpioPin, bool enable) {
  digitalWrite(gpioPin, enable ? HIGH : LOW);
  if (enable) {
    delay(100);  // Allow sensor to power up
  }
}

// ========== Sensor Reading Functions ==========

static float readTemperatureSensor() {
  static unsigned long lastDebugMs = 0;
  bool debug = (millis() - lastDebugMs > 10000);
  
  if (debug) Serial.println("📡 Reading RTD temperature sensor...");
  
  float temp = atlasReadFloat(ATLAS_RTD_ADDR, "R");
  
  if (temp < 0) {
    Serial.println("❌ RTD read failed, using last known: " + String(lastTempReading) + "°C");
    return lastTempReading;
  }
  
  lastTempReading = temp;
  
  if (debug) {
    Serial.printf("🌡️  Temperature: %.2f°C\n", temp);
    lastDebugMs = millis();
  }
  
  return temp;
}

static float readPHSensor() {
  static unsigned long lastDebugMs = 0;
  bool debug = (millis() - lastDebugMs > 10000);
  
  // Send temperature compensation to pH sensor
  char tempCmd[16];
  snprintf(tempCmd, sizeof(tempCmd), "T,%.2f", lastTempReading);
  atlasSendCommand(ATLAS_PH_ADDR, tempCmd);
  delay(300);  // Short delay for temp comp
  
  if (debug) Serial.println("📡 Reading pH sensor...");
  
  float ph = atlasReadFloat(ATLAS_PH_ADDR, "R");
  
  if (ph < 0) {
    Serial.println("❌ pH read failed, returning default 6.5");
    return 6.5f;
  }
  
  if (debug) {
    Serial.printf("🧪 pH: %.2f\n", ph);
    lastDebugMs = millis();
  }
  
  return ph;
}

static float readECSensor() {
  static unsigned long lastDebugMs = 0;
  bool debug = (millis() - lastDebugMs > 10000);
  
  // Send temperature compensation to EC sensor
  char tempCmd[16];
  snprintf(tempCmd, sizeof(tempCmd), "T,%.2f", lastTempReading);
  atlasSendCommand(ATLAS_EC_ADDR, tempCmd);
  delay(300);  // Short delay for temp comp
  
  if (debug) Serial.println("📡 Reading EC sensor...");
  
  float ec = atlasReadFloat(ATLAS_EC_ADDR, "R");
  
  if (ec < 0) {
    Serial.println("❌ EC read failed, returning 0");
    return 0.0f;
  }
  
  if (debug) {
    Serial.printf("⚡ EC: %.1f µS/cm\n", ec);
    lastDebugMs = millis();
  }
  
  return ec;
}

static void publishAck(const String &status, const String &action, const String &reason, float ecValue) {
  StaticJsonDocument<512> doc;
  doc["status"] = status;
  doc["action"] = action;
  doc["reason"] = reason;
  doc["ec"] = ecValue;
  doc["emptyThreshold"] = EC_EMPTY_THRESHOLD;

  time_t now = time(nullptr);
  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);
  char timestamp[25];
  strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  doc["ts"] = timestamp;

  char buffer[512];
  serializeJson(doc, buffer);

  if (mqttClient.publish(ACK_TOPIC, buffer, false)) {
    Serial.printf("📤 Published ack: %s\n", status.c_str());
  } else {
    Serial.println("❌ Failed to publish ack");
  }
}

static void publishSensorData() {
  StaticJsonDocument<512> doc;
  doc["scope"] = "NutrientRoom";

  time_t now = time(nullptr);
  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);
  char timestamp[25];
  strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  doc["ts"] = timestamp;

  JsonObject sensors = doc.createNestedObject("sensors");

  JsonObject phObj = sensors.createNestedObject("ph");
  phObj["value"] = readPHSensor();

  JsonObject ecObj = sensors.createNestedObject("ec");
  ecObj["value"] = readECSensor();
  ecObj["unit"] = "uS/cm";

  JsonObject tempObj = sensors.createNestedObject("temperature");
  tempObj["value"] = readTemperatureSensor();

  attachSetpoints(doc);

  char buffer[512];
  serializeJson(doc, buffer);

  if (mqttClient.publish(SENSOR_TOPIC, buffer, false)) {
    Serial.println("📤 Published sensor data");
  } else {
    Serial.println("❌ Failed to publish sensor data");
  }
}

static void maybeAutodose() {
  const bool controlLinkOnline = isControlLinkOnline();
  const bool usingOfflineFallback = !controlLinkOnline;
  const bool autodoseEnabled = usingOfflineFallback ? DEFAULT_SAFE_AUTODOSE_ENABLED : setpoints.autodoseEnabled;
  const float phTarget = usingOfflineFallback ? DEFAULT_SAFE_PH_TARGET : setpoints.phTarget;
  const float phTolerance = usingOfflineFallback ? DEFAULT_SAFE_PH_DEADBAND : setpoints.phTolerance;
  const float ecTarget = usingOfflineFallback ? DEFAULT_SAFE_EC_TARGET : setpoints.ecTarget;
  const float ecTolerance = usingOfflineFallback ? DEFAULT_SAFE_EC_DEADBAND : setpoints.ecTolerance;
  const float minDoseIntervalSec = usingOfflineFallback ? DEFAULT_SAFE_DOSE_PAUSE_SEC : setpoints.minDoseIntervalSec;

  if (!autodoseEnabled) {
    return;
  }

  const unsigned long now = millis();
  if (now - lastAutodoseCheckMs < AUTODOSE_CHECK_INTERVAL_MS) {
    return;
  }
  lastAutodoseCheckMs = now;

  const unsigned long minPauseMs = minDoseIntervalSec > 0.0f
    ? static_cast<unsigned long>(minDoseIntervalSec * 1000.0f)
    : DOSE_WINDOW_COOLDOWN_MS;
  if (lastDoseActionMs != 0 && (now - lastDoseActionMs) < minPauseMs) {
    return;
  }

  // Keep Atlas sensors temp compensated before dosing decisions.
  readTemperatureSensor();
  float currentPh = readPHSensor();
  float currentEc = readECSensor();

  bool actionTaken = false;

  if (!actionTaken && ecTarget > 0.0f && ecTolerance > 0.0f &&
      setpoints.ecDoseSeconds >= MIN_DURATION_SEC) {
    const float ecLow = std::max(0.0f, ecTarget - ecTolerance);
    if (currentEc > 0.0f && currentEc < ecLow) {
      const String actionA = "ecMixA";
      const String actionB = "ecMixB";
      const float ecMixADoseSec = clampDoseDurationForAction(actionA, setpoints.ecDoseSeconds);
      const float ecMixBDoseSec = clampDoseDurationForAction(actionB, ecMixADoseSec * DEFAULT_EC_MIX_B_RATIO);
      char guardReason[128];
      if (!checkPumpGuardrails(actionA, ecMixADoseSec, guardReason, sizeof(guardReason))) {
        Serial.printf("🤖 Autodose EC skipped: %s\n", guardReason);
      } else if (!checkPumpGuardrails(actionB, ecMixBDoseSec, guardReason, sizeof(guardReason))) {
        Serial.printf("🤖 Autodose EC skipped: %s\n", guardReason);
      } else if (!isSafeToDose(actionA, currentEc) || !isSafeToDose(actionB, currentEc)) {
        Serial.println("🤖 Autodose EC blocked by safety guardrail");
      } else {
        Serial.printf("🤖 Autodose EC: %.1f < target %.1f, dosing A %.1fs then B %.1fs\n",
                      currentEc, ecTarget, ecMixADoseSec, ecMixBDoseSec);
        publishAck("auto-start", actionA, "Autodose EC A triggered", currentEc);
        executeDosingCommand(actionA, ecMixADoseSec);
        publishAck("auto-complete", actionA, "Autodose EC A completed", readECSensor());
        publishAck("auto-start", actionB, "Autodose EC B triggered", readECSensor());
        executeDosingCommand(actionB, ecMixBDoseSec);
        lastDoseActionMs = millis();
        publishAck("auto-complete", actionB, "Autodose EC B completed", readECSensor());
        actionTaken = true;
      }
    }
  }

  if (!actionTaken && phTarget > 0.0f && phTolerance > 0.0f &&
      setpoints.phDownDoseSeconds >= MIN_DURATION_SEC) {
    const float phHigh = phTarget + phTolerance;
    if (currentPh > phHigh) {
      const String action = "phDown";
      char guardReason[128];
      if (!checkPumpGuardrails(action, setpoints.phDownDoseSeconds, guardReason, sizeof(guardReason))) {
        Serial.printf("🤖 Autodose pH skipped: %s\n", guardReason);
      } else if (!isSafeToDose(action, currentEc)) {
        Serial.println("🤖 Autodose pH blocked by safety guardrail");
      } else {
        Serial.printf("🤖 Autodose pH: %.2f > target %.2f, dosing %.1fs\n",
                      currentPh, phTarget, setpoints.phDownDoseSeconds);
        publishAck("auto-start", action, "Autodose triggered", currentEc);
        executeDosingCommand(action, setpoints.phDownDoseSeconds);
        lastDoseActionMs = millis();
        publishAck("auto-complete", action, "Autodose completed", readECSensor());
        actionTaken = true;
      }
    }
  }

  if (actionTaken && controlLinkOnline) {
    publishSensorData();
  }
}

static void loadSetpointsFromStorage() {
  setpoints.phTarget = preferences.getFloat("phTarget", setpoints.phTarget);
  setpoints.phTolerance = preferences.getFloat("phTol", setpoints.phTolerance);
  setpoints.ecTarget = preferences.getFloat("ecTarget", setpoints.ecTarget);
  setpoints.ecTolerance = preferences.getFloat("ecTol", setpoints.ecTolerance);
  setpoints.ecDoseSeconds = preferences.getFloat("ecDose", setpoints.ecDoseSeconds);
  setpoints.phDownDoseSeconds = preferences.getFloat("phDose", setpoints.phDownDoseSeconds);
  setpoints.minDoseIntervalSec = preferences.getFloat("doseMin", setpoints.minDoseIntervalSec);
  setpoints.autodoseEnabled = preferences.getBool("autoDose", setpoints.autodoseEnabled);
  setpoints.updatedAtMs = millis();
  Serial.printf("📦 Loaded setpoints → pH %.2f±%.2f, EC %.0f±%.0f\n",
                setpoints.phTarget, setpoints.phTolerance, setpoints.ecTarget, setpoints.ecTolerance);
  Serial.printf("   Autodose: %s, EC dose %.1fs, pH- dose %.1fs, interval %.0fs\n",
                setpoints.autodoseEnabled ? "ENABLED" : "disabled",
                setpoints.ecDoseSeconds,
                setpoints.phDownDoseSeconds,
                setpoints.minDoseIntervalSec);
}

static void persistSetpointsToStorage() {
  preferences.putFloat("phTarget", setpoints.phTarget);
  preferences.putFloat("phTol", setpoints.phTolerance);
  preferences.putFloat("ecTarget", setpoints.ecTarget);
  preferences.putFloat("ecTol", setpoints.ecTolerance);
  preferences.putFloat("ecDose", setpoints.ecDoseSeconds);
  preferences.putFloat("phDose", setpoints.phDownDoseSeconds);
  preferences.putFloat("doseMin", setpoints.minDoseIntervalSec);
  preferences.putBool("autoDose", setpoints.autodoseEnabled);
  setpoints.updatedAtMs = millis();
  Serial.println("💾 Setpoints persisted to NVS");
}

static void attachSetpoints(JsonDocument &doc) {
  const bool controlLinkOnline = isControlLinkOnline();
  const bool usingOfflineFallback = !controlLinkOnline;
  const float effectivePhTolerance = usingOfflineFallback ? DEFAULT_SAFE_PH_DEADBAND : setpoints.phTolerance;
  const float effectiveEcTolerance = usingOfflineFallback ? DEFAULT_SAFE_EC_DEADBAND : setpoints.ecTolerance;
  const float effectiveMinDoseIntervalSec = usingOfflineFallback ? DEFAULT_SAFE_DOSE_PAUSE_SEC : setpoints.minDoseIntervalSec;

  JsonObject targets = doc.createNestedObject("targets");
  targets["phTarget"] = setpoints.phTarget;
  targets["phTolerance"] = setpoints.phTolerance;
  targets["ecTarget"] = setpoints.ecTarget;
  targets["ecTolerance"] = setpoints.ecTolerance;
  targets["updatedAtMs"] = setpoints.updatedAtMs;
  targets["autodoseEnabled"] = setpoints.autodoseEnabled;
  targets["offlineFallbackActive"] = usingOfflineFallback;
  targets["effectivePhTarget"] = usingOfflineFallback ? DEFAULT_SAFE_PH_TARGET : setpoints.phTarget;
  targets["effectiveEcTarget"] = usingOfflineFallback ? DEFAULT_SAFE_EC_TARGET : setpoints.ecTarget;
  targets["effectivePhTolerance"] = effectivePhTolerance;
  targets["effectiveEcTolerance"] = effectiveEcTolerance;
  targets["effectiveAutodoseEnabled"] = usingOfflineFallback ? DEFAULT_SAFE_AUTODOSE_ENABLED : setpoints.autodoseEnabled;

  JsonObject dosing = targets.createNestedObject("dosing");
  dosing["ecDoseSeconds"] = setpoints.ecDoseSeconds;
  dosing["phDownDoseSeconds"] = setpoints.phDownDoseSeconds;
  dosing["minDoseIntervalSec"] = setpoints.minDoseIntervalSec;
  dosing["effectiveMinDoseIntervalSec"] = effectiveMinDoseIntervalSec;

  JsonObject guard = doc.createNestedObject("guardrails");
  guard["dailyPhRuntimeSec"] = phDownGuard.dailyRuntimeSec;
  guard["dailyEcARuntimeSec"] = ecMixAGuard.dailyRuntimeSec;
  guard["dailyEcBRuntimeSec"] = ecMixBGuard.dailyRuntimeSec;
  const unsigned long cooldownMs = setpoints.minDoseIntervalSec > 0.0f
    ? static_cast<unsigned long>(setpoints.minDoseIntervalSec * 1000.0f)
    : DOSE_WINDOW_COOLDOWN_MS;
  guard["cooldownMs"] = cooldownMs;
  guard["effectiveCooldownMs"] = static_cast<unsigned long>(effectiveMinDoseIntervalSec * 1000.0f);
}

static PumpGuardState &guardStateForAction(const String &action) {
  if (action == "phDown") {
    return phDownGuard;
  }
  if (action == "ecMixA") {
    return ecMixAGuard;
  }
  if (action == "ecMixB") {
    return ecMixBGuard;
  }
  return phDownGuard;
}

static float dailyLimitForAction(const String &action) {
  if (action == "phDown") {
    return MAX_PH_DAILY_RUNTIME_SEC;
  }
  if (action == "ecMixA" || action == "ecMixB") {
    return MAX_EC_DAILY_RUNTIME_SEC;
  }
  return 0.0f;
}

static bool checkPumpGuardrails(const String &action, float requestedDurationSec, char *reason, size_t reasonLen) {
  if (action == "stop") {
    return true;
  }

  PumpGuardState &state = guardStateForAction(action);
  const float dailyLimit = dailyLimitForAction(action);
  const unsigned long now = millis();
  const unsigned long dayMs = 24UL * 60UL * 60UL * 1000UL;

  if (state.dailyResetMs == 0 || now - state.dailyResetMs >= dayMs) {
    state.dailyResetMs = now;
    state.dailyRuntimeSec = 0.0f;
  }

  if (requestedDurationSec > MAX_RUNTIME_PER_WINDOW_SEC + 0.0001f) {
    snprintf(reason, reasonLen, "Safety block: requested %.1fs > per-cycle limit %.1fs", requestedDurationSec, MAX_RUNTIME_PER_WINDOW_SEC);
    return false;
  }

  if (dailyLimit > 0.0f && (state.dailyRuntimeSec + requestedDurationSec) > dailyLimit + 0.0001f) {
    snprintf(reason, reasonLen, "Daily runtime cap reached (%.0fs/%.0fs)", state.dailyRuntimeSec, dailyLimit);
    return false;
  }

  const unsigned long cooldownMs = setpoints.minDoseIntervalSec > 0.0f
    ? static_cast<unsigned long>(setpoints.minDoseIntervalSec * 1000.0f)
    : DOSE_WINDOW_COOLDOWN_MS;

  if (state.lastDoseMs != 0 && (now - state.lastDoseMs) < cooldownMs) {
    const unsigned long waitMs = cooldownMs - (now - state.lastDoseMs);
    const float waitSec = waitMs / 1000.0f;
    snprintf(reason, reasonLen, "Cooldown active: wait %.0fs", waitSec);
    return false;
  }

  reason[0] = '\0';
  return true;
}

static void recordPumpRun(const String &action, float durationSec) {
  if (action == "stop") {
    return;
  }

  PumpGuardState &state = guardStateForAction(action);
  const unsigned long now = millis();
  const unsigned long dayMs = 24UL * 60UL * 60UL * 1000UL;

  if (state.dailyResetMs == 0 || now - state.dailyResetMs >= dayMs) {
    state.dailyResetMs = now;
    state.dailyRuntimeSec = 0.0f;
  }

  state.dailyRuntimeSec += durationSec;
  state.lastDoseMs = now;
}

static float maxDurationForAction(const String &action) {
  if (action == "phDown") {
    return MAX_DURATION_PH_SEC;
  }

  if (action == "ecMixA" || action == "ecMixB") {
    return MAX_DURATION_EC_SEC;
  }

  return 0.0f;
}

static float minDurationForAction(const String &action) {
  if (action == "stop") {
    return 0.0f;
  }

  return MIN_DURATION_SEC;
}

static float clampDoseDurationForAction(const String &action, float durationSec) {
  const float minDuration = minDurationForAction(action);
  const float maxDuration = maxDurationForAction(action);

  float safeDurationSec = durationSec;
  if (maxDuration > 0.0f && safeDurationSec > maxDuration) {
    safeDurationSec = maxDuration;
  }

  if (safeDurationSec < minDuration) {
    safeDurationSec = minDuration;
  }

  return safeDurationSec;
}

static void processSerialInput() {
  while (Serial.available() > 0) {
    char incoming = static_cast<char>(Serial.read());
    if (incoming == '\r' || incoming == '\n') {
      serialBuffer.trim();
      if (serialBuffer.length() > 0) {
        handleSerialCommand(serialBuffer);
      }
      serialBuffer = "";
    } else if (serialBuffer.length() < 128) {
      serialBuffer += incoming;
    }
  }
}

static void handleSerialCommand(const String &command) {
  if (command.equalsIgnoreCase("STOP") || command.equalsIgnoreCase("PAUSE")) {
    stopAllPumps();
    Serial.println("🟢 STOP command (USB) executed. All pumps off.");
    lastUsbStopPulseMs = millis();
    return;
  }

  if (command.equalsIgnoreCase("STATUS")) {
    const bool controlLinkOnline = isControlLinkOnline();
    const bool usingOfflineFallback = !controlLinkOnline;
    const float effectivePhTarget = usingOfflineFallback ? DEFAULT_SAFE_PH_TARGET : setpoints.phTarget;
    const float effectivePhTolerance = usingOfflineFallback ? DEFAULT_SAFE_PH_DEADBAND : setpoints.phTolerance;
    const float effectiveEcTarget = usingOfflineFallback ? DEFAULT_SAFE_EC_TARGET : setpoints.ecTarget;
    const float effectiveEcTolerance = usingOfflineFallback ? DEFAULT_SAFE_EC_DEADBAND : setpoints.ecTolerance;
    const float effectivePauseSec = usingOfflineFallback ? DEFAULT_SAFE_DOSE_PAUSE_SEC : setpoints.minDoseIntervalSec;
    const bool effectiveAutodose = usingOfflineFallback ? DEFAULT_SAFE_AUTODOSE_ENABLED : setpoints.autodoseEnabled;
    float ec = readECSensor();
    Serial.printf("ℹ️  Status → EC: %.1f uS/cm, WiFi: %s, MQTT: %s, target pH: %.2f±%.2f, target EC: %.0f±%.0f, pause: %.0fs, autodose: %s, fallback: %s\n",
                  ec,
                  networkEnabled ? (WiFi.status() == WL_CONNECTED ? "connected" : "retrying") : "disabled",
                  controlLinkOnline ? "connected" : "offline",
                  effectivePhTarget,
                  effectivePhTolerance,
                  effectiveEcTarget,
                  effectiveEcTolerance,
                  effectivePauseSec,
                  effectiveAutodose ? "ENABLED" : "disabled",
                  usingOfflineFallback ? "ON" : "off");
    return;
  }

  if (command.equalsIgnoreCase("SAFE")) {
    setpoints.phTarget = DEFAULT_SAFE_PH_TARGET;
    setpoints.ecTarget = DEFAULT_SAFE_EC_TARGET;
    setpoints.phTolerance = DEFAULT_SAFE_PH_DEADBAND;
    setpoints.ecTolerance = DEFAULT_SAFE_EC_DEADBAND;
    setpoints.minDoseIntervalSec = DEFAULT_SAFE_DOSE_PAUSE_SEC;
    setpoints.autodoseEnabled = DEFAULT_SAFE_AUTODOSE_ENABLED;
    persistSetpointsToStorage();
    lastAutodoseCheckMs = 0;
    lastDoseActionMs = 0;
    Serial.printf("✅ SAFE profile applied: pH %.2f±%.2f, EC %.0f±%.0f, pause %.0fs, autodose ENABLED\n",
                  setpoints.phTarget,
                  setpoints.phTolerance,
                  setpoints.ecTarget,
                  setpoints.ecTolerance,
                  setpoints.minDoseIntervalSec);
    return;
  }

  // WIFI <ssid> <password>
  if (command.startsWith("WIFI ")) {
    int sp = command.indexOf(' ');
    String rest = command.substring(sp + 1);
    int sp2 = rest.indexOf(' ');
    if (sp2 > 0) {
      String ssid = rest.substring(0, sp2);
      String pwd = rest.substring(sp2 + 1);
      saveWifiConfig(ssid, pwd);
      runtimeWifiSsid = ssid;
      runtimeWifiPwd = pwd;
      wifiConfigured = true; // enable network logic in loop
      Serial.printf("✅ Saved WiFi → SSID:%s\n", ssid.c_str());
      WiFi.disconnect(true, true);
      delay(100);
      WiFi.mode(WIFI_STA);
      Serial.printf("Connecting to WiFi: %s\n", runtimeWifiSsid.c_str());
      WiFi.begin(runtimeWifiSsid.c_str(), runtimeWifiPwd.c_str());
      lastWifiAttemptMs = millis();
      unsigned long wifiStart = millis();
      while (WiFi.status() != WL_CONNECTED && (millis() - wifiStart) < 15000UL) {
        delay(500);
        Serial.print(".");
      }
      if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n✅ WiFi connected");
        Serial.printf("IP: %s\n", WiFi.localIP().toString().c_str());
        networkEnabled = true;
        mqttClient.setServer(runtimeMqttHost.c_str(), runtimeMqttPort);
        mqttClient.setCallback(mqttCallback);
        mqttClient.setKeepAlive(60);
        mqttClient.setBufferSize(1024);
        reconnectMQTT();
      } else {
        Serial.println("\n⚠️  WiFi connection failed");
        networkEnabled = false;
      }
    } else {
      Serial.println("⚠️  WIFI command requires SSID and PASSWORD");
    }
    return;
  }  // BROKER <host> [port]
  if (command.startsWith("BROKER ")) {
    int sp = command.indexOf(' ');
    String rest = command.substring(sp + 1);
    String host = rest;
    int port = runtimeMqttPort;
    int sp2 = rest.indexOf(' ');
    if (sp2 > 0) {
      host = rest.substring(0, sp2);
      port = rest.substring(sp2 + 1).toInt();
      if (port <= 0) port = 1883;
    }
    saveBrokerConfig(host, port);
    runtimeMqttHost = host;
    runtimeMqttPort = port;
    Serial.printf("✅ Saved broker → %s:%d\n", runtimeMqttHost.c_str(), runtimeMqttPort);
    if (mqttClient.connected()) mqttClient.disconnect();
    mqttClient.setServer(runtimeMqttHost.c_str(), runtimeMqttPort);
    reconnectMQTT();
    return;
  }

  if (command.equalsIgnoreCase("PUBLISH")) {
    publishSensorData();
    return;
  }

  if (command.equalsIgnoreCase("SENSORS")) {
    Serial.println("🔬 Atlas EZO Sensor Diagnostics:");
    Serial.println("   Reading sensors via I2C...\n");
    
    // Read temperature first (needed for compensation)
    Serial.printf("   🌡️  RTD (0x%02X): ", ATLAS_RTD_ADDR);
    float temp = readTemperatureSensor();
    Serial.printf("%.2f°C %s\n", temp, (temp > 0 && temp < 100) ? "✅" : "⚠️ ");
    
    delay(1000);  // Give sensors time to settle
    
    // Read pH with temperature compensation
    Serial.printf("   🧪 pH (0x%02X): ", ATLAS_PH_ADDR);
    float ph = readPHSensor();
    Serial.printf("%.2f %s\n", ph, (ph > 0 && ph < 14) ? "✅" : "⚠️ ");
    
    delay(1000);
    
    // Read EC with temperature compensation
    Serial.printf("   ⚡ EC (0x%02X): ", ATLAS_EC_ADDR);
    float ec = readECSensor();
    Serial.printf("%.1f µS/cm %s\n", ec, (ec >= 0) ? "✅" : "⚠️ ");
    
    Serial.println("\n   Sensor Status Legend:");
    Serial.println("   ✅ = Valid reading received");
    Serial.println("   ⚠️  = Out of range or failed to read");
    Serial.println("\n   I2C Bus: SDA=" + String(I2C_SDA_PIN) + ", SCL=" + String(I2C_SCL_PIN));
    Serial.println("   Frequency: " + String(I2C_FREQ / 1000) + " kHz");
    return;
  }

  if (command.equalsIgnoreCase("SCAN")) {
    Serial.println("🔍 I2C Bus Scanner");
    Serial.println("   Scanning addresses 0x01-0x7F...\n");
    int found = 0;
    
    for (uint8_t addr = 1; addr < 128; addr++) {
      Wire.beginTransmission(addr);
      int error = Wire.endTransmission();
      
      if (error == 0) {
        Serial.printf("   ✅ Device found at 0x%02X", addr);
        // Identify known Atlas sensors
        if (addr == ATLAS_PH_ADDR) Serial.print(" (pH sensor)");
        else if (addr == ATLAS_EC_ADDR) Serial.print(" (EC sensor)");
        else if (addr == ATLAS_RTD_ADDR) Serial.print(" (RTD sensor)");
        Serial.println();
        found++;
      } else if (error == 4) {
        Serial.printf("   ⚠️  Unknown error at 0x%02X\n", addr);
      }
      delay(10);
    }
    
    Serial.printf("\n   Scan complete. Found %d device(s).\n", found);
    Serial.println("   Expected: pH=0x63, EC=0x64, RTD=0x66");
    
    // Check GPIO power enables
    Serial.println("\n   Power Enable GPIOs:");
    Serial.printf("   EN_PH (GPIO %d):  %s\n", EN_PH_GPIO, digitalRead(EN_PH_GPIO) ? "HIGH ✅" : "LOW ⚠️ ");
    Serial.printf("   EN_EC (GPIO %d):  %s\n", EN_EC_GPIO, digitalRead(EN_EC_GPIO) ? "HIGH ✅" : "LOW ⚠️ ");
    Serial.printf("   EN_RTD (GPIO %d): %s\n", EN_RTD_GPIO, digitalRead(EN_RTD_GPIO) ? "HIGH ✅" : "LOW ⚠️ ");
    return;
  }

  if (command.equalsIgnoreCase("ECPOWER")) {
    Serial.println("🔌 EC Sensor Power Cycle Test");
    Serial.println("   Testing GPIO 27 (EN_EC) control...\n");
    
    Serial.println("   Step 1: Turn OFF EC power (LOW)");
    digitalWrite(EN_EC_GPIO, LOW);
    pinMode(EN_EC_GPIO, OUTPUT);
    digitalWrite(EN_EC_GPIO, LOW);
    Serial.printf("   GPIO %d set to: %s\n", EN_EC_GPIO, digitalRead(EN_EC_GPIO) ? "HIGH" : "LOW");
    Serial.println("   ⏳ Waiting 3 seconds... (EC LED should be OFF)");
    delay(3000);
    
    Serial.println("\n   Step 2: Turn ON EC power (HIGH)");
    digitalWrite(EN_EC_GPIO, HIGH);
    Serial.printf("   GPIO %d set to: %s\n", EN_EC_GPIO, digitalRead(EN_EC_GPIO) ? "HIGH" : "LOW");
    Serial.println("   ⏳ Waiting 3 seconds... (EC LED should be ON)");
    delay(3000);
    
    Serial.println("\n   Step 3: Scanning I2C bus for EC sensor...");
    Wire.beginTransmission(ATLAS_EC_ADDR);
    int error = Wire.endTransmission();
    
    if (error == 0) {
      Serial.printf("   ✅ EC sensor FOUND at 0x%02X!\n", ATLAS_EC_ADDR);
    } else {
      Serial.printf("   ❌ EC sensor NOT responding at 0x%02X (error: %d)\n", ATLAS_EC_ADDR, error);
      Serial.println("   Possible causes:");
      Serial.println("     - GPIO 27 not connected to EN_EC on board");
      Serial.println("     - EC sensor board hardware failure");
      Serial.println("     - Wrong GPIO pin for EC enable");
    }
    
    Serial.println("\n   Full I2C scan:");
    int found = 0;
    for (uint8_t addr = 1; addr < 128; addr++) {
      Wire.beginTransmission(addr);
      if (Wire.endTransmission() == 0) {
        Serial.printf("     0x%02X ", addr);
        found++;
        if (found % 8 == 0) Serial.println();
      }
    }
    if (found % 8 != 0) Serial.println();
    Serial.printf("\n   Total devices found: %d\n", found);
    return;
  }

  // ECCAL [CLEAR|DRY|ONE <uS>|LOW <uS>|HIGH <uS>|STATE]
  if (command.startsWith("ECCAL")) {
    // Ensure temperature compensation is up to date for EC
    float temp = readTemperatureSensor();
    char tcmd[16];
    snprintf(tcmd, sizeof(tcmd), "T,%.2f", temp);
    atlasSendCommand(ATLAS_EC_ADDR, tcmd);
    delay(300);

    String args = command.substring(5);
    args.trim();
    args.toUpperCase();

    if (args == "" || args == "HELP") {
      Serial.println("📏 EC Calibration Usage:");
      Serial.println("   ECCAL CLEAR               - Clear EC calibration");
      Serial.println("   ECCAL DRY                 - Dry calibration (probe in air, dry)");
      Serial.println("   ECCAL ONE <uS>           - Single-point calibration (e.g., 1413)");
      Serial.println("   ECCAL LOW <uS>           - Low-point (e.g., 84)");
      Serial.println("   ECCAL HIGH <uS>          - High-point (e.g., 12880)");
      Serial.println("   ECCAL STATE              - Show EC calibration status");
      Serial.println("Notes: Put RTD & EC probe in the same bath. Use solution value at current temperature.");
      return;
    }

    if (args.startsWith("CLEAR")) {
      bool ok = atlasSendAndCheckOK(ATLAS_EC_ADDR, "Cal,clear", 300);
      Serial.println(ok ? "✅ EC Cal cleared" : "❌ EC Cal clear failed");
      return;
    }

    if (args.startsWith("DRY")) {
      Serial.println("🧼 Ensure probe is clean and dry in air...");
      bool ok = atlasSendAndCheckOK(ATLAS_EC_ADDR, "Cal,dry", 900);
      Serial.println(ok ? "✅ EC Cal DRY OK" : "❌ EC Cal DRY FAILED");
      return;
    }

    if (args.startsWith("STATE")) {
      if (!atlasSendCommand(ATLAS_EC_ADDR, "Cal,?")) {
        Serial.println("❌ Failed to query EC cal state");
        return;
      }
      delay(300);
      char buf[32];
      uint8_t st = 0;
      if (!atlasReadResponse(ATLAS_EC_ADDR, buf, sizeof(buf), &st)) {
        Serial.println("❌ No response");
        return;
      }
      Serial.printf("📊 EC Cal state (status 0x%02X): %s\n", st, buf);
      return;
    }

    auto parseuS = [&]() -> String {
      int sp = args.indexOf(' ');
      if (sp < 0) return String("");
      String v = args.substring(sp + 1);
      v.trim();
      return v;
    };

    if (args.startsWith("ONE")) {
      String val = parseuS();
      if (val.length() == 0) {
        Serial.println("⚠️  ECCAL ONE requires a value in uS/cm, e.g., 'ECCAL ONE 1413'");
        return;
      }
      String cmd = String("Cal,one,") + val;
      bool ok = atlasSendAndCheckOK(ATLAS_EC_ADDR, cmd.c_str(), 900);
      Serial.printf(ok ? "✅ EC Cal ONE %s OK\n" : "❌ EC Cal ONE %s FAILED\n", val.c_str());
      return;
    }

    if (args.startsWith("LOW")) {
      String val = parseuS();
      if (val.length() == 0) {
        Serial.println("⚠️  ECCAL LOW requires a value in uS/cm, e.g., 'ECCAL LOW 84'");
        return;
      }
      String cmd = String("Cal,low,") + val;
      bool ok = atlasSendAndCheckOK(ATLAS_EC_ADDR, cmd.c_str(), 900);
      Serial.printf(ok ? "✅ EC Cal LOW %s OK\n" : "❌ EC Cal LOW %s FAILED\n", val.c_str());
      return;
    }

    if (args.startsWith("HIGH")) {
      String val = parseuS();
      if (val.length() == 0) {
        Serial.println("⚠️  ECCAL HIGH requires a value in uS/cm, e.g., 'ECCAL HIGH 12880'");
        return;
      }
      String cmd = String("Cal,high,") + val;
      bool ok = atlasSendAndCheckOK(ATLAS_EC_ADDR, cmd.c_str(), 900);
      Serial.printf(ok ? "✅ EC Cal HIGH %s OK\n" : "❌ EC Cal HIGH %s FAILED\n", val.c_str());
      return;
    }

    Serial.println("⚠️  Unknown ECCAL subcommand. Type 'ECCAL HELP'");
    return;
  }
  // PHCAL [CLEAR|MID [value]|LOW [value]|HIGH [value]|STATE]
  if (command.startsWith("PHCAL")) {
    // Ensure we have recent temperature for compensation
    float temp = readTemperatureSensor();
    char tcmd[16];
    snprintf(tcmd, sizeof(tcmd), "T,%.2f", temp);
    atlasSendCommand(ATLAS_PH_ADDR, tcmd);
    delay(300);

    // Parse subcommand
    String args = command.substring(5);
    args.trim();
    args.toUpperCase();

    if (args == "" || args == "HELP") {
      Serial.println("📏 pH Calibration Usage:");
      Serial.println("   PHCAL CLEAR                 - Clear existing calibration");
      Serial.println("   PHCAL MID [7.00]           - Mid-point calibration");
      Serial.println("   PHCAL LOW [4.00]           - Low-point calibration");
      Serial.println("   PHCAL HIGH [10.00]         - High-point calibration");
      Serial.println("   PHCAL STATE                - Show calibration status");
      return;
    }

    if (args.startsWith("CLEAR")) {
      bool ok = atlasSendAndCheckOK(ATLAS_PH_ADDR, "Cal,clear", 300);
      Serial.println(ok ? "✅ pH Cal cleared" : "❌ pH Cal clear failed");
      return;
    }

    if (args.startsWith("STATE")) {
      // Query calibration status
      if (!atlasSendCommand(ATLAS_PH_ADDR, "Cal,?")) {
        Serial.println("❌ Failed to query pH cal state");
        return;
      }
      delay(300);
      char buf[32];
      uint8_t st = 0;
      if (!atlasReadResponse(ATLAS_PH_ADDR, buf, sizeof(buf), &st)) {
        Serial.println("❌ No response");
        return;
      }
      Serial.printf("📊 pH Cal state (status 0x%02X): %s\n", st, buf);
      return;
    }

    auto parseValue = [&](const char *defStr) -> String {
      int sp = args.indexOf(' ');
      if (sp < 0) return String(defStr);
      String v = args.substring(sp + 1);
      v.trim();
      if (v.length() == 0) return String(defStr);
      return v;
    };

    if (args.startsWith("MID")) {
      String val = parseValue("7.00");
      String cmd = String("Cal,mid,") + val;
      bool ok = atlasSendAndCheckOK(ATLAS_PH_ADDR, cmd.c_str(), 900);
      Serial.printf(ok ? "✅ pH Cal MID %s OK\n" : "❌ pH Cal MID %s FAILED\n", val.c_str());
      return;
    }

    if (args.startsWith("LOW")) {
      String val = parseValue("4.00");
      String cmd = String("Cal,low,") + val;
      bool ok = atlasSendAndCheckOK(ATLAS_PH_ADDR, cmd.c_str(), 900);
      Serial.printf(ok ? "✅ pH Cal LOW %s OK\n" : "❌ pH Cal LOW %s FAILED\n", val.c_str());
      return;
    }

    if (args.startsWith("HIGH")) {
      String val = parseValue("10.00");
      String cmd = String("Cal,high,") + val;
      bool ok = atlasSendAndCheckOK(ATLAS_PH_ADDR, cmd.c_str(), 900);
      Serial.printf(ok ? "✅ pH Cal HIGH %s OK\n" : "❌ pH Cal HIGH %s FAILED\n", val.c_str());
      return;
    }

    Serial.println("⚠️  Unknown PHCAL subcommand. Type 'PHCAL HELP'");
    return;
  }

  Serial.printf("❓ Unknown USB command: %s\n", command.c_str());
  Serial.println("   Available commands:");
  Serial.println("     STOP              - Emergency stop all pumps");
  Serial.println("     STATUS            - Show current sensor readings and connection status");
  Serial.println("     SENSORS           - Detailed Atlas EZO sensor diagnostics");
  Serial.println("     SCAN              - Scan I2C bus for connected devices");
  Serial.println("     ECPOWER           - Test EC sensor power control (GPIO 27)");
  Serial.println("     ECCAL ...         - EC calibration (type 'ECCAL HELP')");
  Serial.println("     PHCAL ...         - pH calibration (type 'PHCAL HELP')");
  Serial.println("     SAFE              - Apply safe defaults (pH 5.80±0.15, EC 1300±50, pause 60s, autodose ON)");
  Serial.println("     WIFI <ssid> <pwd> - Configure WiFi credentials");
  Serial.println("     BROKER <host>     - Configure MQTT broker");
  Serial.println("     PUBLISH           - Force immediate telemetry publish");
}

static void loadNetworkConfig() {
  // Defaults
  runtimeWifiSsid = WIFI_SSID;
  runtimeWifiPwd = WIFI_PASSWORD;
  runtimeMqttHost = MQTT_BROKER;
  runtimeMqttPort = MQTT_PORT;

  String s = netprefs.getString("ssid", runtimeWifiSsid);
  String p = netprefs.getString("pwd", runtimeWifiPwd);
  String h = netprefs.getString("host", runtimeMqttHost);
  int prt = netprefs.getInt("port", runtimeMqttPort);

  if (s.length()) runtimeWifiSsid = s;
  if (p.length()) runtimeWifiPwd = p;
  if (h.length()) runtimeMqttHost = h;
  if (prt > 0) runtimeMqttPort = prt;

  Serial.printf("📡 NetCfg → SSID:%s, MQTT:%s:%d\n", runtimeWifiSsid.c_str(), runtimeMqttHost.c_str(), runtimeMqttPort);
}

static void saveWifiConfig(const String &ssid, const String &pwd) {
  netprefs.putString("ssid", ssid);
  netprefs.putString("pwd", pwd);
}

static void saveBrokerConfig(const String &host, int port) {
  netprefs.putString("host", host);
  netprefs.putInt("port", port);
}
