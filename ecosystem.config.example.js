// PM2 ecosystem config — copy to ecosystem.config.js and fill in secrets
// DO NOT commit the real ecosystem.config.js (it's in .gitignore)
module.exports = {
  apps: [
    {
      name: 'foxtrot-node',
      script: 'server-foxtrot.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: '8091',
        EDGE_MODE: 'true',
        DEMO_MODE: 'false',
        GREENREACH_CENTRAL_URL: 'https://greenreachgreens.com',
        GREENREACH_API_KEY: '<your-api-key-here>',
        FARM_ID: '<your-farm-id-here>'
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
