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
        // Cloud sync configuration
        GREENREACH_CENTRAL_URL: 'https://greenreachgreens.com',
        GREENREACH_API_KEY: 'b0bc5dbb5cc038533141651efc52df3f5de5c4570b14c7e13abf124f17b38f15',
        FARM_ID: 'FARM-MKLOMAT3-A9D8'
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
