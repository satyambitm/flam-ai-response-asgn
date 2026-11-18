import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Changing this clears a caught error (e.g. a new result arrived). */
  resetKey: unknown;
  onRetry: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

/** Contains a theme renderer crash to its card, so a View bug never blanks the app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[view] render failed:", error.message, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card error" role="alert">
        <h2>Couldn't display this result</h2>
        <p className="muted">The data arrived, but this view failed to render it.</p>
        <button type="button" className="primary" onClick={this.props.onRetry}>
          Retry
        </button>
      </div>
    );
  }
}
