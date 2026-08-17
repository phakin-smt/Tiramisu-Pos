export function MutationFeedback({ error, success }: { error: string; success: string }) {
  if (error) return <div className="mutation-feedback error-state" role="alert">{error}</div>;
  if (success) return <div className="mutation-feedback success-state" role="status">{success}</div>;
  return null;
}
