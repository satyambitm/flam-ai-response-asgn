import { type ReactNode, useEffect, useRef } from "react";
import type { Fault, ProviderId, ThemeInfo } from "../core/api";
import { ERROR_TITLES } from "../core/errors";
import { formatUsage } from "../core/format";
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
  /** null: the server's configured chain. */
  provider: ProviderId | null;
  picker?: ReactNode;
}

/** Generic input → request → result flow for one theme. Mount with key={theme.id} to reset on switch. */
export function Workspace({ theme, View, fault, provider, picker }: Props) {
  const { state, generate, retry, cancel } = useGenerate(theme.id);
  const resultRef = useRef<HTMLElement>(null);
  const settledId = state.status === "idle" || state.status === "loading" ? null : state.requestId;

  useEffect(() => {
    if (settledId !== null) resultRef.current?.focus();
  }, [settledId]);

  return (
    <div className="workspace">
      <InputPanel
        hint={theme.inputHint}
        maxChars={theme.maxInputChars}
        onSubmit={(input) => generate(input, { fault: fault ?? undefined, provider: provider ?? undefined })}
        controls={picker}
      />
      <p className="visually-hidden" aria-live="polite">
        {announce(state)}
      </p>
      <section ref={resultRef} tabIndex={-1} className="result" aria-label="Result">
        {state.status === "idle" && (
          <p className="placeholder">Paste your text and choose Generate. The result appears here.</p>
        )}
        {state.status === "loading" && <LoadingView startedAt={state.startedAt} onCancel={cancel} />}
        {state.status === "error" && <ErrorView key={state.requestId} error={state.error} onRetry={retry} />}
        {state.status === "empty" && <EmptyView message={state.message} onRetry={retry} />}
        {state.status === "success" && (
          <>
            <ErrorBoundary resetKey={state.requestId} onRetry={retry}>
              <View key={state.requestId} data={state.data} />
            </ErrorBoundary>
            <dl className="meta">
              <div>
                <dt>Model</dt>
                <dd>
                  {state.meta.provider} / {state.meta.model}
                </dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{(state.meta.latencyMs / 1000).toFixed(1)} s</dd>
              </div>
              <div>
                <dt>Usage</dt>
                <dd>{formatUsage(state.meta.usage)}</dd>
              </div>
              {state.meta.repaired && (
                <div>
                  <dt className="visually-hidden">Output</dt>
                  <dd className="badge">auto-repaired</dd>
                </div>
              )}
            </dl>
          </>
        )}
      </section>
    </div>
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
