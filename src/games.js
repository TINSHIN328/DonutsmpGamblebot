/**
 * DonutSMP Bot - Extended Games Module
 * Implements all games: blackjack, slots, chicken, keno, limbo, mines, tower
 * All games use the centralized economy engine with 15% tax on profit.
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import config from './config.js';
import { createLogger } from './logger.js';
import * as db from './database.js';
import { calculateGameTax, validateBetAmount, formatMoney, calculateGameResult } from './economy.js';
import {
  generateServerSeed, hashServerSeed, generateClientSeed,
  provableRandomInt, hashToFloat, generateCombinedSeed
} from './provably-fair.js';
import { checkCooldown, updateCooldown, checkDailyWager, updateDailyWager } from './security.js';

const log = createLogger('games');

// ============================================================
// SHARED GAME ENGINE
// ============================================================

/**
 * Start a game - validates, reserves bet, creates session.
 * Returns game context for interactive games.
 */
function startGame(userId, discordUserId, gameType, betAmount) {
  // Check game enabled
  if (!db.isGameEnabled(gameType)) {
    throw new Error(`GAME_DISABLED: ${gameType} is currently unavailable.`);
  }

  // Validate bet
  validateBetAmount(betAmount);

  // Check cooldown
  const gameSetting = db.getGameSetting(gameType);
  const cooldown = gameSetting?.cooldown_seconds || config.COINFLIP_COOLDOWN_SECONDS;
  checkCooldown(discordUserId, gameType, cooldown);

  // Check daily wager
  checkDailyWager(discordUserId, betAmount);

  // Check maintenance
  if (db.getSetting('maintenance_mode') === 'true') {
    throw new Error('MAINTENANCE: Gambling is currently disabled.');
  }

  // Check for active session
  const existingSession = db.hasActiveSession(userId);
  if (existingSession) {
    throw new Error('ACTIVE_SESSION: You already have an active game. Please finish or wait for it to expire.');
  }

  // Get wallet
  const wallet = db.getWalletByDiscordId(discordUserId);
  if (!wallet) throw new Error('WALLET_NOT_FOUND');
  if (wallet.balance < betAmount) {
    throw new Error(`INSUFFICIENT_BALANCE: You need ${formatMoney(betAmount)} but have ${formatMoney(wallet.balance)}`);
  }

  // Generate game identifiers
  const gameId = uuidv4();
  const serverSeed = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);
  const clientSeed = generateClientSeed();
  const nonce = Date.now();

  // Reserve bet
  const { transactionId: reservationTxnId } = db.reserveBet(userId, betAmount);

  // Record game
  db.createGameRecord(userId, gameType, betAmount, gameId, serverSeedHash, clientSeed, nonce);

  return {
    gameId,
    serverSeed,
    serverSeedHash,
    clientSeed,
    nonce,
    reservationTxnId,
    wallet,
    userId,
    discordUserId,
    betAmount,
  };
}

/**
 * Complete a game with result.
 */
function completeGame(ctx, won, grossPayout, gameData) {
  const { userId, reservationTxnId, betAmount, wallet, gameId, serverSeed, clientSeed, nonce } = ctx;

  const { finalBalance, profit, taxAmount, netProfit } = calculateGameResult(
    wallet.balance, betAmount, won, grossPayout
  );

  // Complete bet atomically
  db.completeBet(userId, reservationTxnId, won ? 'WIN' : 'LOSS', betAmount, grossPayout, profit, taxAmount, netProfit, { gameId, ...gameData });

  // Update game record
  db.completeGameRecord(gameId, won ? 'WIN' : 'LOSS', grossPayout, profit, taxAmount, netProfit, { ...gameData, serverSeed, clientSeed, nonce });

  // Cancel active session
  const session = db.hasActiveSession(userId);
  if (session) db.completeSession(session.session_id);

  // Update cooldown and daily wager
  updateCooldown(ctx.discordUserId, Object.keys(gameData)[0] || 'game');
  updateDailyWager(ctx.discordUserId, betAmount);

  // Update rakeback
  db.updateRakebackWagered(userId, betAmount);

  // Audit log
  db.recordAuditLog('GAME_COMPLETED', ctx.discordUserId, null, gameId, betAmount, won ? 'WIN' : 'LOSS',
    JSON.stringify({ grossPayout, taxAmount, netProfit }));

  return {
    gameId,
    won,
    betAmount,
    grossPayout,
    profit,
    taxAmount,
    netProfit,
    finalBalance,
    serverSeedHash: ctx.serverSeedHash,
    serverSeed,
    clientSeed,
    nonce,
    gameData,
  };
}

/**
 * Cancel/refund a game.
 */
function cancelGame(ctx, reason) {
  const { userId, reservationTxnId, betAmount, gameId, wallet } = ctx;

  // Refund the bet
  const refundTxnId = `CANCEL-${gameId}-${Date.now()}`;
  const database = db.getDb();
  const newBalance = wallet.balance + betAmount;

  database.prepare(`
    INSERT INTO wallet_transactions (transaction_id, user_id, wallet_id, type, amount, balance_before, balance_after, status, reference_type, reference_id, reason)
    VALUES (?, ?, ?, 'REFUND', ?, ?, ?, 'COMPLETED', 'GAME', ?, ?)
  `).run(refundTxnId, userId, wallet.id, betAmount, wallet.balance, newBalance, gameId, reason);

  database.prepare('UPDATE wallets SET balance = ? WHERE user_id = ?').run(newBalance, userId);
  db.completeGameRecord(gameId, 'CANCELLED', 0, 0, 0, 0, { reason });

  const session = db.hasActiveSession(userId);
  if (session) db.cancelSession(session.session_id);
}

// ============================================================
// SIMPLE GAMES (non-interactive)
// ============================================================

/**
 * Coinflip - already implemented in gambling.js, wrapper here.
 */
export async function playCoinflip(userId, discordUserId, betAmount, choice) {
  if (!['HEADS', 'TAILS'].includes(choice)) throw new Error('INVALID_CHOICE');

  const ctx = startGame(userId, discordUserId, 'coinflip', betAmount);

  try {
    const hash = generateCombinedSeed(ctx.serverSeed, ctx.clientSeed, ctx.nonce);
    const result = hashToFloat(hash) < 0.5 ? 'HEADS' : 'TAILS';
    const won = result === choice;
    const grossPayout = won ? betAmount * 2 : 0;

    return completeGame(ctx, won, grossPayout, { coinflip: { choice, result } });
  } catch (error) {
    cancelGame(ctx, error.message);
    throw error;
  }
}

/**
 * Dice - pick a number 1-6, 6x payout.
 */
export async function playDice(userId, discordUserId, betAmount, chosenNumber) {
  if (chosenNumber < 1 || chosenNumber > 6) throw new Error('INVALID_CHOICE');

  const ctx = startGame(userId, discordUserId, 'dice', betAmount);

  try {
    const result = provableRandomInt(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1, 6);
    const won = result === chosenNumber;
    const grossPayout = won ? betAmount * 6 : 0;

    return completeGame(ctx, won, grossPayout, { dice: { chosenNumber, result } });
  } catch (error) {
    cancelGame(ctx, error.message);
    throw error;
  }
}

/**
 * High/Low - guess high or low (1-100).
 */
export async function playHighLow(userId, discordUserId, betAmount, choice) {
  const ctx = startGame(userId, discordUserId, 'highlow', betAmount);

  try {
    const result = provableRandomInt(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 1, 100);
    let won = false;
    let multiplier = 2;

    if (choice === 'HIGH') {
      won = result > 50;
    } else if (choice === 'LOW') {
      won = result < 50;
    } else if (choice === 'SEVEN') {
      won = result === 7;
      multiplier = 10;
    }

    const grossPayout = won ? betAmount * multiplier : 0;
    return completeGame(ctx, won, grossPayout, { highlow: { choice, result } });
  } catch (error) {
    cancelGame(ctx, error.message);
    throw error;
  }
}

/**
 * Crash - set cashout multiplier.
 */
export async function playCrash(userId, discordUserId, betAmount, cashoutAt) {
  const ctx = startGame(userId, discordUserId, 'crash', betAmount);

  try {
    const hash = generateCombinedSeed(ctx.serverSeed, ctx.clientSeed, ctx.nonce);
    const float = hashToFloat(hash);
    const houseEdge = 0.01;
    const crashPoint = float < houseEdge ? 1.0 : Math.min(Math.floor((1 / (1 - float)) * 100) / 100, 100);

    const won = crashPoint >= cashoutAt;
    const grossPayout = won ? Math.floor(betAmount * cashoutAt) : 0;

    return completeGame(ctx, won, grossPayout, { crash: { cashoutAt, crashPoint: crashPoint.toFixed(2) } });
  } catch (error) {
    cancelGame(ctx, error.message);
    throw error;
  }
}

/**
 * Roulette - bet on color/number.
 */
export async function playRoulette(userId, discordUserId, betAmount, betType, betValue) {
  const ctx = startGame(userId, discordUserId, 'roulette', betAmount);

  try {
    const result = provableRandomInt(ctx.serverSeed, ctx.clientSeed, ctx.nonce, 0, 36);
    const color = result === 0 ? 'green' : (result % 2 === 0 ? 'black' : 'red');

    let won = false;
    let multiplier = 0;

    switch (betType) {
      case 'red': won = color === 'red'; multiplier = 2; break;
      case 'black': won = color === 'black'; multiplier = 2; break;
      case 'green': won = result === 0; multiplier = 14; break;
      case 'odd': won = result !== 0 && result % 2 !== 0; multiplier = 2; break;
      case 'even': won = result !== 0 && result % 2 === 0; multiplier = 2; break;
      case 'low': won = result >= 1 && result <= 18; multiplier = 2; break;
      case 'high': won = result >= 19 && result <= 36; multiplier = 2; break;
      case 'number': won = result === betValue; multiplier = 36; break;
    }

    const grossPayout = won ? betAmount * multiplier : 0;
    return completeGame(ctx, won, grossPayout, { roulette: { betType, betValue, result, color } });
  } catch (error) {
    cancelGame(ctx, error.message);
    throw error;
  }
}

// ============================================================
// SLOTS
// ============================================================

const SLOT_SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '⭐', '💎', '7️⃣', '🍩'];
const SLOT_MULTIPLIERS = {
  '7️⃣': 50,
  '💎': 25,
  '⭐': 15,
  '🍩': 10,
  '🍇': 8,
  '🍊': 5,
  '🍋': 3,
  '🍒': 2,
};

export async function playSlots(userId, discordUserId, betAmount) {
  const ctx = startGame(userId, discordUserId, 'slots', betAmount);

  try {
    // Generate 3 reels
    const reels = [];
    for (let i = 0; i < 3; i++) {
      const idx = provableRandomInt(ctx.serverSeed, ctx.clientSeed, ctx.nonce + i, 0, SLOT_SYMBOLS.length - 1);
      reels.push(SLOT_SYMBOLS[idx]);
    }

    let multiplier = 0;
    let won = false;

    // Three of a kind
    if (reels[0] === reels[1] && reels[1] === reels[2]) {
      multiplier = SLOT_MULTIPLIERS[reels[0]] || 2;
      won = true;
    }
    // Two of a kind
    else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
      multiplier = 1.5;
      won = true;
    }

    const grossPayout = won ? Math.floor(betAmount * multiplier) : 0;
    return completeGame(ctx, won, grossPayout, { slots: { reels, multiplier } });
  } catch (error) {
    cancelGame(ctx, error.message);
    throw error;
  }
}

// ============================================================
// LIMBO
// ============================================================

export async function playLimbo(userId, discordUserId, betAmount, targetMultiplier) {
  if (targetMultiplier < 1.01 || targetMultiplier > 1000) {
    throw new Error('INVALID_TARGET: Target multiplier must be between 1.01x and 1000x');
  }

  const ctx = startGame(userId, discordUserId, 'limbo', betAmount);

  try {
    const hash = generateCombinedSeed(ctx.serverSeed, ctx.clientSeed, ctx.nonce);
    const float = hashToFloat(hash);
    const houseEdge = 0.01;

    // Result multiplier
    let resultMultiplier;
    if (float < houseEdge) {
      resultMultiplier = 1.0;
    } else {
      resultMultiplier = Math.floor((1 / (1 - float)) * 100) / 100;
      resultMultiplier = Math.min(resultMultiplier, 1000);
    }

    const won = resultMultiplier >= targetMultiplier;
    const grossPayout = won ? Math.floor(betAmount * targetMultiplier) : 0;

    return completeGame(ctx, won, grossPayout, {
      limbo: { targetMultiplier, resultMultiplier: resultMultiplier.toFixed(2) }
    });
  } catch (error) {
    cancelGame(ctx, error.message);
    throw error;
  }
}

// ============================================================
// KENO
// ============================================================

export async function playKeno(userId, discordUserId, betAmount, selectedNumbers) {
  if (!Array.isArray(selectedNumbers) || selectedNumbers.length < 1 || selectedNumbers.length > 10) {
    throw new Error('INVALID_SELECTION: Select 1-10 numbers between 1-40');
  }

  for (const num of selectedNumbers) {
    if (!Number.isInteger(num) || num < 1 || num > 40) {
      throw new Error('INVALID_NUMBER: All numbers must be between 1 and 40');
    }
  }

  // Check for duplicates
  if (new Set(selectedNumbers).size !== selectedNumbers.length) {
    throw new Error('DUPLICATE_NUMBERS: All numbers must be unique');
  }

  const ctx = startGame(userId, discordUserId, 'keno', betAmount);

  try {
    // Draw 10 numbers
    const drawn = [];
    for (let i = 0; i < 10; i++) {
      let num;
      do {
        num = provableRandomInt(ctx.serverSeed, ctx.clientSeed, ctx.nonce + i, 1, 40);
      } while (drawn.includes(num));
      drawn.push(num);
    }

    // Count matches
    const matches = selectedNumbers.filter(n => drawn.includes(n)).length;
    const pickCount = selectedNumbers.length;

    // Keno payout table (multiplier based on picks and matches)
    const kenoPayouts = getKenoPayout(pickCount, matches);
    const multiplier = kenoPayouts;
    const won = multiplier > 0;
    const grossPayout = won ? Math.floor(betAmount * multiplier) : 0;

    return completeGame(ctx, won, grossPayout, {
      keno: { selectedNumbers, drawn, matches, multiplier }
    });
  } catch (error) {
    cancelGame(ctx, error.message);
    throw error;
  }
}

function getKenoPayout(picks, hits) {
  // Simplified keno payout table
  const table = {
    1: { 1: 3 },
    2: { 2: 6 },
    3: { 2: 2, 3: 16 },
    4: { 2: 1, 3: 4, 4: 50 },
    5: { 3: 3, 4: 12, 5: 200 },
    6: { 3: 1, 4: 5, 5: 50, 6: 500 },
    7: { 3: 1, 4: 3, 5: 15, 6: 100, 7: 1000 },
    8: { 4: 2, 5: 8, 6: 50, 7: 500, 8: 2000 },
    9: { 4: 1, 5: 4, 6: 20, 7: 150, 8: 1000, 9: 5000 },
    10: { 5: 3, 6: 10, 7: 50, 8: 500, 9: 2500, 10: 10000 },
  };

  return (table[picks] && table[picks][hits]) || 0;
}

// ============================================================
// BLACKJACK (Interactive - returns session data)
// ============================================================

export function startBlackjack(userId, discordUserId, betAmount) {
  const ctx = startGame(userId, discordUserId, 'blackjack', betAmount);

  // Create session for interactive play
  const sessionId = db.createSession(userId, 'blackjack', ctx.gameId, betAmount, {
    serverSeed: ctx.serverSeed,
    clientSeed: ctx.clientSeed,
    nonce: ctx.nonce,
    reservationTxnId: ctx.reservationTxnId,
    // Cards will be dealt on first interaction
    playerHand: [],
    dealerHand: [],
    deckIndex: 0,
    doubled: false,
    standing: false,
  }, 5);

  // Deal initial cards
  const session = db.getSession(sessionId);
  const sessionData = JSON.parse(session.session_data);

  // Generate a deck using provably fair randomness
  const deck = generateDeck(ctx.serverSeed, ctx.clientSeed, ctx.nonce);
  sessionData.deck = deck;
  sessionData.deckIndex = 4; // We'll deal 4 cards

  // Deal 2 cards each
  sessionData.playerHand = [deck[0], deck[2]];
  sessionData.dealerHand = [deck[1], deck[3]];

  db.updateSession(sessionId, sessionData);

  return {
    sessionId,
    gameId: ctx.gameId,
    playerHand: sessionData.playerHand,
    dealerHand: sessionData.dealerHand,
    dealerVisible: [sessionData.dealerHand[0]], // Only show first dealer card
    playerTotal: calculateHandValue(sessionData.playerHand),
    dealerTotal: calculateHandValue([sessionData.dealerHand[0]]),
    betAmount,
    serverSeedHash: ctx.serverSeedHash,
    isBlackjack: calculateHandValue(sessionData.playerHand) === 21,
  };
}

export function blackjackHit(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);

  // Draw a card
  const card = data.deck[data.deckIndex];
  data.deckIndex++;
  data.playerHand.push(card);

  const total = calculateHandValue(data.playerHand);

  db.updateSession(sessionId, data);

  return {
    playerHand: data.playerHand,
    dealerVisible: [data.dealerHand[0]],
    playerTotal: total,
    bust: total > 21,
    blackjack: total === 21,
  };
}

export function blackjackStand(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);

  // Dealer plays - hits until 17
  while (calculateHandValue(data.dealerHand) < 17) {
    data.dealerHand.push(data.deck[data.deckIndex]);
    data.deckIndex++;
  }

  const playerTotal = calculateHandValue(data.playerHand);
  const dealerTotal = calculateHandValue(data.dealerHand);
  const bust = playerTotal > 21;
  const dealerBust = dealerTotal > 21;

  let won = false;
  let multiplier = 2;

  if (bust) {
    won = false;
  } else if (dealerBust) {
    won = true;
  } else if (playerTotal > dealerTotal) {
    won = true;
  } else if (playerTotal === dealerTotal) {
    // Push - return bet
    won = false;
    multiplier = 1; // Return original bet
  } else {
    won = false;
  }

  // Check for natural blackjack (21 with 2 cards)
  const playerBJ = data.playerHand.length === 2 && playerTotal === 21;
  if (playerBJ && !dealerBust) {
    multiplier = 2.5; // 3:2 payout
    won = true;
  }

  const grossPayout = Math.floor(session.bet_amount * multiplier);

  db.updateSession(sessionId, { ...data, result: { won, playerTotal, dealerTotal } });

  // Complete the game
  const ctx = {
    userId,
    discordUserId: session.user_id, // We need discord ID
    reservationTxnId: data.reservationTxnId,
    betAmount: session.bet_amount,
    wallet: db.getOrCreateWallet(userId),
    gameId: session.game_id,
    serverSeed: data.serverSeed,
    serverSeedHash: hashServerSeed(data.serverSeed),
    clientSeed: data.clientSeed,
    nonce: data.nonce,
  };

  // For push (tie), we need special handling
  if (playerTotal === dealerTotal && !playerBJ && !bust && !dealerBust) {
    // Push - refund the bet (it was reserved)
    const result = completeGame(ctx, false, session.bet_amount, {
      blackjack: { playerHand: data.playerHand, dealerHand: data.dealerHand, playerTotal, dealerTotal, push: true }
    });
    return { ...result, push: true };
  }

  return completeGame(ctx, won, grossPayout, {
    blackjack: { playerHand: data.playerHand, dealerHand: data.dealerHand, playerTotal, dealerTotal, playerBJ }
  });
}

export function blackjackDouble(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);
  if (data.playerHand.length !== 2) throw new Error('CAN_ONLY_DOUBLE_ON_FIRST_TWO_CARDS');
  if (data.doubled) throw new Error('ALREADY_DOUBLED');

  // Check if user has enough for double
  const wallet = db.getOrCreateWallet(userId);
  if (wallet.balance < session.bet_amount) {
    throw new Error('INSUFFICIENT_BALANCE: Not enough balance to double');
  }

  // Reserve additional bet
  db.reserveBet(userId, session.bet_amount);
  data.doubled = true;

  // Draw one card
  const card = data.deck[data.deckIndex];
  data.deckIndex++;
  data.playerHand.push(card);

  const playerTotal = calculateHandValue(data.playerHand);
  const bust = playerTotal > 21;

  db.updateSession(sessionId, data);

  if (bust) {
    // Auto-stand on bust
    return blackjackStand(sessionId, userId);
  }

  return {
    playerHand: data.playerHand,
    playerTotal,
    bust,
    doubled: true,
    mustStand: true,
  };
}

// Deck generation
function generateDeck(serverSeed, clientSeed, nonce) {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let deck = [];

  // Use 2 decks
  for (let d = 0; d < 2; d++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank, value: rank });
      }
    }
  }

  // Shuffle using provably fair method (Fisher-Yates)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = provableRandomInt(serverSeed, clientSeed, nonce + i, 0, i);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank);
    }
  }

  // Adjust aces
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

// ============================================================
// MINES (Interactive)
// ============================================================

export function startMines(userId, discordUserId, betAmount, mineCount) {
  if (mineCount < 1 || mineCount > 24) {
    throw new Error('INVALID_MINES: Mine count must be between 1 and 24');
  }

  const ctx = startGame(userId, discordUserId, 'mines', betAmount);

  // Generate mine positions
  const minePositions = [];
  while (minePositions.length < mineCount) {
    const pos = provableRandomInt(ctx.serverSeed, ctx.clientSeed, ctx.nonce + minePositions.length, 0, 24);
    if (!minePositions.includes(pos)) {
      minePositions.push(pos);
    }
  }

  const sessionId = db.createSession(userId, 'mines', ctx.gameId, betAmount, {
    serverSeed: ctx.serverSeed,
    clientSeed: ctx.clientSeed,
    nonce: ctx.nonce,
    reservationTxnId: ctx.reservationTxnId,
    minePositions,
    mineCount,
    revealedTiles: [],
    currentMultiplier: 1.0,
    cashedOut: false,
  }, 10);

  return {
    sessionId,
    gameId: ctx.gameId,
    mineCount,
    betAmount,
    currentMultiplier: 1.0,
    totalTiles: 25,
    safeTiles: 25 - mineCount,
    serverSeedHash: ctx.serverSeedHash,
  };
}

export function minesReveal(sessionId, userId, tileIndex) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);
  if (data.cashedOut) throw new Error('ALREADY_CASHED_OUT');
  if (data.revealedTiles.includes(tileIndex)) throw new Error('TILE_ALREADY_REVEALED');
  if (tileIndex < 0 || tileIndex > 24) throw new Error('INVALID_TILE');

  data.revealedTiles.push(tileIndex);

  // Check if mine
  if (data.minePositions.includes(tileIndex)) {
    // Hit a mine - game over, lose
    db.updateSession(sessionId, data);
    return { hit: true, tileIndex, gameData: data };
  }

  // Safe tile - calculate new multiplier
  const safeTilesTotal = 25 - data.mineCount;
  const revealed = data.revealedTiles.length;
  // Multiplier increases with each safe reveal
  data.currentMultiplier = calculateMinesMultiplier(revealed, data.mineCount);

  db.updateSession(sessionId, data);

  return {
    hit: false,
    tileIndex,
    currentMultiplier: data.currentMultiplier,
    revealedCount: revealed,
    remainingSafe: safeTilesTotal - revealed,
  };
}

export function minesCashout(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);
  if (data.cashedOut) throw new Error('ALREADY_CASHED_OUT');
  if (data.revealedTiles.length === 0) throw new Error('NO_TILES_REVEALED');

  data.cashedOut = true;
  db.updateSession(sessionId, data);

  const grossPayout = Math.floor(session.bet_amount * data.currentMultiplier);

  const ctx = {
    userId,
    discordUserId: null, // Will be resolved
    reservationTxnId: data.reservationTxnId,
    betAmount: session.bet_amount,
    wallet: db.getOrCreateWallet(userId),
    gameId: session.game_id,
    serverSeed: data.serverSeed,
    serverSeedHash: hashServerSeed(data.serverSeed),
    clientSeed: data.clientSeed,
    nonce: data.nonce,
  };

  return completeGame(ctx, true, grossPayout, {
    mines: { mineCount: data.mineCount, revealedTiles: data.revealedTiles, multiplier: data.currentMultiplier, cashout: true }
  });
}

export function minesHitMine(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');

  const data = JSON.parse(session.session_data);

  const ctx = {
    userId,
    discordUserId: null,
    reservationTxnId: data.reservationTxnId,
    betAmount: session.bet_amount,
    wallet: db.getOrCreateWallet(userId),
    gameId: session.game_id,
    serverSeed: data.serverSeed,
    serverSeedHash: hashServerSeed(data.serverSeed),
    clientSeed: data.clientSeed,
    nonce: data.nonce,
  };

  return completeGame(ctx, false, 0, {
    mines: { mineCount: data.mineCount, revealedTiles: data.revealedTiles, minePositions: data.minePositions, hit: true }
  });
}

function calculateMinesMultiplier(revealed, mineCount) {
  // Each safe reveal increases multiplier
  // Formula: product of (25-i)/(25-mineCount-i) for i in 0..revealed-1
  let multiplier = 1;
  for (let i = 0; i < revealed; i++) {
    multiplier *= (25 - i) / (25 - mineCount - i);
  }
  // Apply 1% house edge
  return Math.floor(multiplier * 0.99 * 100) / 100;
}

// ============================================================
// TOWER (Interactive)
// ============================================================

export function startTower(userId, discordUserId, betAmount, difficulty = 'medium') {
  const ctx = startGame(userId, discordUserId, 'tower', betAmount);

  const difficulties = {
    easy: { tiles: 3, mines: 1, multiplierStep: 1.3 },
    medium: { tiles: 3, mines: 1, multiplierStep: 1.5 },
    hard: { tiles: 4, mines: 2, multiplierStep: 2.0 },
  };

  const diff = difficulties[difficulty] || difficulties.medium;
  const floors = 8;

  // Generate safe tile for each floor
  const safeTiles = [];
  for (let f = 0; f < floors; f++) {
    const safe = provableRandomInt(ctx.serverSeed, ctx.clientSeed, ctx.nonce + f, 0, diff.tiles - 1);
    safeTiles.push(safe);
  }

  const sessionId = db.createSession(userId, 'tower', ctx.gameId, betAmount, {
    serverSeed: ctx.serverSeed,
    clientSeed: ctx.clientSeed,
    nonce: ctx.nonce,
    reservationTxnId: ctx.reservationTxnId,
    safeTiles,
    difficulty,
    tilesPerFloor: diff.tiles,
    minesPerFloor: diff.mines,
    multiplierStep: diff.multiplierStep,
    currentFloor: 0,
    currentMultiplier: 1.0,
    cashedOut: false,
    totalFloors: floors,
  }, 10);

  return {
    sessionId,
    gameId: ctx.gameId,
    difficulty,
    tilesPerFloor: diff.tiles,
    currentFloor: 0,
    currentMultiplier: 1.0,
    totalFloors: floors,
    betAmount,
    serverSeedHash: ctx.serverSeedHash,
  };
}

export function towerSelect(sessionId, userId, floor, tileIndex) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);
  if (data.cashedOut) throw new Error('ALREADY_CASHED_OUT');
  if (floor !== data.currentFloor) throw new Error('WRONG_FLOOR');

  const isSafe = data.safeTiles[floor] === tileIndex;

  if (!isSafe) {
    db.updateSession(sessionId, data);
    return { safe: false, floor, tileIndex, gameData: data };
  }

  data.currentFloor++;
  data.currentMultiplier = Math.floor(data.currentMultiplier * data.multiplierStep * 100) / 100;

  db.updateSession(sessionId, data);

  return {
    safe: true,
    floor,
    tileIndex,
    currentFloor: data.currentFloor,
    currentMultiplier: data.currentMultiplier,
    isComplete: data.currentFloor >= data.totalFloors,
  };
}

export function towerCashout(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);
  if (data.cashedOut) throw new Error('ALREADY_CASHED_OUT');
  if (data.currentFloor === 0) throw new Error('NO_FLOORS_COMPLETED');

  data.cashedOut = true;
  db.updateSession(sessionId, data);

  const grossPayout = Math.floor(session.bet_amount * data.currentMultiplier);

  const ctx = {
    userId,
    discordUserId: null,
    reservationTxnId: data.reservationTxnId,
    betAmount: session.bet_amount,
    wallet: db.getOrCreateWallet(userId),
    gameId: session.game_id,
    serverSeed: data.serverSeed,
    serverSeedHash: hashServerSeed(data.serverSeed),
    clientSeed: data.clientSeed,
    nonce: data.nonce,
  };

  return completeGame(ctx, true, grossPayout, {
    tower: { difficulty: data.difficulty, floorsCompleted: data.currentFloor, multiplier: data.currentMultiplier, cashout: true }
  });
}

export function towerHitMine(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');

  const data = JSON.parse(session.session_data);

  const ctx = {
    userId,
    discordUserId: null,
    reservationTxnId: data.reservationTxnId,
    betAmount: session.bet_amount,
    wallet: db.getOrCreateWallet(userId),
    gameId: session.game_id,
    serverSeed: data.serverSeed,
    serverSeedHash: hashServerSeed(data.serverSeed),
    clientSeed: data.clientSeed,
    nonce: data.nonce,
  };

  return completeGame(ctx, false, 0, {
    tower: { difficulty: data.difficulty, floorsCompleted: data.currentFloor, hit: true }
  });
}

// ============================================================
// CHICKEN (Road-crossing style)
// ============================================================

export function startChicken(userId, discordUserId, betAmount) {
  const ctx = startGame(userId, discordUserId, 'chicken', betAmount);

  const totalRows = 8;

  // Generate safe column for each row
  const safeColumns = [];
  for (let r = 0; r < totalRows; r++) {
    const safe = provableRandomInt(ctx.serverSeed, ctx.clientSeed, ctx.nonce + r, 0, 4); // 5 columns
    safeColumns.push(safe);
  }

  const sessionId = db.createSession(userId, 'chicken', ctx.gameId, betAmount, {
    serverSeed: ctx.serverSeed,
    clientSeed: ctx.clientSeed,
    nonce: ctx.nonce,
    reservationTxnId: ctx.reservationTxnId,
    safeColumns,
    currentRow: 0,
    currentMultiplier: 1.0,
    cashedOut: false,
    totalRows,
    columns: 5,
  }, 5);

  return {
    sessionId,
    gameId: ctx.gameId,
    currentRow: 0,
    currentMultiplier: 1.0,
    totalRows,
    columns: 5,
    betAmount,
    serverSeedHash: ctx.serverSeedHash,
  };
}

export function chickenCross(sessionId, userId, column) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);
  if (data.cashedOut) throw new Error('ALREADY_CASHED_OUT');
  if (column < 0 || column >= data.columns) throw new Error('INVALID_COLUMN');

  const isSafe = data.safeColumns[data.currentRow] === column;

  if (!isSafe) {
    db.updateSession(sessionId, data);
    return { safe: false, row: data.currentRow, column, gameData: data };
  }

  data.currentRow++;
  data.currentMultiplier = Math.floor(data.currentMultiplier * 1.4 * 100) / 100;

  db.updateSession(sessionId, data);

  return {
    safe: true,
    row: data.currentRow - 1,
    column,
    currentRow: data.currentRow,
    currentMultiplier: data.currentMultiplier,
    isComplete: data.currentRow >= data.totalRows,
  };
}

export function chickenCashout(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (session.user_id !== userId) throw new Error('NOT_YOUR_SESSION');

  const data = JSON.parse(session.session_data);
  if (data.cashedOut) throw new Error('ALREADY_CASHED_OUT');
  if (data.currentRow === 0) throw new Error('NO_ROWS_CROSSED');

  data.cashedOut = true;
  db.updateSession(sessionId, data);

  const grossPayout = Math.floor(session.bet_amount * data.currentMultiplier);

  const ctx = {
    userId,
    discordUserId: null,
    reservationTxnId: data.reservationTxnId,
    betAmount: session.bet_amount,
    wallet: db.getOrCreateWallet(userId),
    gameId: session.game_id,
    serverSeed: data.serverSeed,
    serverSeedHash: hashServerSeed(data.serverSeed),
    clientSeed: data.clientSeed,
    nonce: data.nonce,
  };

  return completeGame(ctx, true, grossPayout, {
    chicken: { rowsCrossed: data.currentRow, multiplier: data.currentMultiplier, cashout: true }
  });
}

export function chickenHit(sessionId, userId) {
  const session = db.getSession(sessionId);
  if (!session) throw new Error('SESSION_EXPIRED');

  const data = JSON.parse(session.session_data);

  const ctx = {
    userId,
    discordUserId: null,
    reservationTxnId: data.reservationTxnId,
    betAmount: session.bet_amount,
    wallet: db.getOrCreateWallet(userId),
    gameId: session.game_id,
    serverSeed: data.serverSeed,
    serverSeedHash: hashServerSeed(data.serverSeed),
    clientSeed: data.clientSeed,
    nonce: data.nonce,
  };

  return completeGame(ctx, false, 0, {
    chicken: { rowsCrossed: data.currentRow, hit: true }
  });
}

// ============================================================
// VERIFICATION
// ============================================================

export function verifyGame(gameId) {
  const database = db.getDb();
  const game = database.prepare('SELECT * FROM games WHERE game_id LIKE ?').get(`${gameId}%`);
  if (!game) throw new Error('GAME_NOT_FOUND');
  if (game.status !== 'COMPLETED') throw new Error('GAME_NOT_COMPLETED');

  const gameData = JSON.parse(game.game_data || '{}');
  const { serverSeed, clientSeed, nonce } = gameData;

  if (!serverSeed) throw new Error('SERVER_SEED_NOT_AVAILABLE');

  const computedHash = hashServerSeed(serverSeed);
  const hashValid = computedHash === game.server_seed_hash;

  return {
    gameId: game.game_id,
    gameType: game.game_type,
    hashValid,
    serverSeedHash: game.server_seed_hash,
    serverSeed,
    clientSeed,
    nonce,
    verified: hashValid,
  };
}
