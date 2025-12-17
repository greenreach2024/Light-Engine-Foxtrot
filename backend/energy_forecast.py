#!/usr/bin/env python3
"""
Energy Consumption Forecaster

Predicts HVAC and total facility energy usage based on:
- Outdoor weather conditions (temp, humidity, solar radiation)
- Historical energy consumption patterns
- Lighting schedules
- Automation actions

Uses SARIMAX model with exogenous variables.
"""

import sys
import json
import argparse
from datetime import datetime, timedelta
from pathlib import Path
import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX
import warnings
warnings.filterwarnings('ignore')

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def load_environmental_data(data_dir):
    """
    Load environmental data from env.json.
    
    Returns:
        DataFrame with environmental records
    """
    env_file = Path(data_dir) / 'env.json'
    
    if not env_file.exists():
        return pd.DataFrame()
    
    try:
        with open(env_file, 'r') as f:
            data = json.load(f)
        
        # Handle different formats (API zones array or file rooms object)
        records = []
        
        if isinstance(data, dict):
            if 'zones' in data:
                # API format
                for zone in data['zones']:
                    records.append({
                        'timestamp': zone.get('timestamp'),
                        'zone': zone.get('zone'),
                        'indoor_temp': zone.get('temp'),
                        'indoor_rh': zone.get('rh')
                    })
            elif 'rooms' in data:
                # File format
                for room_name, room_data in data['rooms'].items():
                    for zone_name, zone_data in room_data.get('zones', {}).items():
                        if 'history' in zone_data:
                            for entry in zone_data['history']:
                                records.append({
                                    'timestamp': entry.get('timestamp'),
                                    'zone': zone_name,
                                    'indoor_temp': entry.get('temp'),
                                    'indoor_rh': entry.get('rh')
                                })
        
        if not records:
            return pd.DataFrame()
        
        df = pd.DataFrame(records)
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        
        # Find outdoor sensor
        outdoor_zones = df[df['zone'].str.contains('outdoor', case=False, na=False)]
        if not outdoor_zones.empty:
            # Merge outdoor data as separate columns
            outdoor_df = outdoor_zones.rename(columns={
                'indoor_temp': 'outdoor_temp',
                'indoor_rh': 'outdoor_rh'
            })[['timestamp', 'outdoor_temp', 'outdoor_rh']]
            
            # Merge with indoor data
            indoor_df = df[~df['zone'].str.contains('outdoor', case=False, na=False)]
            df = pd.merge(indoor_df, outdoor_df, on='timestamp', how='left')
        
        return df
        
    except Exception as e:
        print(f"Error loading environmental data: {e}", file=sys.stderr)
        return pd.DataFrame()


def load_energy_history(data_dir, days=30):
    """
    Load historical energy consumption data.
    
    For now, simulates energy data based on environmental conditions.
    In production, would load from real energy meter data.
    
    Args:
        data_dir: Path to data directory
        days: Number of days of history to load
    
    Returns:
        DataFrame with timestamp, hvac_energy_kwh, lighting_energy_kwh, total_energy_kwh
    """
    # Try to load environmental data first
    env_data = load_environmental_data(data_dir)
    
    # If no environmental data, generate synthetic data for testing
    if env_data.empty:
        print("No environmental data found, generating synthetic data for testing", file=sys.stderr)
        
        # Generate hourly data for last 30 days
        hours = days * 24
        timestamps = pd.date_range(
            end=datetime.now(),
            periods=hours,
            freq='H'
        )
        
        # Synthetic environmental data with realistic patterns
        np.random.seed(42)
        hour_of_day = timestamps.hour
        
        # Temperature: 20-26°C with daily cycle
        base_temp = 23.0
        daily_variation = 3.0 * np.sin(2 * np.pi * hour_of_day / 24)
        random_noise = np.random.normal(0, 0.5, hours)
        indoor_temp = base_temp + daily_variation + random_noise
        
        # Humidity: 50-70% with inverse correlation to temp
        base_rh = 60.0
        rh_variation = -10.0 * np.sin(2 * np.pi * hour_of_day / 24)
        rh_noise = np.random.normal(0, 2, hours)
        indoor_rh = base_rh + rh_variation + rh_noise
        
        # Outdoor temp: wider range, leads indoor by a few hours
        outdoor_temp = base_temp + 5.0 * np.sin(2 * np.pi * (hour_of_day - 3) / 24) + np.random.normal(0, 1, hours)
        outdoor_rh = 55.0 - 15.0 * np.sin(2 * np.pi * (hour_of_day - 3) / 24) + np.random.normal(0, 3, hours)
        
        env_data = pd.DataFrame({
            'timestamp': timestamps,
            'zone': 'main',
            'indoor_temp': indoor_temp,
            'indoor_rh': indoor_rh,
            'outdoor_temp': outdoor_temp,
            'outdoor_rh': outdoor_rh
        })
    
    # Simulate energy consumption based on environmental conditions
    # In production, replace with actual energy meter readings
    
    # HVAC energy correlates with temperature difference from setpoint (23°C)
    env_data['temp_diff'] = abs(env_data.get('indoor_temp', 23) - 23)
    env_data['rh_diff'] = abs(env_data.get('indoor_rh', 60) - 60)
    
    # Base HVAC load: 2 kWh/hour
    # Additional load based on temperature/humidity deviation
    env_data['hvac_energy_kwh'] = 2.0 + (env_data['temp_diff'] * 0.3) + (env_data['rh_diff'] * 0.02)
    
    # Lighting energy (constant during photoperiod, 0 during dark)
    # Assume 18-hour photoperiod with 4 kW lighting load
    hour = pd.to_datetime(env_data['timestamp']).dt.hour
    env_data['lighting_energy_kwh'] = np.where((hour >= 6) & (hour < 24), 4.0, 0.0)
    
    # Total energy
    env_data['total_energy_kwh'] = env_data['hvac_energy_kwh'] + env_data['lighting_energy_kwh']
    
    # Keep only recent data
    cutoff = datetime.now() - timedelta(days=days)
    env_data = env_data[pd.to_datetime(env_data['timestamp']) >= cutoff]
    
    return env_data[['timestamp', 'hvac_energy_kwh', 'lighting_energy_kwh', 'total_energy_kwh']].copy()


def prepare_energy_features(env_data, energy_data):
    """
    Prepare features for energy forecasting model.
    
    Args:
        env_data: Environmental data DataFrame
        energy_data: Energy consumption data DataFrame
    
    Returns:
        Tuple of (target_series, exog_df) for SARIMAX
    """
    # If env_data and energy_data are the same (synthetic data case),
    # we already have all columns
    if 'total_energy_kwh' in env_data.columns:
        df = env_data.copy()
    else:
        # Merge environmental and energy data on timestamp
        df = pd.merge(energy_data, env_data, on='timestamp', how='inner')
    
    if df.empty:
        return None, None
    
    # Sort by timestamp
    df = df.sort_values('timestamp')
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.set_index('timestamp')
    
    # Target: total energy consumption
    if 'total_energy_kwh' not in df.columns:
        return None, None
        
    target = df['total_energy_kwh']
    
    # Exogenous features
    exog_features = []
    
    # Outdoor conditions (if available)
    if 'outdoor_temp' in df.columns:
        exog_features.append('outdoor_temp')
    if 'outdoor_rh' in df.columns:
        exog_features.append('outdoor_rh')
    
    # Indoor conditions
    if 'indoor_temp' in df.columns:
        exog_features.append('indoor_temp')
    if 'indoor_rh' in df.columns:
        exog_features.append('indoor_rh')
    
    # Temperature differential (outdoor - indoor)
    if 'outdoor_temp' in df.columns and 'indoor_temp' in df.columns:
        df['temp_differential'] = df['outdoor_temp'] - df['indoor_temp']
        exog_features.append('temp_differential')
    
    # Time features (hour of day, day of week)
    df['hour'] = df.index.hour
    df['day_of_week'] = df.index.dayofweek
    df['is_weekend'] = df['day_of_week'].isin([5, 6]).astype(int)
    exog_features.extend(['hour', 'day_of_week', 'is_weekend'])
    
    # Lighting schedule (binary: on/off)
    df['lights_on'] = ((df['hour'] >= 6) & (df['hour'] < 24)).astype(int)
    exog_features.append('lights_on')
    
    # Historical energy consumption (lagged features)
    df['energy_lag_1h'] = df['total_energy_kwh'].shift(1)
    df['energy_lag_3h'] = df['total_energy_kwh'].shift(3)
    exog_features.extend(['energy_lag_1h', 'energy_lag_3h'])
    
    # Drop rows with NaN (from lagged features)
    df = df.dropna()
    
    if df.empty or len(df) < 24:  # Need at least 24 hours of data
        return None, None
    
    exog_df = df[exog_features]
    target = df['total_energy_kwh']
    
    return target, exog_df


def forecast_energy(target, exog, forecast_hours=24):
    """
    Train SARIMAX model and forecast energy consumption.
    
    Args:
        target: Target series (energy consumption)
        exog: Exogenous features DataFrame
        forecast_hours: Hours to forecast ahead
    
    Returns:
        Dict with predictions, confidence intervals, and model info
    """
    if target is None or exog is None or len(target) < 24:
        return {
            'success': False,
            'error': 'Insufficient data for energy forecasting',
            'min_required_hours': 24
        }
    
    try:
        # SARIMAX model: (p, d, q) x (P, D, Q, s)
        # Hourly data with daily seasonality (s=24)
        # Keep it simple: (1, 0, 1) x (1, 0, 1, 24)
        model = SARIMAX(
            target,
            exog=exog,
            order=(1, 0, 1),
            seasonal_order=(1, 0, 1, 24),
            enforce_stationarity=False,
            enforce_invertibility=False
        )
        
        # Fit model
        fitted_model = model.fit(disp=False, maxiter=100)
        
        # Prepare future exogenous variables
        # For simplicity, assume continuation of current patterns
        last_timestamp = target.index[-1]
        future_timestamps = pd.date_range(
            start=last_timestamp + timedelta(hours=1),
            periods=forecast_hours,
            freq='H'
        )
        
        # Future exogenous features (simplified - use recent values)
        future_exog = pd.DataFrame(index=future_timestamps)
        
        for col in exog.columns:
            if col in ['energy_lag_1h', 'energy_lag_3h']:
                # Use recent energy values for lags
                future_exog[col] = target.iloc[-1]
            elif col == 'hour':
                future_exog[col] = future_timestamps.hour
            elif col == 'day_of_week':
                future_exog[col] = future_timestamps.dayofweek
            elif col == 'is_weekend':
                future_exog[col] = future_timestamps.dayofweek.isin([5, 6]).astype(int)
            elif col == 'lights_on':
                future_exog[col] = ((future_timestamps.hour >= 6) & (future_timestamps.hour < 24)).astype(int)
            else:
                # Use mean of recent values for other features
                future_exog[col] = exog[col].iloc[-24:].mean()
        
        # Forecast
        forecast_result = fitted_model.get_forecast(steps=forecast_hours, exog=future_exog)
        forecast_values = forecast_result.predicted_mean
        conf_int = forecast_result.conf_int(alpha=0.05)  # 95% confidence
        
        # Build predictions list
        predictions = []
        for i, (timestamp, value) in enumerate(forecast_values.items()):
            predictions.append({
                'timestamp': timestamp.isoformat(),
                'energy_kwh': round(float(value), 2),
                'confidence_lower': round(float(conf_int.iloc[i, 0]), 2),
                'confidence_upper': round(float(conf_int.iloc[i, 1]), 2)
            })
        
        # Calculate daily total (sum of hourly predictions)
        total_daily_kwh = sum(p['energy_kwh'] for p in predictions[:24])
        
        # Model diagnostics
        aic = fitted_model.aic
        bic = fitted_model.bic
        
        return {
            'success': True,
            'predictions': predictions,
            'forecast_hours': forecast_hours,
            'total_daily_kwh': round(total_daily_kwh, 2),
            'model': {
                'type': 'SARIMAX',
                'order': '(1,0,1)x(1,0,1,24)',
                'aic': round(float(aic), 2),
                'bic': round(float(bic), 2),
                'training_samples': len(target)
            },
            'generated_at': datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }


def main():
    parser = argparse.ArgumentParser(description='Forecast energy consumption')
    parser.add_argument('--hours', type=int, default=24, help='Hours to forecast ahead')
    parser.add_argument('--history-days', type=int, default=30, help='Days of history to use')
    parser.add_argument('--json', action='store_true', help='Output JSON format')
    args = parser.parse_args()
    
    # Load data
    data_dir = PROJECT_ROOT / 'public' / 'data'
    
    print(f"Loading {args.history_days} days of energy history...", file=sys.stderr)
    energy_data = load_energy_history(data_dir, days=args.history_days)
    
    if energy_data.empty:
        result = {
            'success': False,
            'error': 'No energy data available'
        }
        print(json.dumps(result, indent=2))
        sys.exit(1)
    
    print(f"Loaded {len(energy_data)} energy records", file=sys.stderr)
    
    # Load environmental data for features
    print("Loading environmental data...", file=sys.stderr)
    env_data_for_features = load_environmental_data(data_dir)
    
    # If no real environmental data, use the synthetic data from energy_data
    if env_data_for_features.empty and not energy_data.empty:
        print("Using synthetic environmental data from energy history", file=sys.stderr)
        # The energy_data DataFrame already has the environmental features
        # Just need to ensure it has the right columns
        env_data_for_features = energy_data.copy()
    
    if env_data_for_features.empty:
        result = {
            'success': False,
            'error': 'No environmental data available'
        }
        print(json.dumps(result, indent=2))
        sys.exit(1)
    
    print(f"Loaded {len(env_data_for_features)} environmental records", file=sys.stderr)
    
    # Prepare features
    print("Preparing features...", file=sys.stderr)
    target, exog = prepare_energy_features(env_data_for_features, energy_data)
    
    if target is None:
        result = {
            'success': False,
            'error': 'Failed to prepare features - insufficient data'
        }
        print(json.dumps(result, indent=2))
        sys.exit(1)
    
    print(f"Prepared {len(target)} training samples with {len(exog.columns)} features", file=sys.stderr)
    
    # Forecast
    print(f"Forecasting {args.hours} hours ahead...", file=sys.stderr)
    result = forecast_energy(target, exog, forecast_hours=args.hours)
    
    if result['success']:
        print(f"✓ Forecast complete: {result['total_daily_kwh']} kWh total (24h)", file=sys.stderr)
    else:
        print(f"✗ Forecast failed: {result.get('error', 'Unknown error')}", file=sys.stderr)
    
    # Output
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
