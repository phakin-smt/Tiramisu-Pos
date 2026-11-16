import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

import { getOfflinePaymentConfig } from '../../api/offlinePaymentConfig';
import { deleteStorePaymentQr, setStorePaymentQr } from '../../api/storePaymentQr';
import { MutationFeedback } from '../../components/MutationFeedback';
import { prepareQrForUpload } from '../../domain/paymentQrImage';
import { generateStaticPromptPayPayload, promptPayAccountSuffix } from '../../offline/promptPayPayload';
import { useSafeMutation } from '../shared/useSafeMutation';

/**
 * Which QR a customer of this shop actually scans.
 *
 * `shared` is the deployment-wide PROMPTPAY_ID, a working arrangement and not
 * an error -- but it is drawn here so the owner can scan it and see whose
 * account it pays, because a shop that meant to set its own and did not would
 * otherwise be paid into somebody else's account with nothing to say so.
 * `none` means transfers cannot be taken at all, and `unknown` means the check
 * itself failed; neither may be shown as if the shared QR were in use.
 */
type QrStatus =
  | { kind: 'loading' }
  | { kind: 'own'; imageUrl: string }
  | { kind: 'shared'; qrUrl: string | null; suffix: string | null }
  | { kind: 'none' }
  | { kind: 'unknown' };

async function drawSharedQr(merchantAccountInfo: string): Promise<string | null> {
  try {
    const svg = await QRCode.toString(generateStaticPromptPayPayload(merchantAccountInfo), {
      type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' },
    });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  } catch {
    return null;
  }
}

function statusLine(status: QrStatus): string {
  switch (status.kind) {
    case 'loading': return 'กำลังตรวจสอบ';
    case 'own': return 'ร้านนี้ใช้ QR ของร้านเอง';
    case 'shared': return 'ยังไม่ได้ตั้ง QR ของร้าน — ใช้ QR พร้อมเพย์กลาง';
    case 'none': return 'ยังรับโอนไม่ได้ — ร้านนี้ยังไม่มี QR';
    case 'unknown': return 'ตรวจสอบ QR ไม่ได้';
  }
}

export function StorePaymentQrSection() {
  // Which shop this is comes from the session, the same way every other call on
  // this page is scoped. Reading it from context here would pull the whole store
  // provider -- and an IndexedDB write -- into a screen that needs neither.
  const [status, setStatus] = useState<QrStatus>({ kind: 'loading' });
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState('');
  const [problem, setProblem] = useState('');
  const mutation = useSafeMutation();

  useEffect(() => {
    let active = true;
    setStatus((current) => (current.kind === 'unknown' ? { kind: 'loading' } : current));
    getOfflinePaymentConfig()
      .then(async (config) => {
        let next: QrStatus;
        if (config.mode === 'image' && config.imageUrl) next = { kind: 'own', imageUrl: config.imageUrl };
        else if (config.configured && config.merchantAccountInfo) {
          next = { kind: 'shared', qrUrl: await drawSharedQr(config.merchantAccountInfo), suffix: promptPayAccountSuffix(config.merchantAccountInfo) };
        } else next = { kind: 'none' };
        if (active) setStatus(next);
      })
      .catch(() => { if (active) setStatus({ kind: 'unknown' }); });
    return () => { active = false; };
  }, [reload]);

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
    if (result) { setPending(''); setReload((current) => current + 1); }
  };

  const remove = async () => {
    if (!window.confirm('ต้องการลบ QR ของร้านนี้ใช่หรือไม่? ร้านจะกลับไปใช้ QR พร้อมเพย์กลาง ถ้าระบบตั้งไว้')) return;
    const result = await mutation.run(() => deleteStorePaymentQr(), 'ลบ QR ของร้านแล้ว');
    if (result) { setPending(''); setReload((current) => current + 1); }
  };

  const savedImage = status.kind === 'own' ? status.imageUrl : status.kind === 'shared' ? status.qrUrl : null;
  const preview = pending || savedImage;
  const previewAlt = pending || status.kind === 'own' ? 'QR รับเงินของร้าน' : 'QR พร้อมเพย์กลาง';

  return <section className="store-settings-section">
    <div className="page-toolbar">
      <div>
        <h2>QR รับเงิน</h2>
        <span className={status.kind === 'none' || status.kind === 'unknown' ? 'store-qr-status is-warning' : 'store-qr-status'}>{statusLine(status)}</span>
      </div>
    </div>
    <div className="product-image-row">
      {preview
        ? <img className="store-qr-preview" src={preview} alt={previewAlt} />
        : <span className={status.kind === 'none' ? 'store-qr-empty is-warning' : 'store-qr-empty'} aria-hidden="true">{status.kind === 'none' ? '!' : '▦'}</span>}
      <div className="product-image-actions">
        <label className="secondary-button file-button">
          <span>{status.kind === 'own' || pending ? 'เปลี่ยนรูป QR' : 'เลือกรูป QR ของร้าน'}</span>
          <input type="file" accept="image/*" className="file-input" disabled={mutation.pending} onChange={pick} />
        </label>
        {pending && <button type="button" className="primary-button" disabled={mutation.pending} onClick={save}>{mutation.pending ? 'กำลังบันทึก' : 'บันทึก QR'}</button>}
        {pending && <button type="button" className="secondary-button" disabled={mutation.pending} onClick={() => { setPending(''); setProblem(''); }}>ยกเลิก</button>}
        {status.kind === 'own' && !pending && <button type="button" className="secondary-button" disabled={mutation.pending} onClick={remove}>ลบ QR</button>}
        {status.kind === 'unknown' && <button type="button" className="secondary-button" onClick={() => setReload((current) => current + 1)}>ลองอีกครั้ง</button>}
      </div>
    </div>
    {pending
      ? <p className="store-qr-note">ตรวจว่าสแกนติดก่อนบันทึก · ลูกค้าจะต้องกรอกยอดเอง เพราะรูป QR เก็บยอดไม่ได้</p>
      : <>
        {status.kind === 'shared' && <p className="store-qr-note">{status.suffix ? `พร้อมเพย์ลงท้าย ${status.suffix} · ` : ''}สแกนเพื่อตรวจว่าเงินเข้าบัญชีที่ถูกต้อง · ตอนขาย QR จะมียอดเงินอยู่ในตัว</p>}
        {status.kind === 'none' && <p className="store-qr-note is-warning">ยังไม่ได้ตั้งพร้อมเพย์กลาง (PROMPTPAY_ID) และร้านยังไม่มีรูป QR ลูกค้าจะโอนเงินไม่ได้จนกว่าจะเลือกรูป QR ของร้าน</p>}
        {status.kind === 'unknown' && <p className="store-qr-note is-warning">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ จึงยังไม่รู้ว่าร้านนี้ใช้ QR ไหน</p>}
      </>}
    {problem && <div className="form-error" role="alert">{problem}</div>}
    <MutationFeedback error={mutation.error} success={mutation.success} />
  </section>;
}
