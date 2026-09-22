/**
 * Amount Parser Utility
 * Parses human-readable amount formats into integer currency units.
 * 
 * Supported formats:
 * - 10000 (plain number)
 * - 10k, 10K (thousands)
 * - 1m, 1M (millions)
 * - 1.5m, 1.5M (millions with decimals)
 * - 2.5k, 2.5K (thousands with decimals)
 * - 1,000 (with commas)
 * - 1,000,000 (with commas)
 * 
 * All outputs are safe integers (no floating point).
 */

/**
 * Parse a human-readable amount string into an integer.
 * 
 * @param {string|number} input - The amount to parse
 * @returns {number} - Integer amount
 * @throws {Error} - If input is invalid
 * 
 * @example
 * parseAmount('10k') // 10000
 * parseAmount('1.5m') // 1500000
 * parseAmount('1,000') // 1000
 * parseAmount(5000) // 5000
 */
export function parseAmount(input) {
  // Handle null/undefined
  if (input === null || input === undefined) {
    throw new Error('Amount is required');
  }

  // If already a number, validate and return
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error('Amount must be a finite number');
    }
    if (input < 0) {
      throw new Error('Amount cannot be negative');
    }
    if (!Number.isInteger(input)) {
      throw new Error('Amount must be a whole number');
    }
    return input;
  }

  // Convert to string and trim
  let str = String(input).trim().toLowerCase();

  // Empty check
  if (str === '') {
    throw new Error('Amount cannot be empty');
  }

  // Remove commas (thousand separators)
  str = str.replace(/,/g, '');

  // Check for suffix multipliers
  let multiplier = 1;
  if (str.endsWith('k')) {
    multiplier = 1000;
    str = str.slice(0, -1);
  } else if (str.endsWith('m')) {
    multiplier = 1000000;
    str = str.slice(0, -1);
  } else if (str.endsWith('b')) {
    multiplier = 1000000000;
    str = str.slice(0, -1);
  }

  // Parse the numeric part
  const num = parseFloat(str);

  // Validate the parsed number
  if (isNaN(num)) {
    throw new Error('Invalid amount format');
  }

  if (!Number.isFinite(num)) {
    throw new Error('Amount must be a finite number');
  }

  if (num < 0) {
    throw new Error('Amount cannot be negative');
  }

  if (num === 0) {
    throw new Error('Amount cannot be zero');
  }

  // Apply multiplier and convert to integer
  const result = Math.round(num * multiplier);

  // Final validation
  if (!Number.isInteger(result)) {
    throw new Error('Amount must result in a whole number');
  }

  if (result > Number.MAX_SAFE_INTEGER) {
    throw new Error('Amount exceeds maximum safe integer');
  }

  return result;
}

/**
 * Format an integer amount into a human-readable string.
 * 
 * @param {number} amount - Integer amount
 * @param {boolean} useSuffix - Whether to use k/m/b suffixes (default: false)
 * @returns {string} - Formatted string
 * 
 * @example
 * formatAmount(10000) // '$10,000'
 * formatAmount(1500000, true) // '$1.5M'
 */
export function formatAmount(amount, useSuffix = false) {
  if (!Number.isInteger(amount)) {
    throw new Error('Amount must be an integer');
  }

  if (amount < 0) {
    return '-$' + formatAmount(-amount, useSuffix).slice(1);
  }

  if (useSuffix) {
    if (amount >= 1000000000) {
      const billions = amount / 1000000000;
      return '$' + (billions % 1 === 0 ? billions : billions.toFixed(1)) + 'B';
    }
    if (amount >= 1000000) {
      const millions = amount / 1000000;
      return '$' + (millions % 1 === 0 ? millions : millions.toFixed(1)) + 'M';
    }
    if (amount >= 1000) {
      const thousands = amount / 1000;
      return '$' + (thousands % 1 === 0 ? thousands : thousands.toFixed(1)) + 'K';
    }
  }

  return '$' + amount.toLocaleString('en-US');
}

/**
 * Validate that an amount is within acceptable bounds.
 * 
 * @param {number} amount - Integer amount
 * @param {number} min - Minimum allowed (default: 1)
 * @param {number} max - Maximum allowed (default: Number.MAX_SAFE_INTEGER)
 * @returns {boolean} - True if valid
 * @throws {Error} - If invalid
 */
export function validateAmount(amount, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isInteger(amount)) {
    throw new Error('Amount must be an integer');
  }

  if (amount < min) {
    throw new Error(`Amount must be at least ${formatAmount(min)}`);
  }

  if (amount > max) {
    throw new Error(`Amount cannot exceed ${formatAmount(max)}`);
  }

  return true;
}

/**
 * Parse amount with validation for gambling bets.
 * 
 * @param {string|number} input - The amount to parse
 * @param {number} minBet - Minimum bet amount
 * @param {number} maxBet - Maximum bet amount
 * @returns {number} - Validated integer amount
 */
export function parseBetAmount(input, minBet, maxBet) {
  const amount = parseAmount(input);
  validateAmount(amount, minBet, maxBet);
  return amount;
}
