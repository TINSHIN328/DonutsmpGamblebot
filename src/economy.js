/**
 * DonutSMP Bot - Economy Module
 * Centralized tax calculation and economy operations.
 * All monetary values are integers (no floating point).
 * 
 * Tax is calculated on PROFIT, not on the entire bet.
 * Default tax: 15%
 * 
 * Formula for a WIN:
 *   profit = gross_payout - original_bet
 *   tax = floor(profit * GAME_TAX_PERCENT / 100)
 *   net_profit = profit - tax
 *   final_balance = starting_balance - bet + original_bet + net_profit
 *   (equivalent to: starting_balance + net_profit for 2x payout games)
 * 
 * For a LOSS:
 *   No tax charged.
 *   final_balance = starting_balance - bet
 */
import config from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('economy');

/**
 * Calculate game tax on profit.
 * Tax is applied to PROFIT only, not the entire bet.
 * 
 * @param {number} betAmount - The original bet (integer)
 * @param {number} grossPayout - Total payout including original bet (integer)
 * @returns {{ profit: number, taxAmount: number, netProfit: number, finalBalance: number }}
 */
export function calculateGameTax(betAmount, grossPayout) {
  // Validate inputs are integers
  if (!Number.isInteger(betAmount) || !Number.isInteger(grossPayout)) {
    throw new Error('INVALID_AMOUNT: All monetary values must be integers');
  }
  if (betAmount < 0 || grossPayout < 0) {
    throw new Error('INVALID_AMOUNT: Amounts cannot be negative');
  }

  // Profit = gross payout minus original bet
  const profit = grossPayout - betAmount;

  // If no profit (loss or break-even), no tax
  if (profit <= 0) {
    return {
      profit: 0,
      taxAmount: 0,
      netProfit: profit, // Will be 0 or negative (but negative shouldn't happen in our system)
    };
  }

  // Tax on profit only (integer math, no floating point)
  // tax = floor(profit * taxPercent / 100)
  const taxAmount = Math.floor((profit * config.GAME_TAX_PERCENT) / 100);
  const netProfit = profit - taxAmount;

  return {
    profit,
    taxAmount,
    netProfit,
  };
}

/**
 * Calculate withdrawal tax.
 * Tax is applied to the full withdrawal amount.
 * 
 * @param {number} amount - Withdrawal amount (integer)
 * @returns {{ taxAmount: number, netAmount: number }}
 */
export function calculateWithdrawalTax(amount) {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('INVALID_AMOUNT: Withdrawal amount must be a non-negative integer');
  }

  const taxAmount = Math.floor((amount * config.WITHDRAW_TAX_PERCENT) / 100);
  const netAmount = amount - taxAmount;

  return { taxAmount, netAmount };
}

/**
 * Validate a bet amount against configured limits.
 * 
 * @param {number} amount - Bet amount (integer)
 * @throws {Error} If amount is invalid
 */
export function validateBetAmount(amount) {
  if (!Number.isInteger(amount)) {
    throw new Error('INVALID_BET: Amount must be a whole number');
  }
  if (amount < config.MIN_BET) {
    throw new Error(`INVALID_BET: Minimum bet is ${formatMoney(config.MIN_BET)}`);
  }
  if (amount > config.MAX_BET) {
    throw new Error(`INVALID_BET: Maximum bet is ${formatMoney(config.MAX_BET)}`);
  }
}

/**
 * Format money for display.
 * @param {number} amount - Integer amount
 * @returns {string} Formatted string like "$1,000,000"
 */
export function formatMoney(amount) {
  if (!Number.isInteger(amount)) {
    // Safety: round if somehow not integer
    amount = Math.round(amount);
  }
  return '$' + amount.toLocaleString('en-US');
}

/**
 * Calculate final balance after a game result.
 * 
 * @param {number} startingBalance - Balance before the bet
 * @param {number} betAmount - Amount wagered
 * @param {boolean} won - Whether the player won
 * @param {number} grossPayout - Total payout if won (including original bet)
 * @returns {{ finalBalance: number, profit: number, taxAmount: number, netProfit: number }}
 */
export function calculateGameResult(startingBalance, betAmount, won, grossPayout) {
  if (!Number.isInteger(startingBalance) || !Number.isInteger(betAmount) || !Number.isInteger(grossPayout)) {
    throw new Error('INVALID_CALCULATION: All values must be integers');
  }

  if (won) {
    const { profit, taxAmount, netProfit } = calculateGameTax(betAmount, grossPayout);

    // Final balance = starting - bet + gross_payout - tax
    // = starting - bet + bet + profit - tax
    // = starting + netProfit
    const finalBalance = startingBalance + netProfit;

    return {
      finalBalance,
      profit,
      taxAmount,
      netProfit,
    };
  } else {
    // Loss: no tax, just lose the bet
    return {
      finalBalance: startingBalance - betAmount,
      profit: 0,
      taxAmount: 0,
      netProfit: -betAmount,
    };
  }
}

/**
 * Verify the economy math is correct (for testing).
 * Returns true if calculations are consistent.
 */
export function verifyEconomyIntegrity(startingBalance, betAmount, won, grossPayout) {
  const result = calculateGameResult(startingBalance, betAmount, won, grossPayout);

  if (won) {
    // Verify: finalBalance = startingBalance + netProfit
    const expected = startingBalance + result.netProfit;
    if (result.finalBalance !== expected) {
      log.error({ startingBalance, betAmount, grossPayout, result }, 'ECONOMY INTEGRITY FAILURE');
      return false;
    }

    // Verify: netProfit = profit - tax
    if (result.netProfit !== result.profit - result.taxAmount) {
      log.error({ result }, 'TAX INTEGRITY FAILURE');
      return false;
    }

    // Verify: tax = floor(profit * taxPercent / 100)
    const expectedTax = Math.floor((result.profit * config.GAME_TAX_PERCENT) / 100);
    if (result.taxAmount !== expectedTax) {
      log.error({ result, expectedTax }, 'TAX CALCULATION FAILURE');
      return false;
    }
  } else {
    // Loss: finalBalance = startingBalance - betAmount
    if (result.finalBalance !== startingBalance - betAmount) {
      log.error({ startingBalance, betAmount, result }, 'LOSS CALCULATION FAILURE');
      return false;
    }
    if (result.taxAmount !== 0) {
      log.error({ result }, 'LOSS TAX FAILURE: Tax should be 0 on losses');
      return false;
    }
  }

  return true;
}
