interface CategoryTabsProps {
  categories: readonly string[];
  selected: string;
  onSelect(category: string): void;
}

export function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  return <div className="category-tabs" role="tablist" aria-label="หมวดหมู่สินค้า">
    {categories.map((category) => <button
      key={category}
      type="button"
      role="tab"
      aria-selected={selected === category}
      onClick={() => onSelect(category)}
    >{category}</button>)}
  </div>;
}
