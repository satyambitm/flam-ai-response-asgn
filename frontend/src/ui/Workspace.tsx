import { useEffect, useRef } from "react";
import type { Fault, ThemeInfo } from "../core/api";
import { ERROR_TITLES } from "../core/errors";
import type { GenState } from "../core/state";
import { useGenerate } from "../core/useGenerate";
import type { ThemeView } from "../themes/registry";
import { EmptyView } from "./EmptyView";
import { ErrorBoundary } from "./ErrorBoundary";
import { ErrorView } from "./ErrorView";
import { InputPanel } from "./InputPanel";
import { LoadingView } from "./LoadingView";

interface Props {
  theme: ThemeInfo;
  View: ThemeView;
  fault: Fault | null;
}

/** Generic input → request → result flow for one theme. Mount with key={theme.id} to reset on switch. */
export function Workspace({ theme, View, fault }: Props) {
  const { state, generate, retry, cancel } = useGenerate(theme.id);
  const resultRef = useRef<HTMLElement>(null);
  const settledId = state.status === "idle" || state.status === "loading" ? null : state.requestId;

  useEffect(() => {
    if (settledId !== null) resultRef.current?.focus();
  }, [settledId]);

  return (
    <>
      <InputPanel
        hint={theme.inputHint}
        maxChars={theme.maxInputChars}
        onSubmit={(input) => generate(input, fault ?? undefined)}
      />
      <p className="visually-hidden" aria-live="polite">
        {announce(state)}
      </p>
      <section ref={resultRef} tabIndex={-1} className="result" aria-label="Result">
        {state.status === "idle" && <p className="muted placeholder">Your result will appear here.</p>}
        {state.status === "loading" && <LoadingView startedAt={state.startedAt} onCancel={cancel} />}
        {state.status === "error" && <ErrorView key={state.requestId} error={state.error} onRetry={retry} />}
        {state.status === "empty" && <EmptyView message={state.message} onRetry={retry} />}
        {state.status === "success" && (
          <>
            <p className="meta">
              {state.meta.provider} · {state.meta.model} · {(state.meta.latencyMs / 1000).toFixed(1)}s
              {state.meta.repaired && <span className="badge">auto-repaired</span>}
            </p>
            <ErrorBoundary resetKey={state.requestId} onRetry={retry}>
              <View key={state.requestId} data={state.data} />
            </ErrorBoundary>
          </>
        )}
      </section>
    </>
  );
}

function announce(state: GenState<unknown>): string {
  switch (state.status) {
    case "idle":
      return "";
    case "loading":
      return "Generating…";
    case "success":
      return "Result ready.";
    case "empty":
      return "Nothing useful was generated.";
    case "error":
      return `Error: ${ERROR_TITLES[state.error.kind]}.`;
  }
}
