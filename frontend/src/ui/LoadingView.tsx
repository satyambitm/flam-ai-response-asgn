import { useEffect, useState } from "react";

/** After this long, assume a free-tier cold start rather than a slow model. */
export const WAKE_HINT_AFTER_MS = 5_000;

interface Props {
  startedAt: number;
  label?: string;
  onCancel?: () => void;
}

export function LoadingView({ startedAt, label = "Generating", onCancel }: Props) {
  const elapsed = useElapsed(startedAt);
  return (
    <div className="card loading" aria-busy="true">
      <div className="loading-head">
        <span className="spinner" aria-hidden="true" />
        <span>
          {label}… {Math.floor(elapsed / 1000)}s
        </span>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {elapsed >= WAKE_HINT_AFTER_MS && (
        <p className="muted">Waking up the server… free hosting can take 30–50 s on the first request.</p>
      )}
      <div className="skeleton" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, now - startedAt);
}
