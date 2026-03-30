"""
Broad Health Monitor - AI Health Scanning System (Python Implementation)

Continuously monitors all zones for out-of-target environmental conditions.
Provides quick overview of farm health status.
"""

import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Any

# Path to configuration and data files
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
TARGET_RANGES_PATH = os.path.join(PROJECT_ROOT, 'public', 'data', 'target-ranges.json')
ENV_DATA_PATH = os.path.join(PROJECT_ROOT, 'public', 'data', 'env.json')


def load_target_ranges() -> Optional[Dict]:
    """Load target ranges configuration"""
    try:
        with open(TARGET_RANGES_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[Health Monitor] Failed to load target ranges: {e}")
        return None


def load_env_data() -> Optional[Dict]:
    """Load current environmental data"""
    try:
        with open(ENV_DATA_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"[Health Monitor] Failed to load env data: {e}")
        return None


def is_in_range(value: float, min_val: float, max_val: float) -> bool:
    """Check if a value is within range"""
    return value is not None and min_val <= value <= max_val


def calculate_severity(
    metric: str,
    current: float,
    min_val: float,
    max_val: float,
    thresholds: Dict
) -> str:
    """Calculate severity based on deviation from target range"""
    if is_in_range(current, min_val, max_val):
        return 'healthy'

    deviation = abs(min_val - current) if current < min_val else abs(current - max_val)
    threshold = thresholds.get(metric, {})

    critical_dev = threshold.get('critical_deviation', float('inf'))
    warning_dev = threshold.get('warning_deviation', 0)

    if deviation >= critical_dev:
        return 'critical'
    elif deviation >= warning_dev:
        return 'warning'

    return 'info'


def check_zone_health(
    zone: Dict,
    targets: Dict,
    severity_thresholds: Dict
) -> Dict:
    """Check zone health against target ranges"""
    zone_id = zone.get('id', 'unknown')
    zone_targets = targets['zones'].get(zone_id, targets['defaults'])
    sensors = zone.get('sensors', {})
    issues = []

    # Temperature check
    temp_sensor = sensors.get('tempC', {})
    if 'current' in temp_sensor:
        temp = temp_sensor['current']
        severity = calculate_severity(
            'temperature',
            temp,
            zone_targets['temp_min'],
            zone_targets['temp_max'],
            severity_thresholds
        )

        if severity != 'healthy':
            deviation = abs(zone_targets['temp_min'] - temp) if temp < zone_targets['temp_min'] \
                else abs(temp - zone_targets['temp_max'])
            issues.append({
                'metric': 'temperature',
                'current': temp,
                'unit': '°C',
                'target': f"{zone_targets['temp_min']}-{zone_targets['temp_max']}°C",
                'severity': severity,
                'deviation': round(deviation, 2)
            })

    # Humidity check
    rh_sensor = sensors.get('rh', {})
    if 'current' in rh_sensor:
        rh = rh_sensor['current']
        severity = calculate_severity(
            'humidity',
            rh,
            zone_targets['rh_min'],
            zone_targets['rh_max'],
            severity_thresholds
        )

        if severity != 'healthy':
            deviation = abs(zone_targets['rh_min'] - rh) if rh < zone_targets['rh_min'] \
                else abs(rh - zone_targets['rh_max'])
            issues.append({
                'metric': 'humidity',
                'current': rh,
                'unit': '%',
                'target': f"{zone_targets['rh_min']}-{zone_targets['rh_max']}%",
                'severity': severity,
                'deviation': round(deviation, 2)
            })

    # VPD check
    vpd_sensor = sensors.get('vpd', {})
    if 'current' in vpd_sensor:
        vpd = vpd_sensor['current']
        severity = calculate_severity(
            'vpd',
            vpd,
            zone_targets['vpd_min'],
            zone_targets['vpd_max'],
            severity_thresholds
        )

        if severity != 'healthy':
            deviation = abs(zone_targets['vpd_min'] - vpd) if vpd < zone_targets['vpd_min'] \
                else abs(vpd - zone_targets['vpd_max'])
            issues.append({
                'metric': 'vpd',
                'current': vpd,
                'unit': 'kPa',
                'target': f"{zone_targets['vpd_min']}-{zone_targets['vpd_max']} kPa",
                'severity': severity,
                'deviation': round(deviation, 2)
            })

    # CO2 check
    co2_sensor = sensors.get('co2', {})
    if 'current' in co2_sensor:
        co2 = co2_sensor['current']
        severity = calculate_severity(
            'co2',
            co2,
            zone_targets['co2_min'],
            zone_targets['co2_max'],
            severity_thresholds
        )

        if severity != 'healthy':
            deviation = abs(zone_targets['co2_min'] - co2) if co2 < zone_targets['co2_min'] \
                else abs(co2 - zone_targets['co2_max'])
            issues.append({
                'metric': 'co2',
                'current': co2,
                'unit': 'ppm',
                'target': f"{zone_targets['co2_min']}-{zone_targets['co2_max']} ppm",
                'severity': severity,
                'deviation': round(deviation, 2)
            })

    # Determine overall zone status
    has_critical = any(i['severity'] == 'critical' for i in issues)
    has_warning = any(i['severity'] == 'warning' for i in issues)

    status = 'healthy'
    if has_critical:
        status = 'critical'
    elif has_warning:
        status = 'warning'
    elif issues:
        status = 'info'

    return {
        'zone_id': zone_id,
        'zone_name': zone.get('name', zone_id),
        'room': zone.get('room'),
        'status': status,
        'issues': issues,
        'severity': status if status != 'healthy' else None,
        'last_reading': temp_sensor.get('updatedAt') or zone.get('updatedAt')
    }


def generate_recommendations(issues: List[Dict]) -> List[Dict]:
    """Generate health recommendations based on issues"""
    recommendations = []

    for issue in issues:
        recommendation = ''

        if issue['metric'] == 'temperature':
            target_min = float(issue['target'].split('-')[0].replace('°C', ''))
            if issue['current'] < target_min:
                recommendation = 'Check heating system. Verify thermostat settings and ensure no cold air leaks.'
            else:
                recommendation = 'Check cooling system. Verify HVAC operation and airflow. Consider increasing ventilation.'
        
        elif issue['metric'] == 'humidity':
            target_min = float(issue['target'].split('-')[0].replace('%', ''))
            if issue['current'] < target_min:
                recommendation = 'Increase humidification. Check humidifier operation and water supply.'
            else:
                recommendation = 'Increase dehumidification. Check dehumidifier settings and ensure adequate ventilation.'
        
        elif issue['metric'] == 'vpd':
            target_min = float(issue['target'].split('-')[0])
            if issue['current'] < target_min:
                recommendation = 'VPD too low. Increase temperature or decrease humidity to improve plant transpiration.'
            else:
                recommendation = 'VPD too high. Decrease temperature or increase humidity to prevent plant stress.'
        
        elif issue['metric'] == 'co2':
            target_min = float(issue['target'].split('-')[0].replace(' ppm', ''))
            if issue['current'] < target_min:
                recommendation = 'CO2 levels low. Check CO2 supplementation system and ensure proper distribution.'
            else:
                recommendation = 'CO2 levels high. Increase ventilation and check CO2 injection timing.'

        if recommendation:
            recommendations.append({
                'zone_id': issue.get('zone_id'),
                'metric': issue['metric'],
                'recommendation': recommendation
            })

    return recommendations


def scan_all_zones(env_data: Optional[Dict] = None) -> Dict:
    """Scan all zones and generate health report"""
    target_ranges = load_target_ranges()
    
    if not target_ranges:
        return {
            'ok': False,
            'error': 'Failed to load target ranges configuration',
            'overall_status': 'unknown'
        }

    # Load env data if not provided
    if env_data is None:
        env_data = load_env_data()

    if not env_data or not env_data.get('zones'):
        return {
            'ok': True,
            'overall_status': 'no-data',
            'message': 'No zone data available',
            'out_of_target': [],
            'warnings': [],
            'recommendations': [],
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }

    health_report = {
        'ok': True,
        'overall_status': 'healthy',
        'out_of_target': [],
        'warnings': [],
        'recommendations': [],
        'summary': {
            'total_zones': len(env_data['zones']),
            'healthy': 0,
            'warning': 0,
            'critical': 0
        },
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    }

    # Check each zone
    for zone in env_data['zones']:
        zone_health = check_zone_health(
            zone,
            target_ranges,
            target_ranges['severity_thresholds']
        )

        # Update summary counts
        if zone_health['status'] == 'healthy':
            health_report['summary']['healthy'] += 1
        elif zone_health['status'] == 'warning':
            health_report['summary']['warning'] += 1
            health_report['out_of_target'].append(zone_health)
        elif zone_health['status'] == 'critical':
            health_report['summary']['critical'] += 1
            health_report['out_of_target'].append(zone_health)

        # Update overall status
        if zone_health['status'] == 'critical' and health_report['overall_status'] != 'critical':
            health_report['overall_status'] = 'critical'
        elif zone_health['status'] == 'warning' and health_report['overall_status'] == 'healthy':
            health_report['overall_status'] = 'warning'

    # Generate recommendations for out-of-target zones
    for zone_issue in health_report['out_of_target']:
        issues_with_zone = [
            {**issue, 'zone_id': zone_issue['zone_id']}
            for issue in zone_issue['issues']
        ]
        recs = generate_recommendations(issues_with_zone)
        health_report['recommendations'].extend(recs)

    return health_report


def get_zone_status(zone_id: str, env_data: Optional[Dict] = None) -> Dict:
    """Get detailed status for a specific zone"""
    target_ranges = load_target_ranges()
    
    if not target_ranges:
        return {
            'ok': False,
            'error': 'Failed to load target ranges configuration'
        }

    # Load env data if not provided
    if env_data is None:
        env_data = load_env_data()

    if not env_data:
        return {
            'ok': False,
            'error': 'Failed to load environmental data'
        }

    zones = env_data.get('zones', [])
    zone = next((z for z in zones if z.get('id') == zone_id), None)
    
    if not zone:
        return {
            'ok': False,
            'error': f'Zone {zone_id} not found'
        }

    zone_health = check_zone_health(
        zone,
        target_ranges,
        target_ranges['severity_thresholds']
    )

    return {
        'ok': True,
        **zone_health,
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    }


def get_out_of_target_conditions(env_data: Optional[Dict] = None) -> Dict:
    """Get only out-of-target conditions"""
    scan_result = scan_all_zones(env_data)
    
    return {
        'ok': scan_result['ok'],
        'overall_status': scan_result['overall_status'],
        'out_of_target': scan_result['out_of_target'],
        'count': len(scan_result['out_of_target']),
        'timestamp': scan_result['timestamp']
    }


# CLI interface for testing
if __name__ == '__main__':
    import sys
    
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == 'scan':
            result = scan_all_zones()
            print(json.dumps(result, indent=2))
        
        elif command == 'zone' and len(sys.argv) > 2:
            zone_id = sys.argv[2]
            result = get_zone_status(zone_id)
            print(json.dumps(result, indent=2))
        
        elif command == 'out-of-target':
            result = get_out_of_target_conditions()
            print(json.dumps(result, indent=2))
        
        else:
            print("Usage:")
            print("  python broad_health_monitor.py scan")
            print("  python broad_health_monitor.py zone <zone-id>")
            print("  python broad_health_monitor.py out-of-target")
    else:
        # Default: run full scan
        result = scan_all_zones()
        print(json.dumps(result, indent=2))
