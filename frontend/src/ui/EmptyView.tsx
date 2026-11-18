interface Props {
  message: string;
  onRetry: () => void;
}

export function EmptyView({ message, onRetry }: Props) {
  return (
    <div className="card empty">
      <h2>Nothing to show yet</h2>
      <p>{message}</p>
      <p className="muted">Tip: paste more detail, or be specific about what you want out of it.</p>
      <button type="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
