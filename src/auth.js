/**
 * Account Linking System
 * Handles Minecraft account linking via payment verification.
 * 
 * Flow:
 * 1. User runs /link
 * 2. Bot generates a random challenge amount (1-100)
 * 3. User sends payment to bot's MC account with that exact amount
 * 4. Payment monitor detects the payment
 * 5. Bot verifies the payment matches the challenge
 * 6. Account is linked
 */

import crypto from 'crypto';
import { createLogger } from '../logger.js';
import * as db from '../database.js';
import { paymentMonitor } from '../minecraft/payment-monitor.js';

const log = createLogger('auth');

/**
 * Generate a cryptographically secure random challenge amount (1-100)
 * @returns {number} - Random integer between 1 and 100
 */
export function generateChallengeAmount() {
  return crypto.randomInt(1, 101); // randomInt is exclusive of upper bound
}

/**
 * Create a new link session for a Discord user
 * @param {string} discordUserId - Discord user ID
 * @returns {Object} - Link session details
 */
export function createLinkSession(discordUserId) {
  // Check if user already has a linked account
  const user = db.getUserByDiscordId(discordUserId);
  if (user) {
    const existingAccount = db.getMinecraftAccount(user.id);
    if (existingAccount) {
      throw new Error(`You already have a linked Minecraft account: ${existingAccount.minecraft_username}`);
    }
  }

  // Check for existing pending session
  const existingSession = db.getActiveLinkSession(discordUserId);
  if (existingSession) {
    // Cancel the old session
    db.cancelLinkSession(existingSession.session_id);
    log.info({ discordUserId, oldSessionId: existingSession.session_id }, 'Cancelled existing link session');
  }

  // Generate challenge amount
  const challengeAmount = generateChallengeAmount();

  // Check for collisions with other active sessions
  const collidingSessions = db.findLinkSessionsByAmount(challengeAmount);
  if (collidingSessions.length > 0) {
    // Try to find a unique amount (up to 10 attempts)
    let attempts = 0;
    let uniqueAmount = challengeAmount;
    
    while (attempts < 10) {
      uniqueAmount = generateChallengeAmount();
      const collisions = db.findLinkSessionsByAmount(uniqueAmount);
      if (collisions.length === 0) {
        break;
      }
      attempts++;
    }

    if (attempts >= 10) {
      throw new Error('Unable to generate unique challenge amount. Please try again in a few seconds.');
    }

    challengeAmount = uniqueAmount;
  }

  // Create the session
  const session = db.createLinkSession(discordUserId, challengeAmount);

  log.info({
    discordUserId,
    sessionId: session.sessionId,
    challengeAmount,
    expiresAt: session.expiresAt
  }, 'Created link session');

  return {
    sessionId: session.sessionId,
    challengeAmount: session.challengeAmount,
    expiresAt: session.expiresAt,
    botUsername: paymentMonitor.botUsername || config.MC_USERNAME
  };
}

/**
 * Cancel a link session
 * @param {string} discordUserId - Discord user ID
 */
export function cancelLinkSession(discordUserId) {
  const session = db.getActiveLinkSession(discordUserId);
  if (session) {
    db.cancelLinkSession(session.session_id);
    log.info({ discordUserId, sessionId: session.session_id }, 'Cancelled link session');
  }
}

/**
 * Get active link session for a Discord user
 * @param {string} discordUserId - Discord user ID
 * @returns {Object|null} - Active session or null
 */
export function getActiveLinkSession(discordUserId) {
  return db.getActiveLinkSession(discordUserId);
}

/**
 * Complete the linking process after payment verification
 * Called by payment monitor when a matching payment is detected
 * 
 * @param {string} discordUserId - Discord user ID
 * @param {string} minecraftUsername - Minecraft username from payment
 * @param {string} sessionId - Link session ID
 */
export function completeLinking(discordUserId, minecraftUsername, sessionId) {
  const session = db.getLinkSession(sessionId);
  
  if (!session) {
    throw new Error('Link session not found');
  }

  if (session.status !== 'PENDING') {
    throw new Error('Link session is not pending');
  }

  if (session.discord_user_id !== discordUserId) {
    throw new Error('Session does not belong to this user');
  }

  // Get or create user record
  let user = db.getUserByDiscordId(discordUserId);
  let userId;

  if (!user) {
    userId = db.createUser(discordUserId, null);
    log.info({ discordUserId, userId }, 'Created new user record');
  } else {
    userId = user.id;
  }

  // Get Minecraft UUID (we'll use the username as a placeholder since we can't query Mojang API here)
  // In production, you'd want to fetch the actual UUID from Mojang API
  const minecraftUuid = generateMinecraftUuid(minecraftUsername);

  // Link the account
  db.linkMinecraftAccount(userId, minecraftUuid, minecraftUsername);

  // Create wallet with starting balance
  db.getOrCreateWallet(userId);

  // Mark session as completed
  db.completeLinkSession(sessionId, minecraftUsername, minecraftUuid);

  // Record audit log
  db.recordAuditLog('ACCOUNT_LINKED', discordUserId, minecraftUuid, null, null, 'SUCCESS',
    JSON.stringify({ minecraftUsername, verification: 'MINECRAFT_PAYMENT' }));

  log.info({
    discordUserId,
    minecraftUsername,
    minecraftUuid,
    sessionId
  }, 'Account linked successfully');

  return {
    discordUserId,
    minecraftUsername,
    minecraftUuid
  };
}

/**
 * Generate a deterministic UUID for a Minecraft username
 * This is a placeholder - in production you'd fetch the real UUID from Mojang API
 * @param {string} username - Minecraft username
 * @returns {string} - UUID string
 */
function generateMinecraftUuid(username) {
  // Generate a deterministic UUID based on username
  // This ensures the same username always gets the same UUID
  const hash = crypto.createHash('sha256').update(username.toLowerCase()).digest('hex');
  const uuid = [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16), // Version 4
    ((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32)
  ].join('-');
  
  return uuid;
}

/**
 * Get link status for a Discord user
 * @param {string} discordUserId - Discord user ID
 * @returns {Object} - Link status
 */
export function getLinkStatus(discordUserId) {
  const user = db.getUserByDiscordId(discordUserId);
  
  if (!user) {
    return {
      linked: false,
      hasActiveSession: false
    };
  }

  const mcAccount = db.getMinecraftAccount(user.id);
  const activeSession = db.getActiveLinkSession(discordUserId);

  return {
    linked: !!mcAccount,
    minecraftUsername: mcAccount?.minecraft_username || null,
    minecraftUuid: mcAccount?.minecraft_uuid || null,
    hasActiveSession: !!activeSession,
    activeSession: activeSession ? {
      sessionId: activeSession.session_id,
      challengeAmount: activeSession.challenge_amount,
      expiresAt: activeSession.expires_at
    } : null
  };
}

/**
 * Unlink a Minecraft account
 * @param {string} discordUserId - Discord user ID
 */
export function unlinkAccount(discordUserId) {
  const user = db.getUserByDiscordId(discordUserId);
  
  if (!user) {
    throw new Error('Account not found');
  }

  const mcAccount = db.getMinecraftAccount(user.id);
  
  if (!mcAccount) {
    throw new Error('No Minecraft account linked');
  }

  db.unlinkMinecraftAccount(user.id);

  db.recordAuditLog('ACCOUNT_UNLINKED', discordUserId, mcAccount.minecraft_uuid, null, null, 'SUCCESS',
    JSON.stringify({ minecraftUsername: mcAccount.minecraft_username }));

  log.info({ discordUserId, minecraftUsername: mcAccount.minecraft_username }, 'Account unlinked');
}

/**
 * Expire old link sessions
 * Should be called periodically
 */
export function expireOldSessions() {
  const expired = db.expireOldLinkSessions();
  if (expired > 0) {
    log.info({ count: expired }, 'Expired old link sessions');
  }
}

// Set up payment monitor event listeners
paymentMonitor.on('link-success', (data) => {
  try {
    const result = completeLinking(data.discordUserId, data.minecraftUsername, data.sessionId);
    
    // Emit completion event for Discord bot to handle
    paymentMonitor.emit('link-completed', {
      discordUserId: result.discordUserId,
      minecraftUsername: result.minecraftUsername,
      minecraftUuid: result.minecraftUuid
    });
    
  } catch (error) {
    log.error({ error, data }, 'Failed to complete linking');
    paymentMonitor.emit('link-error', { error, data });
  }
});

paymentMonitor.on('link-already-linked', (data) => {
  paymentMonitor.emit('link-failed', {
    discordUserId: data.discordUserId,
    reason: 'already_linked',
    existingAccount: data.existingAccount
  });
});

paymentMonitor.on('minecraft-already-linked', (data) => {
  paymentMonitor.emit('link-failed', {
    minecraftUsername: data.minecraftUsername,
    reason: 'minecraft_already_linked',
    linkedToDiscord: data.linkedToDiscord
  });
});

paymentMonitor.on('ambiguous-payment', (data) => {
  if (data.type === 'link') {
    paymentMonitor.emit('link-failed', {
      reason: 'ambiguous_payment',
      sessions: data.sessions
    });
  }
});

// Start session expiration checker (every minute)
setInterval(expireOldSessions, 60 * 1000);
