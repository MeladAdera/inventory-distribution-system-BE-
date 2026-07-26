/**
 * Helpers for DECIMAL(15,2) money columns.
 *
 * `pg` returns numeric/DECIMAL as a **string**, and debt code keeps it that way
 * end to end: `parseFloat('0.1') + parseFloat('0.2')` is `0.30000000000000004`,
 * which is acceptable noise in a chart (analytics casts to `::float8` on
 * purpose) but wrong in a balance somebody is owed.
 *
 * Comparisons and additions therefore go through bigint minor units. Number is
 * not enough: DECIMAL(15,2) reaches ~1e17 minor units, past
 * `Number.MAX_SAFE_INTEGER` (~9e15).
 *
 * Wherever possible the arithmetic is left to Postgres `numeric` instead (see
 * `DebtsRepository.applyPaymentDelta`); these helpers exist for the checks that
 * must happen in the service before a write.
 */

const MINOR_DIGITS = 2;
const MINOR_UNITS = 100n;

// Accepts an optional sign, digits, and at most 2 decimal places — the exact
// shape DECIMAL(15,2) round-trips without loss.
const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export class InvalidMoneyError extends Error {
  constructor(value: string) {
    super(`Invalid money value: ${value}`);
    this.name = 'InvalidMoneyError';
  }
}

/** `'100.50'` -> `10050n`. Throws `InvalidMoneyError` on anything else. */
export function toMinor(value: string): bigint {
  const trimmed = value.trim();

  if (!MONEY_PATTERN.test(trimmed)) {
    throw new InvalidMoneyError(value);
  }

  const isNegative = trimmed.startsWith('-');
  const unsigned = isNegative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');

  // padEnd so '.5' is 50 minor units, not 5.
  const minor = BigInt(whole) * MINOR_UNITS + BigInt(fraction.padEnd(MINOR_DIGITS, '0'));

  return isNegative ? -minor : minor;
}

/** `10050n` -> `'100.50'`. Always emits exactly 2 decimal places. */
export function fromMinor(minor: bigint): string {
  const isNegative = minor < 0n;
  const absolute = isNegative ? -minor : minor;

  const whole = absolute / MINOR_UNITS;
  const fraction = (absolute % MINOR_UNITS).toString().padStart(MINOR_DIGITS, '0');

  return `${isNegative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Normalises a money string to exactly 2 decimals (`'100'` -> `'100.00'`), so
 * API responses are consistent regardless of how Postgres formatted the value.
 */
export function formatMoney(value: string): string {
  return fromMinor(toMinor(value));
}

export function isValidMoney(value: string): boolean {
  return MONEY_PATTERN.test(value.trim());
}
