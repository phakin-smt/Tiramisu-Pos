export function LoadingState({ label = 'กำลังโหลดข้อมูล' }: { label?: string }) {
  return <div className="loading-state" role="status" aria-live="polite">{label}</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="error-state" role="alert">{message}</div>;
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}
