import { useCallback, useState } from 'react';

import { getCashDay, saveCashDay } from '../../api/cashDay';
import type { CashDayResponse } from '../../types/cashDay';
import { useAbortableQuery } from '../shared/useAbortableQuery';
import { useSafeMutation } from '../shared/useSafeMutation';

export function useCashDay() {
  const query = useAbortableQuery(getCashDay, []);
  const mutation = useSafeMutation();
  const [saved, setSaved] = useState<CashDayResponse | null>(null);
  const save = useCallback(async (amount: number) => {
    const result = await mutation.run(() => saveCashDay(amount), 'บันทึกเงินทอนตั้งต้นแล้ว');
    if (result) setSaved(result);
    return Boolean(result);
  }, [mutation]);
  return { data: saved ?? query.data, loading: query.loading, loadError: query.error, pending: mutation.pending, saveError: mutation.error, save };
}
