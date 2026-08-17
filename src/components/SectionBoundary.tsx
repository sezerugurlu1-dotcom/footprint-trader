// Per-section error boundary.
//
// The single top-level <ErrorBoundary> in main.tsx is the right last
// resort, but a chart crash nukes the order book and ticker too.  This
// boundary isolates each section so a failure in one doesn't take down
// the rest of the app.  Each boundary shows a small, contextual error
// message; users can still see the other sections and use the manual
// reconnect button.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Short label for the section (e.g. "Chart", "Ticker"). */
  label: string;
  /** Optional custom fallback.  Defaults to a compact red banner. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** When provided, a "↻ Retry" button is rendered next to the message. */
  onRetry?: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class SectionBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to the browser console; we don't have a real telemetry sink.
    console.error(`[SectionBoundary:${this.props.label}]`, error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div
        role="alert"
        className="p-3 text-xs text-tv-red bg-tv-panel border border-tv-border rounded m-2"
      >
        <div className="font-semibold mb-1">
          {this.props.label} failed
        </div>
        <div className="font-mono text-tv-textDim break-words">
          {error.message || String(error)}
        </div>
        {(this.props.onRetry || true) && (
          <button
            type="button"
            onClick={() => {
              this.reset();
              this.props.onRetry?.();
            }}
            className="mt-2 px-2 py-1 text-xs text-tv-textDim hover:text-tv-text border border-tv-border rounded"
          >
            ↻ Retry
          </button>
        )}
      </div>
    );
  }
}
