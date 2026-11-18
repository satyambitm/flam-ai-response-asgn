import { useEffect, useState } from "react";
import { type AppError, ERROR_TITLES } from "../core/errors";

interface Props {
  error: AppError;
  onRetry: () => void;
}

export function ErrorView({ error, onRetry }: Props) {
  const wait = useCountdown(error.retryAfter ?? 0);
  return (
    <div className="card error" role="alert">
      <h2>{ERROR_TITLES[error.kind]}</h2>
      <p>{error.message}</p>
      {error.kind === "input" && <p className="muted">Edit your text above and submit again.</p>}
      {error.retryable && (
        <button type="button" className="primary" onClick={onRetry} disabled={wait > 0}>
          {wait > 0 ? `Retry in ${wait}s` : "Retry"}
        </button>
      )}
    </div>
  );
}

/** Seconds left until `seconds` from mount. Mount with a fresh key per error to restart it. */
function useCountdown(seconds: number): number {
  const [until] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [until]);
  return Math.max(0, Math.ceil((until - now) / 1000));
}
