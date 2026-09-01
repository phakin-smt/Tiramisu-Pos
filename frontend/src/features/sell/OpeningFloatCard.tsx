import { useState } from 'react';

import { formatCurrency } from '../../domain/format';
import { acceptMoneyInput } from '../../domain/money';
import { useCashDay } from './useCashDay';

/** Thai notes and coins a dessert-shop drawer actually holds, largest first. */
const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

function countOf(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return 0;
  return Number(trimmed);
}

export function OpeningFloatCard({ cashSales }: { cashSales: number | null }) {
  const cashDay = useCashDay();
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState('');
  // Counting the drawer by denomination is how it is actually done, and it makes
  // a slipped digit obvious. Nothing is stored: this only fills the total below.
  const [counts, setCounts] = useState<Record<number, string>>({});
  const openingFloat = cashDay.data?.openingFloat ?? null;
  const parsedAmount = Number(amount);
  const validAmount = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount >= 0;
  const expectedCash = openingFloat !== null && cashSales !== null ? openingFloat + cashSales : null;

  const openModal = () => {
    setAmount(openingFloat === null ? '' : String(openingFloat));
    setCounts({});
    setModalOpen(true);
  };
  const changeCount = (denomination: number, raw: string) => {
    const next = { ...counts, [denomination]: raw };
    setCounts(next);
    const total = DENOMINATIONS.reduce((sum, value) => sum + value * countOf(next[value] ?? ''), 0);
    setAmount(total === 0 ? '' : String(total));
  };
  const changeAmount = (raw: string) => {
    // A hand-typed total wins outright; keeping stale counts beside it would
    // show a breakdown that no longer adds up to what gets saved.
    setCounts({});
    setAmount(raw);
  };
  const save = async () => {
    if (!validAmount) return;
    if (await cashDay.save(parsedAmount)) setModalOpen(false);
  };

  return <>
    <section className="opening-float-card" aria-labelledby="opening-float-title">
      <div><span id="opening-float-title">เงินทอนตั้งต้นวันนี้</span>{cashDay.loading && !cashDay.data ? <strong>กำลังโหลด...</strong> : openingFloat === null ? <strong className="is-unset">ยังไม่ได้ตั้งค่า</strong> : <strong>{formatCurrency(openingFloat)}</strong>}</div>
      {openingFloat !== null && <dl className="expected-cash-lines"><div><dt>เงินทอนตั้งต้น</dt><dd>{formatCurrency(openingFloat)}</dd></div><div><dt>ยอดขายเงินสด</dt><dd>{cashSales === null ? 'กำลังโหลด...' : formatCurrency(cashSales)}</dd></div><div><dt>เงินสดที่ควรมี</dt><dd>{expectedCash === null ? '-' : formatCurrency(expectedCash)}</dd></div></dl>}
      {cashDay.loadError && <span className="opening-float-error" role="alert">{cashDay.loadError}</span>}
      <button type="button" className="secondary-button" disabled={cashDay.loading && !cashDay.data} onClick={openModal}>{openingFloat === null ? 'ตั้งเงินทอน' : 'แก้ไข'}</button>
    </section>
    {modalOpen && <div className="opening-float-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !cashDay.pending) setModalOpen(false); }}>
      <section className="opening-float-modal" role="dialog" aria-modal="true" aria-labelledby="opening-float-modal-title">
        <header><div><h2 id="opening-float-modal-title">เงินทอนตั้งต้นวันนี้</h2><span>เงินสดสำหรับทอนก่อนเริ่มขาย</span></div><button type="button" className="icon-button" aria-label="ปิดตั้งเงินทอน" disabled={cashDay.pending} onClick={() => setModalOpen(false)}>×</button></header>
        <div className="opening-float-modal-content"><fieldset className="denomination-pad"><legend>นับตามชนิดเงิน (ไม่บังคับ)</legend><div className="denomination-rows">{DENOMINATIONS.map((denomination) => {
          const count = countOf(counts[denomination] ?? '');
          return <label key={denomination} className="denomination-row"><span className="denomination-face">{denomination >= 20 ? 'แบงก์' : 'เหรียญ'} {denomination}</span><input aria-label={`จำนวน ${denomination} บาท`} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={counts[denomination] ?? ''} disabled={cashDay.pending} onChange={(event) => changeCount(denomination, event.target.value)} /><span className="denomination-line">{count > 0 ? formatCurrency(denomination * count) : '-'}</span></label>;
        })}</div></fieldset><label><span>จำนวนเงิน</span><div><span aria-hidden="true">฿</span><input autoFocus aria-label="เงินทอนตั้งต้น" type="text" inputMode="decimal" autoComplete="off" value={amount} disabled={cashDay.pending} onChange={(event) => changeAmount(acceptMoneyInput(event.target.value, amount))} /></div></label>{amount !== '' && !validAmount && <span className="opening-float-error" role="alert">จำนวนเงินต้องไม่ติดลบ</span>}{cashDay.saveError && <span className="opening-float-error" role="alert">{cashDay.saveError}</span>}</div>
        <footer><button type="button" className="secondary-button" disabled={cashDay.pending} onClick={() => setModalOpen(false)}>ยกเลิก</button><button type="button" className="primary-button" disabled={!validAmount || cashDay.pending} onClick={() => { void save(); }}>{cashDay.pending ? 'กำลังบันทึก...' : 'บันทึก'}</button></footer>
      </section>
    </div>}
  </>;
}
