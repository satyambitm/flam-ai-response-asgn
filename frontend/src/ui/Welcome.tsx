import { type CSSProperties, useId } from "react";
import type { ThemeIntro } from "../themes/registry";

interface Props {
  intro: ThemeIntro;
  /** Fills the input with an example; the user still chooses Generate. */
  onPick: (example: string) => void;
}

/**
 * The first-run panel where the result will appear: what this theme makes, and example inputs as
 * chips (layout after 21st.dev's "Chat Empty State"). A chip fills the box rather than generating,
 * so nothing is sent until the user asks.
 */
export function Welcome({ intro, onPick }: Props) {
  const labelId = useId();
  return (
    <div className="welcome">
      <div className="welcome-art" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <h2>{intro.title}</h2>
      <p className="muted">{intro.body}</p>
      {intro.examples.length > 0 && (
        <div className="welcome-examples">
          <p id={labelId} className="eyebrow">
            Or start from an example
          </p>
          <ul aria-labelledby={labelId} className="chips">
            {intro.examples.map((example, i) => (
              <li key={example} style={{ "--i": i } as CSSProperties}>
                <button type="button" className="chip" onClick={() => onPick(example)}>
                  {example}
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <path
                      d="M5 11 11 5M6 5h5v5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
