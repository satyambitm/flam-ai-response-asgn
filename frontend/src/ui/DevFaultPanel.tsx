import type { Fault } from "../core/api";

// `satisfies` makes a typo or a fault removed from the backend a compile error.
export const FAULTS = [
  "ok",
  "fenced",
  "prose",
  "truncated",
  "wrong_shape",
  "empty",
  "slow",
  "timeout",
  "error_500",
  "rate_429",
  "bad_then_ok",
] as const satisfies readonly Fault[];

interface Props {
  fault: Fault | null;
  onChange: (fault: Fault | null) => void;
}

/** Routes requests to the backend's mock provider with an injected fault (needs ALLOW_FAULTS on the server). */
export function DevFaultPanel({ fault, onChange }: Props) {
  return (
    <aside className="dev-panel">
      <label>
        Fault injection{" "}
        <select value={fault ?? ""} onChange={(e) => onChange((e.target.value || null) as Fault | null)}>
          <option value="">off (real AI)</option>
          {FAULTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
    </aside>
  );
}
