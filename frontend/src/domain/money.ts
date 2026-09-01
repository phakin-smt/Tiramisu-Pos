export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * A partially typed baht amount: digits, optionally one decimal point and up to
 * two decimal places. Deliberately matches the empty string and a trailing dot
 * so the field can be cleared and "12." can exist while the satang is typed.
 */
const MONEY_INPUT = /^\d*(\.\d{0,2})?$/;
/** Whole baht only, for fields that never take satang. */
const WHOLE_BAHT_INPUT = /^\d*$/;

/**
 * Filters a money field to digits, rejecting the keystroke otherwise.
 *
 * `type="number"` still accepts `e`, `+`, `-` and multiple dots, and silently
 * reports an empty value for them, so a cashier can leave a field looking filled
 * while it holds nothing. Filtering the value ourselves keeps every browser,
 * paste and iOS keyboard behaving the same way.
 */
export function acceptMoneyInput(next: string, previous: string, options: { satang?: boolean } = {}): string {
  const pattern = options.satang === false ? WHOLE_BAHT_INPUT : MONEY_INPUT;
  return pattern.test(next) ? next : previous;
}

/** Parses a filtered money field; a blank or partial entry is simply not a number. */
export function parseMoneyInput(value: string): number | null {
  if (value === '' || value === '.') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
