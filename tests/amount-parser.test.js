/**
 * Amount Parser Tests
 * Tests all supported amount formats and edge cases.
 * 
 * Run: node tests/amount-parser.test.js
 */

import { parseAmount, formatAmount, validateAmount, parseBetAmount } from '../src/utils/amount-parser.js';

let passed = 0;
let failed = 0;
const failures = [];

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${message}`);
  } else {
    failed++;
    failures.push(`${message}: expected ${expected}, got ${actual}`);
    console.log(`  ❌ ${message}: expected ${expected}, got ${actual}`);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    failed++;
    failures.push(`${message}: expected to throw but didn't`);
    console.log(`  ❌ ${message}: expected to throw`);
  } catch {
    passed++;
    console.log(`  ✅ ${message}`);
  }
}

console.log('\n🧪 Amount Parser Tests');
console.log('═══════════════════════════════════════\n');

// --- TEST 1: Plain numbers ---
console.log('TEST 1: Plain numbers');
assertEqual(parseAmount('10000'), 10000, 'Parse "10000"');
assertEqual(parseAmount('500'), 500, 'Parse "500"');
assertEqual(parseAmount('1'), 1, 'Parse "1"');
assertEqual(parseAmount(10000), 10000, 'Parse number 10000');

// --- TEST 2: K suffix (thousands) ---
console.log('\nTEST 2: K suffix (thousands)');
assertEqual(parseAmount('10k'), 10000, 'Parse "10k"');
assertEqual(parseAmount('10K'), 10000, 'Parse "10K"');
assertEqual(parseAmount('1k'), 1000, 'Parse "1k"');
assertEqual(parseAmount('2.5k'), 2500, 'Parse "2.5k"');
assertEqual(parseAmount('0.5k'), 500, 'Parse "0.5k"');
assertEqual(parseAmount('100k'), 100000, 'Parse "100k"');

// --- TEST 3: M suffix (millions) ---
console.log('\nTEST 3: M suffix (millions)');
assertEqual(parseAmount('1m'), 1000000, 'Parse "1m"');
assertEqual(parseAmount('1M'), 1000000, 'Parse "1M"');
assertEqual(parseAmount('1.5m'), 1500000, 'Parse "1.5m"');
assertEqual(parseAmount('2.5m'), 2500000, 'Parse "2.5m"');
assertEqual(parseAmount('0.1m'), 100000, 'Parse "0.1m"');
assertEqual(parseAmount('100m'), 100000000, 'Parse "100m"');

// --- TEST 4: B suffix (billions) ---
console.log('\nTEST 4: B suffix (billions)');
assertEqual(parseAmount('1b'), 1000000000, 'Parse "1b"');
assertEqual(parseAmount('1B'), 1000000000, 'Parse "1B"');
assertEqual(parseAmount('2.5b'), 2500000000, 'Parse "2.5b"');

// --- TEST 5: Comma separators ---
console.log('\nTEST 5: Comma separators');
assertEqual(parseAmount('1,000'), 1000, 'Parse "1,000"');
assertEqual(parseAmount('1,000,000'), 1000000, 'Parse "1,000,000"');
assertEqual(parseAmount('10,000'), 10000, 'Parse "10,000"');
assertEqual(parseAmount('100,000,000'), 100000000, 'Parse "100,000,000"');

// --- TEST 6: Combined formats ---
console.log('\nTEST 6: Combined formats');
assertEqual(parseAmount('1,000k'), 1000000, 'Parse "1,000k"');
assertEqual(parseAmount('1.5M'), 1500000, 'Parse "1.5M"');

// --- TEST 7: Invalid inputs ---
console.log('\nTEST 7: Invalid inputs');
assertThrows(() => parseAmount('10abc'), 'Reject "10abc"');
assertThrows(() => parseAmount('-500'), 'Reject "-500"');
assertThrows(() => parseAmount('0'), 'Reject "0"');
assertThrows(() => parseAmount('1.2.3'), 'Reject "1.2.3"');
assertThrows(() => parseAmount('NaN'), 'Reject "NaN"');
assertThrows(() => parseAmount('Infinity'), 'Reject "Infinity"');
assertThrows(() => parseAmount(''), 'Reject empty string');
assertThrows(() => parseAmount(null), 'Reject null');
assertThrows(() => parseAmount(undefined), 'Reject undefined');

// --- TEST 8: Integer safety ---
console.log('\nTEST 8: Integer safety');
const result1 = parseAmount('1.5m');
assertEqual(Number.isInteger(result1), true, '1.5m produces integer');
const result2 = parseAmount('2.5k');
assertEqual(Number.isInteger(result2), true, '2.5k produces integer');
const result3 = parseAmount('0.1m');
assertEqual(Number.isInteger(result3), true, '0.1m produces integer');

// --- TEST 9: formatAmount ---
console.log('\nTEST 9: formatAmount');
assertEqual(formatAmount(10000), '$10,000', 'Format 10000');
assertEqual(formatAmount(1000000), '$1,000,000', 'Format 1000000');
assertEqual(formatAmount(10000, true), '$10K', 'Format 10000 with suffix');
assertEqual(formatAmount(1500000, true), '$1.5M', 'Format 1500000 with suffix');
assertEqual(formatAmount(1000000000, true), '$1B', 'Format 1B with suffix');
assertEqual(formatAmount(500), '$500', 'Format 500');

// --- TEST 10: parseBetAmount ---
console.log('\nTEST 10: parseBetAmount');
assertEqual(parseBetAmount('10k', 1000, 100000000), 10000, 'Parse bet "10k" within limits');
assertEqual(parseBetAmount('1m', 1000, 100000000), 1000000, 'Parse bet "1m" within limits');
assertThrows(() => parseBetAmount('500', 1000, 100000000), 'Reject bet below minimum');
assertThrows(() => parseBetAmount('200m', 1000, 100000000), 'Reject bet above maximum');

// --- TEST 11: Edge cases ---
console.log('\nTEST 11: Edge cases');
assertEqual(parseAmount('  1000  '), 1000, 'Parse with whitespace');
assertEqual(parseAmount('10K'), 10000, 'Parse uppercase K');
assertEqual(parseAmount('10 k'), 10000, 'Parse with space before k');

// --- TEST 12: Real-world examples ---
console.log('\nTEST 12: Real-world examples');
assertEqual(parseAmount('10000'), 10000, '/coinflip 10000 → 10000');
assertEqual(parseAmount('10k'), 10000, '/coinflip 10k → 10000');
assertEqual(parseAmount('1m'), 1000000, '/coinflip 1m → 1000000');
assertEqual(parseAmount('1.5m'), 1500000, '/coinflip 1.5m → 1500000');
assertEqual(parseAmount('1,000,000'), 1000000, '/coinflip 1,000,000 → 1000000');

// ============================================================
// RESULTS
// ============================================================

console.log('\n═══════════════════════════════════════');
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failures.length > 0) {
  console.log('❌ FAILURES:');
  for (const f of failures) {
    console.log(`   - ${f}`);
  }
  process.exit(1);
} else {
  console.log('✅ All amount parser tests passed!');
  process.exit(0);
}
