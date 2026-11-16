import { useMemo, useState } from 'react';
import { deleteProduct, setProductActive } from '../../api/products';
import { ErrorState, LoadingState } from '../../components/AsyncState';
import { MutationFeedback } from '../../components/MutationFeedback';
import { PageHeader } from '../../components/PageHeader';
import { bangkokDateISO } from '../../domain/date';
import type { StockSummaryItem } from '../../types/stock';
import { useSafeMutation } from '../shared/useSafeMutation';
import { useStockSummary } from '../stock/useStockSummary';
import { ProductFilters, type ProductStatusFilter } from './ProductFilters';
import { ProductFormModal } from './ProductFormModal';
import { ProductList } from './ProductList';
import { StorePaymentQrSection } from './StorePaymentQrSection';

export function ProductsAdminPage() {
  const today = bangkokDateISO();
  const [revision, setRevision] = useState(0);
  const products = useStockSummary(today, revision);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ProductStatusFilter>('all');
  const [category, setCategory] = useState('all');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<StockSummaryItem | null>(null);
  const [notice, setNotice] = useState('');
  const mutation = useSafeMutation();
  const items = products.data?.items ?? [];
  const categories = useMemo(() => [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'th')), [items]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('th');
    return items.filter((item) => {
      const matchesQuery = !normalized || item.name.toLocaleLowerCase('th').includes(normalized) || item.code.toLocaleLowerCase('th').includes(normalized);
      const matchesStatus = status === 'all' || (status === 'active' ? item.active : !item.active);
      return matchesQuery && matchesStatus && (category === 'all' || item.category === category);
    });
  }, [category, items, query, status]);

  const refresh = () => setRevision((current) => current + 1);
  const openCreate = () => { setEditing(null); setFormOpen(true); setNotice(''); mutation.clear(); };
  const openEdit = (product: StockSummaryItem) => { setEditing(product); setFormOpen(true); setNotice(''); mutation.clear(); };
  const changeActive = async (product: StockSummaryItem, active: boolean) => {
    setNotice('');
    const result = await mutation.run(() => setProductActive(product.productId, active), active ? `เปิดขาย ${product.name} แล้ว` : `พักขาย ${product.name} แล้ว`);
    if (result) refresh();
  };
  const remove = async (product: StockSummaryItem) => {
    if (!window.confirm(`ต้องการลบเมนู "${product.name}" ใช่หรือไม่?
ถ้าเมนูนี้มีประวัติการขายหรือสต็อก ระบบจะพักขายแทนการลบ เพื่อเก็บประวัติไว้`)) return;
    setNotice('');
    const result = await mutation.run(() => deleteProduct(product.productId), '');
    if (!result) return;
    // The server keeps a menu with history and only takes it off sale; say
    // which happened rather than claim a deletion the list contradicts.
    setNotice(result.deactivated ? `${product.name} มีประวัติการขายหรือสต็อก จึงพักขายแทนการลบ` : `ลบ ${product.name} แล้ว`);
    refresh();
  };
  const saved = (message: string) => { setFormOpen(false); setEditing(null); setNotice(message); refresh(); };

  return <section className="data-page products-admin-page">
    <PageHeader title="ตั้งค่า" />
    <StorePaymentQrSection />
    <div className="page-toolbar"><div><h2>เมนูทั้งหมด</h2><span>{items.length} เมนู · เปิดขาย {items.filter((item) => item.active).length} เมนู</span></div><button type="button" className="primary-button" disabled={mutation.pending} onClick={openCreate}>+ เพิ่มเมนูใหม่</button></div>
    <ProductFilters query={query} status={status} category={category} categories={categories} onQuery={setQuery} onStatus={setStatus} onCategory={setCategory} />
    <MutationFeedback error={mutation.error} success={notice || mutation.success} />
    {products.loading && <LoadingState label="กำลังโหลดรายการเมนู" />}
    {products.error && <ErrorState message={products.error} />}
    {products.data && <ProductList products={filtered} pending={mutation.pending} onEdit={openEdit} onActive={changeActive} onDelete={remove} />}
    {formOpen && <ProductFormModal product={editing} categories={categories} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={saved} />}
  </section>;
}
