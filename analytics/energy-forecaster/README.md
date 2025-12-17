# GreenReach Energy Forecaster

The Energy Forecaster extends Light Engine Charlie with data models that translate crop lighting recipes into energy and operating cost projections. It is designed to operate as a sidecar analytics service that draws from the existing Groups V2 state, spectral solver outputs, and fixture inventories stored in `public/data/`.

## Capabilities

- Forecast fixture power draw from PPFD, spectral mix, and dimming
- Simulate daily energy consumption per group, room, or farm
- Apply utility tariff schedules (off-peak / mid / peak)
- Emit JSON metrics for dashboards or reporting pipelines
- Provide CLI tooling for ad-hoc what-if analysis

## Layout

```
adapters/                # Utility rate providers & helpers
calculators/             # Core power/energy math
cli/                     # Human friendly CLI entry points
data/                    # Fixture & tariff datasets
pipelines/               # Batch export and ETL stubs
services/                # Sidecar/REST integration layer
tests/                   # Unit tests (Node --test)
```

## Quick Start

```bash
node analytics/energy-forecaster/cli/energy-forecaster-cli.js \
  --fixture GROW3_PRO_640 \
  --ppfd 520 \
  --photoperiod 13 \
  --rate peak
```

The CLI prints daily kWh, forecast cost, and per-channel watt distribution using the configuration in `data/`.

## Integration Hooks

- `forecaster-service.js` exposes a class that can be mounted in `server-charlie.js`
- Aggregated metrics can be published to `public/data/` or streamed over WebSocket
- Pipelines produce CSV summaries suitable for finance or sustainability teams

## Next Steps

- Wire live device telemetry once Grow3 reporting is exposed
- Expand fixture dataset beyond the bundled Grow3 reference models
- Add regression tests to cover new rate adapters
