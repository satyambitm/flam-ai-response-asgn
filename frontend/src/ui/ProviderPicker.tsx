import type { ProviderId, ProviderOption } from "../core/api";

interface Props {
  options: ProviderOption[];
  value: ProviderId;
  onChange: (id: ProviderId) => void;
  /** Fault injection routes to the mock, so the choice wouldn't apply. */
  locked?: boolean;
}

/** The server lists only the providers it has keys for and validates the id again on every request. */
export function ProviderPicker({ options, value, onChange, locked = false }: Props) {
  return (
    <label className="picker" title={locked ? "Fault injection is on, so the mock answers" : undefined}>
      <span className="visually-hidden">Model</span>
      <select value={value} disabled={locked} onChange={(e) => onChange(e.target.value as ProviderId)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title} ({o.model})
          </option>
        ))}
      </select>
    </label>
  );
}
