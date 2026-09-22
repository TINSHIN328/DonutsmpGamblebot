/**
 * DonutSMP Bot - Security Module
 * Rate limiting, anti-abuse, cooldowns, and permission checks.
 */
import config from './config.js';
import { createLogger, logSecurityEvent } from './logger.js';
import * as db from './database.js';

const log = createLogger('security');

// In-memory rate limit cache (backed by database)
const rateLimitCache = new Map();

/**
 * Check if a user is on cooldown for a specific action.
 * @throws {Error} if on cooldown
 */
export function checkCooldown(discordUserId, action, cooldownSeconds) {
  const key = `${discordUserId}:${action}`;
  const now = Date.now();
  const cached = rateLimitCache.get(key);

  if (cached && (now - cached) < cooldownSeconds * 1000) {
    const remaining = Math.ceil((cooldownSeconds * 1000 - (now - cached)) / 1000);
    throw new Error(`COOLDOWN: Please wait ${remaining} seconds before using ${action} again.`);
  }
}

/**
 * Update cooldown timestamp for an action.
 */
export function updateCooldown(discordUserId, action) {
  const key = `${discordUserId}:${action}`;
  rateLimitCache.set(key, Date.now());
}

/**
 * Check daily wager limit.
 * @throws {Error} if limit exceeded
 */
export function checkDailyWager(discordUserId, additionalAmount) {
  const rateLimit = db.getRateLimit(discordUserId, 'daily_wager');
  if (!rateLimit) return; // First time today

  const today = new Date().toISOString().slice(0, 10);
  if (rateLimit.reset_date !== today) return; // Reset day

  if (rateLimit.daily_amount + additionalAmount > config.MAX_DAILY_WAGER) {
    const remaining = config.MAX_DAILY_WAGER - rateLimit.daily_amount;
    throw new Error(`DAILY_LIMIT: You have reached your daily wager limit. Remaining: $${remaining.toLocaleString()}`);
  }
}

/**
 * Update daily wager tracking.
 */
export function updateDailyWager(discordUserId, amount) {
  db.updateRateLimit(discordUserId, 'daily_wager', amount);
}

/**
 * Check daily withdrawal limit.
 * @throws {Error} if limit exceeded
 */
export function checkDailyWithdrawal(discordUserId, amount) {
  const rateLimit = db.getRateLimit(discordUserId, 'daily_withdraw');
  if (!rateLimit) return;

  const today = new Date().toISOString().slice(0, 10);
  if (rateLimit.reset_date !== today) return;

  if (rateLimit.daily_amount + amount > config.MAX_WITHDRAW_PER_DAY) {
    const remaining = config.MAX_WITHDRAW_PER_DAY - rateLimit.daily_amount;
    throw new Error(`DAILY_LIMIT: You have reached your daily withdrawal limit. Remaining: $${remaining.toLocaleString()}`);
  }
}

/**
 * Check withdrawal cooldown.
 * @throws {Error} if on cooldown
 */
export function checkWithdrawCooldown(discordUserId) {
  checkCooldown(discordUserId, 'withdraw', config.WITHDRAW_COOLDOWN_SECONDS);
}

/**
 * Update withdrawal tracking.
 */
export function updateWithdrawTracking(discordUserId, amount) {
  updateCooldown(discordUserId, 'withdraw');
  db.updateRateLimit(discordUserId, 'daily_withdraw', amount);
}

/**
 * Check if a user has admin permissions.
 */
export function isAdmin(interaction) {
  if (!interaction.member) return false;

  // Check for configured admin role
  if (interaction.member.roles.cache.has(config.ADMIN_ROLE_ID)) {
    return true;
  }

  // Check for Administrator permission
  if (interaction.member.permissions.has('Administrator')) {
    return true;
  }

  return false;
}

/**
 * Validate that an amount is a safe positive integer.
 */
export function validateAmount(amount, fieldName = 'amount') {
  if (typeof amount !== 'number' || !Number.isInteger(amount)) {
    throw new Error(`INVALID_${fieldName.toUpperCase()}: ${fieldName} must be a whole number`);
  }
  if (amount <= 0) {
    throw new Error(`INVALID_${fieldName.toUpperCase()}: ${fieldName} must be greater than 0`);
  }
  if (amount > Number.MAX_SAFE_INTEGER) {
    throw new Error(`INVALID_${fieldName.toUpperCase()}: ${fieldName} exceeds maximum value`);
  }
  return amount;
}

/**
 * Sanitize a Minecraft username.
 */
export function sanitizeMinecraftUsername(username) {
  if (!username || typeof username !== 'string') {
    throw new Error('INVALID_USERNAME: Username is required');
  }
  const cleaned = username.trim().replace(/[^a-zA-Z0-9_]/g, '');
  if (cleaned.length < 3 || cleaned.length > 16) {
    throw new Error('INVALID_USERNAME: Username must be 3-16 characters (letters, numbers, underscores)');
  }
  return cleaned;
}

/**
 * Detect suspicious activity patterns.
 */
export function detectSuspiciousActivity(discordUserId, action, metadata = {}) {
  const patterns = [];

  // Rapid successive actions
  const key = `suspicious:${discordUserId}:${action}`;
  const recent = rateLimitCache.get(key) || [];
  const now = Date.now();
  const recentActions = recent.filter(t => now - t < 60000); // Last minute

  if (recentActions.length >= 5) {
    patterns.push('RAPID_ACTIONS');
    logSecurityEvent('Suspicious rapid activity detected', {
      discordUserId, action, count: recentActions.length,
    });
  }

  recentActions.push(now);
  rateLimitCache.set(key, recentActions);

  return patterns;
}

/**
 * Check for self-payment (preventing user from paying themselves).
 */
export function checkSelfPayment(senderUuid, targetUuid) {
  if (senderUuid === targetUuid) {
    throw new Error('SELF_PAYMENT: You cannot send money to yourself');
  }
}

/**
 * General command rate limiter (in-memory for fast checks).
 */
const commandTimestamps = new Map();

export function checkCommandRateLimit(discordUserId, commandName, maxPerSecond = 2) {
  const key = `${discordUserId}:${commandName}`;
  const now = Date.now();
  const timestamps = commandTimestamps.get(key) || [];

  // Remove timestamps older than 1 second
  const recent = timestamps.filter(t => now - t < 1000);

  if (recent.length >= maxPerSecond) {
    throw new Error('RATE_LIMIT: You are sending commands too fast. Please slow down.');
  }

  recent.push(now);
  commandTimestamps.set(key, recent);
}

/**
 * Clean up old rate limit cache entries periodically.
 */
export function cleanupRateLimitCache() {
  const now = Date.now();
  const maxAge = 300000; // 5 minutes

  for (const [key, value] of rateLimitCache.entries()) {
    if (typeof value === 'number' && now - value > maxAge) {
      rateLimitCache.delete(key);
    }
  }

  for (const [key, timestamps] of commandTimestamps.entries()) {
    const recent = timestamps.filter(t => now - t < 5000);
    if (recent.length === 0) {
      commandTimestamps.delete(key);
    } else {
      commandTimestamps.set(key, recent);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupRateLimitCache, 60000);
