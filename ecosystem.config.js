module.exports = {
  apps: [
    {
      name: 'node-server',
      script: 'server-charlie.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
        DEMO_FARM_ID: 'GR-00001',
        DEMO_REALTIME: 'true'
        DEMO_MODE: 'true',
        DEMO_FARM_ID: 'GR-00001',
        DEMO_REALTIME: 'true'
      },
      time: true,
      kill_timeout: 5000,
      max_memory_restart: '300M',
      out_file: 'logs/node-server.log',
      error_file: 'logs/node-server.log',
      merge_logs: true,
      autorestart: true
    },
    {
      name: 'python-backend',
      script: '-m',
      args: 'uvicorn backend.server:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-keep-alive 5 --lifespan on',
      interpreter: 'python3',
      exec_mode: 'fork',
      instances: 1,
      env: {
        ENVIRONMENT: 'production'
      },
      time: true,
      kill_timeout: 5000,
      out_file: 'logs/python-backend.log',
      error_file: 'logs/python-backend.log',
      merge_logs: true,
      autorestart: true
    }
  ]
};
