#!/usr/bin/env python3
"""
Outdoor-aware predictive forecasting for indoor environmental conditions.

This module builds time-series models to predict indoor temperature and humidity
1-4 hours ahead based on:
- Current indoor state
- Current outdoor conditions  
- Weather forecast API data
- Historical indoor/outdoor correlations
- Time of day and solar gain patterns

Uses SARIMAX (Seasonal AutoRegressive Integrated Moving Average with eXogenous variables)
for outdoor-aware forecasting with thermal lag and solar effects.
"""

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Optional

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX
import warnings

# Suppress statsmodels warnings
warnings.filterwarnings('ignore')

logger = logging.getLogger(__name__)

# Import outdoor influence module for enhanced features
try:
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    from backend.outdoor_influence import (
        calculate_solar_gain_factor,
        calculate_outdoor_rolling_statistics,
        assess_outdoor_influence
    )
    HAS_OUTDOOR_INFLUENCE = True
except ImportError:
    logger.warning("Outdoor influence module not available, using basic features")
    HAS_OUTDOOR_INFLUENCE = False


def load_historical_data(hours_back: int = 72) -> pd.DataFrame:
    """
    Load historical environmental data from env.json.
    
    Args:
        hours_back: How many hours of history to load
        
    Returns:
        DataFrame with columns: timestamp, zone, indoor_temp, indoor_rh, 
                                outdoor_temp, outdoor_rh, temp_delta
    """
    env_file = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'env.json')
    
    if not os.path.exists(env_file):
        logger.warning(f"Environmental data file not found: {env_file}")
        return pd.DataFrame()
    
    try:
        with open(env_file, 'r') as f:
            env_data = json.load(f)
    except Exception as e:
        logger.error(f"Error loading env.json: {e}")
        return pd.DataFrame()
    
    # Extract sensor readings from zones
    records = []
    now = datetime.now()
    
    for zone_data in env_data.get('zones', []):
        zone_id = zone_data.get('id', 'Unknown')
        zone_name = zone_data.get('name', zone_id)
        location = zone_data.get('location', zone_name)
        
        # Get sensor histories
        sensors = zone_data.get('sensors', {})
        
        # Process each sensor type
        for sensor_type, sensor_data in sensors.items():
            if not isinstance(sensor_data, dict):
                continue
            
            history = sensor_data.get('history', [])
            if not history:
                continue
            
            # Create timestamps (5-minute intervals going backward from now)
            for i, value in enumerate(reversed(history)):
                if value is None:
                    continue
                
                # Calculate timestamp (most recent first)
                minutes_ago = i * 5
                timestamp = now - timedelta(minutes=minutes_ago)
                
                # Map sensor types to standard names
                metric_name = sensor_type
                if sensor_type == 'tempC':
                    metric_name = 'temperature'
                elif sensor_type == 'humidity':
                    metric_name = 'humidity'
                elif sensor_type == 'vpd':
                    metric_name = 'vpd'
                
                records.append({
                    'timestamp': timestamp,
                    'zone': zone_name,
                    'zone_id': zone_id,
                    'metric': metric_name,
                    'value': float(value)
                })
    
    if not records:
        logger.warning("No historical data found in env.json")
        return pd.DataFrame()
    
    # Convert to DataFrame
    df = pd.DataFrame(records)
    
    # Pivot to wide format
    df_wide = df.pivot_table(
        index=['timestamp', 'zone', 'zone_id'],
        columns='metric',
        values='value',
        aggfunc='first'
    ).reset_index()
    
    # Identify outdoor weather zone by name containing "outdoor" or "outside"
    outdoor_mask = df_wide['zone'].str.lower().str.contains('outdoor|outside', case=False, na=False)
    outdoor_data = df_wide[outdoor_mask].copy()
    
    # Extract outdoor temp/humidity if available
    outdoor_columns = ['timestamp']
    if 'temperature' in outdoor_data.columns:
        outdoor_columns.append('temperature')
    if 'humidity' in outdoor_data.columns:
        outdoor_columns.append('humidity')
    
    outdoor_data = outdoor_data[outdoor_columns].copy()
    
    # Rename outdoor columns
    rename_outdoor = {}
    if 'temperature' in outdoor_data.columns:
        rename_outdoor['temperature'] = 'outdoor_temp'
    if 'humidity' in outdoor_data.columns:
        rename_outdoor['humidity'] = 'outdoor_rh'
    outdoor_data.rename(columns=rename_outdoor, inplace=True)
    
    # Get indoor data
    indoor_data = df_wide[~outdoor_mask].copy()
    
    # Merge outdoor data with indoor (by timestamp)
    if not outdoor_data.empty:
        indoor_data = indoor_data.merge(outdoor_data, on='timestamp', how='left')
        
        # Calculate temp delta
        if 'temperature' in indoor_data.columns and 'outdoor_temp' in indoor_data.columns:
            indoor_data['temp_delta'] = indoor_data['temperature'] - indoor_data['outdoor_temp']
    
    # Rename columns for clarity
    rename_dict = {}
    if 'temperature' in indoor_data.columns:
        rename_dict['temperature'] = 'indoor_temp'
    if 'humidity' in indoor_data.columns:
        rename_dict['humidity'] = 'indoor_rh'
    if 'vpd' in indoor_data.columns:
        rename_dict['vpd'] = 'indoor_vpd'
    
    indoor_data.rename(columns=rename_dict, inplace=True)
    
    # Sort by timestamp
    indoor_data.sort_values('timestamp', inplace=True)
    
    # Filter to requested time window
    cutoff_time = now - timedelta(hours=hours_back)
    indoor_data = indoor_data[indoor_data['timestamp'] >= cutoff_time]
    
    return indoor_data


def calculate_solar_gain_exogenous(timestamps: pd.Series) -> pd.Series:
    """
    Calculate solar gain factor (0.0-1.0) for given timestamps.
    
    Args:
        timestamps: Series of datetime objects
        
    Returns:
        Series of solar gain factors (0.0 = night, 1.0 = peak solar)
    """
    # Import here to avoid circular dependency
    import sys
    import os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
    
    try:
        from backend.outdoor_influence import calculate_solar_gain_factor
        return timestamps.apply(lambda t: calculate_solar_gain_factor(t))
    except ImportError:
        # Fallback: simple solar gain calculation
        logger.warning("Could not import outdoor_influence, using fallback solar gain calculation")
        
        def simple_solar_gain(dt):
            hour = dt.hour + dt.minute / 60.0
            # Solar gain peaks at noon (12), zero at night (0-6, 18-24)
            if hour < 6 or hour >= 18:
                return 0.0
            elif 9 <= hour <= 15:
                return 1.0  # Peak solar hours
            elif hour < 9:
                # Sunrise ramp: 6am=0, 9am=1
                return (hour - 6) / 3.0
            else:
                # Sunset ramp: 15pm=1, 18pm=0
                return 1.0 - ((hour - 15) / 3.0)
        
        return timestamps.apply(simple_solar_gain)


def prepare_forecast_features(
    df: pd.DataFrame,
    target_zone: str,
    target_metric: str = 'indoor_temp'
) -> Tuple[pd.Series, pd.DataFrame]:
    """
    Prepare time-series data for forecasting with exogenous variables.
    
    Args:
        df: Historical data DataFrame
        target_zone: Zone to forecast (e.g., "Grow Room 1")
        target_metric: Metric to forecast ('indoor_temp' or 'indoor_rh')
        
    Returns:
        (target_series, exog_df): Target variable and exogenous features
    """
    # Filter to target zone
    zone_data = df[df['zone'] == target_zone].copy()
    
    if zone_data.empty:
        logger.warning(f"No data for zone: {target_zone}")
        return pd.Series(), pd.DataFrame()
    
    # Set timestamp as index and resample to regular intervals (5 min)
    zone_data.set_index('timestamp', inplace=True)
    
    # Select only numeric columns for resampling
    numeric_cols = zone_data.select_dtypes(include=[np.number]).columns
    zone_data = zone_data[numeric_cols]
    
    zone_data = zone_data.resample('5T').mean()  # 5-minute intervals
    
    # Fill missing values with forward fill then backward fill
    zone_data.fillna(method='ffill', inplace=True)
    zone_data.fillna(method='bfill', inplace=True)
    
    # Extract target variable
    if target_metric not in zone_data.columns:
        logger.warning(f"Target metric {target_metric} not found")
        return pd.Series(), pd.DataFrame()
    
    target = zone_data[target_metric]
    
    # Build exogenous features
    exog_features = pd.DataFrame(index=zone_data.index)
    
    # 1. Outdoor conditions (current)
    if 'outdoor_temp' in zone_data.columns:
        exog_features['outdoor_temp'] = zone_data['outdoor_temp']
    if 'outdoor_rh' in zone_data.columns:
        exog_features['outdoor_rh'] = zone_data['outdoor_rh']
    
    # 2. Time-lagged outdoor (15, 30, 60 min ago)
    if 'outdoor_temp' in zone_data.columns:
        exog_features['outdoor_temp_lag15'] = zone_data['outdoor_temp'].shift(3)  # 15 min = 3 periods
        exog_features['outdoor_temp_lag30'] = zone_data['outdoor_temp'].shift(6)  # 30 min = 6 periods
        exog_features['outdoor_temp_lag60'] = zone_data['outdoor_temp'].shift(12)  # 60 min = 12 periods
    
    # 3. Solar gain factor
    exog_features['solar_gain'] = calculate_solar_gain_exogenous(zone_data.index.to_series())
    
    # 4. Outdoor rolling statistics (1-hour window)
    if HAS_OUTDOOR_INFLUENCE and 'outdoor_temp' in zone_data.columns:
        # Build outdoor history for rolling calculations
        outdoor_history = []
        for idx in zone_data.index:
            outdoor_history.append({
                'temp': zone_data.loc[idx, 'outdoor_temp'] if 'outdoor_temp' in zone_data.columns else None,
                'rh': zone_data.loc[idx, 'outdoor_rh'] if 'outdoor_rh' in zone_data.columns else None,
                'timestamp': idx
            })
        
        # Calculate rolling stats for each timestamp
        rolling_stats_list = []
        for i in range(len(outdoor_history)):
            # Get window (last 12 readings = 1 hour)
            window_start = max(0, i - 11)
            window_data = outdoor_history[window_start:i+1]
            
            stats = calculate_outdoor_rolling_statistics(
                window_data,
                window_hours=1.0,
                reading_interval_minutes=5
            )
            rolling_stats_list.append(stats)
        
        # Add rolling features to exog
        for i, stats in enumerate(rolling_stats_list):
            if stats:
                exog_features.loc[zone_data.index[i], 'outdoor_temp_rolling_mean'] = stats['temp_mean']
                exog_features.loc[zone_data.index[i], 'outdoor_temp_trend'] = stats['temp_trend_per_hour']
                exog_features.loc[zone_data.index[i], 'outdoor_variance_score'] = stats['variance_score']
        
        # Fill NaNs for initial periods without full window
        exog_features['outdoor_temp_rolling_mean'].fillna(method='bfill', inplace=True)
        exog_features['outdoor_temp_trend'].fillna(0, inplace=True)
        exog_features['outdoor_variance_score'].fillna(50, inplace=True)
    
    # 5. Time of day features (cyclical encoding)
    hour_of_day = zone_data.index.hour + zone_data.index.minute / 60.0
    exog_features['hour_sin'] = np.sin(2 * np.pi * hour_of_day / 24)
    exog_features['hour_cos'] = np.cos(2 * np.pi * hour_of_day / 24)
    
    # 6. Day of week (weekend vs weekday)
    exog_features['is_weekend'] = (zone_data.index.dayofweek >= 5).astype(int)
    
    # Fill any remaining NaN from lags
    exog_features.fillna(method='bfill', inplace=True)
    exog_features.fillna(0, inplace=True)
    
    return target, exog_features


def train_sarimax_model(
    target: pd.Series,
    exog: pd.DataFrame,
    order: Tuple[int, int, int] = (2, 0, 1),
    seasonal_order: Tuple[int, int, int, int] = (1, 0, 0, 12)  # 12 periods = 1 hour
) -> Optional[SARIMAX]:
    """
    Train SARIMAX model for time-series forecasting.
    
    Args:
        target: Target variable time-series
        exog: Exogenous features DataFrame
        order: (p, d, q) ARIMA order
        seasonal_order: (P, D, Q, s) seasonal order
        
    Returns:
        Fitted SARIMAX model or None if training fails
    """
    if len(target) < 50:
        logger.warning(f"Insufficient data for training: {len(target)} samples")
        return None
    
    try:
        model = SARIMAX(
            target,
            exog=exog,
            order=order,
            seasonal_order=seasonal_order,
            enforce_stationarity=False,
            enforce_invertibility=False
        )
        
        fitted = model.fit(disp=False, maxiter=200)
        logger.info(f"SARIMAX model trained: AIC={fitted.aic:.2f}")
        return fitted
        
    except Exception as e:
        logger.error(f"Error training SARIMAX model: {e}")
        return None


def forecast_future_exog(
    last_exog: pd.DataFrame,
    forecast_horizon: int,
    weather_forecast: Optional[List[Dict]] = None
) -> pd.DataFrame:
    """
    Generate future exogenous variables for forecasting period.
    
    Args:
        last_exog: Last row of exogenous features
        forecast_horizon: Number of periods to forecast
        weather_forecast: List of weather forecast dicts from API
        
    Returns:
        DataFrame of future exogenous features (matching training columns exactly)
    """
    last_timestamp = last_exog.index[-1]
    future_index = pd.date_range(
        start=last_timestamp + timedelta(minutes=5),
        periods=forecast_horizon,
        freq='5T'
    )
    
    future_exog = pd.DataFrame(index=future_index)
    
    # Get all columns from training data
    training_cols = last_exog.columns.tolist()
    
    # Initialize all columns
    for col in training_cols:
        future_exog[col] = 0.0  # Temporary fill
    
    # Use weather forecast if available, otherwise persist last values
    if 'outdoor_temp' in training_cols:
        if weather_forecast and len(weather_forecast) > 0:
            # Map forecast to 5-min intervals
            for i, timestamp in enumerate(future_index):
                forecast_entry = weather_forecast[min(i // 12, len(weather_forecast) - 1)]
                future_exog.loc[timestamp, 'outdoor_temp'] = forecast_entry.get('temp', last_exog.get('outdoor_temp', pd.Series([20])).iloc[-1])
                if 'outdoor_rh' in training_cols:
                    future_exog.loc[timestamp, 'outdoor_rh'] = forecast_entry.get('humidity', last_exog.get('outdoor_rh', pd.Series([50])).iloc[-1])
        else:
            future_exog['outdoor_temp'] = last_exog.get('outdoor_temp', pd.Series([20])).iloc[-1] if 'outdoor_temp' in last_exog else 20.0
            if 'outdoor_rh' in training_cols:
                future_exog['outdoor_rh'] = last_exog.get('outdoor_rh', pd.Series([50])).iloc[-1] if 'outdoor_rh' in last_exog else 50.0
    
    # Time-lagged outdoor (use recent history)
    if 'outdoor_temp_lag15' in training_cols or 'outdoor_temp_lag30' in training_cols or 'outdoor_temp_lag60' in training_cols:
        recent_outdoor = last_exog.get('outdoor_temp', pd.Series([20])) if 'outdoor_temp' in last_exog else pd.Series([20])
        recent_outdoor = recent_outdoor.tail(12).values  # Last 60 min
        default_outdoor = recent_outdoor[-1] if len(recent_outdoor) > 0 else 20.0
        
        for i in range(forecast_horizon):
            if 'outdoor_temp_lag15' in training_cols:
                if i >= 3:
                    future_exog.loc[future_index[i], 'outdoor_temp_lag15'] = future_exog.loc[future_index[i-3], 'outdoor_temp']
                else:
                    future_exog.loc[future_index[i], 'outdoor_temp_lag15'] = recent_outdoor[-(3-i)] if (3-i) <= len(recent_outdoor) else default_outdoor
            
            if 'outdoor_temp_lag30' in training_cols:
                if i >= 6:
                    future_exog.loc[future_index[i], 'outdoor_temp_lag30'] = future_exog.loc[future_index[i-6], 'outdoor_temp']
                else:
                    future_exog.loc[future_index[i], 'outdoor_temp_lag30'] = recent_outdoor[-(6-i)] if (6-i) <= len(recent_outdoor) else default_outdoor
            
            if 'outdoor_temp_lag60' in training_cols:
                if i >= 12:
                    future_exog.loc[future_index[i], 'outdoor_temp_lag60'] = future_exog.loc[future_index[i-12], 'outdoor_temp']
                else:
                    future_exog.loc[future_index[i], 'outdoor_temp_lag60'] = recent_outdoor[-(12-i)] if (12-i) <= len(recent_outdoor) else default_outdoor
    
    # Outdoor rolling statistics for future (use recent trend)
    if 'outdoor_temp_rolling_mean' in training_cols:
        # Use recent rolling mean as baseline, adjust with forecast
        recent_rolling_mean = last_exog.get('outdoor_temp_rolling_mean', pd.Series([20])).iloc[-1] if 'outdoor_temp_rolling_mean' in last_exog else 20.0
        future_exog['outdoor_temp_rolling_mean'] = recent_rolling_mean
        
        # If we have outdoor forecast, adjust rolling mean
        if 'outdoor_temp' in future_exog.columns:
            # Simple rolling mean over future predictions
            for i in range(forecast_horizon):
                window_start = max(0, i - 11)
                window_end = i + 1
                window_temps = future_exog.loc[future_index[window_start:window_end], 'outdoor_temp']
                if len(window_temps) > 0:
                    future_exog.loc[future_index[i], 'outdoor_temp_rolling_mean'] = window_temps.mean()
    
    if 'outdoor_temp_trend' in training_cols:
        # Use recent trend, gradually decaying to zero
        recent_trend = last_exog.get('outdoor_temp_trend', pd.Series([0])).iloc[-1] if 'outdoor_temp_trend' in last_exog else 0.0
        decay_factor = np.exp(-np.arange(forecast_horizon) / (forecast_horizon / 2))
        future_exog['outdoor_temp_trend'] = recent_trend * decay_factor
    
    if 'outdoor_variance_score' in training_cols:
        # Persist recent variance score (conservative assumption)
        recent_variance = last_exog.get('outdoor_variance_score', pd.Series([50])).iloc[-1] if 'outdoor_variance_score' in last_exog else 50.0
        future_exog['outdoor_variance_score'] = recent_variance
    
    # Solar gain for future times
    if 'solar_gain' in training_cols:
        future_exog['solar_gain'] = calculate_solar_gain_exogenous(future_index.to_series())
    
    # Time of day features
    if 'hour_sin' in training_cols or 'hour_cos' in training_cols:
        hour_of_day = future_index.hour + future_index.minute / 60.0
        if 'hour_sin' in training_cols:
            future_exog['hour_sin'] = np.sin(2 * np.pi * hour_of_day / 24)
        if 'hour_cos' in training_cols:
            future_exog['hour_cos'] = np.cos(2 * np.pi * hour_of_day / 24)
    
    # Weekend indicator
    if 'is_weekend' in training_cols:
        future_exog['is_weekend'] = (future_index.dayofweek >= 5).astype(int)
    
    # Ensure columns are in same order as training
    future_exog = future_exog[training_cols]
    
    return future_exog


def predict_indoor_conditions(
    zone: str,
    hours_ahead: int = 4,
    metric: str = 'indoor_temp',
    weather_forecast: Optional[List[Dict]] = None
) -> Dict:
    """
    Predict indoor temperature or humidity for next 1-4 hours.
    
    Args:
        zone: Target zone name (e.g., "Grow Room 1")
        hours_ahead: Forecast horizon in hours (1-4)
        metric: 'indoor_temp' or 'indoor_rh'
        weather_forecast: Optional weather forecast from API
        
    Returns:
        Dict with forecast data:
        {
            'zone': str,
            'metric': str,
            'forecast_horizon_hours': int,
            'current_value': float,
            'predictions': [
                {'timestamp': str, 'value': float, 'lower_ci': float, 'upper_ci': float},
                ...
            ],
            'outdoor_conditions': {
                'current': {'temp': float, 'rh': float},
                'forecast': [{'time': str, 'temp': float, 'rh': float}, ...]
            }
        }
    """
    # Load historical data (72 hours for training)
    df = load_historical_data(hours_back=72)
    
    if df.empty:
        return {
            'error': 'No historical data available',
            'zone': zone,
            'metric': metric
        }
    
    # Prepare features
    target, exog = prepare_forecast_features(df, zone, metric)
    
    if target.empty or exog.empty:
        return {
            'error': f'Insufficient data for zone {zone}',
            'zone': zone,
            'metric': metric
        }
    
    # Train model
    model = train_sarimax_model(target, exog)
    
    if model is None:
        return {
            'error': 'Model training failed',
            'zone': zone,
            'metric': metric
        }
    
    # Generate future exogenous features
    forecast_horizon = hours_ahead * 12  # 12 periods per hour (5-min intervals)
    future_exog = forecast_future_exog(exog, forecast_horizon, weather_forecast)
    
    # Make predictions
    try:
        forecast = model.get_forecast(steps=forecast_horizon, exog=future_exog)
        predictions = forecast.predicted_mean
        conf_int = forecast.conf_int(alpha=0.05)  # 95% confidence interval
        
    except Exception as e:
        logger.error(f"Forecasting error: {e}")
        return {
            'error': f'Forecasting failed: {str(e)}',
            'zone': zone,
            'metric': metric
        }
    
    # Format results
    prediction_list = []
    for i in range(len(predictions)):
        timestamp = predictions.index[i]
        prediction_list.append({
            'timestamp': timestamp.isoformat(),
            'value': float(predictions.iloc[i]),
            'lower_ci': float(conf_int.iloc[i, 0]),
            'upper_ci': float(conf_int.iloc[i, 1])
        })
    
    # Get current outdoor conditions
    outdoor_zones = df[df['zone'].str.contains('outdoor|outside', case=False, na=False)]
    current_outdoor = {}
    
    if not outdoor_zones.empty:
        latest_outdoor = outdoor_zones.tail(1)
        if 'outdoor_temp' in latest_outdoor.columns:
            current_outdoor['temp'] = float(latest_outdoor['outdoor_temp'].iloc[0])
        if 'outdoor_rh' in latest_outdoor.columns:
            current_outdoor['rh'] = float(latest_outdoor['outdoor_rh'].iloc[0])
    
    if not current_outdoor:
        current_outdoor = {'temp': None, 'rh': None}
    
    return {
        'zone': zone,
        'metric': metric,
        'forecast_horizon_hours': hours_ahead,
        'current_value': float(target.iloc[-1]),
        'current_timestamp': target.index[-1].isoformat(),
        'predictions': prediction_list,
        'outdoor_conditions': {
            'current': current_outdoor,
            'forecast': weather_forecast or []
        },
        'model_info': {
            'aic': float(model.aic),
            'training_samples': len(target)
        }
    }


def batch_predict_all_zones(
    hours_ahead: int = 2,
    weather_forecast: Optional[List[Dict]] = None
) -> List[Dict]:
    """
    Predict indoor conditions for all zones.
    
    Args:
        hours_ahead: Forecast horizon in hours
        weather_forecast: Optional weather forecast from API
        
    Returns:
        List of forecast dicts, one per zone
    """
    df = load_historical_data(hours_back=72)
    
    if df.empty:
        return []
    
    zones = df['zone'].unique()
    forecasts = []
    
    for zone in zones:
        # Predict temperature
        temp_forecast = predict_indoor_conditions(
            zone=zone,
            hours_ahead=hours_ahead,
            metric='indoor_temp',
            weather_forecast=weather_forecast
        )
        
        # Predict humidity
        rh_forecast = predict_indoor_conditions(
            zone=zone,
            hours_ahead=hours_ahead,
            metric='indoor_rh',
            weather_forecast=weather_forecast
        )
        
        forecasts.append({
            'zone': zone,
            'temperature_forecast': temp_forecast,
            'humidity_forecast': rh_forecast
        })
    
    return forecasts


if __name__ == '__main__':
    import argparse
    import json as json_module
    
    parser = argparse.ArgumentParser(description='Outdoor-aware predictive forecasting')
    parser.add_argument('--zone', type=str, help='Zone to forecast (default: first zone found)')
    parser.add_argument('--hours', type=int, default=2, help='Forecast horizon in hours (default: 2)')
    parser.add_argument('--metric', type=str, default='indoor_temp', choices=['indoor_temp', 'indoor_rh'], help='Metric to forecast')
    parser.add_argument('--json', action='store_true', help='Output JSON instead of human-readable text')
    args = parser.parse_args()
    
    # Configure logging (quiet in JSON mode)
    if args.json:
        logging.basicConfig(level=logging.ERROR)
    else:
        logging.basicConfig(level=logging.INFO)
    
    try:
        if not args.json:
            print("Testing outdoor-aware predictive forecasting...")
            print("=" * 60)
        
        # Load historical data
        if not args.json:
            print("\n1. Loading historical data...")
        df = load_historical_data(hours_back=72)
        if not args.json:
            print(f"   Loaded {len(df)} records")
        
        if df.empty:
            if args.json:
                print(json_module.dumps({'success': False, 'error': 'No historical data available'}))
            else:
                print(" No historical data available for testing")
            sys.exit(1)
        
        zones = df['zone'].unique()
        if not args.json:
            print(f"   Zones: {', '.join(zones)}")
        
        # Determine target zone
        test_zone = args.zone if args.zone else zones[0]
        
        if not args.json:
            print(f"\n2. Generating forecast for: {test_zone}")
        
        # Generate forecast
        forecast = predict_indoor_conditions(
            zone=test_zone,
            hours_ahead=args.hours,
            metric=args.metric
        )
        
        if args.json:
            # JSON output
            if 'error' in forecast:
                output = {'success': False, 'error': forecast['error'], 'zone': test_zone}
            else:
                output = {'success': True, **forecast}
            print(json_module.dumps(output, indent=2))
        else:
            # Human-readable output
            if 'error' in forecast:
                print(f"   Error: {forecast['error']}")
            else:
                print(f"   Current: {forecast['current_value']:.1f}°C")
                print(f"   Forecast horizon: {forecast['forecast_horizon_hours']} hours")
                print(f"   Model AIC: {forecast['model_info']['aic']:.2f}")
                print(f"   Training samples: {forecast['model_info']['training_samples']}")
                
                # Show first few predictions
                print("\n   Predictions (first 6):")
                for pred in forecast['predictions'][:6]:
                    timestamp = datetime.fromisoformat(pred['timestamp'])
                    print(f"     {timestamp.strftime('%H:%M')}: {pred['value']:.1f}°C [{pred['lower_ci']:.1f}, {pred['upper_ci']:.1f}]")
            
            print("\n Predictive forecasting test complete")
    
    except Exception as e:
        if args.json:
            print(json_module.dumps({'success': False, 'error': str(e)}))
        else:
            print(f" Error: {e}")
        sys.exit(1)
