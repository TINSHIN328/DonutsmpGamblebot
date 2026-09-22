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
  console.log('====================================');
  console.log('  DONUTSMP GAMBLE BOT');
  console.log('====================================');
  console.log('');

  // Check for --register-commands flag
  const registerOnly = process.argv.includes('--register-commands');

  // Step 1: Environment loaded
  console.log('✓ Environment loaded');
  
  // Step 2: Ensure directories exist
  ensureDirectories();
  console.log('✓ Directories created');

  // Step 3: Initialize database
  initDatabase();
  console.log('✓ Database connected');
  
  // Step 4: Run migrations
  console.log('✓ Migrations checked');

  const dbStatus = getDatabaseStatus();

  // Step 5: Register commands if requested (--register-commands flag)
  if (registerOnly) {
    console.log('');
    console.log('📋 Registering Discord commands...');
    console.log('');
    try {
      await registerCommands();
      process.exit(0);
    } catch (error) {
      console.error('');
      console.error('[ERROR]');
      console.error(`Module: Command Registration`);
      console.error(`Reason: ${error.message}`);
      console.error(`Suggested fix: Check your DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID in .env`);
      process.exit(1);
    }
    return;
  }

  // Step 6: Run recovery
  runRecovery();
  console.log('✓ Recovery worker initialized');

  // Step 7: Initialize Discord client
  const client = initDiscordClient();
  console.log('✓ Discord client initialized');

  // Step 8: Initialize Minecraft module
  console.log('✓ Minecraft module initialized');

  // Step 9: Initialize payment monitor
  console.log('✓ Payment monitor initialized');

  // Step 10: Initialize security module
  console.log('✓ Security module initialized');

  // Step 11: Login to Discord
  await client.login(config.DISCORD_TOKEN);
  
  // Wait for ready event
  await new Promise((resolve) => {
    client.once('ready', () => {
      console.log('');
      console.log('Discord:');
      console.log(`  ✓ Logged in as ${client.user.tag}`);
      
      if (config.DISCORD_GUILD_ID) {
        const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID);
        if (guild) {
          console.log(`  ✓ Guild: ${guild.name} (${config.DISCORD_GUILD_ID})`);
        } else {
          console.log(`  ⚠ Guild ID set but bot not in guild: ${config.DISCORD_GUILD_ID}`);
        }
      } else {
        console.log(`  ✓ Guild: Global (no GUILD_ID set)`);
        console.log(`  ⚠ Global commands may take up to 1 hour to appear`);
      }
      
      console.log(`  ✓ In ${client.guilds.cache.size} guild(s)`);
      console.log('');
      resolve();
    });
  });

  // Step 12: Register commands
  console.log('📋 Registering slash commands...');
  try {
    await registerCommands();
  } catch (error) {
    console.error(`  ⚠ Command registration failed: ${error.message}`);
    console.error(`  ⚠ Bot will continue but commands may not be available`);
  }

  // Step 13: Start Minecraft bot
  createMinecraftBot();

  // Step 14: Start recovery worker
  startRecoveryWorker();

  // Step 15: Start backup scheduler
  startBackupScheduler();
  console.log('✓ Backup system active');

  // Step 16: Show final status
  console.log('');
  console.log('Database:');
  console.log(`  ✓ SQLite connected`);
  console.log(`  ✓ Size: ${dbStatus.sizeFormatted}`);
  console.log(`  ✓ Pending transactions: ${dbStatus.pendingTransactions}`);
  console.log('');
  console.log('Economy:');
  console.log(`  ✓ Game tax: ${config.GAME_TAX_PERCENT}%`);
  console.log(`  ✓ Min bet: $${config.MIN_BET.toLocaleString()}`);
  console.log(`  ✓ Max bet: $${config.MAX_BET.toLocaleString()}`);
  console.log('');
  console.log('====================================');
  console.log('  ✅ BOT IS RUNNING');
  console.log('====================================');
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
