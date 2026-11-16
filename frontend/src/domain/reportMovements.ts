import type { ReportMenuSummary } from '../types/reports';

/** A menu that sold, was given away, or was written off on the day. */
export function hasMovement(item: ReportMenuSummary): boolean {
  return item.sold > 0 || item.giveaway > 0 || item.waste > 0;
}

/**
 * The menus worth reading on a day's report: those that moved, best seller
 * first. A shop lists every menu, and most rows on a quiet day are all zeros.
 */
export function movedMenus(items: ReportMenuSummary[]): ReportMenuSummary[] {
  return items.filter(hasMovement).sort((a, b) => b.sold - a.sold || b.giveaway - a.giveaway || a.name.localeCompare(b.name, 'th'));
}
