/**
 * DonutSMP Discord Bot - Main Entry Point
 * 
 * Startup sequence:
 * 1. Load configuration
 * 2. Create required directories
 * 3. Connect database (auto-create schema)
 * 4. Run migrations
 * 5. Load settings
 * 6. Initialize Discord bot
 * 7. Register slash commands (if --register-commands flag)
 * 8. Start Discord bot
 * 9. Start Minecraft bot
 * 10. Start recovery worker
 * 11. Start backup scheduler
 * 12. Show health status
 */
import config from './config.js';
import { createLogger } from './logger.js';
import { initDatabase, closeDatabase, startBackupScheduler, getDatabaseStatus } from './database.js';
import { initDiscordClient, registerCommands } from './events.js';
import { createMinecraftBot, disconnectBot } from './minecraft.js';
import { runRecovery, startRecoveryWorker } from './recovery.js';
import fs from 'fs';
import path from 'path';

const log = createLogger('main');

let isShuttingDown = false;

/**
 * Main startup function.
 */
async function main() {
  console.log('');
  console.log('🍩 ═══════════════════════════════════════════');
  console.log('🍩   DonutSMP Discord Bot v1.0.0');
  console.log('🍩 ═══════════════════════════════════════════');
  console.log('');

  // Check for --register-commands flag
  const registerOnly = process.argv.includes('--register-commands');

  // Step 1: Ensure directories exist
  log.info('Step 1: Ensuring directories...');
  ensureDirectories();

  // Step 2: Initialize database
  log.info('Step 2: Initializing database...');
  initDatabase();

  const dbStatus = getDatabaseStatus();
  log.info({ size: dbStatus.sizeFormatted, lastMigration: dbStatus.lastMigration }, 'Database ready');

  // Step 3: Register commands if requested
  if (registerOnly) {
    log.info('Step 3: Registering Discord commands...');
    try {
      await registerCommands();
      console.log('✅ Commands registered successfully!');
      process.exit(0);
    } catch (error) {
      console.error('❌ Failed to register commands:', error.message);
      process.exit(1);
    }
    return;
  }

  // Step 4: Run recovery
  log.info('Step 4: Running transaction recovery...');
  runRecovery();

  // Step 5: Initialize Discord client
  log.info('Step 5: Initializing Discord client...');
  const client = initDiscordClient();

  // Step 6: Register commands
  log.info('Step 6: Registering slash commands...');
  try {
    await registerCommands();
  } catch (error) {
    log.error({ error: error.message }, 'Failed to register commands (will retry on next start)');
  }

  // Step 7: Login to Discord
  log.info('Step 7: Connecting to Discord...');
  await client.login(config.DISCORD_TOKEN);

  // Step 8: Start Minecraft bot
  log.info('Step 8: Starting Minecraft bot...');
  createMinecraftBot();

  // Step 9: Start recovery worker
  log.info('Step 9: Starting recovery worker...');
  startRecoveryWorker();

  // Step 10: Start backup scheduler
  log.info('Step 10: Starting backup scheduler...');
  startBackupScheduler();

  // Step 11: Show health status
  console.log('');
  console.log('🍩 ═══════════════════════════════════════════');
  console.log('✅ Bot is running!');
  console.log(`   Discord: 🟢 Connected as ${client.user.tag}`);
  console.log(`   Database: 🟢 ${dbStatus.sizeFormatted}`);
  console.log(`   Minecraft: 🟡 Connecting...`);
  console.log(`   Pending Transactions: ${dbStatus.pendingTransactions}`);
  console.log(`   Game Tax: ${config.GAME_TAX_PERCENT}%`);
  console.log(`   Min Bet: $${config.MIN_BET.toLocaleString()}`);
  console.log(`   Max Bet: $${config.MAX_BET.toLocaleString()}`);
  console.log('🍩 ═══════════════════════════════════════════');
  console.log('');

  // Setup graceful shutdown
  setupGracefulShutdown(client);
}

/**
 * Ensure required directories exist.
 */
function ensureDirectories() {
  const dirs = [
    './data',
    './data/backups',
    './logs',
  ];

  for (const dir of dirs) {
    const fullPath = path.resolve(dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      log.info({ dir: fullPath }, 'Created directory');
    }
  }
}

/**
 * Setup graceful shutdown handlers.
 */
function setupGracefulShutdown(client) {
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n${signal} received. Shutting down gracefully...`);
    log.info({ signal }, 'Graceful shutdown initiated');

    try {
      // Disconnect Minecraft bot
      log.info('Disconnecting Minecraft bot...');
      await disconnectBot();

      // Disconnect Discord
      log.info('Disconnecting Discord client...');
      client.destroy();

      // Close database
      log.info('Closing database...');
      closeDatabase();

      log.info('Shutdown complete');
      console.log('✅ Bot shut down successfully.');
      process.exit(0);
    } catch (error) {
      log.error({ error: error.message }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', (error) => {
    log.fatal({ error: error.message, stack: error.stack }, 'Uncaught exception');
    console.error('💥 Uncaught exception:', error.message);
    shutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason) => {
    log.error({ reason: String(reason) }, 'Unhandled rejection');
    console.error('⚠️ Unhandled rejection:', reason);
  });
}

// Run
main().catch(error => {
  console.error('💥 Fatal error during startup:', error);
  log.fatal({ error: error.message, stack: error.stack }, 'Fatal startup error');
  process.exit(1);
});
