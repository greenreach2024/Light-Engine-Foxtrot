"""Import updated lighting recipes with environmental targets and nutrient data.

This importer normalizes cultivar worksheets (Excel or CSV) into a JSON dataset
that includes lighting spectra, PPFD, environmental guidance, and nutrient
targets required for automation.

- Preferred source folder: ``public/Updated Light recipe/All_Combined_Recipes_with_EC_PH_Veg_Fruit``
- Fallback workbook: ``public/data/Lighting_Recipes_With_Varieties_Daily_Full_EXPANDED_HydroPerformers-2.xlsx``
- Output JSON: ``public/data/lighting-recipes.json``

Each worksheet (or CSV file) corresponds to a cultivar/recipe with one row per day.
"""

from __future__ import annotations

import copy
import json
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

EXCEL_PATH = 'public/data/Lighting_Recipes_With_Varieties_Daily_Full_EXPANDED_HydroPerformers-2.xlsx'
CSV_SOURCE_DIR = Path('public/Updated Light recipe/All_Combined_Recipes_with_EC_PH_Veg_Fruit-6')
OUTPUT_PATH = 'public/data/lighting-recipes.json'
GROWTH_CFG_PATH = 'config/growth-stages.json'


@dataclass
class StageEnvelope:
    key: str
    name: str
    vpd_min: Optional[float]
    vpd_max: Optional[float]
    vpd_target: Optional[float]
    temp_min: Optional[float]
    temp_max: Optional[float]
    temp_target: Optional[float]
    rh_min: Optional[float]
    rh_max: Optional[float]
    rh_target: Optional[float]


STAGE_ALIASES: Dict[str, Tuple[str, ...]] = {
    'propagation': (
        'prop', 'propagation', 'nursery', 'seed', 'seeding', 'seedling', 'clone',
        'germination', 'sprout', 'starter', 'establishment', 'early veg'
    ),
    'vegetative': (
        'veg', 'vegetative', 'growth', 'leaf', 'development', 'mid veg',
        'transition', 'production veg', 'juvenile', 'late growth', 'growth phase'
    ),
    'finishing': (
        'finishing', 'finish', 'pre-harvest', 'harvest', 'final', 'flower',
        'flowering', 'bloom', 'budding', 'fruit', 'fruiting', 'ripening',
        'production', 'maturation'
    ),
}


def load_growth_stage_config(path: str) -> Dict[str, StageEnvelope]:
    if not os.path.exists(path):
        raise FileNotFoundError(f'Growth stage config not found: {path}')
    with open(path, 'r', encoding='utf-8') as handle:
        payload = json.load(handle)
    stages = payload.get('stages', {}) if isinstance(payload, dict) else {}
    envelopes: Dict[str, StageEnvelope] = {}
    for key, spec in stages.items():
        if not isinstance(spec, dict):
            continue
        env = StageEnvelope(
            key=key,
            name=spec.get('name', key),
            vpd_min=_to_float(spec.get('vpd', {}).get('min')),
            vpd_max=_to_float(spec.get('vpd', {}).get('max')),
            vpd_target=_to_float(spec.get('vpd', {}).get('target')),
            temp_min=_to_float(spec.get('temperature', {}).get('min')),
            temp_max=_to_float(spec.get('temperature', {}).get('max')),
            temp_target=_to_float(spec.get('temperature', {}).get('target')),
            rh_min=_to_float(spec.get('humidity', {}).get('min')),
            rh_max=_to_float(spec.get('humidity', {}).get('max')),
            rh_target=_to_float(spec.get('humidity', {}).get('target')),
        )
        envelopes[key] = env
    envelopes['_safe_limits'] = payload.get('safeLimits', {})
    return envelopes


def _to_float(value) -> Optional[float]:
    try:
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_stage_key(stage: str) -> str:
    cleaned = (stage or '').strip().lower()
    canonical = re.sub(r'[^a-z0-9]+', ' ', cleaned).strip()
    if not canonical:
        return 'vegetative'
    for target, aliases in STAGE_ALIASES.items():
        if canonical == target:
            return target
        for alias in aliases:
            if canonical == alias or canonical.startswith(alias):
                return target
    return 'vegetative'


def saturation_vapor_pressure(temp_c: float) -> float:
    # Tetens formula (kPa)
    return 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))


def vpd_from_temp_rh(temp_c: float, rh_percent: float) -> Optional[float]:
    if temp_c is None or rh_percent is None:
        return None
    es = saturation_vapor_pressure(temp_c)
    return round(max(0.0, es * (1 - min(max(rh_percent, 0.0), 100.0) / 100.0)), 3)


def rh_from_temp_vpd(temp_c: float, vpd: float) -> Optional[float]:
    if temp_c is None or vpd is None:
        return None
    es = saturation_vapor_pressure(temp_c)
    if es <= 0:
        return None
    rh = (1 - (vpd / es)) * 100.0
    return max(0.0, min(100.0, rh))


def parse_temperature_band(value) -> Optional[Dict[str, float]]:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value)
    cleaned = text.replace('°', '').replace('c', '').replace('C', '').strip()
    cleaned = cleaned.replace('to', '-').replace('–', '-').replace('—', '-').replace('−', '-').strip()
    numbers = re.findall(r'-?\d+(?:\.\d+)?', cleaned)
    if not numbers:
        return None
    values = [float(num) for num in numbers]
    if len(values) == 1:
        val = values[0]
        return {'min': val, 'max': val, 'target': val}
    if len(values) >= 2:
        low, high = values[0], values[1]
        if low >= 0 and high < 0:
            high = abs(high)
        target = values[2] if len(values) >= 3 else (low + high) / 2.0
        return {'min': min(low, high), 'max': max(low, high), 'target': target}
    return None


def _min_finite(values: List[Optional[float]]) -> Optional[float]:
    candidates = [v for v in values if v is not None]
    return min(candidates) if candidates else None


def _max_finite(values: List[Optional[float]]) -> Optional[float]:
    candidates = [v for v in values if v is not None]
    return max(candidates) if candidates else None


def derive_environment(
    stage_env: StageEnvelope,
    temp_band: Optional[Dict[str, float]],
    safe_limits: Dict,
    explicit: Dict[str, Optional[float]]
) -> Dict:
    stage_env = stage_env or StageEnvelope(
        key='vegetative',
        name='Vegetative',
        vpd_min=None,
        vpd_max=None,
        vpd_target=None,
        temp_min=None,
        temp_max=None,
        temp_target=None,
        rh_min=None,
        rh_max=None,
        rh_target=None,
    )

    afternoon_temp = _to_float(explicit.get('afternoon_temp'))
    night_temp = _to_float(explicit.get('night_temp'))
    target_vpd_explicit = _to_float(explicit.get('target_vpd'))
    max_humidity_explicit = _to_float(explicit.get('max_humidity'))

    temp_target = None
    if temp_band and temp_band.get('target') is not None:
        temp_target = temp_band['target']
    elif afternoon_temp is not None and night_temp is not None:
        temp_target = (afternoon_temp + night_temp) / 2.0
    elif afternoon_temp is not None:
        temp_target = afternoon_temp
    elif night_temp is not None:
        temp_target = night_temp
    elif stage_env.temp_target is not None:
        temp_target = stage_env.temp_target

    temp_min = _min_finite([
        temp_band.get('min') if temp_band else None,
        night_temp,
        stage_env.temp_min,
        temp_target,
    ])
    temp_max = _max_finite([
        temp_band.get('max') if temp_band else None,
        afternoon_temp,
        stage_env.temp_max,
        temp_target,
    ])
    if temp_min is None:
        temp_min = temp_target
    if temp_max is None:
        temp_max = temp_target

    vpd_target = target_vpd_explicit if target_vpd_explicit is not None else stage_env.vpd_target
    rh_target = stage_env.rh_target
    if afternoon_temp is not None and vpd_target is not None:
        rh_target = rh_from_temp_vpd(afternoon_temp, vpd_target)
    if rh_target is None and temp_target is not None and vpd_target is not None:
        rh_target = rh_from_temp_vpd(temp_target, vpd_target)

    rh_max_candidates = [stage_env.rh_max, max_humidity_explicit]
    rh_max = _min_finite(rh_max_candidates)
    if rh_max is None:
        rh_max = max_humidity_explicit or stage_env.rh_max

    rh_min = stage_env.rh_min
    if rh_min is not None and rh_max is not None and rh_min > rh_max:
        rh_min, rh_max = rh_max, rh_min

    if rh_min is None and rh_target is not None:
        rh_min = max(0.0, rh_target - 10.0)

    rh_band = None
    if rh_target is not None and rh_min is not None and rh_max is not None:
        rh_band = max(abs(rh_target - rh_min), abs(rh_max - rh_target))

    vpd_actual = vpd_target
    if afternoon_temp is not None and rh_target is not None:
        vpd_actual = vpd_from_temp_rh(afternoon_temp, rh_target)

    vpd_min_actual = stage_env.vpd_min
    if afternoon_temp is not None and rh_max is not None:
        vpd_min_actual = vpd_from_temp_rh(afternoon_temp, rh_max)

    vpd_max_actual = stage_env.vpd_max
    if afternoon_temp is not None and rh_min is not None:
        vpd_max_actual = vpd_from_temp_rh(afternoon_temp, rh_min)

    humidity_struct = {
        'target': _round(rh_target),
        'min': _round(rh_min),
        'max': _round(rh_max),
        'band': _round(rh_band),
    }
    if max_humidity_explicit is not None:
        humidity_struct['ceiling'] = _round(max_humidity_explicit)

    temperature_struct = {
        'target': _round(temp_target),
        'min': _round(temp_min),
        'max': _round(temp_max),
    }
    if afternoon_temp is not None:
        temperature_struct['day'] = _round(afternoon_temp)
    if night_temp is not None:
        temperature_struct['night'] = _round(night_temp)

    vpd_struct = {
        'target': _round(vpd_actual),
        'min': _round(vpd_min_actual),
        'max': _round(vpd_max_actual),
        'unit': 'kPa'
    }

    guardrails = copy.deepcopy(safe_limits) if isinstance(safe_limits, dict) else {}

    return {
        'temperature': temperature_struct,
        'humidity': humidity_struct,
        'vpd': vpd_struct,
        'guardrails': guardrails,
        'stageKey': stage_env.key,
        'stageName': stage_env.name,
    }


def _round(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), 3)


def get_numeric(row, primary: str, secondary: Optional[str] = None) -> Optional[float]:
    for column in (primary, secondary):
        if not column:
            continue
        value = row.get(column)
        if value is None or (isinstance(value, float) and math.isnan(value)):
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def clamp_percent(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return round(max(0.0, min(100.0, float(value))), 4)


def infer_crop_name_from_path(path: Path) -> str:
    stem = path.stem
    base = stem.split('__', 1)[0]
    base = re.sub(r'-Table\s*\d+.*$', '', base, flags=re.IGNORECASE)
    base = base.replace('_', ' ')
    base = re.sub(r'\s+', ' ', base).strip()
    return base or stem


def load_source_tables() -> Tuple[Dict[str, pd.DataFrame], str, List[str]]:
    source_paths: List[str] = []
    if CSV_SOURCE_DIR.exists():
        tables: Dict[str, pd.DataFrame] = {}
        for csv_path in sorted(CSV_SOURCE_DIR.glob('*.csv')):
            try:
                df = pd.read_csv(csv_path)
            except Exception as exc:  # pragma: no cover - defensive logging
                print(f"⚠️  Failed to read {csv_path}: {exc}")
                continue
            crop_name = infer_crop_name_from_path(csv_path)
            tables[crop_name] = df
            source_paths.append(str(csv_path))
        if tables:
            return tables, 'csv-folder', source_paths
    if not os.path.exists(EXCEL_PATH):
        raise FileNotFoundError(f"No recipe source found. Missing {CSV_SOURCE_DIR} and {EXCEL_PATH}")
    workbook_tables = pd.read_excel(EXCEL_PATH, sheet_name=None)
    source_paths.append(EXCEL_PATH)
    return workbook_tables, 'excel-workbook', source_paths


def main() -> None:
    growth_env = load_growth_stage_config(GROWTH_CFG_PATH)
    safe_limits_config = growth_env.pop('_safe_limits', {})
    tables, source_mode, source_paths = load_source_tables()

    recipes: Dict[str, list] = {}
    warnings: Dict[str, int] = {}

    for crop, df in tables.items():
        df.columns = [str(c).strip() for c in df.columns]
        if 'Day' not in df.columns:
            continue
        df = df[df['Day'].notnull()]
        days: List[Dict[str, object]] = []
        for _, row in df.iterrows():
            day_val = row.get('Day')
            try:
                day_index = round(float(day_val), 2)
            except (TypeError, ValueError):
                continue

            stage_raw = str(row.get('Stage', '') or '').strip()
            stage_key = normalize_stage_key(stage_raw)
            stage_env = growth_env.get(stage_key) or growth_env.get('vegetative')
            if stage_env is None:
                warnings[stage_key] = warnings.get(stage_key, 0) + 1
                continue

            temp_band = parse_temperature_band(row.get('Temperature (°C)'))
            env = derive_environment(
                stage_env,
                temp_band,
                safe_limits_config,
                {
                    'afternoon_temp': get_numeric(row, 'Afternoon Temp (°C)', 'Afternoon Temp'),
                    'night_temp': get_numeric(row, 'Night Temp (°C)', 'Night Temp'),
                    'target_vpd': get_numeric(row, 'Target VPD (kPa)', 'Target VPD'),
                    'max_humidity': get_numeric(row, 'Max Humidity (%)', 'Max Humidity'),
                }
            )

            blue = clamp_percent(get_numeric(row, 'Blue (%)', 'Blue (450 nm)')) or 0.0
            red = clamp_percent(get_numeric(row, 'Red (%)', 'Red (660 nm)')) or 0.0
            green = clamp_percent(get_numeric(row, 'Green (%)', 'Green ( %)')) or 0.0
            far_red = clamp_percent(get_numeric(row, 'Far-Red (%)', 'Far-Red (730 nm)')) or 0.0
            uv = clamp_percent(get_numeric(row, 'UV (%)'))
            ppfd = get_numeric(row, 'PPFD (µmol/m²/s)', 'PPFD (µmol/m^2/s)') or 0.0
            photoperiod = get_numeric(row, 'Photoperiod (h)', 'Photoperiod Hours')

            ec = get_numeric(row, 'EC')
            ph = get_numeric(row, 'PH')
            veg_flag = get_numeric(row, 'Veg')
            fruit_flag = get_numeric(row, 'Fruit')
            nutrient_program = None
            if fruit_flag is not None and fruit_flag >= 0.5:
                nutrient_program = 'fruit'
            elif veg_flag is not None and veg_flag >= 0.5:
                nutrient_program = 'veg'

            nutrients = None
            if any(value is not None for value in (ec, ph, nutrient_program)):
                nutrients = {
                    'ec': _round(ec),
                    'ph': _round(ph),
                    'program': nutrient_program,
                    'automationEnabled': nutrient_program == 'fruit',
                    'tank': 'fruiting' if nutrient_program == 'fruit' else None,
                }

            entry = {
                'day': day_index,
                'stage': stage_raw or stage_env.name,
                'stage_key': stage_key,
                'temperature': env['temperature']['target'],
                'tempC': env['temperature']['target'],
                'temp_min': env['temperature']['min'],
                'temp_max': env['temperature']['max'],
                'blue': blue,
                'green': green,
                'red': red,
                'far_red': far_red,
                'ppfd': round(ppfd, 3),
                'rh': env['humidity']['target'],
                'rh_min': env['humidity']['min'],
                'rh_max': env['humidity']['max'],
                'rhBand': env['humidity']['band'],
                'vpd': env['vpd']['target'],
                'vpd_min': env['vpd']['min'],
                'vpd_max': env['vpd']['max'],
                'environment': env,
            }

            if nutrients:
                entry['nutrients'] = nutrients
                entry['environment']['nutrients'] = nutrients

            if photoperiod is not None:
                entry['photoperiod'] = photoperiod
            if uv is not None:
                entry['uv'] = uv
            max_humidity = get_numeric(row, 'Max Humidity (%)', 'Max Humidity')
            if max_humidity is not None:
                entry['max_humidity'] = _round(max_humidity)
            notes = row.get('Notes') or row.get('Environmental Adjustments')
            if isinstance(notes, str) and notes.strip():
                entry['notes'] = notes.strip()

            days.append(entry)

        if days:
            crop_name = crop.strip()
            recipes[crop_name] = days

    meta = {
        'source': source_mode,
        'generatedBy': 'import-lighting-recipes.py',
        'sources': source_paths,
        'timestamp': pd.Timestamp.utcnow().isoformat(),
    }

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as handle:
        json.dump({'crops': recipes, 'meta': meta}, handle, indent=2)

    print(f"✅ Imported {len(recipes)} crops. Output: {OUTPUT_PATH}")
    if warnings:
        for stage_key, count in warnings.items():
            print(f"⚠️  Missing stage envelope for '{stage_key}' ({count} rows skipped)")


if __name__ == '__main__':
    main()
