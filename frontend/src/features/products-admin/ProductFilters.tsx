export type ProductStatusFilter = 'all' | 'active' | 'inactive';

interface Props {
  query: string;
  status: ProductStatusFilter;
  category: string;
  categories: string[];
  onQuery(value: string): void;
  onStatus(value: ProductStatusFilter): void;
  onCategory(value: string): void;
}

export function ProductFilters({ query, status, category, categories, onQuery, onStatus, onCategory }: Props) {
  return <div className="product-filters">
    <label><span>ค้นหาเมนู</span><input type="search" placeholder="ชื่อหรือรหัสเมนู" value={query} onChange={(event) => onQuery(event.target.value)} /></label>
    <label><span>สถานะ</span><select value={status} onChange={(event) => onStatus(event.target.value as ProductStatusFilter)}><option value="all">ทั้งหมด</option><option value="active">เปิดขาย</option><option value="inactive">พักขาย</option></select></label>
    <label><span>หมวดหมู่</span><select value={category} onChange={(event) => onCategory(event.target.value)}><option value="all">ทุกหมวดหมู่</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
  </div>;
}
