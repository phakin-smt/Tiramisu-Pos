import { useState } from 'react';

import { formatCurrency } from '../../domain/format';
import { useCashDay } from './useCashDay';

export function OpeningFloatCard({ cashSales }: { cashSales: number | null }) {
  const cashDay = useCashDay();
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const openingFloat = cashDay.data?.openingFloat ?? null;
  const parsedAmount = Number(amount);
  const validAmount = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount >= 0;
  const expectedCash = openingFloat !== null && cashSales !== null ? openingFloat + cashSales : null;

  const openModal = () => {
    setAmount(openingFloat === null ? '' : String(openingFloat));
    setModalOpen(true);
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
        <div className="opening-float-modal-content"><label><span>จำนวนเงิน</span><div><span aria-hidden="true">฿</span><input autoFocus aria-label="เงินทอนตั้งต้น" type="number" min="0" step="0.01" inputMode="decimal" value={amount} disabled={cashDay.pending} onChange={(event) => setAmount(event.target.value)} /></div></label>{amount !== '' && !validAmount && <span className="opening-float-error" role="alert">จำนวนเงินต้องไม่ติดลบ</span>}{cashDay.saveError && <span className="opening-float-error" role="alert">{cashDay.saveError}</span>}</div>
        <footer><button type="button" className="secondary-button" disabled={cashDay.pending} onClick={() => setModalOpen(false)}>ยกเลิก</button><button type="button" className="primary-button" disabled={!validAmount || cashDay.pending} onClick={() => { void save(); }}>{cashDay.pending ? 'กำลังบันทึก...' : 'บันทึก'}</button></footer>
      </section>
    </div>}
  </>;
}
