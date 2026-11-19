import { type FormEvent, type KeyboardEvent, type ReactNode, useId, useState } from "react";

interface Props {
  hint: string;
  maxChars: number;
  onSubmit: (input: string) => void;
  /** Extra controls placed beside Generate. */
  controls?: ReactNode;
}

export function InputPanel({ hint, maxChars, onSubmit, controls }: Props) {
  const [text, setText] = useState("");
  const id = useId();
  const length = text.trim().length;
  const tooLong = length > maxChars; // same rule as the backend: trimmed length
  const canSubmit = length > 0 && !tooLong;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (canSubmit) onSubmit(text);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">
        Your text
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={hint}
        rows={8}
        aria-invalid={tooLong}
        aria-describedby={`${id}-count`}
        aria-keyshortcuts="Control+Enter Meta+Enter"
      />
      <div className="composer-bar">
        <span id={`${id}-count`} className={tooLong ? "counter over" : "counter"}>
          {length.toLocaleString()} / {maxChars.toLocaleString()}
          {tooLong && ", too long"}
        </span>
        <span className="kbd-hint" aria-hidden="true">
          <kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd>
        </span>
        <div className="composer-actions">
          {controls}
          <button type="submit" className="primary" disabled={!canSubmit}>
            Generate
          </button>
        </div>
      </div>
    </form>
  );
}
