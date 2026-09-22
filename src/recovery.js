/**
 * DonutSMP Bot - Recovery Module
 * Handles crash recovery for stale transactions, games, and withdrawals.
 * Runs on startup and periodically.
 */
import { createLogger } from './logger.js';
import * as db from './database.js';
import { getDb } from './database.js';

const log = createLogger('recovery');

/**
 * Run recovery on startup.
 * Detects and resolves stale PROCESSING transactions.
 */
export function runRecovery() {
  log.info('Starting transaction recovery...');

  try {
    recoverStaleGames();
    recoverStaleWithdrawals();
    recoverStaleTransactions();
    resetDailyLimits();

    log.info('Recovery complete');
  } catch (error) {
    log.error({ error: error.message }, 'Recovery failed');
  }
}

/**
 * Recover stale games (stuck in PROCESSING state).
 * These games had bets reserved but never completed.
 */
function recoverStaleGames() {
  const staleGames = db.getStaleGames(5); // Games older than 5 minutes

  if (staleGames.length === 0) {
    log.info('No stale games found');
    return;
  }

  log.info({ count: staleGames.length }, 'Found stale games to recover');

  const database = getDb();

  for (const game of staleGames) {
    try {
      log.info({ gameId: game.game_id, userId: game.user_id, amount: game.bet_amount }, 'Recovering stale game');

      // Check if there's a reservation transaction for this game
      const reservation = database.prepare(`
        SELECT * FROM wallet_transactions
        WHERE user_id = ? AND type = 'RESERVATION' AND status = 'COMPLETED'
        AND reference_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(game.user_id, game.game_id);

      if (reservation) {
        // Refund the bet
        const wallet = database.prepare('SELECT * FROM wallets WHERE user_id = ?').get(game.user_id);
        const refundTxnId = `RECOVERY-${game.game_id}-${Date.now()}`;
        const newBalance = wallet.balance + game.bet_amount;

        database.prepare(`
          INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
          VALUES (?, ?, ?, 'REFUND', ?, ?, ?, 'COMPLETED', 'GAME', ?, 'Crash recovery - game refund')
        `).run(refundTxnId, game.user_id, wallet.id, game.bet_amount, wallet.balance, newBalance, game.game_id);

        database.prepare('UPDATE wallets SET balance = ? WHERE user_id = ?').run(newBalance, game.user_id);

        // Mark game as cancelled
        database.prepare(`
          UPDATE games SET status = 'CANCELLED', game_data = ?, completed_at = datetime('now')
          WHERE game_id = ?
        `).run(JSON.stringify({ recovery: 'crash_refund', original_bet: game.bet_amount }), game.game_id);

        // Release the reservation
        database.prepare(`
          UPDATE wallet_transactions SET status = 'CANCELLED' WHERE transaction_id = ?
        `).run(reservation.transaction_id);

        db.recordAuditLog('GAME_RECOVERED', null, null, game.game_id, game.bet_amount, 'REFUNDED',
          'Crash recovery - bet refunded');

        log.info({ gameId: game.game_id, refundAmount: game.bet_amount }, 'Stale game recovered - bet refunded');
      } else {
        // No reservation found, just mark as cancelled
        database.prepare(`
          UPDATE games SET status = 'CANCELLED', completed_at = datetime('now')
          WHERE game_id = ?
        `).run(game.game_id);
        log.info({ gameId: game.game_id }, 'Stale game marked as cancelled (no reservation)');
      }
    } catch (error) {
      log.error({ error: error.message, gameId: game.game_id }, 'Failed to recover game');
    }
  }
}

/**
 * Recover stale withdrawals.
 * These withdrawals had money reserved but MC payment was never confirmed.
 */
function recoverStaleWithdrawals() {
  const staleWithdrawals = db.getStaleWithdrawals(10); // Older than 10 minutes

  if (staleWithdrawals.length === 0) {
    log.info('No stale withdrawals found');
    return;
  }

  log.info({ count: staleWithdrawals.length }, 'Found stale withdrawals to recover');

  const database = getDb();

  for (const wd of staleWithdrawals) {
    try {
      log.info({ withdrawalId: wd.withdrawal_id, userId: wd.user_id, amount: wd.amount }, 'Recovering stale withdrawal');

      // Refund the withdrawal amount
      const wallet = database.prepare('SELECT * FROM wallets WHERE user_id = ?').get(wd.user_id);
      const refundTxnId = `RECOVERY-WD-${wd.withdrawal_id}-${Date.now()}`;
      const newBalance = wallet.balance + wd.amount;

      database.prepare(`
        INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
        VALUES (?, ?, ?, 'REFUND', ?, ?, ?, 'COMPLETED', 'WITHDRAWAL', ?, 'Crash recovery - withdrawal refund')
      `).run(refundTxnId, wd.user_id, wallet.id, wd.amount, wallet.balance, newBalance, wd.withdrawal_id);

      database.prepare('UPDATE wallets SET balance = ?, total_withdrawn = total_withdrawn - ? WHERE user_id = ?')
        .run(newBalance, wd.amount, wd.user_id);

      // Mark withdrawal as failed
      database.prepare(`
        UPDATE withdrawals SET status = 'FAILED', error_message = 'Crash recovery - payment not confirmed'
        WHERE withdrawal_id = ?
      `).run(wd.withdrawal_id);

      // Cancel the original transaction
      database.prepare(`
        UPDATE wallet_transactions SET status = 'CANCELLED' WHERE transaction_id = ?
      `).run(wd.transaction_id);

      db.recordAuditLog('WITHDRAWAL_RECOVERED', null, null, wd.withdrawal_id, wd.amount, 'REFUNDED',
        'Crash recovery - withdrawal refunded');

      log.info({ withdrawalId: wd.withdrawal_id, refundAmount: wd.amount }, 'Stale withdrawal recovered');
    } catch (error) {
      log.error({ error: error.message, withdrawalId: wd.withdrawal_id }, 'Failed to recover withdrawal');
    }
  }
}

/**
 * Recover stale transactions.
 */
function recoverStaleTransactions() {
  const staleTxns = db.getStaleTransactions(15); // Older than 15 minutes

  if (staleTxns.length === 0) {
    log.info('No stale transactions found');
    return;
  }

  log.info({ count: staleTxns.length }, 'Found stale transactions');

  const database = getDb();

  for (const txn of staleTxns) {
    try {
      // Only cancel reservations that weren't part of a completed game
      if (txn.type === 'RESERVATION' || txn.type === 'WITHDRAW') {
        // Check if there's a corresponding completed game/withdrawal
        const hasCompletion = database.prepare(`
          SELECT 1 FROM wallet_transactions
          WHERE user_id = ? AND reference_id = ? AND type IN ('WIN', 'LOSS', 'REFUND') AND status = 'COMPLETED'
          LIMIT 1
        `).get(txn.user_id, txn.reference_id);

        if (!hasCompletion) {
          // Refund
          const wallet = database.prepare('SELECT * FROM wallets WHERE user_id = ?').get(txn.user_id);
          const refundTxnId = `RECOVERY-TXN-${txn.transaction_id}-${Date.now()}`;
          const refundAmount = Math.abs(txn.amount);
          const newBalance = wallet.balance + refundAmount;

          database.prepare(`
            INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
            VALUES (?, ?, ?, 'REFUND', ?, ?, ?, 'COMPLETED', ?, ?, 'Crash recovery - stale transaction refund')
          `).run(refundTxnId, txn.user_id, wallet.id, refundAmount, wallet.balance, newBalance, txn.type, txn.reference_id);

          database.prepare('UPDATE wallets SET balance = ? WHERE user_id = ?').run(newBalance, txn.user_id);
          database.prepare(`UPDATE wallet_transactions SET status = 'CANCELLED' WHERE transaction_id = ?`).run(txn.transaction_id);

          log.info({ txnId: txn.transaction_id, refundAmount }, 'Stale transaction recovered');
        }
      }
    } catch (error) {
      log.error({ error: error.message, txnId: txn.transaction_id }, 'Failed to recover transaction');
    }
  }
}

/**
 * Reset daily rate limits.
 */
function resetDailyLimits() {
  db.resetDailyLimits();
  log.info('Daily rate limits reset');
}

/**
 * Start periodic recovery checks.
 */
export function startRecoveryWorker() {
  // Run recovery every 5 minutes
  setInterval(() => {
    try {
      recoverStaleGames();
      recoverStaleWithdrawals();
      recoverStaleTransactions();
      resetDailyLimits();
    } catch (error) {
      log.error({ error: error.message }, 'Periodic recovery failed');
    }
  }, 5 * 60 * 1000);

  log.info('Recovery worker started (interval: 5 minutes)');
}
