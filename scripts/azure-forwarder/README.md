# Azure IoT -> Charlie Env Forwarder (Local)

This optional helper consumes environment telemetry and forwards it to Charlie's local `/env` endpoint.

You can use it when prototyping Azure IoT ingestion or when replaying recorded payloads.

## Usage

1. Prepare a JSONL file with one JSON object per line containing fields compatible with `/env`:

- scope (string, or zoneId/room fields that can be mapped)
- sensors.temp (number, °C)
- sensors.rh (number, %)
- sensors.vpd (number, kPa)
- sensors.co2 (number, ppm)
- ts (number or ISO timestamp)
- meta.* (optional metadata such as name, battery, rssi, source)

2. Run the forwarder and point it at your file.

```sh
node forward-jsonl.js ./sample-env.jsonl
```

3. Open the dashboard. The Environment section will poll `/env` every 10 seconds and reflect updates.

## Notes

- This script is a local helper, not a production pipeline. Replace with your Azure Function, IoT Hub consumer, or Logic App as needed.
