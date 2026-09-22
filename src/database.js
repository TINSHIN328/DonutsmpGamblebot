/**
 * DonutSMP Bot - Database Module
 * SQLite database with automatic schema creation, migrations, and backups.
 * All monetary operations use atomic transactions.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import config from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('database');

let db = null;
let backupInterval = null;

/**
 * Ensure required directories exist.
 */
function ensureDirectories() {
  const dirs = [
    path.dirname(config.DATABASE_PATH),
    path.join(path.dirname(config.DATABASE_PATH), 'backups'),
    path.resolve('logs'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log.info({ dir }, 'Created directory');
    }
  }
}

/**
 * Initialize the database - creates file, schema, and indexes.
 */
export function initDatabase() {
  ensureDirectories();

  log.info({ path: config.DATABASE_PATH }, 'Initializing database');

  db = new Database(config.DATABASE_PATH);

  // Performance settings
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations();
  createIndexes();
  createDefaultSettings();

  log.info('Database initialized successfully');
  return db;
}

/**
 * Run all schema migrations in order.
 */
function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrations = [
    {
      name: '001_initial_schema',
      sql: `
        -- Users table (Discord accounts)
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          discord_user_id TEXT NOT NULL UNIQUE,
          discord_username TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Minecraft accounts linked to Discord users
        CREATE TABLE IF NOT EXISTS minecraft_accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          minecraft_uuid TEXT NOT NULL UNIQUE,
          minecraft_username TEXT NOT NULL,
          linked_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Wallets
        CREATE TABLE IF NOT EXISTS wallets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL UNIQUE,
          balance INTEGER NOT NULL DEFAULT 0,
          total_deposited INTEGER NOT NULL DEFAULT 0,
          total_withdrawn INTEGER NOT NULL DEFAULT 0,
          total_wagered INTEGER NOT NULL DEFAULT 0,
          total_won INTEGER NOT NULL DEFAULT 0,
          total_lost INTEGER NOT NULL DEFAULT 0,
          games_played INTEGER NOT NULL DEFAULT 0,
          wins INTEGER NOT NULL DEFAULT 0,
          losses INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        -- Immutable wallet transaction log
        CREATE TABLE IF NOT EXISTS wallet_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          transaction_id TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          wallet_id INTEGER NOT NULL,
          type TEXT NOT NULL CHECK(type IN (
            'DEPOSIT', 'WITHDRAW', 'BET', 'WIN', 'LOSS',
            'TAX', 'REFUND', 'ADMIN_ADJUSTMENT', 'RESERVATION',
            'RESERVATION_RELEASE'
          )),
          amount INTEGER NOT NULL,
          balance_before INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN (
            'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'
          )),
          reference_type TEXT,
          reference_id TEXT,
          reason TEXT,
          metadata TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Games
        CREATE TABLE IF NOT EXISTS games (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          game_type TEXT NOT NULL,
          bet_amount INTEGER NOT NULL,
          result TEXT,
          gross_payout INTEGER NOT NULL DEFAULT 0,
          profit INTEGER NOT NULL DEFAULT 0,
          tax_amount INTEGER NOT NULL DEFAULT 0,
          net_payout INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN (
            'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED'
          )),
          server_seed_hash TEXT,
          client_seed TEXT,
          nonce INTEGER,
          game_data TEXT,
          transaction_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- Withdrawals
        CREATE TABLE IF NOT EXISTS withdrawals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          withdrawal_id TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          tax_amount INTEGER NOT NULL DEFAULT 0,
          net_amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN (
            'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'
          )),
          mc_transaction_id TEXT,
          error_message TEXT,
          transaction_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- Deposits
        CREATE TABLE IF NOT EXISTS deposits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          deposit_id TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN (
            'PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED'
          )),
          mc_transaction_id TEXT,
          transaction_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          confirmed_at TEXT,
          expires_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- Admin actions audit log
        CREATE TABLE IF NOT EXISTS admin_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_discord_id TEXT NOT NULL,
          action TEXT NOT NULL,
          target_user_id TEXT,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Bot settings (key-value store)
        CREATE TABLE IF NOT EXISTS bot_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Channel settings
        CREATE TABLE IF NOT EXISTS channel_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          setting_type TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(guild_id, setting_type)
        );

        -- Audit logs
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          discord_user_id TEXT,
          minecraft_uuid TEXT,
          reference_id TEXT,
          amount INTEGER,
          status TEXT,
          details TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Rate limiting
        CREATE TABLE IF NOT EXISTS rate_limits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          action TEXT NOT NULL,
          last_used TEXT NOT NULL DEFAULT (datetime('now')),
          daily_count INTEGER NOT NULL DEFAULT 0,
          daily_amount INTEGER NOT NULL DEFAULT 0,
          reset_date TEXT NOT NULL DEFAULT (date('now')),
          UNIQUE(user_id, action)
        );
      `
    },
    {
      name: '002_big_win_announcements',
      sql: `
        CREATE TABLE IF NOT EXISTS big_win_announcements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id TEXT NOT NULL UNIQUE,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          announced_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (game_id) REFERENCES games(game_id)
        );
      `
    }
  ];

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map(r => r.name)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      log.info({ migration: migration.name }, 'Applying migration');
      // Create backup before migration
      if (config.DATABASE_BACKUP_ENABLED) {
        createBackup(`pre-migration-${migration.name}`);
      }
      db.exec(migration.sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
      log.info({ migration: migration.name }, 'Migration applied');
    }
  }
}

/**
 * Create indexes for performance.
 */
function createIndexes() {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_user_id)',
    'CREATE INDEX IF NOT EXISTS idx_mc_accounts_uuid ON minecraft_accounts(minecraft_uuid)',
    'CREATE INDEX IF NOT EXISTS idx_mc_accounts_user_id ON minecraft_accounts(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON wallet_transactions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_transactions_transaction_id ON wallet_transactions(transaction_id)',
    'CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON wallet_transactions(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_transactions_status ON wallet_transactions(status)',
    'CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_games_game_id ON games(game_id)',
    'CREATE INDEX IF NOT EXISTS idx_games_status ON games(status)',
    'CREATE INDEX IF NOT EXISTS idx_games_created_at ON games(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status)',
    'CREATE INDEX IF NOT EXISTS idx_deposits_user_id ON deposits(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type)',
    'CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action ON rate_limits(user_id, action)',
  ];

  for (const idx of indexes) {
    db.exec(idx);
  }
}

/**
 * Create default bot settings.
 */
function createDefaultSettings() {
  const defaults = {
    maintenance_mode: 'false',
    win_channel_id: '',
    logs_channel_id: '',
    bot_version: '1.0.0',
  };

  const insert = db.prepare(
    `INSERT OR IGNORE INTO bot_settings (key, value) VALUES (?, ?)`
  );

  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, value);
  }
}

/**
 * Get the database instance.
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Create a database backup.
 */
export function createBackup(suffix = '') {
  if (!db) return null;

  const backupDir = path.join(path.dirname(config.DATABASE_PATH), 'backups');
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `database-${timestamp}${suffix ? '-' + suffix : ''}.sqlite`;
  const backupPath = path.join(backupDir, filename);

  try {
    db.backup(backupPath).then(() => {
      log.info({ backupPath }, 'Database backup created');
      // Clean old backups
      cleanOldBackups(backupDir);
    }).catch(err => {
      log.error({ err, backupPath }, 'Backup failed');
    });
    return backupPath;
  } catch (err) {
    log.error({ err }, 'Backup creation failed');
    return null;
  }
}

/**
 * Remove backups older than retention period.
 */
function cleanOldBackups(backupDir) {
  try {
    const files = fs.readdirSync(backupDir);
    const retentionMs = config.DATABASE_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith('.sqlite')) continue;
      const filePath = path.join(backupDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > retentionMs) {
        fs.unlinkSync(filePath);
        log.info({ file }, 'Removed old backup');
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed to clean old backups');
  }
}

/**
 * Start periodic backups.
 */
export function startBackupScheduler() {
  if (!config.DATABASE_BACKUP_ENABLED) {
    log.info('Database backups disabled');
    return;
  }

  const intervalMs = config.DATABASE_BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
  backupInterval = setInterval(() => {
    createBackup('scheduled');
  }, intervalMs);

  log.info({ intervalHours: config.DATABASE_BACKUP_INTERVAL_HOURS }, 'Backup scheduler started');
}

/**
 * Stop backup scheduler.
 */
export function stopBackupScheduler() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
  }
}

/**
 * Get database status info.
 */
export function getDatabaseStatus() {
  if (!db) return { connected: false };

  const size = fs.statSync(config.DATABASE_PATH).size;
  const pendingTransactions = db.prepare(
    `SELECT COUNT(*) as count FROM wallet_transactions WHERE status IN ('PENDING', 'PROCESSING')`
  ).get();
  const pendingGames = db.prepare(
    `SELECT COUNT(*) as count FROM games WHERE status IN ('PENDING', 'PROCESSING')`
  ).get();
  const pendingWithdrawals = db.prepare(
    `SELECT COUNT(*) as count FROM withdrawals WHERE status IN ('PENDING', 'PROCESSING')`
  ).get();

  const lastMigration = db.prepare(
    `SELECT name, applied_at FROM migrations ORDER BY id DESC LIMIT 1`
  ).get();

  const backupDir = path.join(path.dirname(config.DATABASE_PATH), 'backups');
  let lastBackup = null;
  try {
    const files = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.sqlite'))
      .sort()
      .reverse();
    if (files.length > 0) {
      const stat = fs.statSync(path.join(backupDir, files[0]));
      lastBackup = stat.mtime.toISOString();
    }
  } catch { /* ignore */ }

  return {
    connected: true,
    size,
    sizeFormatted: formatBytes(size),
    pendingTransactions: pendingTransactions.count,
    pendingGames: pendingGames.count,
    pendingWithdrawals: pendingWithdrawals.count,
    lastMigration: lastMigration?.name || 'none',
    lastBackup,
  };
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Close database connection gracefully.
 */
export function closeDatabase() {
  stopBackupScheduler();
  if (db) {
    db.close();
    db = null;
    log.info('Database connection closed');
  }
}

// ============================================================
// WALLET OPERATIONS (Atomic)
// ============================================================

/**
 * Get or create a wallet for a user.
 */
export function getOrCreateWallet(userId) {
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (wallet) return wallet;

  // Create wallet with starting balance
  const createWallet = db.transaction(() => {
    db.prepare('INSERT INTO wallets (user_id, balance) VALUES (?, ?)').run(userId, config.STARTING_BALANCE);
    const newWallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);

    // Create initial transaction
    const txnId = `INIT-${userId}-${Date.now()}`;
    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reason)
      VALUES (?, ?, ?, 'ADMIN_ADJUSTMENT', ?, 0, ?, 'COMPLETED', 'Starting balance')
    `).run(txnId, userId, newWallet.id, config.STARTING_BALANCE, config.STARTING_BALANCE);

    return newWallet;
  });

  return createWallet();
}

/**
 * Get wallet by Discord user ID.
 */
export function getWalletByDiscordId(discordUserId) {
  const user = db.prepare('SELECT id FROM users WHERE discord_user_id = ?').get(discordUserId);
  if (!user) return null;
  return getOrCreateWallet(user.id);
}

/**
 * Reserve balance for a bet (atomic).
 * Returns the reservation transaction ID or throws.
 */
export function reserveBet(userId, amount) {
  const reserve = db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ? FOR UPDATE').get(userId);
    if (!wallet) throw new Error('Wallet not found');
    if (wallet.balance < amount) throw new Error('INSUFFICIENT_BALANCE');

    const txnId = `BET-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newBalance = wallet.balance - amount;

    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reason)
      VALUES (?, ?, ?, 'RESERVATION', ?, ?, ?, 'COMPLETED', 'Bet reservation')
    `).run(txnId, userId, wallet.id, amount, wallet.balance, newBalance);

    db.prepare('UPDATE wallets SET balance = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newBalance, wallet.id);

    return { transactionId: txnId, newBalance };
  });

  return reserve();
}

/**
 * Complete a bet - either win or loss (atomic).
 * 
 * IMPORTANT: The bet amount was already deducted from the wallet via reserveBet().
 * For a WIN: we add back the net profit (original bet is effectively returned).
 * For a LOSS: the balance stays as-is (bet was already deducted).
 * 
 * @param {number} userId - Internal user ID
 * @param {string} reservationTxnId - The reservation transaction ID
 * @param {string} result - 'WIN' or 'LOSS'
 * @param {number} betAmount - Original bet amount (integer)
 * @param {number} grossPayout - Total payout if won (integer, 0 for loss)
 * @param {number} profit - Gross profit (grossPayout - betAmount)
 * @param {number} taxAmount - Tax on profit (integer)
 * @param {number} netProfit - Net profit after tax (integer)
 * @param {object} gameData - Game metadata including gameId
 */
export function completeBet(userId, reservationTxnId, result, betAmount, grossPayout, profit, taxAmount, netProfit, gameData) {
  const complete = db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('Wallet not found');

    // Release reservation record (informational, balance unchanged)
    const releaseTxnId = `RELEASE-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
      VALUES (?, ?, ?, 'RESERVATION_RELEASE', ?, ?, ?, 'COMPLETED', 'BET', ?, 'Reservation released')
    `).run(releaseTxnId, userId, wallet.id, 0, wallet.balance, wallet.balance, reservationTxnId);

    let newBalance = wallet.balance;
    let betTxnId;

    if (result === 'WIN') {
      // Credit the original bet back PLUS the net profit.
      // The original bet was already deducted via reserveBet().
      // So we need to return: betAmount (original wager returned) + netProfit (after-tax winnings)
      // 
      // Example:
      //   Starting: 1,000,000 → After reservation: 0
      //   Bet: 1,000,000, Gross Payout: 2,000,000
      //   Profit: 1,000,000, Tax (15%): 150,000, Net Profit: 850,000
      //   Credit: betAmount + netProfit = 1,000,000 + 850,000 = 1,850,000
      //   Final: 0 + 1,850,000 = 1,850,000 ✓
      const totalCredit = betAmount + netProfit;
      betTxnId = `WIN-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      newBalance = wallet.balance + totalCredit;

      db.prepare(`
        INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
        VALUES (?, ?, ?, 'WIN', ?, ?, ?, 'COMPLETED', 'GAME', ?, 'Game win (bet returned + net profit)')
      `).run(betTxnId, userId, wallet.id, totalCredit, wallet.balance, newBalance, gameData.gameId);

      // Tax record (informational - already accounted for in netProfit)
      if (taxAmount > 0) {
        const taxTxnId = `TAX-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        db.prepare(`
          INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
          VALUES (?, ?, ?, 'TAX', ?, ?, ?, 'COMPLETED', 'GAME', ?, 'Game tax (${config.GAME_TAX_PERCENT}%)')
        `).run(taxTxnId, userId, wallet.id, -taxAmount, newBalance, newBalance, gameData.gameId);
      }

      // Update wallet stats: balance, total_won (net profit), games, wins, wagered
      db.prepare(`
        UPDATE wallets SET
          balance = ?,
          total_won = total_won + ?,
          total_wagered = total_wagered + ?,
          games_played = games_played + 1,
          wins = wins + 1,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(newBalance, netProfit, betAmount, wallet.id);

    } else {
      // LOSS - bet amount was already deducted via reservation.
      // Balance stays as-is. No tax on losses.
      betTxnId = `LOSS-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      db.prepare(`
        INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
        VALUES (?, ?, ?, 'LOSS', ?, ?, ?, 'COMPLETED', 'GAME', ?, 'Game loss')
      `).run(betTxnId, userId, wallet.id, 0, wallet.balance, wallet.balance, gameData.gameId);

      // Update wallet stats: total_lost (the bet amount), games, losses, wagered
      db.prepare(`
        UPDATE wallets SET
          total_lost = total_lost + ?,
          total_wagered = total_wagered + ?,
          games_played = games_played + 1,
          losses = losses + 1,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(betAmount, betAmount, wallet.id);
    }

    return { newBalance, betTxnId };
  });

  return complete();
}

/**
 * Process a withdrawal (atomic).
 */
export function processWithdrawal(userId, amount) {
  const withdraw = db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('Wallet not found');
    if (wallet.balance < amount) throw new Error('INSUFFICIENT_BALANCE');

    const withdrawalId = `WD-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const txnId = `WD-TXN-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Calculate tax on withdrawal
    const taxAmount = Math.floor(amount * config.WITHDRAW_TAX_PERCENT / 100);
    const netAmount = amount - taxAmount;

    // Reserve the full amount
    const newBalance = wallet.balance - amount;

    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
      VALUES (?, ?, ?, 'WITHDRAW', ?, ?, ?, 'PROCESSING', 'WITHDRAWAL', ?, 'Withdrawal')
    `).run(txnId, userId, wallet.id, -amount, wallet.balance, newBalance, withdrawalId);

    db.prepare('UPDATE wallets SET balance = ?, total_withdrawn = total_withdrawn + ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newBalance, amount, wallet.id);

    // Create withdrawal record
    db.prepare(`
      INSERT INTO withdrawals (withdrawal_id, user_id, amount, tax_amount, net_amount, status, transaction_id)
      VALUES (?, ?, ?, ?, ?, 'PROCESSING', ?)
    `).run(withdrawalId, userId, amount, taxAmount, netAmount, txnId);

    return { withdrawalId, transactionId: txnId, taxAmount, netAmount, newBalance };
  });

  return withdraw();
}

/**
 * Confirm a withdrawal (after MC payment succeeds).
 */
export function confirmWithdrawal(withdrawalId) {
  const confirm = db.transaction(() => {
    db.prepare(`
      UPDATE withdrawals SET status = 'COMPLETED', completed_at = datetime('now') WHERE withdrawal_id = ?
    `).run(withdrawalId);

    const wd = db.prepare('SELECT * FROM withdrawals WHERE withdrawal_id = ?').get(withdrawalId);
    if (wd) {
      db.prepare(`
        UPDATE wallet_transactions SET status = 'COMPLETED' WHERE transaction_id = ?
      `).run(wd.transaction_id);
    }
  });
  confirm();
}

/**
 * Rollback a failed withdrawal.
 */
export function rollbackWithdrawal(withdrawalId, errorMessage) {
  const rollback = db.transaction(() => {
    const wd = db.prepare('SELECT * FROM withdrawals WHERE withdrawal_id = ?').get(withdrawalId);
    if (!wd) throw new Error('Withdrawal not found');

    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(wd.user_id);

    // Refund the amount
    const refundTxnId = `REFUND-${withdrawalId}-${Date.now()}`;
    const newBalance = wallet.balance + wd.amount;

    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
      VALUES (?, ?, ?, 'REFUND', ?, ?, ?, 'COMPLETED', 'WITHDRAWAL', ?, 'Withdrawal failed - refund')
    `).run(refundTxnId, wd.user_id, wallet.id, wd.amount, wallet.balance, newBalance, withdrawalId);

    db.prepare('UPDATE wallets SET balance = ?, total_withdrawn = total_withdrawn - ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newBalance, wd.amount, wallet.id);

    db.prepare(`
      UPDATE withdrawals SET status = 'FAILED', error_message = ? WHERE withdrawal_id = ?
    `).run(errorMessage, withdrawalId);

    db.prepare(`
      UPDATE wallet_transactions SET status = 'CANCELLED' WHERE transaction_id = ?
    `).run(wd.transaction_id);
  });
  rollback();
}

/**
 * Admin adjust balance.
 */
export function adminAdjustBalance(userId, amount, reason, adminDiscordId) {
  const adjust = db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('Wallet not found');

    const txnId = `ADMIN-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newBalance = wallet.balance + amount;

    if (newBalance < 0) throw new Error('Cannot set negative balance');

    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reason, metadata)
      VALUES (?, ?, ?, 'ADMIN_ADJUSTMENT', ?, ?, ?, 'COMPLETED', ?, ?)
    `).run(txnId, userId, wallet.id, amount, wallet.balance, newBalance, reason, JSON.stringify({ admin: adminDiscordId }));

    db.prepare('UPDATE wallets SET balance = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newBalance, wallet.id);

    // Log admin action
    db.prepare(`
      INSERT INTO admin_actions (admin_discord_id, action, target_user_id, details)
      VALUES (?, 'BALANCE_ADJUSTMENT', ?, ?)
    `).run(adminDiscordId, String(userId), JSON.stringify({ amount, reason, txnId }));

    return { transactionId: txnId, newBalance };
  });

  return adjust();
}

/**
 * Process a deposit (atomic).
 */
export function processDeposit(userId, amount) {
  const deposit = db.transaction(() => {
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('Wallet not found');

    const depositId = `DEP-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const txnId = `DEP-TXN-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    db.prepare(`
      INSERT INTO deposits (deposit_id, user_id, amount, status, transaction_id, expires_at)
      VALUES (?, ?, ?, 'PENDING', ?, datetime('now', '+30 minutes'))
    `).run(depositId, userId, amount, txnId);

    return { depositId, transactionId: txnId };
  });

  return deposit();
}

/**
 * Confirm a deposit (after MC verification).
 */
export function confirmDeposit(depositId) {
  const confirm = db.transaction(() => {
    const dep = db.prepare('SELECT * FROM deposits WHERE deposit_id = ?').get(depositId);
    if (!dep) throw new Error('Deposit not found');
    if (dep.status !== 'PENDING') throw new Error('Deposit not in PENDING state');

    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(dep.user_id);
    const newBalance = wallet.balance + dep.amount;

    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
      VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, 'COMPLETED', 'DEPOSIT', ?, 'Deposit confirmed')
    `).run(dep.transaction_id, dep.user_id, wallet.id, dep.amount, wallet.balance, newBalance, depositId);

    db.prepare('UPDATE wallets SET balance = ?, total_deposited = total_deposited + ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newBalance, dep.amount, wallet.id);

    db.prepare(`
      UPDATE deposits SET status = 'CONFIRMED', confirmed_at = datetime('now') WHERE deposit_id = ?
    `).run(depositId);

    return { newBalance };
  });

  return confirm();
}

/**
 * Record a game in the database.
 */
export function createGameRecord(userId, gameType, betAmount, gameId, serverSeedHash, clientSeed, nonce) {
  db.prepare(`
    INSERT INTO games (game_id, user_id, game_type, bet_amount, status, server_seed_hash, client_seed, nonce)
    VALUES (?, ?, ?, ?, 'PROCESSING', ?, ?, ?)
  `).run(gameId, userId, gameType, betAmount, serverSeedHash, clientSeed, nonce);
}

/**
 * Complete a game record.
 */
export function completeGameRecord(gameId, result, grossPayout, profit, taxAmount, netPayout, gameData) {
  db.prepare(`
    UPDATE games SET
      result = ?,
      gross_payout = ?,
      profit = ?,
      tax_amount = ?,
      net_payout = ?,
      status = 'COMPLETED',
      game_data = ?,
      completed_at = datetime('now')
    WHERE game_id = ?
  `).run(result, grossPayout, profit, taxAmount, netPayout, JSON.stringify(gameData), gameId);
}

/**
 * Get user by Discord ID.
 */
export function getUserByDiscordId(discordUserId) {
  return db.prepare('SELECT * FROM users WHERE discord_user_id = ?').get(discordUserId);
}

/**
 * Create a user.
 */
export function createUser(discordUserId, discordUsername) {
  const result = db.prepare(
    'INSERT INTO users (discord_user_id, discord_username) VALUES (?, ?)'
  ).run(discordUserId, discordUsername);
  return result.lastInsertRowid;
}

/**
 * Link a Minecraft account to a user.
 */
export function linkMinecraftAccount(userId, minecraftUuid, minecraftUsername) {
  // Check if MC account already linked
  const existing = db.prepare('SELECT * FROM minecraft_accounts WHERE minecraft_uuid = ?').get(minecraftUuid);
  if (existing) throw new Error('MINECRAFT_ALREADY_LINKED');

  // Check if user already has a MC account
  const userExisting = db.prepare('SELECT * FROM minecraft_accounts WHERE user_id = ?').get(userId);
  if (userExisting) throw new Error('USER_ALREADY_LINKED');

  db.prepare(`
    INSERT INTO minecraft_accounts (user_id, minecraft_uuid, minecraft_username)
    VALUES (?, ?, ?)
  `).run(userId, minecraftUuid, minecraftUsername);
}

/**
 * Unlink Minecraft account.
 */
export function unlinkMinecraftAccount(userId) {
  db.prepare('DELETE FROM minecraft_accounts WHERE user_id = ?').run(userId);
}

/**
 * Get Minecraft account for a user.
 */
export function getMinecraftAccount(userId) {
  return db.prepare('SELECT * FROM minecraft_accounts WHERE user_id = ?').get(userId);
}

/**
 * Get Minecraft account by UUID.
 */
export function getMinecraftAccountByUuid(uuid) {
  return db.prepare('SELECT * FROM minecraft_accounts WHERE minecraft_uuid = ?').get(uuid);
}

/**
 * Get bot setting.
 */
export function getSetting(key) {
  const row = db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Set bot setting.
 */
export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO bot_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
}

/**
 * Get channel setting.
 */
export function getChannelSetting(guildId, settingType) {
  return db.prepare('SELECT channel_id FROM channel_settings WHERE guild_id = ? AND setting_type = ?')
    .get(guildId, settingType);
}

/**
 * Set channel setting.
 */
export function setChannelSetting(guildId, settingType, channelId) {
  db.prepare(`
    INSERT INTO channel_settings (guild_id, setting_type, channel_id, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id, setting_type) DO UPDATE SET channel_id = excluded.channel_id, updated_at = datetime('now')
  `).run(guildId, settingType, channelId);
}

/**
 * Record audit log.
 */
export function recordAuditLog(eventType, discordUserId, minecraftUuid, referenceId, amount, status, details) {
  db.prepare(`
    INSERT INTO audit_logs (event_type, discord_user_id, minecraft_uuid, reference_id, amount, status, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(eventType, discordUserId, minecraftUuid, referenceId, amount, status, details);
}

/**
 * Get transaction history for a user.
 */
export function getTransactionHistory(userId, limit = 10, offset = 0) {
  return db.prepare(`
    SELECT * FROM wallet_transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
}

/**
 * Get game history for a user.
 */
export function getGameHistory(userId, limit = 10, offset = 0) {
  return db.prepare(`
    SELECT * FROM games
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
}

/**
 * Count total transactions for pagination.
 */
export function countTransactions(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM wallet_transactions WHERE user_id = ?').get(userId).count;
}

/**
 * Count total games for pagination.
 */
export function countGames(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM games WHERE user_id = ?').get(userId).count;
}

/**
 * Get rate limit info.
 */
export function getRateLimit(userId, action) {
  return db.prepare('SELECT * FROM rate_limits WHERE user_id = ? AND action = ?').get(userId, action);
}

/**
 * Update rate limit.
 */
export function updateRateLimit(userId, action, amount = 0) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO rate_limits (user_id, action, daily_count, daily_amount, reset_date)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(user_id, action) DO UPDATE SET
      last_used = datetime('now'),
      daily_count = CASE WHEN reset_date = ? THEN daily_count + 1 ELSE 1 END,
      daily_amount = CASE WHEN reset_date = ? THEN daily_amount + ? ELSE ? END,
      reset_date = CASE WHEN reset_date = ? THEN reset_date ELSE ? END
  `).run(userId, action, amount, today, today, today, amount, amount, today, today);
}

/**
 * Reset daily rate limits if day has changed.
 */
export function resetDailyLimits() {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    UPDATE rate_limits SET daily_count = 0, daily_amount = 0, reset_date = ?
    WHERE reset_date != ?
  `).run(today, today);
}

/**
 * Get stale processing transactions for recovery.
 */
export function getStaleTransactions(minutesOld = 10) {
  return db.prepare(`
    SELECT * FROM wallet_transactions
    WHERE status = 'PROCESSING'
    AND created_at < datetime('now', ? || ' minutes')
  `).all(`-${minutesOld}`);
}

/**
 * Get stale processing games for recovery.
 */
export function getStaleGames(minutesOld = 10) {
  return db.prepare(`
    SELECT * FROM games
    WHERE status = 'PROCESSING'
    AND created_at < datetime('now', ? || ' minutes')
  `).all(`-${minutesOld}`);
}

/**
 * Get stale processing withdrawals for recovery.
 */
export function getStaleWithdrawals(minutesOld = 10) {
  return db.prepare(`
    SELECT * FROM withdrawals
    WHERE status = 'PROCESSING'
    AND created_at < datetime('now', ? || ' minutes')
  `).all(`-${minutesOld}`);
}

/**
 * Check if big win was already announced.
 */
export function isBigWinAnnounced(gameId) {
  return db.prepare('SELECT 1 FROM big_win_announcements WHERE game_id = ?').get(gameId);
}

/**
 * Record big win announcement.
 */
export function recordBigWinAnnouncement(gameId, channelId, messageId) {
  db.prepare(`
    INSERT INTO big_win_announcements (game_id, channel_id, message_id)
    VALUES (?, ?, ?)
  `).run(gameId, channelId, messageId);
}

/**
 * Get all users (for admin).
 */
export function getAllUsers(limit = 50, offset = 0) {
  return db.prepare(`
    SELECT u.*, w.balance, w.games_played, w.wins, w.losses
    FROM users u
    LEFT JOIN wallets w ON w.user_id = u.id
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * Get full user profile.
 */
export function getUserProfile(discordUserId) {
  const user = db.prepare('SELECT * FROM users WHERE discord_user_id = ?').get(discordUserId);
  if (!user) return null;

  const wallet = getOrCreateWallet(user.id);
  const mcAccount = getMinecraftAccount(user.id);

  return { user, wallet, mcAccount };
}
