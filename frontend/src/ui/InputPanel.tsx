import { type FormEvent, type KeyboardEvent, type ReactNode, type Ref, useId, useState } from "react";

interface Props {
  hint: string;
  maxChars: number;
  onSubmit: (input: string) => void;
  /** Extra controls placed beside Generate. */
  controls?: ReactNode;
  /** Controlled text, for a parent that fills the box (e.g. from an example). Uncontrolled if omitted. */
  value?: string;
  onChange?: (text: string) => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function InputPanel({ hint, maxChars, onSubmit, controls, value, onChange, textareaRef }: Props) {
  const [own, setOwn] = useState("");
  const text = value ?? own;
  const setText = onChange ?? setOwn;
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
      <div className="composer-head">
        <label htmlFor={id}>Your notes</label>
        {text && (
          <button type="button" className="link" onClick={() => setText("")}>
            Clear
          </button>
        )}
      </div>
      <textarea
        ref={textareaRef}
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
      <div className="composer-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, (length / maxChars) * 100)}%` }} className={tooLong ? "over" : ""} />
      </div>
      <div className="composer-bar">
        <span id={`${id}-count`} className={tooLong ? "counter over" : "counter"}>
          {length.toLocaleString()} / {maxChars.toLocaleString()}
          {tooLong && ", too long"}
        </span>
        <span className="kbd-hint" aria-hidden="true">
          <kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd>
        </span>
      </div>
      <div className="composer-actions">
        {controls}
        <button type="submit" className="primary" disabled={!canSubmit}>
          Generate
        </button>
      </div>
    </form>
  );
}
