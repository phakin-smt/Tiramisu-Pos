import type { PricingRules } from '../domain/promotion';
import {
  PRICING_RULES_KEY,
  openBaannoiPosDatabase,
  type PricingRulesRecord,
} from './database';

export interface CachedStore {
  storeId: number;
  storeName: string;
  rules: PricingRules;
}

/**
 * Remembers which store this device sells for, and on what terms.
 *
 * Two reasons it has to be held locally rather than read back from the session:
 * the session cookie is HttpOnly, so an offline till cannot see which store it
 * chose, and it needs the discounts to price a cart the same way the server
 * would. Both are written together, so they can never disagree about which shop
 * the rules belong to.
 */
export async function saveSelectedStore(
  store: CachedStore,
  savedAt = new Date().toISOString(),
): Promise<void> {
  const record: PricingRulesRecord = {
    key: PRICING_RULES_KEY,
    storeId: store.storeId,
    storeName: store.storeName,
    bundle: store.rules.bundle,
    wholesale: store.rules.wholesale,
    savedAt,
  };
  const database = await openBaannoiPosDatabase();
  try {
    await database.put('metadata', record);
  } finally {
    database.close();
  }
}

export async function readSelectedStore(): Promise<CachedStore | null> {
  const database = await openBaannoiPosDatabase();
  try {
    const value = await database.get('metadata', PRICING_RULES_KEY);
    if (!value || value.key !== PRICING_RULES_KEY) return null;
    return {
      storeId: value.storeId,
      storeName: value.storeName,
      rules: { bundle: value.bundle, wholesale: value.wholesale },
    };
  } finally {
    database.close();
  }
}

/** Signing out must not leave the next person selling under this store's terms. */
export async function clearSelectedStore(): Promise<void> {
  const database = await openBaannoiPosDatabase();
  try {
    await database.delete('metadata', PRICING_RULES_KEY);
  } finally {
    database.close();
  }
}
