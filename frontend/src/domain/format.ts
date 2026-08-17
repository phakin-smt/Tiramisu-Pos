export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(amount);
}

export function formatPercent(value: number | null): string {
  return value === null ? '-' : new Intl.NumberFormat('th-TH', { style: 'percent', maximumFractionDigits: 1 }).format(value);
}
