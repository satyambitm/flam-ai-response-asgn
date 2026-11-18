import { type FormEvent, type KeyboardEvent, useId, useState } from "react";

interface Props {
  hint: string;
  maxChars: number;
  onSubmit: (input: string) => void;
}

export function InputPanel({ hint, maxChars, onSubmit }: Props) {
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
    <form className="input-panel" onSubmit={submit}>
      <label htmlFor={id} className="visually-hidden">
        Your text
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={hint}
        rows={6}
        aria-invalid={tooLong}
        aria-describedby={`${id}-count`}
      />
      <div className="input-row">
        <span id={`${id}-count`} className={tooLong ? "counter over" : "counter"}>
          {length.toLocaleString()} / {maxChars.toLocaleString()}
          {tooLong && " · too long"}
        </span>
        <button type="submit" className="primary" disabled={!canSubmit}>
          Generate
        </button>
      </div>
      <p className="kbd-hint">Ctrl/⌘ + Enter to submit</p>
    </form>
  );
}
