import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getPricingRules, getStores, selectStore, type Store } from '../../api/stores';
import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { NO_PRICING_RULES, type PricingRules } from '../../domain/promotion';
import { readSelectedStore, saveSelectedStore } from '../../offline/selectedStore';

interface StoreState {
  stores: Store[];
  storeId: number | null;
  storeName: string;
  storeLogoUrl: string | null;
  /**
   * The selling store's automatic discounts. Starts as none and only becomes the
   * store's own once they are known -- a till that has not learned its rules
   * charges full price rather than guessing at someone else's promotion.
   */
  rules: PricingRules;
  loading: boolean;
  error: string;
}

interface StoreContextValue extends StoreState {
  /** Authenticated, but the store is still an open question. */
  needsSelection: boolean;
  /** The cashier asked to change store, so show the picker again. */
  switching: boolean;
  choose(storeId: number): Promise<boolean>;
  requestSwitch(): void;
  cancelSwitch(): void;
  reload(): void;
}

const initialState: StoreState = {
  stores: [],
  storeId: null,
  storeName: '',
  storeLogoUrl: null,
  rules: NO_PRICING_RULES,
  loading: true,
  error: '',
};

const StoreContext = createContext<StoreContextValue | null>(null);

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { isOnline } = useConnectivity();
  const [revision, setRevision] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [state, setState] = useState<StoreState>(initialState);

  useEffect(() => {
    let active = true;

    async function load() {
      // Offline the session cookie is unreadable, so the device's own record of
      // which store it sells for is the only answer available.
      if (!isOnline) {
        try {
          const cached = await readSelectedStore();
          if (!active) return;
          setState({
            stores: cached
              ? [{ id: cached.storeId, code: '', name: cached.storeName, logoUrl: cached.storeLogoUrl }]
              : [],
            storeId: cached?.storeId ?? null,
            storeName: cached?.storeName ?? '',
            storeLogoUrl: cached?.storeLogoUrl ?? null,
            rules: cached?.rules ?? NO_PRICING_RULES,
            loading: false,
            error: '',
          });
        } catch (error) {
          if (active) setState({ ...initialState, loading: false, error: message(error, 'อ่านข้อมูลร้านในเครื่องไม่สำเร็จ') });
        }
        return;
      }

      try {
        const listed = await getStores();
        if (!active) return;
        if (listed.storeId === null) {
          setState({ ...initialState, stores: listed.stores, loading: false });
          return;
        }
        const rules = await getPricingRules();
        if (!active) return;
        const chosen = listed.stores.find((store) => store.id === listed.storeId);
        const storeName = chosen?.name ?? '';
        const storeLogoUrl = chosen?.logoUrl ?? null;
        setState({
          stores: listed.stores,
          storeId: listed.storeId,
          storeName,
          storeLogoUrl,
          rules: { bundle: rules.bundle, wholesale: rules.wholesale },
          loading: false,
          error: '',
        });
        await saveSelectedStore({
          storeId: listed.storeId,
          storeName,
          storeLogoUrl,
          rules: { bundle: rules.bundle, wholesale: rules.wholesale },
        });
      } catch (error) {
        if (active) setState((previous) => ({ ...previous, loading: false, error: message(error, 'โหลดข้อมูลร้านไม่สำเร็จ') }));
      }
    }

    void load();
    return () => { active = false; };
  }, [isOnline, revision]);

  const choose = useCallback(async (storeId: number) => {
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    try {
      await selectStore(storeId);
      const rules = await getPricingRules();
      setSwitching(false);
      setState((previous) => {
        const chosen = previous.stores.find((store) => store.id === storeId);
        const storeName = chosen?.name ?? '';
        const storeLogoUrl = chosen?.logoUrl ?? null;
        void saveSelectedStore({
          storeId,
          storeName,
          storeLogoUrl,
          rules: { bundle: rules.bundle, wholesale: rules.wholesale },
        });
        return {
          ...previous,
          storeId,
          storeName,
          storeLogoUrl,
          rules: { bundle: rules.bundle, wholesale: rules.wholesale },
          loading: false,
          error: '',
        };
      });
      return true;
    } catch (error) {
      setState((previous) => ({ ...previous, loading: false, error: message(error, 'เลือกร้านไม่สำเร็จ') }));
      return false;
    }
  }, []);

  const reload = useCallback(() => setRevision((current) => current + 1), []);

  const value = useMemo(() => ({
    ...state,
    needsSelection: !state.loading && state.storeId === null,
    switching,
    choose,
    requestSwitch: () => setSwitching(true),
    cancelSwitch: () => setSwitching(false),
    reload,
  }), [choose, reload, state, switching]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used within StoreProvider');
  return value;
}
