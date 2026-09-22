/**
 * DonutSMP Bot - Gambling Engine
 * Handles all gambling games with atomic transactions.
 * Every game uses the same wallet/transaction system and tax calculation.
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import config from './config.js';
import { createLogger } from './logger.js';
import * as db from './database.js';
import { calculateGameTax, validateBetAmount, formatMoney, calculateGameResult } from './economy.js';
import {
  generateServerSeed, hashServerSeed, provableCoinflip,
  provableDiceRoll, provableRoulette, provableCrash,
  provableRandomInt, generateClientSeed
} from './provably-fair.js';
import { checkCooldown, updateCooldown, checkDailyWager, updateDailyWager } from './security.js';

const log = createLogger('gambling');

/**
 * Base game executor. All games follow the same pattern:
 * 1. Validate inputs
 * 2. Check cooldowns and limits
 * 3. Reserve bet amount
 * 4. Generate provably fair result
 * 5. Calculate tax on profit
 * 6. Update wallet atomically
 * 7. Record game
 * 8. Check for big win
 */
async function executeGame(userId, discordUserId, gameType, betAmount, gameLogic) {
  // Validate bet
  validateBetAmount(betAmount);

  // Check cooldown
  checkCooldown(discordUserId, gameType, config.COINFLIP_COOLDOWN_SECONDS);

  // Check daily wager limit
  checkDailyWager(discordUserId, betAmount);

  // Check maintenance mode
  const maintenance = db.getSetting('maintenance_mode');
  if (maintenance === 'true') {
    throw new Error('MAINTENANCE: Gambling is currently disabled for maintenance.');
  }

  // Get wallet
  const wallet = db.getWalletByDiscordId(discordUserId);
  if (!wallet) throw new Error('WALLET_NOT_FOUND: Please link your account first with /link');

  // Check balance
  if (wallet.balance < betAmount) {
    throw new Error(`INSUFFICIENT_BALANCE: You need ${formatMoney(betAmount)} but only have ${formatMoney(wallet.balance)}`);
  }

  // Generate game ID and seeds
  const gameId = uuidv4();
  const serverSeed = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const clientSeed = generateClientSeed();
  const nonce = Date.now();

  // Reserve the bet
  const { transactionId: reservationTxnId } = db.reserveBet(userId, betAmount);

  try {
    // Record game start
    db.createGameRecord(userId, gameType, betAmount, gameId, serverSeedHash, clientSeed, nonce);

    // Execute game-specific logic
    const { won, grossPayout, gameData } = gameLogic(serverSeed, clientSeed, nonce, betAmount);

    // Calculate result
    const { finalBalance, profit, taxAmount, netProfit } = calculateGameResult(
      wallet.balance, betAmount, won, grossPayout
    );

    // Complete the bet atomically
    db.completeBet(
      userId, reservationTxnId,
      won ? 'WIN' : 'LOSS',
      betAmount,
      grossPayout, profit, taxAmount, netProfit,
      { gameId, ...gameData }
    );

    // Update game record
    db.completeGameRecord(
      gameId,
      won ? 'WIN' : 'LOSS',
      grossPayout, profit, taxAmount, netProfit,
      { ...gameData, serverSeed, clientSeed, nonce }
    );

    // Update cooldown and daily wager
    updateCooldown(discordUserId, gameType);
    updateDailyWager(discordUserId, betAmount);

    // Record audit log
    db.recordAuditLog(
      'GAME_COMPLETED',
      discordUserId, null, gameId,
      betAmount, won ? 'WIN' : 'LOSS',
      JSON.stringify({ gameType, grossPayout, taxAmount, netProfit })
    );

    // Check for big win
    let bigWinAnnounced = false;
    if (won && netProfit >= config.BIG_WIN_THRESHOLD) {
      bigWinAnnounced = await announceBigWin(gameId, discordUserId, gameType, betAmount, grossPayout, profit, taxAmount, netProfit, finalBalance);
    }

    return {
      gameId,
      gameType,
      won,
      betAmount,
      grossPayout,
      profit,
      taxAmount,
      netProfit,
      finalBalance,
      serverSeedHash,
      serverSeed, // Revealed after game
      clientSeed,
      nonce,
      gameData,
      bigWinAnnounced,
    };
  } catch (error) {
    // On error, refund the reservation
    log.error({ error, gameId, userId }, 'Game execution failed, refunding');
    try {
      // Release the reservation by adding back the bet
      const currentWallet = db.getOrCreateWallet(userId);
      const refundTxnId = `REFUND-${gameId}-${Date.now()}`;
      const { getDb } = await import('./database.js');
      const database = getDb();
      
      database.prepare(`
        INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
        VALUES (?, ?, ?, 'REFUND', ?, ?, ?, 'COMPLETED', 'GAME', ?, 'Game error refund')
      `).run(refundTxnId, userId, currentWallet.id, betAmount, currentWallet.balance, currentWallet.balance + betAmount, gameId);

      database.prepare('UPDATE wallets SET balance = balance + ? WHERE user_id = ?')
        .run(betAmount, userId);

      // Mark game as failed
      db.completeGameRecord(gameId, 'FAILED', 0, 0, 0, 0, { error: error.message });
    } catch (refundError) {
      log.error({ refundError, gameId }, 'CRITICAL: Failed to refund after game error');
    }
    throw error;
  }
}

/**
 * Announce a big win in the configured channel.
 */
async function announceBigWin(gameId, discordUserId, gameType, betAmount, grossPayout, profit, taxAmount, netProfit, finalBalance) {
  // Check if already announced
  if (db.isBigWinAnnounced(gameId)) return false;

  const winChannelId = db.getSetting('win_channel_id');
  if (!winChannelId) return false;

  try {
    const { getChannel } = await import('./events.js');
    const channel = getChannel(winChannelId);
    if (!channel) return false;

    const { EmbedBuilder } = await import('discord.js');
    const embed = new EmbedBuilder()
      .setTitle('🎉 BIG WIN! 🎉')
      .setColor(0xFFD700)
      .setDescription(`A player just won a massive amount!`)
      .addFields(
        { name: '🎮 Game', value: gameType.charAt(0).toUpperCase() + gameType.slice(1), inline: true },
        { name: '💰 Bet', value: formatMoney(betAmount), inline: true },
        { name: '📊 Gross Payout', value: formatMoney(grossPayout), inline: true },
        { name: '📈 Gross Profit', value: formatMoney(profit), inline: true },
        { name: `🏛️ Game Tax (${config.GAME_TAX_PERCENT}%)`, value: formatMoney(taxAmount), inline: true },
        { name: '💵 Net Profit', value: formatMoney(netProfit), inline: true },
        { name: '🏦 Final Wallet', value: formatMoney(finalBalance), inline: true },
        { name: '🎫 Game ID', value: `\`${gameId.slice(0, 8)}...\``, inline: false },
      )
      .setTimestamp()
      .setFooter({ text: 'DonutSMP Economy' });

    const message = await channel.send({
      content: `<@${discordUserId}> just hit a BIG WIN!`,
      embeds: [embed],
    });

    db.recordBigWinAnnouncement(gameId, winChannelId, message.id);
    return true;
  } catch (error) {
    log.error({ error, gameId }, 'Failed to announce big win');
    return false;
  }
}

// ============================================================
// GAME IMPLEMENTATIONS
// ============================================================

/**
 * Coinflip game.
 * Player picks HEADS or TAILS. 2x payout on win.
 */
export async function playCoinflip(userId, discordUserId, betAmount, choice) {
  if (!['HEADS', 'TAILS'].includes(choice)) {
    throw new Error('INVALID_CHOICE: Please choose HEADS or TAILS');
  }

  return executeGame(userId, discordUserId, 'coinflip', betAmount, (serverSeed, clientSeed, nonce) => {
    const result = provableCoinflip(serverSeed, clientSeed, nonce);
    const won = result === choice;
    const grossPayout = won ? betAmount * 2 : 0;

    return {
      won,
      grossPayout,
      gameData: { choice, result },
    };
  });
}

/**
 * Dice game.
 * Player picks a number 1-6. 6x payout on win.
 */
export async function playDice(userId, discordUserId, betAmount, chosenNumber) {
  if (chosenNumber < 1 || chosenNumber > 6 || !Number.isInteger(chosenNumber)) {
    throw new Error('INVALID_CHOICE: Please choose a number between 1 and 6');
  }

  return executeGame(userId, discordUserId, 'dice', betAmount, (serverSeed, clientSeed, nonce) => {
    const result = provableDiceRoll(serverSeed, clientSeed, nonce);
    const won = result === chosenNumber;
    const grossPayout = won ? betAmount * 6 : 0;

    return {
      won,
      grossPayout,
      gameData: { chosenNumber, result },
    };
  });
}

/**
 * Roulette game.
 * Player bets on red/black/green or a specific number.
 */
export async function playRoulette(userId, discordUserId, betAmount, betType, betValue) {
  const validTypes = ['red', 'black', 'green', 'number', 'odd', 'even'];
  if (!validTypes.includes(betType)) {
    throw new Error('INVALID_BET_TYPE: Choose red, black, green, number, odd, or even');
  }

  return executeGame(userId, discordUserId, 'roulette', betAmount, (serverSeed, clientSeed, nonce) => {
    const result = provableRoulette(serverSeed, clientSeed, nonce);
    const color = result === 0 ? 'green' : (result % 2 === 0 ? 'black' : 'red');
    const isOdd = result !== 0 && result % 2 !== 0;

    let won = false;
    let multiplier = 0;

    switch (betType) {
      case 'red':
        won = color === 'red';
        multiplier = 2;
        break;
      case 'black':
        won = color === 'black';
        multiplier = 2;
        break;
      case 'green':
        won = color === 'green';
        multiplier = 14; // 0 pays 14x
        break;
      case 'number':
        won = result === betValue;
        multiplier = 36; // Straight number pays 36x
        break;
      case 'odd':
        won = isOdd;
        multiplier = 2;
        break;
      case 'even':
        won = !isOdd && result !== 0;
        multiplier = 2;
        break;
    }

    const grossPayout = won ? betAmount * multiplier : 0;

    return {
      won,
      grossPayout,
      gameData: { betType, betValue, result, color },
    };
  });
}

/**
 * High/Low game.
 * Player guesses if next number is higher or lower than 50 (1-100 range).
 */
export async function playHighLow(userId, discordUserId, betAmount, choice) {
  if (!['HIGH', 'LOW', 'SEVEN'].includes(choice)) {
    throw new Error('INVALID_CHOICE: Choose HIGH, LOW, or SEVEN');
  }

  return executeGame(userId, discordUserId, 'highlow', betAmount, (serverSeed, clientSeed, nonce) => {
    const result = provableRandomInt(serverSeed, clientSeed, nonce, 1, 100);
    let won = false;
    let multiplier = 0;

    if (choice === 'HIGH') {
      won = result > 50;
      multiplier = 2;
    } else if (choice === 'LOW') {
      won = result < 50;
      multiplier = 2;
    } else if (choice === 'SEVEN') {
      // Betting on exactly 7 - higher payout
      won = result === 7;
      multiplier = 10;
    }

    const grossPayout = won ? betAmount * multiplier : 0;

    return {
      won,
      grossPayout,
      gameData: { choice, result },
    };
  });
}

/**
 * Crash game.
 * Player sets a cashout multiplier. If crash point is above cashout, they win.
 * Payout = bet * cashoutMultiplier
 */
export async function playCrash(userId, discordUserId, betAmount, cashoutAt) {
  if (cashoutAt < 1.01 || cashoutAt > 100) {
    throw new Error('INVALID_CASHOUT: Cashout must be between 1.01x and 100x');
  }

  return executeGame(userId, discordUserId, 'crash', betAmount, (serverSeed, clientSeed, nonce) => {
    const crashPoint = provableCrash(serverSeed, clientSeed, nonce);
    const won = crashPoint >= cashoutAt;
    const grossPayout = won ? Math.floor(betAmount * cashoutAt) : 0;

    return {
      won,
      grossPayout,
      gameData: { cashoutAt, crashPoint: crashPoint.toFixed(2) },
    };
  });
}

/**
 * Verify a game result.
 */
export function verifyGame(gameId) {
  const { getDb } = db;
  const database = getDb();
  const game = database.prepare('SELECT * FROM games WHERE game_id = ?').get(gameId);
  if (!game) throw new Error('GAME_NOT_FOUND');
  if (game.status !== 'COMPLETED') throw new Error('GAME_NOT_COMPLETED');

  const gameData = JSON.parse(game.game_data || '{}');
  const { serverSeed, clientSeed, nonce } = gameData;

  if (!serverSeed) throw new Error('SERVER_SEED_NOT_AVAILABLE');

  // Verify hash
  const computedHash = hashServerSeed(serverSeed);
  const hashValid = computedHash === game.server_seed_hash;

  // Recompute result
  let result;
  switch (game.game_type) {
    case 'coinflip':
      result = provableCoinflip(serverSeed, clientSeed, nonce);
      break;
    case 'dice':
      result = provableDiceRoll(serverSeed, clientSeed, nonce);
      break;
    case 'roulette':
      result = provableRoulette(serverSeed, clientSeed, nonce);
      break;
    case 'crash':
      result = provableCrash(serverSeed, clientSeed, nonce);
      break;
    case 'highlow':
      result = provableRandomInt(serverSeed, clientSeed, nonce, 1, 100);
      break;
    default:
      throw new Error('UNKNOWN_GAME_TYPE');
  }

  return {
    gameId,
    gameType: game.game_type,
    hashValid,
    serverSeedHash: game.server_seed_hash,
    serverSeed,
    clientSeed,
    nonce,
    result,
    expected: gameData.result || gameData.choice || gameData.chosenNumber || gameData.betValue,
    verified: hashValid,
  };
}
