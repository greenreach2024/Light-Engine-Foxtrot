module.exports = {
  apps: [
    {
      name: 'charlie-node',
      script: 'server-charlie.js',
      node_args: '',
      watch: false,
      env: {
        NODE_ENV: 'production',
        ENV_SOURCE: 'local',
        CLOUD_ENDPOINT_URL: '',
        AWS_ENDPOINT_URL: '',
        DEMO_MODE: 'true',
        DEMO_FARM_ID: 'GR-00001',
        DEMO_REALTIME: 'true'
      },
      env_production: {
        NODE_ENV: 'production',
        ENV_SOURCE: 'local',
        CLOUD_ENDPOINT_URL: '',
        AWS_ENDPOINT_URL: '',
        DEMO_MODE: 'true',
        DEMO_FARM_ID: 'GR-00001',
        DEMO_REALTIME: 'true'
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      kill_timeout: 5000,
      wait_ready: false,
      listen_timeout: 8000,
      out_file: 'logs/node-out.log',
      error_file: 'logs/node-error.log',
      merge_logs: true
    },
    {
      name: 'charlie-py',
      script: 'uvicorn',
      args: 'backend:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-keep-alive 30 --graceful-timeout 15',
      interpreter: 'none',
      exec_mode: 'fork',
      env: {
        PYTHONUNBUFFERED: '1'
      },
      out_file: 'logs/py-out.log',
      error_file: 'logs/py-error.log',
      merge_logs: true,
      kill_timeout: 5000
    },
    {
      name: 'ml-anomaly-detector',
      script: 'scripts/ml-anomaly-cron.py',
      interpreter: 'python3',
      cron_restart: '*/15 * * * *',  // Run every 15 minutes
      autorestart: false,  // Don't auto-restart, only run on cron schedule
      watch: false,
      env: {
        PYTHONUNBUFFERED: '1',
        ALERT_CRITICAL_ONLY: 'true',
        ENABLE_WEBHOOKS: 'false'  // Set to 'true' and add ALERT_WEBHOOK_URL to enable
      },
      out_file: 'logs/ml-anomaly-out.log',
      error_file: 'logs/ml-anomaly-error.log',
      merge_logs: true,
      kill_timeout: 30000,  // 30 seconds for ML processing
      max_memory_restart: '256M'
    }
  ]
};