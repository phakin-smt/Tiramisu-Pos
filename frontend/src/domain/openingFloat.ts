/**
 * Counting the opening float by note and coin.
 *
 * The backend checks the same rules (FLOAT_DENOMINATIONS in backend/server.py):
 * only these faces, whole counts up to MAX_DENOMINATION_COUNT, and a breakdown
 * that adds up to the saved total.
 */

/** Thai notes and coins a dessert-shop drawer actually holds, largest first. */
export const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;
export const MAX_DENOMINATION_COUNT = 9999;

/** What the API stores: face value (as a JSON key) to how many were counted. */
export type DenominationCounts = Record<string, number>;
/** What the count fields hold while being typed, keyed by face value. */
export type CountDrafts = Record<number, string>;

/** A count field's value as a number; anything that is not a plain count is 0. */
export function countOf(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return 0;
  return Number(trimmed);
}

export function countedTotal(drafts: CountDrafts): number {
  return DENOMINATIONS.reduce((sum, value) => sum + value * countOf(drafts[value] ?? ''), 0);
}

/** The counts worth saving, or null when nothing was counted. */
export function toDenominationCounts(drafts: CountDrafts): DenominationCounts | null {
  const counts: DenominationCounts = {};
  for (const value of DENOMINATIONS) {
    const count = countOf(drafts[value] ?? '');
    if (count > 0) counts[String(value)] = count;
  }
  return Object.keys(counts).length > 0 ? counts : null;
}

/** Refills the count fields from a saved count, ignoring anything it does not recognise. */
export function toCountDrafts(counts: DenominationCounts | null | undefined): CountDrafts {
  const drafts: CountDrafts = {};
  if (!counts) return drafts;
  for (const value of DENOMINATIONS) {
    const count = counts[String(value)];
    if (Number.isInteger(count) && count > 0 && count <= MAX_DENOMINATION_COUNT) drafts[value] = String(count);
  }
  return drafts;
}
