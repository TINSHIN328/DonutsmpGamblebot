/**
 * DonutSMP Bot - Microsoft/Minecraft Authentication Module
 * Uses Mineflayer's built-in Microsoft auth (device code flow).
 * NEVER stores passwords or tokens.
 * 
 * Flow:
 * 1. User runs /link
 * 2. Bot generates a unique link code
 * 3. User authenticates via Microsoft (handled by Mineflayer)
 * 4. On success, we get the Minecraft UUID and username
 * 5. Store the mapping in the database
 * 
 * The actual Microsoft auth is handled by Mineflayer internally.
 * We never see or store the user's password or access tokens.
 */
import { createLogger, logSecurityEvent } from './logger.js';
import * as db from './database.js';

const log = createLogger('auth');

// Pending link requests (code -> { discordUserId, timestamp, resolve, reject })
const pendingLinks = new Map();

// Link codes expire after 5 minutes
const LINK_CODE_EXPIRY = 5 * 60 * 1000;

/**
 * Generate a unique link code for account linking.
 */
function generateLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No ambiguous chars
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Create a new link request.
 * Returns a link code that the user must use to authenticate.
 */
export function createLinkRequest(discordUserId) {
  // Check if user already has a pending request
  for (const [code, request] of pendingLinks.entries()) {
    if (request.discordUserId === discordUserId) {
      return { code, existing: true };
    }
  }

  // Check if user already has a linked account
  const user = db.getUserByDiscordId(discordUserId);
  if (user) {
    const mcAccount = db.getMinecraftAccount(user.id);
    if (mcAccount) {
      throw new Error('ALREADY_LINKED: Your account is already linked. Use /unlink first to change it.');
    }
  }

  const code = generateLinkCode();
  pendingLinks.set(code, {
    discordUserId,
    timestamp: Date.now(),
  });

  // Clean up expired codes
  cleanExpiredLinks();

  log.info({ discordUserId, code }, 'Link request created');
  return { code, existing: false };
}

/**
 * Complete a link request after successful Minecraft authentication.
 * Called when Mineflayer successfully authenticates.
 */
export function completeLinkRequest(discordUserId, minecraftUuid, minecraftUsername) {
  // Find the pending request for this Discord user
  let linkCode = null;
  for (const [code, request] of pendingLinks.entries()) {
    if (request.discordUserId === discordUserId) {
      linkCode = code;
      break;
    }
  }

  if (!linkCode) {
    log.warn({ discordUserId }, 'No pending link request found');
    return false;
  }

  try {
    // Get or create user
    let user = db.getUserByDiscordId(discordUserId);
    let userId;

    if (!user) {
      userId = db.createUser(discordUserId, null);
    } else {
      userId = user.id;
    }

    // Link the Minecraft account
    db.linkMinecraftAccount(userId, minecraftUuid, minecraftUsername);

    // Create wallet
    db.getOrCreateWallet(userId);

    // Remove pending request
    pendingLinks.delete(linkCode);

    // Audit log
    db.recordAuditLog('ACCOUNT_LINKED', discordUserId, minecraftUuid, null, null, 'SUCCESS',
      JSON.stringify({ minecraftUsername }));

    log.info({ discordUserId, minecraftUuid, minecraftUsername }, 'Account linked successfully');
    return true;
  } catch (error) {
    log.error({ error: error.message, discordUserId }, 'Failed to complete link');
    throw error;
  }
}

/**
 * Unlink a user's Minecraft account.
 */
export function unlinkAccount(discordUserId) {
  const user = db.getUserByDiscordId(discordUserId);
  if (!user) throw new Error('NOT_LINKED: You do not have a linked account.');

  const mcAccount = db.getMinecraftAccount(user.id);
  if (!mcAccount) throw new Error('NOT_LINKED: You do not have a linked Minecraft account.');

  db.unlinkMinecraftAccount(user.id);

  db.recordAuditLog('ACCOUNT_UNLINKED', discordUserId, mcAccount.minecraft_uuid, null, null, 'SUCCESS',
    JSON.stringify({ minecraftUsername: mcAccount.minecraft_username }));

  log.info({ discordUserId }, 'Account unlinked');
  return mcAccount;
}

/**
 * Clean up expired link requests.
 */
function cleanExpiredLinks() {
  const now = Date.now();
  for (const [code, request] of pendingLinks.entries()) {
    if (now - request.timestamp > LINK_CODE_EXPIRY) {
      pendingLinks.delete(code);
      log.info({ code }, 'Expired link request removed');
    }
  }
}

/**
 * Get the status of a link request.
 */
export function getLinkStatus(discordUserId) {
  for (const [code, request] of pendingLinks.entries()) {
    if (request.discordUserId === discordUserId) {
      const remaining = LINK_CODE_EXPIRY - (Date.now() - request.timestamp);
      return {
        pending: true,
        code,
        expiresInSeconds: Math.max(0, Math.floor(remaining / 1000)),
      };
    }
  }
  return { pending: false };
}

/**
 * Periodically clean expired links.
 */
setInterval(cleanExpiredLinks, 60000);

/**
 * For the actual /link command flow:
 * Since Mineflayer handles Microsoft auth internally (device code flow),
 * the bot admin needs to authenticate the MC bot account once.
 * 
 * For user linking, we use a simplified approach:
 * - The admin-configured MC bot account is already authenticated
 * - Users verify their identity by performing an in-game action
 *   (like sending a specific message or using a command)
 * - Or the admin manually verifies the link
 * 
 * This avoids storing any user credentials.
 */

/**
 * Alternative: Admin-assisted linking
 * Admin verifies a user's Minecraft identity and links them.
 */
export function adminLinkAccount(adminDiscordId, targetDiscordId, minecraftUuid, minecraftUsername) {
  try {
    let user = db.getUserByDiscordId(targetDiscordId);
    let userId;

    if (!user) {
      userId = db.createUser(targetDiscordId, null);
    } else {
      userId = user.id;
    }

    db.linkMinecraftAccount(userId, minecraftUuid, minecraftUsername);
    db.getOrCreateWallet(userId);

    db.recordAuditLog('ACCOUNT_LINKED', targetDiscordId, minecraftUuid, null, null, 'ADMIN_LINKED',
      JSON.stringify({ admin: adminDiscordId, minecraftUsername }));

    log.info({ adminDiscordId, targetDiscordId, minecraftUuid }, 'Admin-linked account');
    return true;
  } catch (error) {
    if (error.message === 'MINECRAFT_ALREADY_LINKED') {
      throw new Error('That Minecraft account is already linked to another Discord user.');
    }
    if (error.message === 'USER_ALREADY_LINKED') {
      throw new Error('That Discord user already has a linked Minecraft account.');
    }
    throw error;
  }
}
