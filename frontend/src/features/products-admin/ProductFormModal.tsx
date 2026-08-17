import { useEffect, useRef, useState } from 'react';
import { createProduct, updateProduct } from '../../api/products';
import { MutationFeedback } from '../../components/MutationFeedback';
import type { ProductPayload } from '../../types/products';
import type { StockSummaryItem } from '../../types/stock';
import { useSafeMutation } from '../shared/useSafeMutation';

interface Props {
  product: StockSummaryItem | null;
  categories: string[];
  onClose(): void;
  onSaved(message: string): void;
}

interface FormValues {
  code: string; name: string; category: string; price: string; cost: string;
  stock: string; minStock: string; active: boolean;
}

function initialValues(product: StockSummaryItem | null): FormValues {
  return product ? {
    code: product.code, name: product.name, category: product.category,
    price: String(product.price), cost: String(product.cost), stock: String(product.stockNow),
    minStock: String(product.minStock), active: product.active,
  } : { code: '', name: '', category: '', price: '', cost: '0', stock: '0', minStock: '2', active: true };
}

export function ProductFormModal({ product, categories, onClose, onSaved }: Props) {
  const [values, setValues] = useState(() => initialValues(product));
  const [validation, setValidation] = useState('');
  const mutation = useSafeMutation();
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => { firstInput.current?.focus(); }, []);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !mutation.pending) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mutation.pending, onClose]);

  const field = (name: keyof FormValues, value: string | boolean) => setValues((current) => ({ ...current, [name]: value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: ProductPayload = {
      code: values.code.trim(), name: values.name.trim(), category: values.category.trim(),
      price: Number(values.price), cost: Number(values.cost || 0), stock: Number(values.stock || 0),
      minStock: Number(values.minStock || 0), active: values.active,
    };
    if (!payload.code || !payload.name || !payload.category || values.price === '') {
      setValidation('กรอกรหัสเมนู ชื่อเมนู หมวดหมู่ และราคาให้ครบ'); return;
    }
    if (![payload.price, payload.cost, payload.stock, payload.minStock].every(Number.isFinite)
      || Math.min(payload.price, payload.cost, payload.stock, payload.minStock) < 0
      || !Number.isInteger(payload.stock) || !Number.isInteger(payload.minStock)) {
      setValidation('ราคาและจำนวนต้องเป็นตัวเลขไม่ติดลบ และจำนวนสต็อกต้องเป็นจำนวนเต็ม'); return;
    }
    setValidation('');
    const result = await mutation.run(
      () => product ? updateProduct(product.productId, payload) : createProduct(payload),
      product ? 'แก้ไขเมนูแล้ว' : 'เพิ่มเมนูใหม่แล้ว',
    );
    if (result) onSaved(product ? 'แก้ไขเมนูแล้ว' : 'เพิ่มเมนูใหม่แล้ว');
  };

  return <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !mutation.pending) onClose(); }}>
    <section className="product-modal" role="dialog" aria-modal="true" aria-labelledby="product-form-title">
      <header><h2 id="product-form-title">{product ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่'}</h2><button type="button" className="icon-button" aria-label="ปิด" disabled={mutation.pending} onClick={onClose}>×</button></header>
      <form onSubmit={submit}>
        <div className="product-form-grid">
          <label><span>รหัสเมนู</span><input ref={firstInput} value={values.code} onChange={(event) => field('code', event.target.value)} required /></label>
          <label><span>ชื่อเมนู</span><input value={values.name} onChange={(event) => field('name', event.target.value)} required /></label>
          <label className="form-wide"><span>หมวดหมู่</span><input list="product-categories" value={values.category} onChange={(event) => field('category', event.target.value)} required /><datalist id="product-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
          <label><span>ราคาขาย (บาท)</span><input type="number" min="0" step="0.01" value={values.price} onChange={(event) => field('price', event.target.value)} required /></label>
          <label><span>ต้นทุน/ชิ้น (บาท)</span><input type="number" min="0" step="0.01" value={values.cost} onChange={(event) => field('cost', event.target.value)} /></label>
          <label><span>จำนวนคงเหลือ</span><input type="number" min="0" step="1" inputMode="numeric" value={values.stock} onChange={(event) => field('stock', event.target.value)} /></label>
          <label><span>จุดสั่งเตรียมขั้นต่ำ</span><input type="number" min="0" step="1" inputMode="numeric" value={values.minStock} onChange={(event) => field('minStock', event.target.value)} /></label>
          <label className="active-toggle form-wide"><input type="checkbox" checked={values.active} onChange={(event) => field('active', event.target.checked)} /><span>เปิดขายเมนูนี้</span></label>
        </div>
        {validation && <div className="form-error" role="alert">{validation}</div>}
        <MutationFeedback error={mutation.error} success={mutation.success} />
        <footer><button type="button" className="secondary-button" disabled={mutation.pending} onClick={onClose}>ยกเลิก</button><button type="submit" className="primary-button" disabled={mutation.pending}>{mutation.pending ? 'กำลังบันทึก' : 'บันทึกเมนู'}</button></footer>
      </form>
    </section>
  </div>;
}
