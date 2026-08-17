export const navigationItems = [
  { path: '/sell', label: 'ขายสินค้า', shortLabel: 'ขาย', marker: 'S' },
  { path: '/stock', label: 'จัดการสต็อก', shortLabel: 'สต็อก', marker: 'K' },
  { path: '/orders', label: 'ออเดอร์', shortLabel: 'ออเดอร์', marker: 'O' },
  { path: '/reports', label: 'รายงาน', shortLabel: 'รายงาน', marker: 'R' },
  { path: '/analytics', label: 'วิเคราะห์', shortLabel: 'วิเคราะห์', marker: 'A' },
  { path: '/settings', label: 'ตั้งค่า', shortLabel: 'ตั้งค่า', marker: 'T' },
] as const;
