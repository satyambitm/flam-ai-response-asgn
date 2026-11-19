import { type CSSProperties, type KeyboardEvent, useRef } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** id of the panel this tab controls, for aria-controls */
  controls?: string;
}

interface Props<T extends string> {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * A tablist with a sliding thumb (pattern after 21st.dev's "Segmented Control", re-done in plain CSS).
 * Segments are equal width so the thumb is one transform; arrows, Home and End move selection and
 * focus together (roving tabindex), as the WAI-ARIA tabs pattern expects.
 */
export function Segmented<T extends string>({ label, options, value, onChange, className = "" }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  const go = (i: number) => {
    const n = options.length;
    const next = (i + n) % n;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const targets: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: -1 };
    const to = targets[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation(); // the flashcard deck also listens for arrows
    go(to);
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`segmented ${className}`}
      style={{ "--count": options.length, "--index": index } as CSSProperties}
    >
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(node) => {
            refs.current[i] = node;
          }}
          type="button"
          role="tab"
          aria-selected={i === index}
          aria-controls={o.controls}
          tabIndex={i === index ? 0 : -1}
          className={i === index ? "segment active" : "segment"}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
