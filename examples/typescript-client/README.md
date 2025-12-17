# Light Engine Charlie - TypeScript Client Example

This example project demonstrates type-safe API interactions with the Light Engine Charlie platform using TypeScript.

## Features

✅ **Full Type Safety** - All API requests and responses are strongly typed  
✅ **IDE Autocomplete** - IntelliSense support for all methods and properties  
✅ **Compile-Time Validation** - Catch errors before runtime  
✅ **Comprehensive Examples** - 11 real-world usage scenarios  
✅ **Production Ready** - Error handling, timeouts, and retries included

## Installation

```bash
cd examples/typescript-client
npm install
```

## Type Checking

Verify that all types are correct without running the code:

```bash
npm run type-check
```

This will compile TypeScript and check for type errors without emitting any JavaScript files.

## Building

Compile TypeScript to JavaScript:

```bash
npm run build
```

Output will be in the `dist/` directory.

## Running Examples

### Development Mode (with ts-node)

```bash
npm run dev
```

### Production Mode (compiled JavaScript)

```bash
npm run build
npm start
```

## Prerequisites

The Light Engine Charlie backend must be running:

```bash
# In the main project directory
python3 -m backend &
```

The backend should be accessible at `http://localhost:8000`.

## Type Definitions

This example uses the type definitions from `src/types/api.ts` in the main project:

### Core Types
- `SensorPayload` - Sensor data ingestion format
- `LatestReadingsResponse` - Latest sensor readings
- `DiscoveryDevice` - Discovered device metadata
- `NetworkTestRequest` - Network connectivity test
- `DeviceCommandRequest` - Device control commands
- `AutomationRule` - Automation rule definition
- `FailsafePowerRequest` - Emergency lighting control

### Type Guards
- `isErrorResponse()` - Check if response is an error
- `isSuccessResponse()` - Check if response is successful

## Example Scenarios

The `src/examples.ts` file demonstrates:

1. **Health Check** - Verify API availability
2. **Sensor Data Ingestion** - Type-safe sensor payload
3. **Latest Readings** - Retrieve current sensor values
4. **Device Discovery** - Trigger and retrieve device scans
5. **Network Testing** - Validate connectivity
6. **Device Commands** - Control devices with type safety
7. **Lighting Fixtures** - Get fixture metadata
8. **Automation Rules** - Create and manage rules
9. **Rule Management** - List and update rules
10. **Emergency Failsafe** - Immediate power control
11. **Type Safety Benefits** - Compile-time error prevention

## API Client Usage

```typescript
import { LightEngineClient } from './client';
import type { SensorPayload } from './types';

// Initialize client
const client = new LightEngineClient({
  baseUrl: 'http://localhost:8000',
  timeout: 10000,
  apiKey: 'optional-jwt-token'
});

// Type-safe sensor data ingestion
const payload: SensorPayload = {
  scope: 'VegRoom1',
  ts: new Date().toISOString(),
  sensors: {
    temperature: { value: 75.2, unit: 'F' },
    humidity: { value: 60.5, unit: '%' }
  }
};

await client.ingestSensorData(payload);

// Type-safe device discovery
const devices = await client.getDiscoveredDevices();
console.log(`Found ${devices.count} devices`);

// Type-safe automation rule
const rule: AutomationRule = {
  name: 'Temperature Alert',
  enabled: true,
  conditions: { sensor: 'temperature', operator: 'gt', value: 85 },
  actions: { notification: { type: 'alert' } },
  priority: 10
};

await client.createRule(rule);
```

## Type Safety Benefits

### Before (No Types)
```javascript
// No autocomplete, runtime errors possible
const result = await fetch('/api/env/ingest', {
  body: JSON.stringify({
    scop: 'VegRoom1', // Typo! Will fail at runtime
    sensors: { temp: 75 } // Wrong field name
  })
});
```

### After (With Types)
```typescript
// TypeScript catches errors at compile time
const payload: SensorPayload = {
  scop: 'VegRoom1', // ❌ Error: Property 'scop' does not exist
  sensors: { temp: { value: 75 } } // ❌ Error: Type is missing 'unit'
};

// Correct version with IDE autocomplete
const payload: SensorPayload = {
  scope: 'VegRoom1', // ✅ Autocomplete suggests 'scope'
  ts: new Date().toISOString(),
  sensors: {
    temperature: { value: 75, unit: 'F' } // ✅ Autocomplete suggests all fields
  }
};
```

## Testing Output

When you run `npm run dev`, you should see:

```
🌱 Light Engine Charlie - Type-Safe API Examples

1️⃣ Health Check
   Status: running
   Version: 1.0.0

2️⃣ Ingest Sensor Data (Type-Safe)
   Ingested: "Sensor data ingested"

3️⃣ Get Latest Readings
   Scope: VegRoom1
   Sensors: temperature, humidity, co2
   Observed: 2025-12-06T12:00:00Z

...

✅ All examples completed successfully!

📊 Type Safety Benefits:
   - IDE autocomplete for all API methods
   - Compile-time type checking
   - IntelliSense for request/response objects
   - Catch errors before runtime
```

## Project Structure

```
typescript-client/
├── src/
│   ├── client.ts       # Main API client class
│   ├── examples.ts     # Usage examples
│   ├── index.ts        # Entry point
│   └── types.ts        # Type re-exports
├── dist/               # Compiled JavaScript (after build)
├── package.json        # Dependencies
├── tsconfig.json       # TypeScript configuration
└── README.md           # This file
```

## Next Steps

- **Extend the Client**: Add more methods for your specific use cases
- **Add Tests**: Write unit tests using Jest or Vitest
- **Publish as Package**: Share as `@light-engine/typescript-client` on npm
- **Generate from OpenAPI**: Auto-generate types from `openapi.yaml`

## Contributing

This example is part of the Light Engine Charlie platform enablement initiative. For questions or improvements, see the main project documentation.

## License

MIT
