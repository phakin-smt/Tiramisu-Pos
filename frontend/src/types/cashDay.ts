import type { DenominationCounts } from '../domain/openingFloat';

export interface CashDayResponse {
  date: string;
  openingFloat: number | null;
  /** The notes and coins counted into the float; null when the total was typed. */
  denominations?: DenominationCounts | null;
}
