import { useEffect, useState } from 'react';

import { getOfflinePaymentConfig } from '../../api/offlinePaymentConfig';
import { deleteStorePaymentQr, setStorePaymentQr } from '../../api/storePaymentQr';
import { MutationFeedback } from '../../components/MutationFeedback';
import { prepareQrForUpload } from '../../domain/paymentQrImage';
import { useSafeMutation } from '../shared/useSafeMutation';

/**
 * The QR this shop is paid through.
 *
 * A shop with none falls back to the QR shared by the whole deployment, which
 * is a working arrangement and not an error -- but it is said out loud here
 * rather than left to be discovered, because a shop that meant to set its own
 * and did not would otherwise be paid into somebody else's account with nothing
 * on screen to say so.
 */
export function StorePaymentQrSection() {
  // Which shop this is comes from the session, the same way every other call on
  // this page is scoped. Reading it from context here would pull the whole store
  // provider -- and an IndexedDB write -- into a screen that needs neither.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pending, setPending] = useState('');
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const mutation = useSafeMutation();
  const preview = pending || imageUrl || '';

  useEffect(() => {
    let active = true;
    setLoading(true);
    getOfflinePaymentConfig()
      .then((config) => {
        if (active) setImageUrl(config.mode === 'image' ? config.imageUrl ?? null : null);
      })
      .catch(() => { if (active) setImageUrl(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mutation.success]);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clearing it lets the same file be chosen again after a failure.
    event.target.value = '';
    if (!file) return;
    setProblem('');
    try {
      setPending(await prepareQrForUpload(file));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'ใช้รูปนี้ไม่ได้');
    }
  };

  const save = async () => {
    if (!pending) return;
    const result = await mutation.run(() => setStorePaymentQr(pending), 'บันทึก QR ของร้านแล้ว');
    if (result) setPending('');
  };

  const remove = async () => {
    if (!window.confirm('ต้องการลบ QR ของร้านนี้ใช่หรือไม่? ร้านจะกลับไปใช้ QR กลาง')) return;
    const result = await mutation.run(() => deleteStorePaymentQr(), 'ลบ QR ของร้านแล้ว');
    if (result) { setPending(''); setImageUrl(null); }
  };

  return <section className="store-settings-section">
    <div className="page-toolbar">
      <div>
        <h2>QR รับเงิน</h2>
        <span>{loading ? 'กำลังตรวจสอบ' : imageUrl ? 'ร้านนี้ใช้ QR ของร้านเอง' : 'ยังไม่ได้ตั้ง — ร้านนี้ใช้ QR กลาง'}</span>
      </div>
    </div>
    <div className="product-image-row">
      {preview
        ? <img className="store-qr-preview" src={preview} alt="QR รับเงินของร้าน" />
        : <span className="store-qr-empty" aria-hidden="true">▦</span>}
      <div className="product-image-actions">
        <label className="secondary-button file-button">
          <span>{preview ? 'เปลี่ยนรูป QR' : 'เลือกรูป QR'}</span>
          <input type="file" accept="image/*" className="file-input" disabled={mutation.pending} onChange={pick} />
        </label>
        {pending && <button type="button" className="primary-button" disabled={mutation.pending} onClick={save}>{mutation.pending ? 'กำลังบันทึก' : 'บันทึก QR'}</button>}
        {imageUrl && !pending && <button type="button" className="secondary-button" disabled={mutation.pending} onClick={remove}>ลบ QR</button>}
      </div>
    </div>
    {pending && <p className="store-qr-note">ตรวจว่าสแกนติดก่อนบันทึก · ลูกค้าจะต้องกรอกยอดเอง เพราะรูป QR เก็บยอดไม่ได้</p>}
    {problem && <div className="form-error" role="alert">{problem}</div>}
    <MutationFeedback error={mutation.error} success={mutation.success} />
  </section>;
}
