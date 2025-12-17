#!/usr/bin/env python3
"""
ML Anomaly Detection Cron Job Wrapper

Runs anomaly detector every 15 minutes via PM2 cron.
Logs results to file and sends alerts for critical anomalies.
"""

import json
import sys
import subprocess
from pathlib import Path
from datetime import datetime
import requests
import logging

# Setup logging
LOG_DIR = Path(__file__).parent.parent / 'logs'
LOG_DIR.mkdir(exist_ok=True)

ANOMALY_LOG_FILE = LOG_DIR / 'ml-anomalies.jsonl'  # JSON Lines format
ALERT_LOG_FILE = LOG_DIR / 'ml-alerts.log'

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(ALERT_LOG_FILE),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Alert configuration (from environment variables or defaults)
import os
WEBHOOK_URL = os.environ.get('ALERT_WEBHOOK_URL')  # Slack/Discord webhook
ALERT_ENDPOINT = os.environ.get('ALERT_API_ENDPOINT', 'http://localhost:8091/api/alerts')
ENABLE_WEBHOOKS = os.environ.get('ENABLE_WEBHOOKS', 'false').lower() == 'true'
CRITICAL_ONLY = os.environ.get('ALERT_CRITICAL_ONLY', 'true').lower() == 'true'


def run_anomaly_detector():
    """Execute the anomaly detector and return results"""
    try:
        detector_path = Path(__file__).parent / 'simple-anomaly-detector.py'
        result = subprocess.run(
            ['python3', str(detector_path), '--json'],
            capture_output=True,
            text=True,
            timeout=60  # 1 minute timeout
        )
        
        if result.returncode != 0:
            logger.error(f"Anomaly detector failed with exit code {result.returncode}")
            logger.error(f"stderr: {result.stderr}")
            return None
        
        # Parse JSON output
        try:
            data = json.loads(result.stdout)
            return data
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse anomaly detector JSON output: {e}")
            logger.error(f"stdout: {result.stdout[:500]}")
            return None
            
    except subprocess.TimeoutExpired:
        logger.error("Anomaly detector timed out after 60 seconds")
        return None
    except Exception as e:
        logger.error(f"Error running anomaly detector: {e}")
        return None


def log_anomalies_to_file(data):
    """Append anomalies to JSONL log file"""
    if not data or not data.get('success'):
        return
    
    try:
        with open(ANOMALY_LOG_FILE, 'a') as f:
            log_entry = {
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'count': data.get('count', 0),
                'critical_count': data.get('critical_count', 0),
                'warning_count': data.get('warning_count', 0),
                'info_count': data.get('info_count', 0),
                'anomalies': data.get('anomalies', [])
            }
            f.write(json.dumps(log_entry) + '\n')
        
        logger.info(f"Logged {data.get('count', 0)} anomalies to {ANOMALY_LOG_FILE}")
        
    except Exception as e:
        logger.error(f"Failed to write anomalies to log file: {e}")


def send_webhook_alert(anomaly):
    """Send alert to Slack/Discord webhook"""
    if not WEBHOOK_URL or not ENABLE_WEBHOOKS:
        return
    
    try:
        # Format message for Slack/Discord
        severity_emoji = {
            'critical': '🔴',
            'warning': '🟡',
            'info': '🔵'
        }.get(anomaly.get('severity', 'info'), '⚠️')
        
        outdoor_info = ""
        if anomaly.get('outdoor_temp') is not None:
            outdoor_info = f" (Outdoor: {anomaly['outdoor_temp']:.1f}°C, {anomaly.get('outdoor_rh', 0):.0f}%)"
        
        message = {
            "text": f"{severity_emoji} ML Anomaly Detected",
            "attachments": [{
                "color": {"critical": "danger", "warning": "warning", "info": "good"}.get(anomaly['severity'], "#808080"),
                "fields": [
                    {"title": "Zone", "value": anomaly.get('zone', 'Unknown'), "short": True},
                    {"title": "Severity", "value": anomaly.get('severity', 'unknown').upper(), "short": True},
                    {"title": "Indoor Conditions", "value": f"{anomaly.get('indoor_temp', 0):.1f}°C, {anomaly.get('indoor_rh', 0):.0f}% RH{outdoor_info}", "short": False},
                    {"title": "Reason", "value": anomaly.get('reason', 'Statistical anomaly'), "short": False}
                ],
                "footer": "Light Engine Charlie ML",
                "ts": int(datetime.utcnow().timestamp())
            }]
        }
        
        response = requests.post(WEBHOOK_URL, json=message, timeout=5)
        response.raise_for_status()
        logger.info(f"Sent webhook alert for {anomaly.get('zone')}")
        
    except Exception as e:
        logger.error(f"Failed to send webhook alert: {e}")


def send_api_alert(anomaly):
    """Send alert to internal API endpoint"""
    try:
        payload = {
            'type': 'ml_anomaly',
            'severity': anomaly.get('severity', 'info'),
            'zone': anomaly.get('zone', 'Unknown'),
            'data': anomaly,
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }
        
        response = requests.post(ALERT_ENDPOINT, json=payload, timeout=3)
        response.raise_for_status()
        logger.debug(f"Sent API alert for {anomaly.get('zone')}")
        
    except requests.exceptions.ConnectionError:
        logger.debug(f"Alert API not available at {ALERT_ENDPOINT}")
    except Exception as e:
        logger.error(f"Failed to send API alert: {e}")


def process_alerts(data):
    """Process anomalies and send alerts for critical/warning issues"""
    if not data or not data.get('success'):
        return
    
    anomalies = data.get('anomalies', [])
    
    if not anomalies:
        logger.info("No anomalies detected - all systems normal")
        return
    
    # Filter anomalies that need alerts
    alert_anomalies = []
    
    if CRITICAL_ONLY:
        alert_anomalies = [a for a in anomalies if a.get('severity') == 'critical']
    else:
        alert_anomalies = [a for a in anomalies if a.get('severity') in ['critical', 'warning']]
    
    if not alert_anomalies:
        logger.info(f"Found {len(anomalies)} anomalies but none require alerts (critical_only={CRITICAL_ONLY})")
        return
    
    logger.warning(f"Found {len(alert_anomalies)} anomalies requiring alerts:")
    
    for anomaly in alert_anomalies:
        severity = anomaly.get('severity', 'unknown')
        zone = anomaly.get('zone', 'Unknown')
        reason = anomaly.get('reason', 'No reason provided')
        
        # Log the alert
        logger.warning(f"  [{severity.upper()}] {zone}: {reason}")
        
        # Check if this is likely an equipment failure (not just outdoor influence)
        anomaly_likelihood = anomaly.get('anomaly_likelihood', 0)
        outdoor_influence = anomaly.get('outdoor_influence', 'unknown')
        
        if anomaly_likelihood > 0.5 or severity == 'critical':
            logger.critical(
                f"Likely equipment failure in {zone}: "
                f"Indoor {anomaly.get('indoor_temp', 0):.1f}°C "
                f"(Outdoor {anomaly.get('outdoor_temp', 0):.1f}°C, "
                f"influence: {outdoor_influence}, "
                f"anomaly likelihood: {anomaly_likelihood:.2f})"
            )
        
        # Send alerts
        send_webhook_alert(anomaly)
        send_api_alert(anomaly)


def main():
    """Main execution"""
    logger.info("=" * 60)
    logger.info("Starting ML anomaly detection cron job")
    
    # Run anomaly detector
    data = run_anomaly_detector()
    
    if data is None:
        logger.error("Anomaly detection failed - no data returned")
        sys.exit(1)
    
    if not data.get('success'):
        logger.error(f"Anomaly detection reported failure: {data.get('error', 'Unknown error')}")
        sys.exit(1)
    
    # Log results summary
    logger.info(f"Anomaly detection complete:")
    logger.info(f"  Total anomalies: {data.get('count', 0)}")
    logger.info(f"  Critical: {data.get('critical_count', 0)}")
    logger.info(f"  Warning: {data.get('warning_count', 0)}")
    logger.info(f"  Info: {data.get('info_count', 0)}")
    
    # Log to file
    log_anomalies_to_file(data)
    
    # Process and send alerts
    process_alerts(data)
    
    logger.info("ML anomaly detection cron job complete")
    logger.info("=" * 60)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.critical(f"Unexpected error in cron job: {e}", exc_info=True)
        sys.exit(1)
