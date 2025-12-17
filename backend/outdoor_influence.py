"""
Outdoor Influence Feature Engineering Module

Provides helper functions to calculate outdoor environmental influence on indoor conditions.
Used for ML models, anomaly detection, and HVAC optimization.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


def calculate_temp_delta(indoor_temp: float, outdoor_temp: float) -> float:
    """
    Calculate temperature differential between indoor and outdoor.
    
    Args:
        indoor_temp: Indoor temperature in Celsius
        outdoor_temp: Outdoor temperature in Celsius
    
    Returns:
        Temperature delta (indoor - outdoor) in Celsius
    """
    if indoor_temp is None or outdoor_temp is None:
        return None
    
    return round(indoor_temp - outdoor_temp, 2)


def calculate_expected_indoor_range(
    outdoor_temp: float,
    outdoor_rh: float,
    season: str = "spring",
    has_hvac: bool = True
) -> Tuple[float, float]:
    """
    Calculate expected indoor temperature range based on outdoor conditions.
    
    Args:
        outdoor_temp: Outdoor temperature in Celsius
        outdoor_rh: Outdoor relative humidity (0-100%)
        season: Current season ("winter", "spring", "summer", "fall")
        has_hvac: Whether facility has active HVAC system
    
    Returns:
        Tuple of (min_expected_temp, max_expected_temp) in Celsius
    """
    if outdoor_temp is None:
        return (18.0, 26.0)  # Default comfortable range
    
    if has_hvac:
        # With HVAC, indoor should be relatively stable
        # But outdoor extremes can still stress the system
        if outdoor_temp < 0:  # Extreme cold
            min_temp = 18.0
            max_temp = 24.0
        elif outdoor_temp < 10:  # Cold
            min_temp = 19.0
            max_temp = 25.0
        elif outdoor_temp < 25:  # Comfortable
            min_temp = 20.0
            max_temp = 26.0
        elif outdoor_temp < 35:  # Hot
            min_temp = 21.0
            max_temp = 27.0
        else:  # Extreme heat
            min_temp = 22.0
            max_temp = 28.0
    else:
        # Without HVAC, indoor tracks outdoor more closely
        # Indoor typically 2-5°C warmer than outdoor due to building heat
        offset = 3.0
        variance = 2.0
        min_temp = outdoor_temp + offset - variance
        max_temp = outdoor_temp + offset + variance
    
    return (round(min_temp, 1), round(max_temp, 1))


def calculate_hvac_load_prediction(
    indoor_temp: float,
    outdoor_temp: float,
    indoor_rh: float,
    outdoor_rh: float,
    target_temp: float = 22.0,
    target_rh: float = 60.0
) -> Dict[str, float]:
    """
    Predict HVAC load requirements based on indoor/outdoor conditions.
    
    Args:
        indoor_temp: Current indoor temperature (°C)
        outdoor_temp: Current outdoor temperature (°C)
        indoor_rh: Current indoor relative humidity (%)
        outdoor_rh: Current outdoor relative humidity (%)
        target_temp: Desired indoor temperature (°C)
        target_rh: Desired indoor relative humidity (%)
    
    Returns:
        Dict with keys:
            - cooling_load: 0-100 (percentage of max cooling capacity needed)
            - heating_load: 0-100 (percentage of max heating capacity needed)
            - dehumidification_load: 0-100 (percentage of max dehumidification needed)
            - humidification_load: 0-100 (percentage of max humidification needed)
            - ventilation_efficiency: 0-100 (effectiveness of outdoor air exchange)
    """
    result = {
        "cooling_load": 0.0,
        "heating_load": 0.0,
        "dehumidification_load": 0.0,
        "humidification_load": 0.0,
        "ventilation_efficiency": 50.0
    }
    
    if None in [indoor_temp, outdoor_temp, indoor_rh, outdoor_rh]:
        return result
    
    # Temperature load calculation
    temp_delta = indoor_temp - target_temp
    outdoor_delta = outdoor_temp - target_temp
    
    if temp_delta > 0:  # Need cooling
        # Higher load if outdoor is also hot
        base_load = min(100, temp_delta * 20)  # 5°C over = 100% load
        outdoor_penalty = max(0, outdoor_delta * 10)
        result["cooling_load"] = round(min(100, base_load + outdoor_penalty), 1)
    elif temp_delta < 0:  # Need heating
        base_load = min(100, abs(temp_delta) * 20)
        outdoor_penalty = max(0, abs(outdoor_delta) * 10)
        result["heating_load"] = round(min(100, base_load + outdoor_penalty), 1)
    
    # Humidity load calculation
    rh_delta = indoor_rh - target_rh
    
    if rh_delta > 0:  # Need dehumidification
        result["dehumidification_load"] = round(min(100, rh_delta * 2), 1)  # 50% over = 100% load
    elif rh_delta < 0:  # Need humidification
        result["humidification_load"] = round(min(100, abs(rh_delta) * 2), 1)
    
    # Ventilation efficiency (higher when outdoor conditions closer to target)
    temp_efficiency = max(0, 100 - abs(outdoor_delta) * 10)
    rh_efficiency = max(0, 100 - abs(outdoor_rh - target_rh) * 1.5)
    result["ventilation_efficiency"] = round((temp_efficiency + rh_efficiency) / 2, 1)
    
    return result


def get_time_lagged_outdoor_data(
    env_history: List[Dict],
    outdoor_zone_id: str,
    lag_minutes: int = 30,
    current_time: Optional[datetime] = None
) -> Optional[Dict]:
    """
    Get outdoor conditions from X minutes ago to account for thermal lag.
    
    Buildings respond to outdoor conditions with a delay due to thermal mass.
    Typical lag: 15-60 minutes depending on insulation and building size.
    
    Args:
        env_history: List of environmental data snapshots with timestamps
        outdoor_zone_id: Zone ID for outdoor sensor
        lag_minutes: How many minutes back to look (15-60 typical)
        current_time: Reference time (defaults to now)
    
    Returns:
        Dict with outdoor sensor data from lag_minutes ago, or None if not found
    """
    if not env_history or not outdoor_zone_id:
        return None
    
    if current_time is None:
        current_time = datetime.utcnow()
    
    target_time = current_time - timedelta(minutes=lag_minutes)
    
    # Find the snapshot closest to the target time
    closest_snapshot = None
    min_time_diff = float('inf')
    
    for snapshot in env_history:
        if 'timestamp' not in snapshot or 'zones' not in snapshot:
            continue
        
        try:
            snapshot_time = datetime.fromisoformat(snapshot['timestamp'].replace('Z', '+00:00'))
            time_diff = abs((snapshot_time - target_time).total_seconds())
            
            if time_diff < min_time_diff:
                # Find outdoor zone in this snapshot
                for zone in snapshot['zones']:
                    if zone.get('id') == outdoor_zone_id or zone.get('meta', {}).get('deviceId') == outdoor_zone_id:
                        closest_snapshot = zone
                        min_time_diff = time_diff
                        break
        except (ValueError, AttributeError) as e:
            logger.warning(f"Error parsing timestamp in history: {e}")
            continue
    
    if closest_snapshot and min_time_diff <= lag_minutes * 60 * 1.5:  # Within 1.5x lag window
        return {
            'temp': closest_snapshot.get('sensors', {}).get('tempC', {}).get('current'),
            'rh': closest_snapshot.get('sensors', {}).get('rh', {}).get('current'),
            'timestamp': closest_snapshot.get('meta', {}).get('lastSync'),
            'lag_seconds': int(min_time_diff)
        }
    
    return None


def calculate_outdoor_rolling_statistics(
    outdoor_history: List[Dict],
    window_hours: float = 1.0,
    reading_interval_minutes: int = 5
) -> Dict[str, any]:
    """
    Calculate rolling statistics for outdoor conditions over a time window.
    
    Useful for detecting outdoor trends and variance that affect indoor control difficulty.
    
    Args:
        outdoor_history: List of outdoor readings with 'temp', 'rh', 'timestamp'
        window_hours: Rolling window size in hours (default 1.0)
        reading_interval_minutes: Time between readings (default 5)
    
    Returns:
        Dict with rolling statistics:
            - temp_mean, temp_std, temp_min, temp_max, temp_trend
            - rh_mean, rh_std, rh_min, rh_max, rh_trend
            - variance_score (0-100, higher = more unstable outdoor conditions)
    """
    if not outdoor_history:
        return None
    
    window_size = int((window_hours * 60) / reading_interval_minutes)
    
    if len(outdoor_history) < window_size:
        window_size = len(outdoor_history)
    
    if window_size < 2:
        return None
    
    recent = outdoor_history[-window_size:]
    temps = [r['temp'] for r in recent if r.get('temp') is not None]
    rhs = [r['rh'] for r in recent if r.get('rh') is not None]
    
    if not temps or not rhs:
        return None
    
    # Temperature statistics
    temp_mean = sum(temps) / len(temps)
    temp_std = (sum((t - temp_mean) ** 2 for t in temps) / len(temps)) ** 0.5
    temp_min = min(temps)
    temp_max = max(temps)
    
    # Temperature trend (linear regression slope approximation)
    # Positive = warming, negative = cooling
    if len(temps) >= 3:
        n = len(temps)
        x_mean = (n - 1) / 2  # Index mean
        y_mean = temp_mean
        numerator = sum((i - x_mean) * (temps[i] - y_mean) for i in range(n))
        denominator = sum((i - x_mean) ** 2 for i in range(n))
        temp_trend = numerator / denominator if denominator != 0 else 0.0
        temp_trend_per_hour = temp_trend * (60 / reading_interval_minutes)  # Convert to °C/hour
    else:
        temp_trend_per_hour = 0.0
    
    # Humidity statistics
    rh_mean = sum(rhs) / len(rhs)
    rh_std = (sum((r - rh_mean) ** 2 for r in rhs) / len(rhs)) ** 0.5
    rh_min = min(rhs)
    rh_max = max(rhs)
    
    # Humidity trend
    if len(rhs) >= 3:
        n = len(rhs)
        x_mean = (n - 1) / 2
        y_mean = rh_mean
        numerator = sum((i - x_mean) * (rhs[i] - y_mean) for i in range(n))
        denominator = sum((i - x_mean) ** 2 for i in range(n))
        rh_trend = numerator / denominator if denominator != 0 else 0.0
        rh_trend_per_hour = rh_trend * (60 / reading_interval_minutes)  # Convert to %/hour
    else:
        rh_trend_per_hour = 0.0
    
    # Variance score (0-100): measures outdoor instability
    # Higher score = more difficult to control indoor conditions
    temp_variance_component = min(50, temp_std * 10)  # Up to 50 points from temp variance
    temp_range_component = min(25, (temp_max - temp_min) * 2)  # Up to 25 points from temp range
    rh_variance_component = min(25, rh_std * 2)  # Up to 25 points from RH variance
    
    variance_score = temp_variance_component + temp_range_component + rh_variance_component
    
    return {
        'temp_mean': round(temp_mean, 2),
        'temp_std': round(temp_std, 2),
        'temp_min': round(temp_min, 2),
        'temp_max': round(temp_max, 2),
        'temp_trend_per_hour': round(temp_trend_per_hour, 3),
        'temp_range': round(temp_max - temp_min, 2),
        'rh_mean': round(rh_mean, 2),
        'rh_std': round(rh_std, 2),
        'rh_min': round(rh_min, 2),
        'rh_max': round(rh_max, 2),
        'rh_trend_per_hour': round(rh_trend_per_hour, 3),
        'rh_range': round(rh_max - rh_min, 2),
        'variance_score': round(variance_score, 1),
        'window_size': window_size,
        'window_hours': window_hours
    }


def calculate_solar_gain_factor(
    current_time: Optional[datetime] = None,
    latitude: float = 44.26,  # Kingston, ON default
    season: str = "spring"
) -> float:
    """
    Calculate solar gain factor based on time of day and season.
    
    Solar radiation affects indoor temperature, especially with windows.
    Peak solar gain typically occurs 12pm-3pm.
    
    Args:
        current_time: Time to calculate for (defaults to now)
        latitude: Facility latitude for solar angle calculation
        season: Current season affects sun angle
    
    Returns:
        Solar gain factor (0.0 to 1.0, where 1.0 is peak midday sun)
    """
    if current_time is None:
        current_time = datetime.now()
    
    hour = current_time.hour
    
    # Solar gain follows a sine curve, peaking at solar noon (~12-13h)
    # Adjusted for season: summer has higher peak and longer day
    season_factors = {
        "winter": {"peak": 0.6, "day_start": 8, "day_end": 16},
        "spring": {"peak": 0.8, "day_start": 6, "day_end": 19},
        "summer": {"peak": 1.0, "day_start": 5, "day_end": 21},
        "fall": {"peak": 0.7, "day_start": 7, "day_end": 18}
    }
    
    season_config = season_factors.get(season, season_factors["spring"])
    
    day_start = season_config["day_start"]
    day_end = season_config["day_end"]
    peak = season_config["peak"]
    
    if hour < day_start or hour > day_end:
        return 0.0  # Night time, no solar gain
    
    # Calculate position in day cycle (0 to π)
    day_length = day_end - day_start
    hour_in_cycle = hour - day_start
    angle = (hour_in_cycle / day_length) * 3.14159
    
    # Sine curve for solar intensity
    import math
    solar_factor = math.sin(angle) * peak
    
    return round(max(0.0, min(1.0, solar_factor)), 3)


def assess_outdoor_influence(
    indoor_temp: float,
    outdoor_temp: float,
    indoor_rh: float,
    outdoor_rh: float,
    outdoor_temp_lagged: Optional[float] = None,
    solar_gain: Optional[float] = None
) -> Dict[str, any]:
    """
    Comprehensive assessment of outdoor influence on indoor conditions.
    
    Combines multiple factors to determine if current indoor conditions
    are expected given outdoor environment, or indicate equipment issues.
    
    Args:
        indoor_temp: Current indoor temperature (°C)
        outdoor_temp: Current outdoor temperature (°C)
        indoor_rh: Current indoor relative humidity (%)
        outdoor_rh: Current outdoor relative humidity (%)
        outdoor_temp_lagged: Outdoor temp from 30-60 min ago (accounts for thermal lag)
        solar_gain: Solar gain factor (0-1) from calculate_solar_gain_factor()
    
    Returns:
        Dict with assessment results
    """
    result = {
        "temp_delta": None,
        "expected_range": (18.0, 26.0),
        "is_within_expected": True,
        "hvac_load": {},
        "outdoor_influence_level": "moderate",  # low, moderate, high
        "expected_indoor_from_outdoor": None,
        "anomaly_likelihood": 0.0  # 0-1, higher means more likely equipment issue
    }
    
    if None in [indoor_temp, outdoor_temp]:
        return result
    
    # Calculate temp delta
    result["temp_delta"] = calculate_temp_delta(indoor_temp, outdoor_temp)
    
    # Get expected range
    result["expected_range"] = calculate_expected_indoor_range(outdoor_temp, outdoor_rh or 50)
    
    # Check if within expected
    min_exp, max_exp = result["expected_range"]
    result["is_within_expected"] = min_exp <= indoor_temp <= max_exp
    
    # Calculate HVAC load
    if indoor_rh is not None and outdoor_rh is not None:
        result["hvac_load"] = calculate_hvac_load_prediction(
            indoor_temp, outdoor_temp, indoor_rh, outdoor_rh
        )
    
    # Determine outdoor influence level
    temp_diff = abs(outdoor_temp - 22.0)  # Distance from comfortable temp
    if temp_diff < 5:
        result["outdoor_influence_level"] = "low"
    elif temp_diff < 15:
        result["outdoor_influence_level"] = "moderate"
    else:
        result["outdoor_influence_level"] = "high"
    
    # Predict expected indoor temp from outdoor
    # Use lagged outdoor if available (better predictor)
    reference_outdoor = outdoor_temp_lagged if outdoor_temp_lagged is not None else outdoor_temp
    
    # Base expectation: indoor warmer than outdoor due to building heat + HVAC
    base_offset = 3.0
    if solar_gain and solar_gain > 0.5:
        base_offset += solar_gain * 2.0  # Solar gain adds heat
    
    result["expected_indoor_from_outdoor"] = round(reference_outdoor + base_offset, 1)
    
    # Anomaly likelihood calculation
    # High if: indoor far from expected AND outdoor influence is low (should be easy to control)
    expected_indoor = result["expected_indoor_from_outdoor"]
    indoor_deviation = abs(indoor_temp - expected_indoor)
    
    if result["outdoor_influence_level"] == "low" and indoor_deviation > 3.0:
        # Indoor should be easy to control, but it's off → equipment issue likely
        result["anomaly_likelihood"] = min(1.0, indoor_deviation / 10.0)
    elif result["outdoor_influence_level"] == "high" and indoor_deviation > 5.0:
        # Hard outdoor conditions, some deviation expected, but this is extreme
        result["anomaly_likelihood"] = min(1.0, (indoor_deviation - 5.0) / 10.0)
    else:
        # Within reasonable bounds
        result["anomaly_likelihood"] = 0.0
    
    result["anomaly_likelihood"] = round(result["anomaly_likelihood"], 3)
    
    return result


# Example usage and testing
if __name__ == "__main__":
    # Test scenario 1: Normal conditions
    print("=== Test 1: Normal Conditions ===")
    indoor = 22.0
    outdoor = 15.0
    assessment = assess_outdoor_influence(
        indoor_temp=indoor,
        outdoor_temp=outdoor,
        indoor_rh=60.0,
        outdoor_rh=70.0,
        solar_gain=0.7
    )
    print(f"Indoor: {indoor}°C, Outdoor: {outdoor}°C")
    print(f"Temp delta: {assessment['temp_delta']}°C")
    print(f"Expected range: {assessment['expected_range']}")
    print(f"Within expected: {assessment['is_within_expected']}")
    print(f"Anomaly likelihood: {assessment['anomaly_likelihood']}")
    print()
    
    # Test scenario 2: Equipment failure (high indoor despite cool outdoor)
    print("=== Test 2: Equipment Failure (Cooling Issue) ===")
    indoor = 28.0
    outdoor = 15.0
    assessment = assess_outdoor_influence(
        indoor_temp=indoor,
        outdoor_temp=outdoor,
        indoor_rh=65.0,
        outdoor_rh=70.0,
        solar_gain=0.3
    )
    print(f"Indoor: {indoor}°C, Outdoor: {outdoor}°C")
    print(f"Expected indoor from outdoor: {assessment['expected_indoor_from_outdoor']}°C")
    print(f"Within expected: {assessment['is_within_expected']}")
    print(f"Anomaly likelihood: {assessment['anomaly_likelihood']} (HIGH = equipment issue)")
    print()
    
    # Test scenario 3: Extreme heat (indoor high but expected given outdoor)
    print("=== Test 3: Extreme Outdoor Heat (Expected High Indoor) ===")
    indoor = 27.0
    outdoor = 35.0
    assessment = assess_outdoor_influence(
        indoor_temp=indoor,
        outdoor_temp=outdoor,
        indoor_rh=55.0,
        outdoor_rh=40.0,
        solar_gain=1.0
    )
    print(f"Indoor: {indoor}°C, Outdoor: {outdoor}°C")
    print(f"Expected indoor from outdoor: {assessment['expected_indoor_from_outdoor']}°C")
    print(f"Outdoor influence: {assessment['outdoor_influence_level']}")
    print(f"Anomaly likelihood: {assessment['anomaly_likelihood']} (LOW = normal for conditions)")
    print(f"HVAC load: {assessment['hvac_load']}")
