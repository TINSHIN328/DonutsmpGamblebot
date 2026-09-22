/**
 * Minecraft Payment Monitor
 * Monitors Minecraft chat for payment events and matches them against
 * active link sessions and deposit sessions.
 * 
 * This module:
 * - Parses payment messages from Minecraft chat
 * - Detects sender, recipient, and amount
 * - Matches payments against active sessions
 * - Prevents duplicate processing
 * - Handles ambiguous payments (same amount from multiple sessions)
 * - Emits events for successful matches
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from '../logger.js';
import * as db from '../database.js';
import config from '../config.js';

const log = createLogger('payment-monitor');

/**
 * PaymentMonitor class - monitors Minecraft chat for payments
 */
class PaymentMonitor extends EventEmitter {
  constructor() {
    super();
    this.botUsername = null;
    this.isRunning = false;
    
    // Configurable payment patterns for different server plugins
    // These can be adjusted based on the actual DonutSMP payment message format
    this.paymentPatterns = [
      // Pattern: "PlayerName paid RecipientName $Amount"
      /^(\w+)\s+paid\s+(\w+)\s+\$?([\d,]+(?:\.\d+)?[kKmMbB]?)$/i,
      
      // Pattern: "Payment of $Amount from PlayerName to RecipientName"
      /^Payment\s+of\s+\$?([\d,]+(?:\.\d+)?[kKmMbB]?)\s+from\s+(\w+)\s+to\s+(\w+)$/i,
      
      // Pattern: "[Economy] PlayerName -> RecipientName: $Amount"
      /^\[Economy\]\s+(\w+)\s+->\s+(\w+):\s+\$?([\d,]+(?:\.\d+)?[kKmMbB]?)$/i,
      
      // Pattern: "PlayerName sent $Amount to RecipientName"
      /^(\w+)\s+sent\s+\$?([\d,]+(?:\.\d+)?[kKmMbB]?)\s+to\s+(\w+)$/i,
    ];
  }

  /**
   * Start monitoring payments
   * @param {string} botUsername - The Minecraft bot's username (payment recipient)
   */
  start(botUsername) {
    if (this.isRunning) {
      log.warn('Payment monitor is already running');
      return;
    }

    this.botUsername = botUsername;
    this.isRunning = true;
    log.info({ botUsername }, 'Payment monitor started');
  }

  /**
   * Stop monitoring payments
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.botUsername = null;
    log.info('Payment monitor stopped');
  }

  /**
   * Process a Minecraft chat message
   * @param {string} message - The chat message to process
   */
  processMessage(message) {
    if (!this.isRunning || !this.botUsername) {
      return;
    }

    // Try to parse as a payment message
    const payment = this.parsePaymentMessage(message);
    
    if (!payment) {
      // Not a payment message, ignore
      return;
    }

    log.debug({ payment }, 'Detected payment message');

    // Check if payment is to the bot
    if (payment.recipient.toLowerCase() !== this.botUsername.toLowerCase()) {
      // Payment not to us, ignore
      return;
    }

    // Generate unique hash for this payment to prevent duplicate processing
    const paymentHash = this.generatePaymentHash(payment);

    // Check if already processed
    if (db.isPaymentProcessed(paymentHash)) {
      log.warn({ paymentHash, payment }, 'Payment already processed, ignoring');
      return;
    }

    // Try to match against active sessions
    this.matchPayment(payment, paymentHash);
  }

  /**
   * Parse a chat message to extract payment information
   * @param {string} message - The chat message
   * @returns {Object|null} - Parsed payment or null if not a payment
   */
  parsePaymentMessage(message) {
    // Clean the message
    const cleanMessage = message.trim();

    // Try each pattern
    for (const pattern of this.paymentPatterns) {
      const match = cleanMessage.match(pattern);
      
      if (match) {
        // Determine which group is sender/recipient/amount based on pattern
        let sender, recipient, amountStr;

        if (pattern === this.paymentPatterns[0]) {
          // Pattern 1: PlayerName paid RecipientName $Amount
          [, sender, recipient, amountStr] = match;
        } else if (pattern === this.paymentPatterns[1]) {
          // Pattern 2: Payment of $Amount from PlayerName to RecipientName
          [, amountStr, sender, recipient] = match;
        } else if (pattern === this.paymentPatterns[2]) {
          // Pattern 3: [Economy] PlayerName -> RecipientName: $Amount
          [, sender, recipient, amountStr] = match;
        } else if (pattern === this.paymentPatterns[3]) {
          // Pattern 4: PlayerName sent $Amount to RecipientName
          [, sender, amountStr, recipient] = match;
        }

        // Parse amount
        try {
          const amount = this.parseAmount(amountStr);
          
          return {
            sender: sender.trim(),
            recipient: recipient.trim(),
            amount,
            rawMessage: message,
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          log.debug({ message, error: error.message }, 'Failed to parse amount in payment message');
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Parse amount string to integer
   * @param {string} amountStr - Amount string (e.g., "1000", "10k", "1.5m")
   * @returns {number} - Integer amount
   */
  parseAmount(amountStr) {
    // Remove commas and whitespace
    let str = amountStr.replace(/[,\s]/g, '');
    
    // Handle suffixes
    let multiplier = 1;
    const lower = str.toLowerCase();
    
    if (lower.endsWith('k')) {
      multiplier = 1000;
      str = str.slice(0, -1);
    } else if (lower.endsWith('m')) {
      multiplier = 1000000;
      str = str.slice(0, -1);
    } else if (lower.endsWith('b')) {
      multiplier = 1000000000;
      str = str.slice(0, -1);
    }

    // Parse the number
    const num = parseFloat(str);
    
    if (isNaN(num) || num <= 0) {
      throw new Error('Invalid amount');
    }

    // Convert to integer
    const result = Math.round(num * multiplier);
    
    if (!Number.isInteger(result) || result <= 0) {
      throw new Error('Amount must be a positive integer');
    }

    return result;
  }

  /**
   * Generate a unique hash for a payment
   * @param {Object} payment - Payment object
   * @returns {string} - SHA256 hash
   */
  generatePaymentHash(payment) {
    const data = `${payment.sender}:${payment.recipient}:${payment.amount}:${payment.timestamp}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Match a payment against active sessions
   * @param {Object} payment - Parsed payment
   * @param {string} paymentHash - Unique payment hash
   */
  matchPayment(payment, paymentHash) {
    // First, try to match against link sessions
    const linkMatch = this.matchLinkSession(payment);
    
    if (linkMatch) {
      if (linkMatch.type === 'ambiguous') {
        // Multiple sessions with same amount - cannot determine which one
        log.warn({ payment, sessions: linkMatch.sessions }, 'Ambiguous payment - multiple link sessions with same amount');
        
        // Mark payment as processed to prevent future matches
        db.recordProcessedPayment(paymentHash, payment.sender, null, payment.recipient, payment.amount, 'AMBIGUOUS', null);
        
        // Emit event for admin notification
        this.emit('ambiguous-payment', {
          payment,
          sessions: linkMatch.sessions,
          type: 'link'
        });
        
        return;
      }

      // Successful match
      const session = linkMatch.session;
      
      // Mark as processed
      db.recordProcessedPayment(paymentHash, payment.sender, null, payment.recipient, payment.amount, 'LINK', session.session_id);
      
      // Complete the link session
      try {
        db.completeLinkSession(session.session_id, payment.sender, null);
        
        log.info({
          discordUserId: session.discord_user_id,
          minecraftUsername: payment.sender,
          challengeAmount: session.challenge_amount
        }, 'Link session completed successfully');
        
        // Emit success event
        this.emit('link-success', {
          discordUserId: session.discord_user_id,
          minecraftUsername: payment.sender,
          sessionId: session.session_id
        });
        
      } catch (error) {
        log.error({ error, session, payment }, 'Failed to complete link session');
        this.emit('link-error', { error, session, payment });
      }
      
      return;
    }

    // Try to match against deposit sessions
    const depositMatch = this.matchDepositSession(payment);
    
    if (depositMatch) {
      if (depositMatch.type === 'ambiguous') {
        log.warn({ payment, sessions: depositMatch.sessions }, 'Ambiguous payment - multiple deposit sessions with same amount');
        
        db.recordProcessedPayment(paymentHash, payment.sender, null, payment.recipient, payment.amount, 'AMBIGUOUS', null);
        
        this.emit('ambiguous-payment', {
          payment,
          sessions: depositMatch.sessions,
          type: 'deposit'
        });
        
        return;
      }

      // Successful match
      const session = depositMatch.session;
      
      db.recordProcessedPayment(paymentHash, payment.sender, null, payment.recipient, payment.amount, 'DEPOSIT', session.session_id);
      
      try {
        const result = db.completeDepositSession(session.session_id, payment.sender, null);
        
        log.info({
          discordUserId: session.discord_user_id,
          amount: session.requested_amount,
          minecraftUsername: payment.sender
        }, 'Deposit session completed successfully');
        
        this.emit('deposit-success', {
          discordUserId: session.discord_user_id,
          amount: session.requested_amount,
          newBalance: result.newBalance,
          sessionId: session.session_id
        });
        
      } catch (error) {
        log.error({ error, session, payment }, 'Failed to complete deposit session');
        this.emit('deposit-error', { error, session, payment });
      }
      
      return;
    }

    // No match found - log for debugging
    log.info({ payment, paymentHash }, 'Payment detected but no matching session found');
    
    // Still record as processed to prevent future attempts
    db.recordProcessedPayment(paymentHash, payment.sender, null, payment.recipient, payment.amount, 'UNMATCHED', null);
    
    this.emit('unmatched-payment', { payment, paymentHash });
  }

  /**
   * Match payment against active link sessions
   * @param {Object} payment - Parsed payment
   * @returns {Object|null} - Match result
   */
  matchLinkSession(payment) {
    // Find all active link sessions with matching amount
    const sessions = db.findLinkSessionsByAmount(payment.amount);
    
    if (sessions.length === 0) {
      return null;
    }

    if (sessions.length > 1) {
      // Ambiguous - multiple sessions with same amount
      return {
        type: 'ambiguous',
        sessions
      };
    }

    // Single match - verify the sender matches
    const session = sessions[0];
    
    // Check if this Discord user already has a linked account
    const user = db.getUserByDiscordId(session.discord_user_id);
    if (user) {
      const existingAccount = db.getMinecraftAccount(user.id);
      if (existingAccount) {
        log.warn({
          discordUserId: session.discord_user_id,
          existingAccount: existingAccount.minecraft_username,
          newSender: payment.sender
        }, 'Discord user already has linked Minecraft account');
        
        // Cancel this session
        db.cancelLinkSession(session.session_id);
        
        this.emit('link-already-linked', {
          discordUserId: session.discord_user_id,
          existingAccount: existingAccount.minecraft_username,
          sessionId: session.session_id
        });
        
        return null;
      }
    }

    // Check if this Minecraft username is already linked to another Discord user
    const existingByMinecraft = db.getMinecraftAccountByUuid(payment.sender);
    if (existingByMinecraft) {
      log.warn({
        minecraftUsername: payment.sender,
        linkedToDiscord: existingByMinecraft.discord_user_id,
        newDiscordUser: session.discord_user_id
      }, 'Minecraft account already linked to different Discord user');
      
      db.cancelLinkSession(session.session_id);
      
      this.emit('minecraft-already-linked', {
        minecraftUsername: payment.sender,
        linkedToDiscord: existingByMinecraft.discord_user_id,
        sessionId: session.session_id
      });
      
      return null;
    }

    // All checks passed - return the match
    return {
      type: 'success',
      session
    };
  }

  /**
   * Match payment against active deposit sessions
   * @param {Object} payment - Parsed payment
   * @returns {Object|null} - Match result
   */
  matchDepositSession(payment) {
    // Find all active deposit sessions with matching challenge amount
    const sessions = db.findDepositSessionsByAmount(payment.amount);
    
    if (sessions.length === 0) {
      return null;
    }

    if (sessions.length > 1) {
      return {
        type: 'ambiguous',
        sessions
      };
    }

    const session = sessions[0];

    // Verify the user is linked
    if (!session.user_id) {
      log.warn({ sessionId: session.session_id }, 'Deposit session has no linked user');
      db.cancelDepositSession(session.session_id);
      return null;
    }

    return {
      type: 'success',
      session
    };
  }

  /**
   * Get monitor status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      botUsername: this.botUsername
    };
  }
}

// Export singleton instance
export const paymentMonitor = new PaymentMonitor();
