/**
 * DonutSMP Bot - Provably Fair System
 * Uses server seed, client seed, and nonce for verifiable randomness.
 * 
 * Flow:
 * 1. Server generates a random seed and hashes it (SHA-256)
 * 2. Hash is committed before the game
 * 3. After the game, server reveals the seed
 * 4. User can verify: hash(server_seed) == committed_hash
 * 5. Result is derived from: HMAC-SHA256(server_seed, client_seed:nonce)
 */
import crypto from 'crypto';
import { createLogger } from './logger.js';

const log = createLogger('provably-fair');

/**
 * Generate a new server seed (random 32 bytes, hex encoded).
 */
export function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a server seed (SHA-256).
 * This is what gets committed before the game.
 */
export function hashServerSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * Generate a result from server seed, client seed, and nonce.
 * Returns a float between 0 and 1 (exclusive).
 */
export function generateCombinedSeed(serverSeed, clientSeed, nonce) {
  const combined = `${clientSeed}:${nonce}`;
  const hmac = crypto.createHmac('sha256', serverSeed);
  hmac.update(combined);
  return hmac.digest('hex');
}

/**
 * Convert a hex hash to a float between 0 and 1.
 * Uses the first 8 hex characters (32 bits) for precision.
 */
export function hashToFloat(hexHash) {
  const hex = hexHash.slice(0, 8);
  const intVal = parseInt(hex, 16);
  return intVal / 0xFFFFFFFF;
}

/**
 * Generate a random integer in range [min, max] using provably fair system.
 */
export function provableRandomInt(serverSeed, clientSeed, nonce, min, max) {
  const hash = generateCombinedSeed(serverSeed, clientSeed, nonce);
  const float = hashToFloat(hash);
  return Math.floor(float * (max - min + 1)) + min;
}

/**
 * Generate a coinflip result using provably fair system.
 * Returns 'HEADS' or 'TAILS'.
 */
export function provableCoinflip(serverSeed, clientSeed, nonce) {
  const hash = generateCombinedSeed(serverSeed, clientSeed, nonce);
  const float = hashToFloat(hash);
  return float < 0.5 ? 'HEADS' : 'TAILS';
}

/**
 * Generate a dice roll (1-6) using provably fair system.
 */
export function provableDiceRoll(serverSeed, clientSeed, nonce) {
  return provableRandomInt(serverSeed, clientSeed, nonce, 1, 6);
}

/**
 * Generate a roulette result (0-36) using provably fair system.
 */
export function provableRoulette(serverSeed, clientSeed, nonce) {
  return provableRandomInt(serverSeed, clientSeed, nonce, 0, 36);
}

/**
 * Generate a crash game multiplier using provably fair system.
 * Uses an exponential distribution for realistic crash points.
 */
export function provableCrash(serverSeed, clientSeed, nonce) {
  const hash = generateCombinedSeed(serverSeed, clientSeed, nonce);
  const float = hashToFloat(hash);

  // House edge adjustment
  const houseEdge = 0.01; // 1% house edge on crash
  if (float < houseEdge) return 1.0; // Instant crash

  // Exponential distribution: multiplier = 99 / (1 - float)
  // Capped at 100x for safety
  const multiplier = Math.floor((1 / (1 - float)) * 100) / 100;
  return Math.min(multiplier, 100.0);
}

/**
 * Verify a game result.
 * Returns true if the committed hash matches and the result is correct.
 */
export function verifyGameResult(serverSeed, committedHash, clientSeed, nonce, expectedType, expectedValue) {
  // Verify hash
  const computedHash = hashServerSeed(serverSeed);
  if (computedHash !== committedHash) {
    return { valid: false, reason: 'Hash mismatch - server seed was changed' };
  }

  // Verify result based on game type
  let result;
  switch (expectedType) {
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
    default:
      return { valid: false, reason: 'Unknown game type' };
  }

  if (String(result) !== String(expectedValue)) {
    return { valid: false, reason: `Result mismatch: computed ${result}, expected ${expectedValue}` };
  }

  return { valid: true, result };
}

/**
 * Generate a client seed (user can provide their own or we generate one).
 */
export function generateClientSeed() {
  return crypto.randomBytes(16).toString('hex');
}
