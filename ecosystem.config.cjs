module.exports = {
  apps: [
    {
      name: 'donutsmp-bot',
      script: 'src/index.js',
      node_args: '--max-old-space-size=512',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      // Restart on crash
      autorestart: true,
      // Max memory before restart
      max_memory_restart: '512M',
      // Watch for file changes (disable in production)
      watch: false,
      // Log files
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      // Merge logs from cluster instances
      merge_logs: true,
      // Kill timeout for graceful shutdown
      kill_timeout: 10000,
      // Listen for SIGINT
      listen_timeout: 5000,
    },
  ],
};
