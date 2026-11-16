import type { OrderFilters, OrderPaymentFilter, OrderSort, OrderStatusFilter } from '../../domain/orderFilters';

interface Props {
  filters: OrderFilters;
  onChange(filters: OrderFilters): void;
}

export function OrderFilterBar({ filters, onChange }: Props) {
  const update = (patch: Partial<OrderFilters>) => onChange({ ...filters, ...patch });
  return <div className="order-filters" role="search" aria-label="กรองออเดอร์">
    <label className="order-filter-query"><span>ค้นหา</span><input type="search" placeholder="เลขออเดอร์หรือชื่อเมนู" value={filters.query} onChange={(event) => update({ query: event.target.value })} /></label>
    <label><span>ช่องทางชำระ</span><select value={filters.payment} onChange={(event) => update({ payment: event.target.value as OrderPaymentFilter })}><option value="all">ทุกช่องทาง</option><option value="cash">เงินสด</option><option value="transfer">โอน/พร้อมเพย์</option></select></label>
    <label><span>สถานะ</span><select value={filters.status} onChange={(event) => update({ status: event.target.value as OrderStatusFilter })}><option value="all">ทุกสถานะ</option><option value="completed">เสร็จสิ้น</option><option value="cancelled">ยกเลิกแล้ว</option></select></label>
    <label className="order-filter-sort"><span>เรียงตาม</span><select value={filters.sort} onChange={(event) => update({ sort: event.target.value as OrderSort })}><option value="oldest">เวลา เก่า → ใหม่</option><option value="newest">เวลา ใหม่ → เก่า</option><option value="highest">ยอด มาก → น้อย</option><option value="lowest">ยอด น้อย → มาก</option></select></label>
  </div>;
}
