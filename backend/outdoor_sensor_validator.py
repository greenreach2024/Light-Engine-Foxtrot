"""
Outdoor Conditions Validation Module

Validates outdoor weather data quality for ML operations.
Primary source: Weather API (Open-Meteo via /api/weather endpoint).
No physical outdoor sensor is required — outdoor conditions are pulled from weather API.

The OutdoorSensorValidator class is retained for data validation logic
(range checks, staleness) and comparison utilities.
"""

import logging
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple
import requests

logger = logging.getLogger(__name__)

# Valid ranges for outdoor sensor readings
TEMP_MIN_C = -40.0
TEMP_MAX_C = 50.0
RH_MIN = 0.0
RH_MAX = 100.0

# Stale data threshold (minutes)
STALE_THRESHOLD_MINUTES = 15

def load_farm_coordinates() -> Dict:
    """Load farm coordinates from farm.json config file"""
    try:
        farm_json_path = Path(__file__).parent.parent / "public" / "data" / "farm.json"
        if farm_json_path.exists():
            with open(farm_json_path, 'r') as f:
                farm_data = json.load(f)
                coords = farm_data.get('coordinates', {})
                if coords.get('lat') and coords.get('lng'):
                    logger.info(f"✓ Loaded farm coordinates: {coords['lat']}, {coords['lng']} from farm.json")
                    return {'lat': coords['lat'], 'lng': coords['lng']}
    except Exception as e:
        logger.warning(f"Failed to load farm coordinates from farm.json: {e}")
    
    # Fallback to Kingston, ON
    logger.info("Using default coordinates: Kingston, ON (44.258679, -76.372517)")
    return {'lat': 44.258679, 'lng': -76.372517}

class OutdoorSensorValidator:
    """Validates outdoor sensor data quality and manages fallback to weather API"""
    
    def __init__(self, weather_api_url: str = None, farm_coords: Dict = None):
        """
        Initialize validator with weather API fallback.
        
        Args:
            weather_api_url: Base URL for weather API (e.g., '/api/weather')
            farm_coords: Dict with 'lat' and 'lng' keys for farm location (if None, loads from farm.json)
        """
        self.weather_api_url = weather_api_url or 'http://localhost:8091/api/weather'
        # Load farm coordinates from farm.json if not explicitly provided
        self.farm_coords = farm_coords or load_farm_coordinates()
        self.last_validation = None
        self.validation_cache_seconds = 60
    
    def validate_temperature(self, temp_c: float) -> Tuple[bool, Optional[str]]:
        """
        Validate temperature reading is within reasonable range.
        
        Args:
            temp_c: Temperature in Celsius
        
        Returns:
            Tuple of (is_valid, error_message)
        """
        if temp_c is None:
            return (False, "Temperature is null")
        
        if not isinstance(temp_c, (int, float)):
            return (False, f"Temperature must be numeric, got {type(temp_c)}")
        
        if temp_c < TEMP_MIN_C:
            return (False, f"Temperature {temp_c}°C below minimum {TEMP_MIN_C}°C")
        
        if temp_c > TEMP_MAX_C:
            return (False, f"Temperature {temp_c}°C above maximum {TEMP_MAX_C}°C")
        
        # Additional sanity check: 0°C exactly is often a sensor error
        if temp_c == 0.0:
            return (False, "Temperature exactly 0°C likely indicates sensor error")
        
        return (True, None)
    
    def validate_humidity(self, rh: float) -> Tuple[bool, Optional[str]]:
        """
        Validate relative humidity reading is within reasonable range.
        
        Args:
            rh: Relative humidity (0-100%)
        
        Returns:
            Tuple of (is_valid, error_message)
        """
        if rh is None:
            return (False, "Humidity is null")
        
        if not isinstance(rh, (int, float)):
            return (False, f"Humidity must be numeric, got {type(rh)}")
        
        if rh < RH_MIN:
            return (False, f"Humidity {rh}% below minimum {RH_MIN}%")
        
        if rh > RH_MAX:
            return (False, f"Humidity {rh}% above maximum {RH_MAX}%")
        
        return (True, None)
    
    def is_data_stale(self, last_sync: str, threshold_minutes: int = None) -> Tuple[bool, Optional[str]]:
        """
        Check if sensor data is stale (not updated recently).
        
        Args:
            last_sync: ISO 8601 timestamp of last sensor update
            threshold_minutes: Minutes before data is considered stale
        
        Returns:
            Tuple of (is_stale, staleness_info)
        """
        if threshold_minutes is None:
            threshold_minutes = STALE_THRESHOLD_MINUTES
        
        if not last_sync:
            return (True, "No timestamp available")
        
        try:
            if isinstance(last_sync, str):
                last_sync_dt = datetime.fromisoformat(last_sync.replace('Z', '+00:00'))
            else:
                last_sync_dt = last_sync
            
            now = datetime.now(last_sync_dt.tzinfo) if last_sync_dt.tzinfo else datetime.utcnow()
            age = now - last_sync_dt
            age_minutes = age.total_seconds() / 60
            
            if age_minutes > threshold_minutes:
                return (True, f"Data is {age_minutes:.1f} minutes old (threshold: {threshold_minutes})")
            
            return (False, f"Data is {age_minutes:.1f} minutes old (fresh)")
            
        except (ValueError, AttributeError) as e:
            return (True, f"Invalid timestamp format: {e}")
    
    def validate_outdoor_sensor(self, sensor_data: Dict) -> Dict[str, any]:
        """
        Comprehensive validation of outdoor sensor data.
        
        Args:
            sensor_data: Dict with keys:
                - temp: Temperature in Celsius
                - rh: Relative humidity (%)
                - last_sync: ISO timestamp of last update
                - device_id: Sensor device ID (optional)
        
        Returns:
            Dict with validation results:
                - is_valid: Overall validity
                - temp_valid: Temperature validation result
                - rh_valid: Humidity validation result
                - is_stale: Whether data is stale
                - errors: List of error messages
                - warnings: List of warning messages
        """
        result = {
            'is_valid': True,
            'temp_valid': True,
            'rh_valid': True,
            'is_stale': False,
            'errors': [],
            'warnings': []
        }
        
        # Validate temperature
        temp = sensor_data.get('temp')
        temp_valid, temp_error = self.validate_temperature(temp)
        result['temp_valid'] = temp_valid
        if not temp_valid:
            result['is_valid'] = False
            result['errors'].append(f"Temperature: {temp_error}")
        
        # Validate humidity
        rh = sensor_data.get('rh')
        rh_valid, rh_error = self.validate_humidity(rh)
        result['rh_valid'] = rh_valid
        if not rh_valid:
            result['is_valid'] = False
            result['errors'].append(f"Humidity: {rh_error}")
        
        # Check staleness
        last_sync = sensor_data.get('last_sync')
        is_stale, stale_info = self.is_data_stale(last_sync)
        result['is_stale'] = is_stale
        if is_stale:
            result['is_valid'] = False
            result['errors'].append(f"Staleness: {stale_info}")
        else:
            result['warnings'].append(stale_info)
        
        return result
    
    def get_weather_api_fallback(self) -> Optional[Dict]:
        """
        Fetch outdoor conditions from weather API as fallback.
        
        Returns:
            Dict with temp and rh, or None if API fails
        """
        try:
            url = f"{self.weather_api_url}?lat={self.farm_coords['lat']}&lng={self.farm_coords['lng']}"
            logger.info(f"Fetching weather API fallback from {url}")
            
            response = requests.get(url, timeout=5)
            response.raise_for_status()
            
            data = response.json()
            if not data.get('ok'):
                logger.error(f"Weather API returned not ok: {data.get('error')}")
                return None
            
            current = data.get('current', {})
            
            return {
                'temp': current.get('temperature_c'),
                'rh': current.get('humidity'),
                'source': 'weather_api',
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }
            
        except requests.RequestException as e:
            logger.error(f"Weather API request failed: {e}")
            return None
        except Exception as e:
            logger.error(f"Weather API fallback error: {e}")
            return None
    
    def compare_with_weather_api(self, sensor_temp: float, sensor_rh: float) -> Dict[str, any]:
        """
        Compare outdoor sensor reading with weather API as sanity check.
        
        Typical acceptable difference:
        - Temperature: ±5°C (local microclimates, sensor placement)
        - Humidity: ±15% (sensor accuracy, local conditions)
        
        Args:
            sensor_temp: Temperature from outdoor sensor (°C)
            sensor_rh: Humidity from outdoor sensor (%)
        
        Returns:
            Dict with comparison results
        """
        weather_data = self.get_weather_api_fallback()
        
        if not weather_data:
            return {
                'compared': False,
                'error': 'Weather API unavailable for comparison'
            }
        
        weather_temp = weather_data.get('temp')
        weather_rh = weather_data.get('rh')
        
        temp_diff = abs(sensor_temp - weather_temp) if (sensor_temp and weather_temp) else None
        rh_diff = abs(sensor_rh - weather_rh) if (sensor_rh and weather_rh) else None
        
        result = {
            'compared': True,
            'sensor_temp': sensor_temp,
            'weather_temp': weather_temp,
            'temp_diff': temp_diff,
            'sensor_rh': sensor_rh,
            'weather_rh': weather_rh,
            'rh_diff': rh_diff,
            'temp_discrepancy': False,
            'rh_discrepancy': False,
            'warnings': []
        }
        
        # Check temperature discrepancy
        if temp_diff is not None and temp_diff > 5.0:
            result['temp_discrepancy'] = True
            result['warnings'].append(
                f"Temperature differs from weather API by {temp_diff:.1f}°C "
                f"(sensor: {sensor_temp:.1f}°C, weather: {weather_temp:.1f}°C)"
            )
        
        # Check humidity discrepancy
        if rh_diff is not None and rh_diff > 15.0:
            result['rh_discrepancy'] = True
            result['warnings'].append(
                f"Humidity differs from weather API by {rh_diff:.0f}% "
                f"(sensor: {sensor_rh:.0f}%, weather: {weather_rh:.0f}%)"
            )
        
        return result
    
    def get_validated_outdoor_data(self, sensor_data: Dict, use_fallback: bool = True) -> Dict[str, any]:
        """
        Get validated outdoor data with automatic fallback to weather API.
        
        Main entry point for getting reliable outdoor conditions.
        
        Args:
            sensor_data: Dict with outdoor sensor readings
            use_fallback: Whether to fall back to weather API on sensor failure
        
        Returns:
            Dict with validated outdoor data and metadata
        """
        validation = self.validate_outdoor_sensor(sensor_data)
        
        result = {
            'valid': validation['is_valid'],
            'temp': sensor_data.get('temp'),
            'rh': sensor_data.get('rh'),
            'source': 'outdoor_sensor',
            'validation': validation,
            'used_fallback': False
        }
        
        # If sensor invalid and fallback enabled, use weather API
        if not validation['is_valid'] and use_fallback:
            logger.warning(f"Outdoor sensor invalid: {validation['errors']}. Using weather API fallback.")
            
            weather_data = self.get_weather_api_fallback()
            if weather_data:
                result['temp'] = weather_data['temp']
                result['rh'] = weather_data['rh']
                result['source'] = 'weather_api_fallback'
                result['used_fallback'] = True
                result['valid'] = True
                logger.info(f"Weather API fallback successful: {weather_data['temp']}°C, {weather_data['rh']}%")
            else:
                logger.error("Weather API fallback also failed")
        
        # Even if sensor is valid, compare with weather API as sanity check
        elif validation['is_valid'] and sensor_data.get('temp') and sensor_data.get('rh'):
            comparison = self.compare_with_weather_api(sensor_data['temp'], sensor_data['rh'])
            result['weather_comparison'] = comparison
            
            if comparison.get('temp_discrepancy') or comparison.get('rh_discrepancy'):
                result['validation']['warnings'].extend(comparison['warnings'])
        
        return result


# Example usage
if __name__ == "__main__":
    import json
    
    validator = OutdoorSensorValidator()
    
    print("=== Test 1: Valid Sensor Data ===")
    sensor_data = {
        'temp': 15.5,
        'rh': 65.0,
        'last_sync': datetime.utcnow().isoformat() + 'Z',
        'device_id': 'CE2A83060A2C'
    }
    result = validator.get_validated_outdoor_data(sensor_data)
    print(json.dumps(result, indent=2, default=str))
    print()
    
    print("=== Test 2: Stale Sensor Data (should fallback) ===")
    sensor_data['last_sync'] = (datetime.utcnow() - timedelta(hours=1)).isoformat() + 'Z'
    result = validator.get_validated_outdoor_data(sensor_data)
    print(f"Used fallback: {result['used_fallback']}")
    print(f"Source: {result['source']}")
    print(f"Errors: {result['validation']['errors']}")
    print()
    
    print("=== Test 3: Invalid Temperature (0°C sensor error) ===")
    sensor_data = {
        'temp': 0.0,
        'rh': 60.0,
        'last_sync': datetime.utcnow().isoformat() + 'Z'
    }
    result = validator.get_validated_outdoor_data(sensor_data)
    print(f"Valid: {result['valid']}")
    print(f"Used fallback: {result['used_fallback']}")
    print(f"Errors: {result['validation']['errors']}")
