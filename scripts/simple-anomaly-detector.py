#!/usr/bin/env python3
"""
Weather-Aware ML Anomaly Detector for Light Engine Foxtrot
Uses sklearn (free) to detect unusual sensor readings while considering
outdoor weather conditions from the Open-Meteo weather API.
Run this every 15 minutes to get free predictive alerts.

SCOPE: Only analyzes sensors physically placed in Room Mapper (room-map.json)
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timedelta
import requests
from sklearn.ensemble import IsolationForest
import numpy as np

# Add backend to path for outdoor influence module
sys.path.insert(0, str(Path(__file__).parent.parent / 'backend'))
from outdoor_influence import (
    assess_outdoor_influence,
    calculate_temp_delta,
    calculate_hvac_load_prediction,
    calculate_solar_gain_factor,
    get_time_lagged_outdoor_data
)
from outdoor_sensor_validator import OutdoorSensorValidator

# Load historical sensor data
DATA_PATH = Path(__file__).parent.parent / 'public/data/env.json'
ROOM_MAP_PATH = Path(__file__).parent.parent / 'public/data/room-map.json'
FARM_JSON_PATH = Path(__file__).parent.parent / 'public/data/farm.json'

# Initialize weather data validator (validates Open-Meteo weather API responses)
outdoor_validator = OutdoorSensorValidator()

def get_placed_sensor_ids():
    """Load list of device IDs that are placed in Room Mapper"""
    try:
        with open(ROOM_MAP_PATH, 'r') as f:
            room_map = json.load(f)
        
        placed_ids = set()
        for device in room_map.get('devices', []):
            device_id = device.get('deviceId')
            if device_id:
                placed_ids.add(device_id)
        
        return placed_ids
    except FileNotFoundError:
        print(f"Warning: room-map.json not found at {ROOM_MAP_PATH}", file=sys.stderr)
        return set()
    except Exception as e:
        print(f"Warning: Failed to load room-map.json: {e}", file=sys.stderr)
        return set()

def fetch_weather_outdoor_data():
    """Fetch outdoor conditions from weather API (no physical sensor required)"""
    try:
        response = requests.get('http://localhost:8091/api/weather/current', timeout=5)
        if response.ok:
            data = response.json()
            if data.get('ok') and data.get('current'):
                current = data['current']
                return {
                    'temp': current.get('temperature_c'),
                    'rh': current.get('humidity'),
                    'timestamp': current.get('last_updated', datetime.now().isoformat()),
                    'source': 'weather-api',
                    'description': current.get('description', '')
                }
    except Exception as e:
        print(f"Warning: Weather API unavailable: {e}", file=sys.stderr)

    # Fallback: try weather API with farm coordinates directly
    try:
        coords = _load_farm_coords()
        if coords:
            response = requests.get(
                f'http://localhost:8091/api/weather?lat={coords["lat"]}&lng={coords["lng"]}',
                timeout=5
            )
            if response.ok:
                data = response.json()
                if data.get('ok') and data.get('current'):
                    current = data['current']
                    return {
                        'temp': current.get('temperature_c'),
                        'rh': current.get('humidity'),
                        'timestamp': current.get('last_updated', datetime.now().isoformat()),
                        'source': 'weather-api',
                        'description': current.get('description', '')
                    }
    except Exception as e:
        print(f"Warning: Weather API fallback failed: {e}", file=sys.stderr)

    return None


def _load_farm_coords():
    """Load farm coordinates from farm.json"""
    try:
        if FARM_JSON_PATH.exists():
            with open(FARM_JSON_PATH, 'r') as f:
                farm = json.load(f)
            coords = farm.get('coordinates', {})
            if coords.get('lat') and coords.get('lng'):
                return coords
    except Exception:
        pass
    return None

def get_outdoor_reading_at_time(outdoor_zone, target_timestamp, window_minutes=10):
    """Get outdoor conditions at a specific time (within window)"""
    if not outdoor_zone or not outdoor_zone.get('history'):
        return None
    
    # Find closest outdoor reading to target timestamp
    target_time = datetime.fromisoformat(target_timestamp.replace('Z', '+00:00')) if isinstance(target_timestamp, str) else target_timestamp
    closest_reading = None
    min_diff = timedelta(hours=1)
    
    for reading in outdoor_zone.get('history', []):
        reading_time = datetime.fromisoformat(reading['timestamp'].replace('Z', '+00:00')) if isinstance(reading['timestamp'], str) else reading['timestamp']
        diff = abs(target_time - reading_time)
        
        if diff < min_diff and diff <= timedelta(minutes=window_minutes):
            min_diff = diff
            closest_reading = reading
    
    return closest_reading

def calculate_outdoor_rolling_features(outdoor_history, window_size=12):
    """Calculate rolling statistics for outdoor conditions (12 readings = 1 hour at 5min intervals)"""
    if not outdoor_history or len(outdoor_history) < window_size:
        return None
    
    recent = outdoor_history[-window_size:]
    temps = [r.get('temp') for r in recent if r.get('temp') is not None]
    rhs = [r.get('rh') for r in recent if r.get('rh') is not None]
    
    if not temps or not rhs:
        return None
    
    return {
        'temp_mean': round(np.mean(temps), 2),
        'temp_std': round(np.std(temps), 2),
        'temp_trend': round((temps[-1] - temps[0]) / len(temps), 3),  # Temp change per reading
        'rh_mean': round(np.mean(rhs), 2),
        'rh_std': round(np.std(rhs), 2)
    }

def detect_correlated_anomalies(zone_data, time_window_minutes=30):
    """
    Detect anomalies that occur across multiple zones simultaneously
    This indicates systemic issues (HVAC failure, power outage, etc.)
    """
    if len(zone_data) < 2:
        return []
    
    correlated_events = []
    
    # Group anomalies by time window
    time_buckets = {}
    for zone in zone_data:
        zone_name = zone['zone']
        timestamp = zone['timestamp']
        
        # Parse timestamp to datetime
        try:
            event_time = datetime.fromisoformat(timestamp.replace('Z', '+00:00')) if isinstance(timestamp, str) else timestamp
        except:
            continue
        
        # Round to time window (e.g., 30 min buckets)
        bucket_time = event_time.replace(minute=(event_time.minute // time_window_minutes) * time_window_minutes, second=0, microsecond=0)
        bucket_key = bucket_time.isoformat()
        
        if bucket_key not in time_buckets:
            time_buckets[bucket_key] = []
        
        time_buckets[bucket_key].append(zone)
    
    # Find buckets with multiple zones affected
    for bucket_time, zones in time_buckets.items():
        if len(zones) >= 2:
            # Check if they have similar issues (all hot, all humid, etc.)
            temps = [z.get('indoor_temp') for z in zones if z.get('indoor_temp') is not None]
            rhs = [z.get('indoor_rh') for z in zones if z.get('indoor_rh') is not None]
            
            temp_avg = np.mean(temps) if temps else None
            rh_avg = np.mean(rhs) if rhs else None
            
            # Detect patterns
            pattern = None
            severity = 'warning'
            
            if temp_avg and temp_avg > 26:
                pattern = 'high_temperature'
                severity = 'critical' if temp_avg > 28 else 'warning'
            elif temp_avg and temp_avg < 18:
                pattern = 'low_temperature'
                severity = 'critical' if temp_avg < 16 else 'warning'
            elif rh_avg and rh_avg > 75:
                pattern = 'high_humidity'
                severity = 'warning'
            elif rh_avg and rh_avg < 35:
                pattern = 'low_humidity'
                severity = 'warning'
            else:
                pattern = 'correlated_deviation'
                severity = 'info'
            
            correlated_events.append({
                'timestamp': bucket_time,
                'zone_count': len(zones),
                'zones': [z['zone'] for z in zones],
                'pattern': pattern,
                'severity': severity,
                'avg_temp': round(temp_avg, 1) if temp_avg else None,
                'avg_rh': round(rh_avg, 1) if rh_avg else None,
                'reason': generate_correlation_reason(pattern, len(zones), temp_avg, rh_avg)
            })
    
    return correlated_events

def generate_correlation_reason(pattern, zone_count, temp_avg, rh_avg):
    """Generate human-readable reason for correlated anomaly"""
    reasons = {
        'high_temperature': f" {zone_count} zones experiencing high temperatures (avg {temp_avg:.1f}°C) - possible HVAC cooling failure",
        'low_temperature': f"❄ {zone_count} zones experiencing low temperatures (avg {temp_avg:.1f}°C) - possible HVAC heating failure",
        'high_humidity': f"💧 {zone_count} zones with high humidity (avg {rh_avg:.1f}%) - possible dehumidifier failure or leak",
        'low_humidity': f"🌵 {zone_count} zones with low humidity (avg {rh_avg:.1f}%) - possible humidifier failure",
        'correlated_deviation': f" {zone_count} zones showing simultaneous anomalies - possible systemic issue"
    }
    return reasons.get(pattern, f"{zone_count} zones affected simultaneously")

def load_sensor_history():
    """Load last 24 hours of sensor data with outdoor context - ONLY for sensors placed in Room Mapper"""
    with open(DATA_PATH, 'r') as f:
        data = json.load(f)
    
    zones = data.get('zones', [])
    
    # Get list of sensors placed in Room Mapper
    placed_sensor_ids = get_placed_sensor_ids()
    if not placed_sensor_ids:
        print("Warning: No sensors found in room-map.json - anomaly detection will be empty", file=sys.stderr)
    
    # Get outdoor conditions from weather API (no physical sensor needed)
    weather_data = fetch_weather_outdoor_data()
    
    # Build feature matrix with outdoor influence:
    # Enhanced features: [indoor_temp, indoor_rh, indoor_vpd, outdoor_temp, outdoor_rh, temp_delta,
    #                     outdoor_temp_lagged, outdoor_temp_rolling_mean, solar_gain]
    features = []
    timestamps = []
    zone_names = []
    outdoor_contexts = []
    
    # No physical outdoor sensor history — weather API provides current snapshot only
    outdoor_history = []
    
    # Get outdoor conditions from weather API
    outdoor_temp_ref = None
    outdoor_rh_ref = None
    outdoor_data_source = None
    
    if weather_data and weather_data.get('temp') is not None:
        outdoor_temp_ref = weather_data['temp']
        outdoor_rh_ref = weather_data.get('rh')
        outdoor_data_source = 'weather-api'
        print(f"Using weather API for outdoor conditions: {outdoor_temp_ref:.1f}°C, {outdoor_rh_ref}% RH ({weather_data.get('description', '')})", file=sys.stderr)
    else:
        print("Warning: Outdoor data unavailable — anomaly detection will have no outdoor context", file=sys.stderr)
    
    for zone in zones:
        zone_name = zone.get('name', 'Unknown')
        zone_location = zone.get('location', '').lower()
        zone_name_lower = zone_name.lower()
        
        # Get device ID from zone metadata
        zone_device_id = zone.get('meta', {}).get('deviceId')
        
        # CRITICAL FILTER: Skip sensors not placed in Room Mapper
        if zone_device_id and zone_device_id not in placed_sensor_ids:
            continue
        
        # Skip all outdoor/outside-labeled zones (outdoor conditions come from weather API)
        if 'outdoor' in zone_name_lower or 'outside' in zone_name_lower:
            continue
        if 'outdoor' in zone_location or 'outside' in zone_location:
            continue
        sensors = zone.get('sensors', {})
        
        # Extract history arrays from nested sensor structure
        temp_history = sensors.get('tempC', {}).get('history', [])
        rh_history = sensors.get('rh', {}).get('history', [])
        vpd_history = sensors.get('vpd', {}).get('history', [])
        
        # Use minimum length to avoid index errors
        history_len = min(len(temp_history), len(rh_history), len(vpd_history))
        
        if history_len == 0:
            continue
        
        # Process last 288 readings (24h at 5min intervals) or all available
        for i in range(max(0, history_len - 288), history_len):
            indoor_temp = temp_history[i] if i < len(temp_history) else 20
            indoor_rh = rh_history[i] if i < len(rh_history) else 60
            indoor_vpd = vpd_history[i] if i < len(vpd_history) else 1.0
            
            # Skip invalid readings (0 or null temperatures indicate sensor issues)
            if indoor_temp == 0 or indoor_temp is None:
                continue
            
            # Calculate enhanced outdoor features with time-lag and rolling statistics
            if outdoor_temp_ref is not None and outdoor_rh_ref is not None:
                outdoor_temp = outdoor_temp_ref
                outdoor_rh = outdoor_rh_ref
                temp_delta = indoor_temp - outdoor_temp
                
                # Get time-lagged outdoor (30 min ago accounts for thermal mass)
                outdoor_temp_lagged = outdoor_temp  # Default to current
                if len(outdoor_history) >= 6:  # 30 min ago (6 readings at 5min intervals)
                    lagged_reading = outdoor_history[-6]
                    if lagged_reading.get('temp') is not None:
                        outdoor_temp_lagged = lagged_reading['temp']
                
                # Calculate rolling statistics (1 hour window)
                rolling_features = calculate_outdoor_rolling_features(outdoor_history, window_size=12)
                outdoor_temp_rolling_mean = rolling_features['temp_mean'] if rolling_features else outdoor_temp
                outdoor_temp_trend = rolling_features['temp_trend'] if rolling_features else 0.0
                
                # Calculate solar gain factor
                solar_gain = calculate_solar_gain_factor()
                
                outdoor_context = {
                    'outdoor_temp': outdoor_temp,
                    'outdoor_rh': outdoor_rh,
                    'temp_delta': temp_delta,
                    'outdoor_temp_lagged': outdoor_temp_lagged,
                    'outdoor_temp_rolling_mean': outdoor_temp_rolling_mean,
                    'outdoor_temp_trend': outdoor_temp_trend,
                    'solar_gain': solar_gain
                }
            else:
                # No outdoor data available - use neutral values
                outdoor_temp = indoor_temp
                outdoor_rh = indoor_rh
                temp_delta = 0
                outdoor_temp_lagged = indoor_temp
                outdoor_temp_rolling_mean = indoor_temp
                solar_gain = 0.5
                outdoor_context = None
            
            features.append([
                indoor_temp,
                indoor_rh,
                indoor_vpd,
                outdoor_temp,
                outdoor_rh,
                temp_delta,
                outdoor_temp_lagged,
                outdoor_temp_rolling_mean,
                solar_gain
            ])
            timestamps.append(f"reading_{i}")  # Simplified timestamp
            zone_names.append(zone_name)
            outdoor_contexts.append(outdoor_context)
    
    return np.array(features), timestamps, zone_names, outdoor_contexts

def detect_anomalies(json_mode=False):
    """Use Isolation Forest to find unusual readings considering outdoor influence"""
    features, timestamps, zone_names, outdoor_contexts = load_sensor_history()
    
    if len(features) < 10:
        if not json_mode:
            print("Not enough data yet (need at least 10 readings)")
        return []
    
    # Train anomaly detector with outdoor-aware features
    # Lower contamination since we're filtering outdoor effects
    model = IsolationForest(contamination=0.03, random_state=42)
    predictions = model.fit_predict(features)
    
    # Find anomalies
    anomalies = []
    for i, pred in enumerate(predictions):
        if pred == -1:  # Anomaly detected
            outdoor_ctx = outdoor_contexts[i]
            
            indoor_temp = float(features[i][0])
            indoor_rh = float(features[i][1])
            indoor_vpd = float(features[i][2])
            outdoor_temp = float(features[i][3]) if outdoor_ctx else None
            outdoor_rh = float(features[i][4]) if outdoor_ctx else None
            temp_delta_val = float(features[i][5]) if outdoor_ctx else None
            
            anomaly = {
                'zone': zone_names[i],
                'timestamp': timestamps[i],
                'indoor_temp': indoor_temp,
                'indoor_rh': indoor_rh,
                'indoor_vpd': indoor_vpd,
                'outdoor_temp': outdoor_temp,
                'outdoor_rh': outdoor_rh,
                'temp_delta': temp_delta_val
            }
            
            # Use outdoor influence module for comprehensive assessment with enhanced features
            if outdoor_ctx and outdoor_temp is not None and outdoor_rh is not None:
                outdoor_temp_lagged = float(features[i][6]) if len(features[i]) > 6 else outdoor_temp
                solar_gain = float(features[i][8]) if len(features[i]) > 8 else None
                
                influence = assess_outdoor_influence(
                    indoor_temp=indoor_temp,
                    outdoor_temp=outdoor_temp,
                    indoor_rh=indoor_rh,
                    outdoor_rh=outdoor_rh,
                    outdoor_temp_lagged=outdoor_temp_lagged,
                    solar_gain=solar_gain
                )
                
                anomaly['outdoor_influence'] = influence['outdoor_influence_level']
                anomaly['anomaly_likelihood'] = influence['anomaly_likelihood']
                anomaly['expected_indoor'] = influence['expected_indoor_from_outdoor']
                anomaly['hvac_load'] = influence['hvac_load']
                
                # Enhanced severity assessment using outdoor influence
                if influence['anomaly_likelihood'] > 0.7:
                    anomaly['severity'] = 'critical'
                    anomaly['reason'] = f"Equipment likely failed: Indoor {indoor_temp:.1f}°C vs expected {influence['expected_indoor_from_outdoor']:.1f}°C from outdoor {outdoor_temp:.1f}°C. {influence['outdoor_influence_level'].capitalize()} outdoor influence."
                elif influence['anomaly_likelihood'] > 0.4:
                    anomaly['severity'] = 'warning'
                    anomaly['reason'] = f"Unusual conditions: Indoor {indoor_temp:.1f}°C (expected {influence['expected_indoor_from_outdoor']:.1f}°C). Outdoor: {outdoor_temp:.1f}°C. Check HVAC."
                elif not influence['is_within_expected']:
                    anomaly['severity'] = 'warning'
                    anomaly['reason'] = f"Indoor {indoor_temp:.1f}°C outside expected range {influence['expected_range']} given outdoor {outdoor_temp:.1f}°C"
                else:
                    anomaly['severity'] = 'info'
                    anomaly['reason'] = f"Statistical anomaly: Indoor {indoor_temp:.1f}°C, outdoor {outdoor_temp:.1f}°C, influence: {influence['outdoor_influence_level']}"
            else:
                # Fallback to simpler severity assessment without outdoor influence
                if indoor_temp > 26 and temp_delta_val and temp_delta_val > 8:
                    anomaly['severity'] = 'critical'
                    anomaly['reason'] = f"High indoor temp ({indoor_temp:.1f}°C) despite cool outdoor conditions ({outdoor_temp:.1f}°C)" if outdoor_temp else f"High indoor temp ({indoor_temp:.1f}°C)"
                elif indoor_temp < 18 and temp_delta_val and temp_delta_val < -5:
                    anomaly['severity'] = 'warning'
                    anomaly['reason'] = f"Low indoor temp ({indoor_temp:.1f}°C) despite warm outdoor conditions ({outdoor_temp:.1f}°C)" if outdoor_temp else f"Low indoor temp ({indoor_temp:.1f}°C)"
                elif indoor_rh and outdoor_rh and abs(indoor_rh - outdoor_rh) > 40:
                    anomaly['severity'] = 'warning'
                    anomaly['reason'] = f"Large humidity difference: indoor {indoor_rh:.0f}% vs outdoor {outdoor_rh:.0f}%"
                else:
                    anomaly['severity'] = 'info'
                    anomaly['reason'] = "Statistical anomaly detected (limited outdoor context)"
            
            anomalies.append(anomaly)
    
    # Detect cross-zone correlations
    correlated = detect_correlated_anomalies(anomalies) if len(anomalies) >= 2 else []
    
    # Report findings (only in non-JSON mode)
    if not json_mode:
        if correlated:
            print(f"\n🔗 Found {len(correlated)} cross-zone correlation(s):")
            for c in correlated:
                severity_icon = {'critical': '', 'warning': '🟡', 'info': '🔵'}[c['severity']]
                print(f"  {severity_icon} {c['reason']}")
                print(f"     Affected zones: {', '.join(c['zones'])}")
        
        if anomalies:
            print(f"\n🚨 Found {len(anomalies)} outdoor-aware anomalies in last 24h:")
            for a in sorted(anomalies, key=lambda x: {'critical': 0, 'warning': 1, 'info': 2}[x['severity']])[-10:]:
                severity_icon = {'critical': '', 'warning': '🟡', 'info': '🔵'}[a['severity']]
                outdoor_info = f" (Outdoor: {a['outdoor_temp']:.1f}°C, {a['outdoor_rh']:.0f}%)" if a['outdoor_temp'] is not None else ""
                print(f"  {severity_icon} {a['zone']} at {a['timestamp']}: "
                      f"Indoor {a['indoor_temp']:.1f}°C, {a['indoor_rh']:.0f}%{outdoor_info}")
                print(f"     → {a['reason']}")
        else:
            print(" All sensor readings normal (considering outdoor influence)")
    
    return {
        'anomalies': anomalies,
        'correlated_events': correlated
    }

if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Outdoor-aware ML anomaly detector')
    parser.add_argument('--json', action='store_true', help='Output JSON instead of human-readable text')
    args = parser.parse_args()
    
    try:
        result = detect_anomalies(json_mode=args.json)
        anomalies = result.get('anomalies', []) if isinstance(result, dict) else result
        correlated = result.get('correlated_events', []) if isinstance(result, dict) else []
        
        if args.json:
            # Output JSON for API consumption
            import json
            output = {
                'success': True,
                'anomalies': anomalies,
                'count': len(anomalies),
                'critical_count': len([a for a in anomalies if a['severity'] == 'critical']),
                'warning_count': len([a for a in anomalies if a['severity'] == 'warning']),
                'info_count': len([a for a in anomalies if a['severity'] == 'info']),
                'correlated_events': correlated,
                'correlated_count': len(correlated)
            }
            print(json.dumps(output, indent=2))
        
        # Could POST to /api/alerts endpoint here
        # Could send to Slack/Discord webhook
        # Could trigger automated response
        
    except FileNotFoundError:
        if args.json:
            print(json.dumps({'success': False, 'error': f'Could not find {DATA_PATH}'}))
        else:
            print(f"Error: Could not find {DATA_PATH}")
            print("Make sure server is running and collecting data")
        sys.exit(1)
    except Exception as e:
        if args.json:
            print(json.dumps({'success': False, 'error': str(e)}))
        else:
            print(f"Error: {e}")
        sys.exit(1)
