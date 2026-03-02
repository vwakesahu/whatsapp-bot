module.exports = {
  apps: [
    {
      name: 'whatsapp-gatekeeper',
      script: 'src/index.ts',
      interpreter: 'bun',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
      error_file: './data/logs/error.log',
      out_file: './data/logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
