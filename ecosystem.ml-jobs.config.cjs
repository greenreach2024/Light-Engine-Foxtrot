/**
 * PM2 Ecosystem Configuration for ML Jobs
 * 
 * Schedules anomaly detection and predictive forecasting jobs.
 * 
 * Usage:
 *   pm2 start ecosystem.ml-jobs.config.cjs
 *   pm2 logs ml-anomalies
 *   pm2 stop all
 *   pm2 delete all
 */

module.exports = {
  apps: [
    {
      name: 'ml-anomalies',
      script: './scripts/ml-job-runner.js',
      args: '--job anomalies',
      cron_restart: '*/15 * * * *', // Every 15 minutes
      autorestart: false, // Don't restart on exit (cron will handle)
      max_memory_restart: '200M',
      env: {
        NODE_ENV: 'production',
        PYTHON_BIN: './venv/bin/python',
      },
      error_file: './logs/ml-anomalies-error.log',
      out_file: './logs/ml-anomalies-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 3,
    },
    {
      name: 'ml-forecast-main',
      script: './scripts/ml-job-runner.js',
      args: '--job forecast --zone main',
      cron_restart: '0 * * * *', // Every hour at :00
      autorestart: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PYTHON_BIN: './venv/bin/python',
      },
      error_file: './logs/ml-forecast-main-error.log',
      out_file: './logs/ml-forecast-main-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 3,
    },
    {
      name: 'ml-forecast-veg',
      script: './scripts/ml-job-runner.js',
      args: '--job forecast --zone veg',
      cron_restart: '0 * * * *', // Every hour at :00
      autorestart: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PYTHON_BIN: './venv/bin/python',
      },
      error_file: './logs/ml-forecast-veg-error.log',
      out_file: './logs/ml-forecast-veg-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 3,
    },
    {
      name: 'ml-forecast-flower',
      script: './scripts/ml-job-runner.js',
      args: '--job forecast --zone flower',
      cron_restart: '0 * * * *', // Every hour at :00
      autorestart: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PYTHON_BIN: './venv/bin/python',
      },
      error_file: './logs/ml-forecast-flower-error.log',
      out_file: './logs/ml-forecast-flower-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '10s',
      max_restarts: 3,
    },
    {
      name: 'ml-health-check',
      script: './scripts/ml-job-runner.js',
      args: '--health-check',
      cron_restart: '*/5 * * * *', // Every 5 minutes
      autorestart: false,
      max_memory_restart: '100M',
      env: {
        NODE_ENV: 'production',
        PYTHON_BIN: './venv/bin/python',
      },
      error_file: './logs/ml-health-error.log',
      out_file: './logs/ml-health-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      min_uptime: '5s',
      max_restarts: 3,
    },
  ],
};
