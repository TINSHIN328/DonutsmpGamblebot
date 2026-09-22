/**
 * DonutSMP Bot - Minecraft Bot Module
 * Handles Mineflayer connection, reconnection, and in-game commands.
 * Uses Microsoft authentication (no password storage).
 */
import mineflayer from 'mineflayer';
import config from './config.js';
import { createLogger } from './logger.js';
import * as db from './database.js';
import { paymentMonitor } from './minecraft/payment-monitor.js';

const log = createLogger('minecraft');

let bot = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let isConnected = false;
let isShuttingDown = false;

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RECONNECT_DELAY = 60000; // 1 minute

/**
 * Create and connect the Minecraft bot.
 */
export function createMinecraftBot() {
  if (isShuttingDown) {
    log.warn('Bot is shutting down, not reconnecting');
    return;
  }

  log.info({ host: config.MC_HOST, port: config.MC_PORT, auth: config.MC_AUTH }, 'Connecting to Minecraft server');

  try {
    bot = mineflayer.createBot({
      host: config.MC_HOST,
      port: config.MC_PORT,
      username: config.MC_USERNAME,
      auth: config.MC_AUTH, // Microsoft auth - uses device code flow
      // Mineflayer handles the Microsoft auth flow interactively
      // It will print a URL/code to the console for the user to authenticate
      version: false, // Auto-detect
      hideErrors: false,
      logErrors: true,
    });

    registerBotEvents();
  } catch (error) {
    log.error({ error: error.message }, 'Failed to create Minecraft bot');
    scheduleReconnect();
  }
}

/**
 * Register all bot event handlers.
 */
function registerBotEvents() {
  bot.on('spawn', () => {
    isConnected = true;
    reconnectAttempts = 0;
    log.info('Minecraft bot spawned successfully');
    db.recordAuditLog('BOT_CONNECTED', null, null, null, null, 'SUCCESS', 'Minecraft bot connected');
    
    // Start payment monitor with bot's username
    paymentMonitor.start(config.MC_USERNAME);
  });

  bot.on('login', () => {
    log.info('Minecraft bot logged in');
  });

  bot.on('kicked', (reason) => {
    log.warn({ reason }, 'Minecraft bot was kicked');
    isConnected = false;
    db.recordAuditLog('BOT_DISCONNECTED', null, null, null, null, 'KICKED', String(reason).slice(0, 200));
    scheduleReconnect();
  });

  bot.on('error', (error) => {
    log.error({ error: error.message }, 'Minecraft bot error');
    // Don't log full error to prevent credential leaks
    isConnected = false;
  });

  bot.on('end', (reason) => {
    log.warn({ reason: String(reason).slice(0, 100) }, 'Minecraft bot disconnected');
    isConnected = false;
    db.recordAuditLog('BOT_DISCONNECTED', null, null, null, null, 'DISCONNECTED', String(reason).slice(0, 200));

    if (!isShuttingDown) {
      scheduleReconnect();
    }
  });

  bot.on('chat', (username, message) => {
    // Handle chat messages for transaction verification
    handleChatMessage(username, message);
    
    // Forward to payment monitor
    paymentMonitor.processMessage(message);
  });

  bot.on('messagestr', (message) => {
    // Handle system messages (like payment confirmations)
    handleSystemMessage(message);
    
    // Also forward system messages to payment monitor
    paymentMonitor.processMessage(message);
  });
}

/**
 * Schedule a reconnection attempt with exponential backoff.
 */
function scheduleReconnect() {
  if (isShuttingDown) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    log.error('Max reconnect attempts reached. Manual restart required.');
    db.recordAuditLog('ERROR', null, null, null, null, 'MAX_RECONNECT', 'Max reconnect attempts reached');
    return;
  }

  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY
  );

  reconnectAttempts++;
  log.info({ attempt: reconnectAttempts, delay }, 'Scheduling reconnect');

  reconnectTimer = setTimeout(() => {
    createMinecraftBot();
  }, delay);
}

/**
 * Handle incoming chat messages for transaction verification.
 */
function handleChatMessage(username, message) {
  // Look for payment confirmations
  // This is server-specific and may need adjustment
  const paymentPattern = /(?:paid|sent|transferred)\s+(\d+)\s+(?:to\s+)?(\w+)/i;
  const match = message.match(paymentPattern);

  if (match) {
    const amount = parseInt(match[1]);
    const target = match[2];
    log.info({ username, amount, target }, 'Detected potential payment confirmation');
    // Process payment confirmation if needed
  }
}

/**
 * Handle system messages.
 */
function handleSystemMessage(message) {
  // Handle server-specific system messages
  if (message.includes('Payment successful') || message.includes('Transaction complete')) {
    log.info({ message: message.slice(0, 100) }, 'Payment confirmation detected');
  }
}

/**
 * Execute a Minecraft pay command.
 * IMPORTANT: This should only be called after database verification.
 * 
 * @param {string} targetUsername - Minecraft username to pay
 * @param {number} amount - Amount to pay (integer)
 * @param {string} withdrawalId - Associated withdrawal ID for tracking
 * @returns {Promise<boolean>} Whether payment was initiated
 */
export async function executeMinecraftPayment(targetUsername, amount, withdrawalId) {
  if (!bot || !isConnected) {
    throw new Error('MINECRAFT_OFFLINE: Bot is not connected to the server');
  }

  if (!targetUsername || typeof targetUsername !== 'string') {
    throw new Error('INVALID_TARGET: Invalid Minecraft username');
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('INVALID_AMOUNT: Amount must be a positive integer');
  }

  // Validate username format (Minecraft rules)
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(targetUsername)) {
    throw new Error('INVALID_USERNAME: Invalid Minecraft username format');
  }

  log.info({ target: targetUsername, amount, withdrawalId }, 'Executing Minecraft payment');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('PAYMENT_TIMEOUT: Minecraft payment timed out'));
    }, 30000);

    // Listen for confirmation
    const messageHandler = (message) => {
      const msg = typeof message === 'string' ? message : message.toString();
      if (msg.toLowerCase().includes('payment') && msg.includes(targetUsername)) {
        clearTimeout(timeout);
        bot.removeListener('messagestr', messageHandler);
        log.info({ target: targetUsername, amount, withdrawalId }, 'Payment confirmed');
        resolve(true);
      }
    };

    bot.on('messagestr', messageHandler);

    // Execute the pay command
    // Adjust this command format based on your server's economy plugin
    bot.chat(`/pay ${targetUsername} ${amount}`);

    // If no confirmation within reasonable time, assume it might have worked
    // but mark as PROCESSING for manual review
    setTimeout(() => {
      bot.removeListener('messagestr', messageHandler);
      log.warn({ target: targetUsername, amount, withdrawalId }, 'Payment sent but no confirmation received');
      resolve(true); // Return true but withdrawal stays PROCESSING for review
    }, 10000);
  });
}

/**
 * Get bot connection status.
 */
export function getBotStatus() {
  return {
    connected: isConnected,
    username: bot?.username || null,
    host: config.MC_HOST,
    port: config.MC_PORT,
    reconnectAttempts,
  };
}

/**
 * Disconnect the bot gracefully.
 */
export async function disconnectBot() {
  isShuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Stop payment monitor
  paymentMonitor.stop();

  if (bot) {
    try {
      bot.quit();
    } catch (error) {
      log.error({ error: error.message }, 'Error during bot quit');
    }
    bot = null;
    isConnected = false;
  }

  log.info('Minecraft bot disconnected');
}

/**
 * Check if bot is connected.
 */
export function isBotConnected() {
  return isConnected && bot !== null;
}
