/**
 * DonutSMP Bot - Database Module
 * SQLite database with automatic schema creation, migrations, and backups.
 * All monetary operations use atomic transactions.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
    },
    {
      name: '003_rewards_and_giveaways',
      sql: `
        -- Promo/redeem codes
        CREATE TABLE IF NOT EXISTS promo_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code TEXT NOT NULL UNIQUE,
          amount INTEGER NOT NULL,
          max_uses INTEGER NOT NULL DEFAULT 1,
          per_user_limit INTEGER NOT NULL DEFAULT 1,
          current_uses INTEGER NOT NULL DEFAULT 0,
          min_account_age_days INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          expires_at TEXT,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Code redemptions
        CREATE TABLE IF NOT EXISTS code_redemptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          code_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          transaction_id TEXT NOT NULL,
          redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (code_id) REFERENCES promo_codes(id),
          UNIQUE(code_id, user_id)
        );

        -- Invite/referral tracking
        CREATE TABLE IF NOT EXISTS invites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          inviter_user_id INTEGER NOT NULL,
          invitee_discord_id TEXT NOT NULL UNIQUE,
          invitee_user_id INTEGER,
          eligible INTEGER NOT NULL DEFAULT 0,
          reward_claimed INTEGER NOT NULL DEFAULT 0,
          joined_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (inviter_user_id) REFERENCES users(id)
        );

        -- Rakeback tracking
        CREATE TABLE IF NOT EXISTS rakeback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL UNIQUE,
          total_wagered INTEGER NOT NULL DEFAULT 0,
          total_rakeback INTEGER NOT NULL DEFAULT 0,
          last_claimed_at TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- Giveaways
        CREATE TABLE IF NOT EXISTS giveaways (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          giveaway_id TEXT NOT NULL UNIQUE,
          guild_id TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          message_id TEXT,
          prize TEXT NOT NULL,
          amount INTEGER NOT NULL DEFAULT 0,
          winners_count INTEGER NOT NULL DEFAULT 1,
          min_wagered INTEGER NOT NULL DEFAULT 0,
          min_games INTEGER NOT NULL DEFAULT 0,
          min_balance INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'ENDED', 'CANCELLED')),
          ends_at TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          ended_at TEXT
        );

        -- Giveaway entries
        CREATE TABLE IF NOT EXISTS giveaway_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          giveaway_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          entered_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (giveaway_id) REFERENCES giveaways(giveaway_id),
          UNIQUE(giveaway_id, user_id)
        );

        -- Giveaway winners
        CREATE TABLE IF NOT EXISTS giveaway_winners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          giveaway_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          amount INTEGER NOT NULL DEFAULT 0,
          transaction_id TEXT,
          awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (giveaway_id) REFERENCES giveaways(giveaway_id)
        );

        -- Active game sessions (for interactive games like blackjack, mines)
        CREATE TABLE IF NOT EXISTS active_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL UNIQUE,
          user_id INTEGER NOT NULL,
          game_type TEXT NOT NULL,
          game_id TEXT NOT NULL,
          bet_amount INTEGER NOT NULL,
          session_data TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT NOT NULL,
          FOREIGN KEY (game_id) REFERENCES games(game_id)
        );

        -- Role sync configuration
        CREATE TABLE IF NOT EXISTS role_sync_config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL,
          role_id TEXT NOT NULL,
          requirement_type TEXT NOT NULL,
          requirement_value INTEGER NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(guild_id, role_id)
        );

        -- Indexes for new tables
        CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
        CREATE INDEX IF NOT EXISTS idx_code_redemptions_user ON code_redemptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_user_id);
        CREATE INDEX IF NOT EXISTS idx_invites_invitee ON invites(invitee_discord_id);
        CREATE INDEX IF NOT EXISTS idx_giveaways_status ON giveaways(status);
        CREATE INDEX IF NOT EXISTS idx_giveaway_entries_giveaway ON giveaway_entries(giveaway_id);
        CREATE INDEX IF NOT EXISTS idx_active_sessions_user ON active_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_active_sessions_status ON active_sessions(status);
      `
    },
    {
      name: '004_game_settings',
      sql: `
        -- Per-game enabled/disabled settings
        CREATE TABLE IF NOT EXISTS game_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_type TEXT NOT NULL UNIQUE,
          enabled INTEGER NOT NULL DEFAULT 1,
          min_bet INTEGER,
          max_bet INTEGER,
          house_edge INTEGER NOT NULL DEFAULT 0,
          cooldown_seconds INTEGER NOT NULL DEFAULT 5,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Insert default game settings
        INSERT OR IGNORE INTO game_settings (game_type, enabled, cooldown_seconds) VALUES
          ('coinflip', 1, 5),
          ('blackjack', 1, 10),
          ('roulette', 1, 5),
          ('slots', 1, 3),
          ('dice', 1, 5),
          ('chicken', 1, 5),
          ('keno', 1, 10),
          ('limbo', 1, 5),
          ('mines', 1, 10),
          ('tower', 1, 10),
          ('highlow', 1, 5),
          ('crash', 1, 5);
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

// ============================================================
// EXTENDED FEATURES - Rewards, Giveaways, Sessions
// ============================================================

/**
 * Get balance leaderboard (for /baltop).
 */
export function getBalanceLeaderboard(limit = 10, offset = 0) {
  return db.prepare(`
    SELECT u.discord_user_id, w.balance, w.games_played, w.total_wagered
    FROM wallets w
    JOIN users u ON u.id = w.user_id
    ORDER BY w.balance DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

/**
 * Count total users with wallets.
 */
export function countWalletUsers() {
  return db.prepare('SELECT COUNT(*) as count FROM wallets').get().count;
}

/**
 * Process a user-to-user payment (atomic).
 */
export function processPayment(senderUserId, recipientUserId, amount) {
  const payment = db.transaction(() => {
    const senderWallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(senderUserId);
    const recipientWallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(recipientUserId);

    if (!senderWallet) throw new Error('Sender wallet not found');
    if (!recipientWallet) throw new Error('Recipient wallet not found');
    if (senderWallet.balance < amount) throw new Error('INSUFFICIENT_BALANCE');
    if (senderUserId === recipientUserId) throw new Error('SELF_PAYMENT');

    const txnId = `PAY-${senderUserId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Deduct from sender
    const senderNewBalance = senderWallet.balance - amount;
    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
      VALUES (?, ?, ?, 'WITHDRAW', ?, ?, ?, 'COMPLETED', 'PAYMENT', ?, 'Payment sent')
    `).run(txnId, senderUserId, senderWallet.id, -amount, senderWallet.balance, senderNewBalance, txnId);
    db.prepare('UPDATE wallets SET balance = ? WHERE id = ?').run(senderNewBalance, senderWallet.id);

    // Credit to recipient
    const recipientNewBalance = recipientWallet.balance + amount;
    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
      VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, 'COMPLETED', 'PAYMENT', ?, 'Payment received')
    `).run(txnId + '-R', recipientUserId, recipientWallet.id, amount, recipientWallet.balance, recipientNewBalance, txnId);
    db.prepare('UPDATE wallets SET balance = ? WHERE id = ?').run(recipientNewBalance, recipientWallet.id);

    return { transactionId: txnId, senderNewBalance, recipientNewBalance };
  });

  return payment();
}

/**
 * Check if a user has an active game session.
 */
export function hasActiveSession(userId) {
  return db.prepare(`
    SELECT * FROM active_sessions
    WHERE user_id = ? AND status = 'ACTIVE' AND expires_at > datetime('now')
    LIMIT 1
  `).get(userId);
}

/**
 * Create an active game session.
 */
export function createSession(userId, gameType, gameId, betAmount, sessionData, expiresMinutes = 5) {
  const sessionId = `SES-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO active_sessions (session_id, user_id, game_type, game_id, bet_amount, session_data, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ? || ' minutes'))
  `).run(sessionId, userId, gameType, gameId, betAmount, JSON.stringify(sessionData), expiresMinutes);
  return sessionId;
}

/**
 * Get an active session.
 */
export function getSession(sessionId) {
  return db.prepare(`
    SELECT * FROM active_sessions
    WHERE session_id = ? AND status = 'ACTIVE' AND expires_at > datetime('now')
  `).get(sessionId);
}

/**
 * Update session data.
 */
export function updateSession(sessionId, sessionData) {
  db.prepare('UPDATE active_sessions SET session_data = ? WHERE session_id = ?')
    .run(JSON.stringify(sessionData), sessionId);
}

/**
 * Complete a session.
 */
export function completeSession(sessionId) {
  db.prepare("UPDATE active_sessions SET status = 'COMPLETED' WHERE session_id = ?").run(sessionId);
}

/**
 * Cancel a session.
 */
export function cancelSession(sessionId) {
  db.prepare("UPDATE active_sessions SET status = 'CANCELLED' WHERE session_id = ?").run(sessionId);
}

/**
 * Get game setting.
 */
export function getGameSetting(gameType) {
  return db.prepare('SELECT * FROM game_settings WHERE game_type = ?').get(gameType);
}

/**
 * Check if a game is enabled.
 */
export function isGameEnabled(gameType) {
  const setting = getGameSetting(gameType);
  if (!setting) return true; // Default enabled
  return setting.enabled === 1;
}

/**
 * Set game enabled/disabled.
 */
export function setGameEnabled(gameType, enabled) {
  db.prepare(`
    INSERT INTO game_settings (game_type, enabled) VALUES (?, ?)
    ON CONFLICT(game_type) DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')
  `).run(gameType, enabled ? 1 : 0);
}

/**
 * Get all game settings.
 */
export function getAllGameSettings() {
  return db.prepare('SELECT * FROM game_settings ORDER BY game_type').all();
}

/**
 * Create a promo code.
 */
export function createPromoCode(code, amount, maxUses, perUserLimit, minAccountAgeDays, expiresAt, createdBy) {
  db.prepare(`
    INSERT INTO promo_codes (code, amount, max_uses, per_user_limit, min_account_age_days, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(code.toUpperCase(), amount, maxUses, perUserLimit, minAccountAgeDays, expiresAt, createdBy);
}

/**
 * Get a promo code.
 */
export function getPromoCode(code) {
  return db.prepare('SELECT * FROM promo_codes WHERE code = ?').get(code.toUpperCase());
}

/**
 * Redeem a promo code (atomic).
 */
export function redeemPromoCode(userId, code, discordUserId) {
  const redeem = db.transaction(() => {
    const promo = db.prepare('SELECT * FROM promo_codes WHERE code = ? AND enabled = 1').get(code.toUpperCase());
    if (!promo) throw new Error('CODE_NOT_FOUND');
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) throw new Error('CODE_EXPIRED');
    if (promo.current_uses >= promo.max_uses) throw new Error('CODE_MAXED_OUT');

    // Check per-user limit
    const userRedemptions = db.prepare(
      'SELECT COUNT(*) as count FROM code_redemptions WHERE code_id = ? AND user_id = ?'
    ).get(promo.id, userId).count;
    if (userRedemptions >= promo.per_user_limit) throw new Error('ALREADY_REDEEMED');

    // Check account age
    if (promo.min_account_age_days > 0) {
      const user = db.prepare('SELECT created_at FROM users WHERE id = ?').get(userId);
      const accountAge = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (accountAge < promo.min_account_age_days) {
        throw new Error(`ACCOUNT_TOO_YOUNG: Account must be at least ${promo.min_account_age_days} days old`);
      }
    }

    // Credit the wallet
    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
    if (!wallet) throw new Error('WALLET_NOT_FOUND');

    const txnId = `REDEEM-${code}-${userId}-${Date.now()}`;
    const newBalance = wallet.balance + promo.amount;

    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
      VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, 'COMPLETED', 'PROMO', ?, 'Promo code redemption')
    `).run(txnId, userId, wallet.id, promo.amount, wallet.balance, newBalance, promo.code);

    db.prepare('UPDATE wallets SET balance = ? WHERE id = ?').run(newBalance, wallet.id);

    // Record redemption
    db.prepare('INSERT INTO code_redemptions (code_id, user_id, amount, transaction_id) VALUES (?, ?, ?, ?)')
      .run(promo.id, userId, promo.amount, txnId);

    // Update usage count
    db.prepare('UPDATE promo_codes SET current_uses = current_uses + 1 WHERE id = ?').run(promo.id);

    return { transactionId: txnId, amount: promo.amount, newBalance };
  });

  return redeem();
}

/**
 * Record an invite.
 */
export function recordInvite(inviterUserId, inviteeDiscordId) {
  // Check for self-referral
  const inviter = db.prepare('SELECT discord_user_id FROM users WHERE id = ?').get(inviterUserId);
  if (inviter && inviter.discord_user_id === inviteeDiscordId) {
    throw new Error('SELF_REFERRAL');
  }

  // Check if already invited
  const existing = db.prepare('SELECT * FROM invites WHERE invitee_discord_id = ?').get(inviteeDiscordId);
  if (existing) throw new Error('ALREADY_INVITED');

  db.prepare('INSERT INTO invites (inviter_user_id, invitee_discord_id) VALUES (?, ?)')
    .run(inviterUserId, inviteeDiscordId);
}

/**
 * Get invites for a user.
 */
export function getUserInvites(userId) {
  return db.prepare(`
    SELECT i.*, u.discord_user_id as invitee_discord
    FROM invites i
    LEFT JOIN users u ON u.id = i.invitee_user_id
    WHERE i.inviter_user_id = ?
    ORDER BY i.joined_at DESC
  `).all(userId);
}

/**
 * Get rakeback info for a user.
 */
export function getRakebackInfo(userId) {
  return db.prepare('SELECT * FROM rakeback WHERE user_id = ?').get(userId);
}

/**
 * Update rakeback tracking.
 */
export function updateRakebackWagered(userId, wagerAmount) {
  db.prepare(`
    INSERT INTO rakeback (user_id, total_wagered) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET total_wagered = total_wagered + excluded.total_wagered
  `).run(userId, wagerAmount);
}

/**
 * Claim rakeback (atomic).
 */
export function claimRakeback(userId, rakebackPercent) {
  const claim = db.transaction(() => {
    const rakeback = db.prepare('SELECT * FROM rakeback WHERE user_id = ?').get(userId);
    if (!rakeback || rakeback.total_wagered === 0) throw new Error('NO_RAKEBACK');

    const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
    const rakebackAmount = Math.floor(rakeback.total_wagered * rakebackPercent / 100);

    if (rakebackAmount <= 0) throw new Error('NO_RAKEBACK');

    const txnId = `RAKE-${userId}-${Date.now()}`;
    const newBalance = wallet.balance + rakebackAmount;

    db.prepare(`
      INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
      VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, 'COMPLETED', 'RAKEBACK', ?, 'Rakeback claim')
    `).run(txnId, userId, wallet.id, rakebackAmount, wallet.balance, newBalance, txnId);

    db.prepare('UPDATE wallets SET balance = ? WHERE id = ?').run(newBalance, wallet.id);
    db.prepare('UPDATE rakeback SET total_wagered = 0, total_rakeback = total_rakeback + ?, last_claimed_at = datetime(\'now\') WHERE user_id = ?')
      .run(rakebackAmount, userId);

    return { transactionId: txnId, amount: rakebackAmount, newBalance };
  });

  return claim();
}

/**
 * Create a giveaway.
 */
export function createGiveaway(giveawayId, guildId, channelId, prize, amount, winnersCount, minWagered, minGames, minBalance, endsAt, createdBy) {
  db.prepare(`
    INSERT INTO giveaways (giveaway_id, guild_id, channel_id, prize, amount, winners_count, min_wagered, min_games, min_balance, ends_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(giveawayId, guildId, channelId, prize, amount, winnersCount, minWagered, minGames, minBalance, endsAt, createdBy);
}

/**
 * Enter a giveaway.
 */
export function enterGiveaway(giveawayId, userId) {
  const giveaway = db.prepare('SELECT * FROM giveaways WHERE giveaway_id = ? AND status = \'ACTIVE\'').get(giveawayId);
  if (!giveaway) throw new Error('GIVEAWAY_NOT_FOUND');
  if (new Date(giveaway.ends_at) < new Date()) throw new Error('GIVEAWAY_ENDED');

  // Check requirements
  const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (wallet) {
    if (wallet.total_wagered < giveaway.min_wagered) throw new Error('MIN_WAGER_NOT_MET');
    if (wallet.games_played < giveaway.min_games) throw new Error('MIN_GAMES_NOT_MET');
    if (wallet.balance < giveaway.min_balance) throw new Error('MIN_BALANCE_NOT_MET');
  }

  db.prepare('INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id) VALUES (?, ?)')
    .run(giveawayId, userId);
}

/**
 * End a giveaway and select winners.
 */
export function endGiveaway(giveawayId) {
  const giveaway = db.prepare('SELECT * FROM giveaways WHERE giveaway_id = ?').get(giveawayId);
  if (!giveaway) throw new Error('GIVEAWAY_NOT_FOUND');

  const entries = db.prepare('SELECT * FROM giveaway_entries WHERE giveaway_id = ?').all(giveawayId);
  if (entries.length === 0) {
    db.prepare("UPDATE giveaways SET status = 'ENDED', ended_at = datetime('now') WHERE giveaway_id = ?").run(giveawayId);
    return { winners: [] };
  }

  // Secure random winner selection
  const winners = [];
  const remaining = [...entries];

  for (let i = 0; i < Math.min(giveaway.winners_count, remaining.length); i++) {
    const idx = crypto.randomInt(remaining.length);
    winners.push(remaining[idx]);
    remaining.splice(idx, 1);
  }

  // Credit winners
  const amountPerWinner = Math.floor(giveaway.amount / giveaway.winners_count);
  for (const winner of winners) {
    if (amountPerWinner > 0) {
      const wallet = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(winner.user_id);
      const txnId = `GIVEAWAY-${giveawayId}-${winner.user_id}-${Date.now()}`;
      const newBalance = wallet.balance + amountPerWinner;

      db.prepare(`
        INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
        VALUES (?, ?, ?, 'DEPOSIT', ?, ?, ?, 'COMPLETED', 'GIVEAWAY', ?, 'Giveaway win')
      `).run(txnId, winner.user_id, wallet.id, amountPerWinner, wallet.balance, newBalance, giveawayId);

      db.prepare('UPDATE wallets SET balance = ? WHERE id = ?').run(newBalance, wallet.id);

      db.prepare('INSERT INTO giveaway_winners (giveaway_id, user_id, amount, transaction_id) VALUES (?, ?, ?, ?)')
        .run(giveawayId, winner.user_id, amountPerWinner, txnId);
    }
  }

  db.prepare("UPDATE giveaways SET status = 'ENDED', ended_at = datetime('now') WHERE giveaway_id = ?").run(giveawayId);

  return { winners, amountPerWinner };
}

/**
 * Get active giveaways.
 */
export function getActiveGiveaways(guildId) {
  return db.prepare(`
    SELECT * FROM giveaways WHERE guild_id = ? AND status = 'ACTIVE' AND ends_at > datetime('now')
    ORDER BY ends_at ASC
  `).all(guildId);
}

/**
 * Get role sync config.
 */
export function getRoleSyncConfig(guildId) {
  return db.prepare('SELECT * FROM role_sync_config WHERE guild_id = ?').all(guildId);
}

/**
 * Set role sync config.
 */
export function setRoleSyncConfig(guildId, roleId, requirementType, requirementValue) {
  db.prepare(`
    INSERT INTO role_sync_config (guild_id, role_id, requirement_type, requirement_value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, role_id) DO UPDATE SET
      requirement_type = excluded.requirement_type,
      requirement_value = excluded.requirement_value,
      updated_at = datetime('now')
  `).run(guildId, roleId, requirementType, requirementValue);
}

/**
 * Remove role sync config.
 */
export function removeRoleSyncConfig(guildId, roleId) {
  db.prepare('DELETE FROM role_sync_config WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
}
